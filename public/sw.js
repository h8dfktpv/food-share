/* eslint-disable no-restricted-globals */
/**
 * 两人食 Service Worker
 * 职责：
 * 1. 缓存应用外壳，支持离线打开；
 * 2. 缓存私有打卡照片（按路径命中，忽略签名参数变化）；
 * 3. 接收 Web Push 并展示系统通知。
 *
 * 更新版本号即可让旧缓存失效。
 */
const VERSION = 'v2'
const SHELL_CACHE = `liangrenshi-shell-${VERSION}`
const ASSET_CACHE = `liangrenshi-assets-${VERSION}`
const IMAGE_CACHE = `liangrenshi-images-${VERSION}`

const SHELL_FILES = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png'
]

/** 离线时的图片占位（一块柔和的空盘子） */
const PLACEHOLDER_IMAGE = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 5" width="400" height="500">
  <rect width="4" height="5" fill="#F3F5F0"/>
  <circle cx="2" cy="2.5" r="0.7" fill="#E7ECE2" stroke="#D2DCC9" stroke-width="0.04"/>
</svg>`

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE)
      // 单个资源失败不应导致整个 SW 安装失败
      await Promise.allSettled(SHELL_FILES.map((url) => cache.add(url)))
      await self.skipWaiting()
    })()
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [SHELL_CACHE, ASSET_CACHE, IMAGE_CACHE]
      const keys = await caches.keys()
      await Promise.all(keys.filter((key) => !keep.includes(key)).map((key) => caches.delete(key)))
      await self.clients.claim()
    })()
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return

  const url = new URL(request.url)

  // 1. 私有照片：按去掉 query 的路径缓存
  if (url.pathname.includes('/storage/v1/object/sign/checkin-photos/')) {
    event.respondWith(serveImage(request, url))
    return
  }

  // 2. 页面导航：网络优先，离线回退到缓存的首页
  if (request.mode === 'navigate') {
    event.respondWith(serveNavigation(request))
    return
  }

  // 3. 同源静态资源：缓存优先 + 后台更新
  const isStatic =
    url.origin === self.location.origin &&
    (url.pathname.startsWith('/assets/') ||
      url.pathname.startsWith('/icons/') ||
      url.pathname.startsWith('/splash/') ||
      url.pathname === '/favicon.svg' ||
      url.pathname === '/manifest.webmanifest')

  if (isStatic) {
    event.respondWith(serveStatic(request))
  }
})

async function serveImage(request, url) {
  const cache = await caches.open(IMAGE_CACHE)
  const key = new Request(`${url.origin}${url.pathname}`)
  const cached = await cache.match(key)
  if (cached) return cached

  try {
    const response = await fetch(request)
    if (response.ok || response.type === 'opaque') {
      cache.put(key, response.clone())
    }
    return response
  } catch {
    return new Response(PLACEHOLDER_IMAGE, {
      status: 200,
      headers: { 'Content-Type': 'image/svg+xml; charset=utf-8' }
    })
  }
}

async function serveNavigation(request) {
  try {
    const response = await fetch(request)
    const cache = await caches.open(SHELL_CACHE)
    if (response.ok) {
      cache.put(request, response.clone())
      cache.put('/', response.clone())
    }
    return response
  } catch {
    const cache = await caches.open(SHELL_CACHE)
    return (
      (await cache.match(request)) ||
      (await cache.match('/')) ||
      (await cache.match('/index.html')) ||
      new Response('<h1>当前离线</h1><p>请联网后再打开两人食。</p>', {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8' }
      })
    )
  }
}

async function serveStatic(request) {
  const cache = await caches.open(ASSET_CACHE)
  const cached = await cache.match(request)

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone())
      return response
    })
    .catch(() => null)

  return cached || (await network) || new Response('', { status: 504 })
}

/* ------------------------------ Web Push ------------------------------ */

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { body: event.data ? event.data.text() : '' }
  }

  const title = payload.title || '两人食'
  const options = {
    body: payload.body || '到饭点啦，记得上传你的伙食打卡～',
    icon: '/icons/icon-192.png',
    tag: payload.tag || 'liangrenshi-reminder',
    renotify: true,
    lang: 'zh-CN',
    data: { url: payload.url || '/' }
  }

  event.waitUntil(self.registration.showNotification(title, options))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href

  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({
        type: 'window',
        includeUncontrolled: true
      })

      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin)) {
          await client.focus()
          // 告诉网页：用户是从通知点进来的，自动把信箱抽屉拉开
          client.postMessage({ type: 'open-mailbox' })
          if ('navigate' in client) await client.navigate(target)
          return
        }
      }
      await self.clients.openWindow(target)
    })()
  )
})
