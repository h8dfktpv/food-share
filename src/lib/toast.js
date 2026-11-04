import { ref } from 'vue'

/** 极简全局提示，避免为两个账号的小应用引入额外 UI 依赖 */
export const toasts = ref([])
let seq = 0

/**
 * 弹一条提示
 * @param {string} message 提示内容
 * @param {string} type info / success / error / remind
 * @param {number} duration 持续毫秒，默认 2800
 */
export function toast(message, type = 'info', duration = 2800) {
  const id = ++seq
  toasts.value.push({ id, message, type })
  window.setTimeout(() => {
    toasts.value = toasts.value.filter((t) => t.id !== id)
  }, duration)
}

export const toastError = (message) => toast(message, 'error')
export const toastSuccess = (message) => toast(message, 'success')
/** 饭点提醒弹窗，停留更久一点 */
export const toastRemind = (message) => toast(message, 'remind', 9000)
