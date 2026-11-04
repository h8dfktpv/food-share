/**
 * 首页时间流的本地快照。
 * - 离线时直接展示上次加载的打卡与评论；
 * - 图片由 Service Worker 按路径缓存，断网仍可显示。
 */
const KEY = 'liangrenshi:feed:v1'
const MAX_ROWS = 60

export function saveFeedSnapshot(rows) {
  try {
    const trimmed = (rows || []).slice(0, MAX_ROWS)
    localStorage.setItem(KEY, JSON.stringify({ savedAt: Date.now(), rows: trimmed }))
  } catch {
    // 存储空间不足时忽略，不影响主流程
  }
}

export function loadFeedSnapshot() {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.rows)) return null
    return parsed
  } catch {
    return null
  }
}

export function clearFeedSnapshot() {
  try {
    localStorage.removeItem(KEY)
  } catch {
    /* noop */
  }
}
