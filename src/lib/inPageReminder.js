import { supabase } from './supabase'
import { toastRemind } from './toast'
import { displayReminderTime } from './date'

/**
 * 网页内计时器提醒（兜底方案）。
 *
 * 背景：iPhone（iOS 16.4+，从桌面图标打开）可以正常收 Web Push 锁屏通知；
 * 但国内华为 / 部分安卓即使添加到桌面，后台休眠后 Web Push 也经常收不到
 * （无 FCM 通道 + 系统省电策略）。
 *
 * 这里在网页打开时轮询提醒时间，到点在网页内弹窗提醒，不依赖系统通知。
 * 只要网页开着（无论前台还是切回前台），就能看到饭点提示。
 */

const CHECK_INTERVAL = 25 * 1000 // 每 25 秒检查一次，足够覆盖分钟级提醒
let timer = null
let lastFetchedAt = 0
let cachedReminders = []
/** 已弹过的提醒 key：`${reminderId}:${YYYY-MM-DD}`，避免同一天重复弹 */
const firedKeys = new Set()

function todayKey(date = new Date()) {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function nowHHmm(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function fetchReminders() {
  // 简单节流：避免频繁查库
  if (Date.now() - lastFetchedAt < 60 * 1000 && cachedReminders.length) {
    return cachedReminders
  }
  const { data, error } = await supabase
    .from('reminders')
    .select('id, label, remind_at, message, enabled')
    .eq('enabled', true)
  if (error) {
    console.warn('[inPageReminder] 拉取提醒失败：', error.message)
    return cachedReminders
  }
  cachedReminders = data || []
  lastFetchedAt = Date.now()
  return cachedReminders
}

async function tick() {
  const reminders = await fetchReminders()
  const hhmm = nowHHmm()
  const day = todayKey()

  for (const item of reminders) {
    if (!item?.remind_at) continue
    const target = displayReminderTime(item.remind_at) // "08:00"
    if (target !== hhmm) continue

    const key = `${item.id}:${day}`
    if (firedKeys.has(key)) continue
    firedKeys.add(key)

    // 同一天内只清一次旧 key，避免集合无限增长
    if (firedKeys.size > 200) {
      for (const k of [...firedKeys]) {
        if (!k.endsWith(`:${day}`)) firedKeys.delete(k)
      }
    }

    toastRemind(`${item.label || '饭点'} · ${target}：${item.message}`)
  }
}

/** 启动网页内提醒；已启动时不会重复启动 */
export function startInPageReminder() {
  if (timer) return
  // 启动时立即检查一次，避免错过整点
  tick().catch(() => {})
  timer = window.setInterval(() => {
    tick().catch(() => {})
  }, CHECK_INTERVAL)
}

/** 停止网页内提醒（登出时调用） */
export function stopInPageReminder() {
  if (timer) {
    window.clearInterval(timer)
    timer = null
  }
  cachedReminders = []
  lastFetchedAt = 0
}
