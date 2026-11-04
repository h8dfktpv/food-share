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
  })
}
