/** 时间格式化工具，统一使用设备本地时区 */

const pad = (n) => String(n).padStart(2, '0')

/** 顶部日期：11月4日 · 星期二 */
export function todayLabel(date = new Date()) {
  const week = ['日', '一', '二', '三', '四', '五', '六'][date.getDay()]
  return `${date.getMonth() + 1}月${date.getDate()}日 · 星期${week}`
}

/** 时间流里的相对时间 */
export function relativeTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const now = new Date()

  const sameDay =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate()

  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  if (sameDay) return time

  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (
    date.getFullYear() === yesterday.getFullYear() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getDate() === yesterday.getDate()
  ) {
    return `昨天 ${time}`
  }

  if (date.getFullYear() === now.getFullYear()) {
    return `${date.getMonth() + 1}月${date.getDate()}日 ${time}`
  }
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日`
}

/** 评论/留言的短时间：刚刚 / 5 分钟前 / 今天 12:30 / 昨天 18:20 / 10月1日 */
export function shortTime(iso) {
  if (!iso) return ''
  const date = new Date(iso)
  const diff = Date.now() - date.getTime()

  if (diff < 60 * 1000) return '刚刚'
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / 60000)} 分钟前`
  if (diff < 24 * 60 * 60 * 1000 && diff >= 0) {
    const today = new Date()
    if (date.getDate() === today.getDate()) return `今天 ${pad(date.getHours())}:${pad(date.getMinutes())}`
  }
  return relativeTime(iso)
}

/** "08:00:00" → "08:00" */
export function displayReminderTime(time) {
  if (!time) return ''
  return String(time).slice(0, 5)
}

/** "08:00" → "08:00:00"（Postgres time 字段） */
export function toDbTime(time) {
  if (!time) return '08:00:00'
  return time.length === 5 ? `${time}:00` : time
}

/** 问候语，让首页更温柔一点 */
export function greeting(date = new Date()) {
  const hour = date.getHours()
  if (hour < 5) return '夜深了'
  if (hour < 10) return '早上好'
  if (hour < 14) return '中午好'
  if (hour < 18) return '下午好'
  return '晚上好'
}
