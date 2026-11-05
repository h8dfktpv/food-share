import { supabase, supabaseUrl } from './supabase'
const vapidPublicKey = import.meta.env.VITE_VAPID_PUBLIC_KEY

/** 判断是否 iOS（含 iPadOS，iPad 默认 UA 是 Macintosh） */
export function isIOS() {
  if (typeof navigator === 'undefined') return false
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  )
}

/** 是否以主屏幕独立应用方式打开（iOS Web Push 的必要条件） */
export function isStandalone() {
  if (typeof window === 'undefined') return false
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function pushSupported() {
  return (
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window
  )
}

/** VAPID 公钥是 base64url，Web Push 订阅需要 Uint8Array */
export function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/')
  const rawData = window.atob(base64)
  const outputArray = new Uint8Array(rawData.length)
  for (let i = 0; i < rawData.length; i += 1) outputArray[i] = rawData.charCodeAt(i)
  return outputArray
}

async function ensureRegistration() {
  let registration = await navigator.serviceWorker.getRegistration('/')
  if (!registration) {
    registration = await navigator.serviceWorker.register('/sw.js')
  }
  await navigator.serviceWorker.ready
  return registration
}

/** 汇总通知能力，供设置页展示 */
export async function getPushState() {
  const supported = pushSupported()
  let subscription = null

  if (supported) {
    try {
      const registration = await navigator.serviceWorker.getRegistration('/')
      subscription = (await registration?.pushManager.getSubscription()) ?? null
    } catch {
      subscription = null
    }
  }

  return {
    supported,
    configured: Boolean(vapidPublicKey),
    permission: supported ? Notification.permission : 'unsupported',
    standalone: isStandalone(),
    ios: isIOS(),
    subscription
  }
}

function keyMatches(subscription, publicKey) {
  const current = subscription.options?.applicationServerKey
  if (!current) return true
  const expected = urlBase64ToUint8Array(publicKey)
  const actual = new Uint8Array(current)
  return actual.length === expected.length && actual.every((byte, i) => byte === expected[i])
}

/**
 * 开启通知：申请系统权限 → 订阅推送 → 写入 push_subscriptions。
 * 必须由用户点击触发（iOS 要求用户手势）。
 */
export async function enablePush(userId, { renew = false } = {}) {
  if (!pushSupported()) throw new Error('当前浏览器不支持通知推送')
  if (!vapidPublicKey) throw new Error('尚未配置 VAPID 公钥，请检查部署环境变量')
  if (isIOS() && !isStandalone()) {
    throw new Error('iPhone 请先在 Safari 中「分享 → 添加到主屏幕」，再从桌面上打开「两人食」开启通知')
  }

  const permission = await Notification.requestPermission()
  if (permission !== 'granted') {
    throw new Error('通知权限未开启，请到 iPhone「设置 → 通知 → 两人食」中允许通知')
  }

  const registration = await ensureRegistration()
  let subscription = await registration.pushManager.getSubscription()

  // 换过 VAPID 密钥或推送服务已判定失效的旧订阅，继续复用只会一直发送失败
  if (subscription && (renew || !keyMatches(subscription, vapidPublicKey))) {
    await subscription.unsubscribe()
    subscription = null
  }

  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey)
    })
  }

  const json = subscription.toJSON()
  const { error } = await supabase.from('push_subscriptions').upsert(
    {
      user_id: userId,
      endpoint: json.endpoint,
      p256dh: json.keys.p256dh,
      auth: json.keys.auth,
      user_agent: navigator.userAgent.slice(0, 240)
    },
    { onConflict: 'endpoint' }
  )
  if (error) throw error

  return subscription
}

/** 关闭通知并删除本设备的订阅 */
export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration('/')
  const subscription = await registration?.pushManager.getSubscription()
  if (!subscription) return

  await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint)
  await subscription.unsubscribe()
}

/** 调用 Edge Function 发送一条测试通知给自己 */
export async function sendTestPush() {
  const {
    data: { session }
  } = await supabase.auth.getSession()
  if (!session) throw new Error('登录状态已失效，请重新登录')

  const res = await fetch(`${supabaseUrl}/functions/v1/send-reminders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`
    },
    body: JSON.stringify({ mode: 'test' })
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`推送服务返回 ${res.status}${text ? `：${text.slice(0, 140)}` : ''}`)
  }
  return res.json().catch(() => ({}))
}
