import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import { initAuth } from './lib/auth'
import './styles/main.css'

// 先恢复本地会话，路由守卫会读取 getSession()，不阻塞挂载
initAuth()

createApp(App).use(router).mount('#app')

// 生产环境注册 Service Worker（开发环境避免缓存干扰 HMR）
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('[sw] 注册失败：', error)
    })

    // 从锁屏通知点开时，sw 会 postMessage 过来；
    // 转发成 window 事件，Mailbox 组件收到就自动拉开抽屉
    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'open-mailbox') {
        setTimeout(() => window.dispatchEvent(new Event('open-mailbox')), 400)
      }
    })
  })
}
