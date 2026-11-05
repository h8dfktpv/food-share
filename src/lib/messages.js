import { ref } from 'vue'
import { currentUser } from './auth'
import { supabase } from './supabase'

/**
 * 站内信箱。
 * - pushMessage：给指定 user_id 写入一条消息（客户端直接 insert，受 RLS 约束）
 * - unreadCount：当前用户未读消息数（Realtime 自动更新）
 * - fetchMessages / markAsRead / markAllRead：信箱抽屉用
 *
 * 与 Web Push 的关系：Web Push 是瞬时锁屏提醒，信箱是网页内永久记录，两者独立。
 */

/** 当前用户未读消息数，供铃铛红点使用 */
export const unreadCount = ref(0)

let countChannel = null
let started = false

/** 消息类型对应的标题前缀（也可在调用处自定义 title） */
export const MESSAGE_TYPES = {
  meal_reminder: '饭点提醒',
  photo: '新的打卡',
  note: '新的留言',
  dish: '新增菜品'
}

/** 向指定账号发送一条站内消息，并同步推送系统通知 */
export async function pushMessage({ userId, type, title, body = '', data = {} }) {
  if (!userId) {
    console.warn('[messages] pushMessage 跳过：userId 为空')
    return { error: new Error('userId 为空') }
  }

  // 1. 写入信箱（永久留存）
  const { error } = await supabase.from('messages').insert({
    user_id: userId,
    type,
    title,
    body,
    data
  })
  if (error) {
    console.error('[messages] 写入消息失败：', { type, userId, title, error: error.message })
    return { error }
  }

  // 2. 发送系统推送（锁屏/通知栏）。失败不影响信箱记录，仅打日志。
  try {
    const { data: pushRes, error: pushErr } = await supabase.functions.invoke('send-push', {
      body: {
        userId,
        title,
        body,
        url: '/',
        tag: `liangrenshi-${type}`
      }
    })
    if (pushErr) {
      console.warn('[messages] 系统推送调用失败：', pushErr.message)
    } else if (pushRes?.sent === 0) {
      console.warn('[messages] 对方暂无推送订阅，仅写入信箱：', pushRes?.message)
    }
  } catch (e) {
    console.warn('[messages] 系统推送异常：', e?.message)
  }

  return { error: null }
}

/** 拉取当前用户的全部消息（时间倒序） */
export async function fetchMessages() {
  const { data, error } = await supabase
    .from('messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)

  if (error) {
    console.warn('[messages] 拉取失败：', error.message)
    return []
  }
  return data || []
}

/** 把某条消息标记为已读 */
export async function markAsRead(messageId) {
  const { error } = await supabase
    .from('messages')
    .update({ is_read: true })
    .eq('id', messageId)
  if (error) console.warn('[messages] 标记已读失败：', error.message)
}

/** 把当前用户所有消息标记为已读 */
export async function markAllRead() {
  const { error } = await supabase
    .from('messages')
    .update({ is_read: true })
    .eq('user_id', currentUser.value?.id)
    .eq('is_read', false)
  if (error) console.warn('[messages] 全部已读失败：', error.message)
}

/** 刷新未读数（登录后调用一次） */
async function refreshUnreadCount() {
  if (!currentUser.value) {
    unreadCount.value = 0
    return
  }
  const { count, error } = await supabase
    .from('messages')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', currentUser.value.id)
    .eq('is_read', false)

  if (error) {
    console.warn('[messages] 未读数查询失败：', error.message)
    return
  }
  unreadCount.value = count ?? 0
}

/**
 * 页面打开时，收到新消息直接弹浏览器系统通知（通知栏）。
 * 这是 Web Push（页面关闭时）的补充：页面开着时靠这个，关着时靠 Edge Function 的 Web Push。
 */
function showIncomingNotification(message) {
  if (typeof window === 'undefined' || !('Notification' in window)) return
  if (Notification.permission !== 'granted') return
  // 自己的操作也会触发 realtime，但收件人是对方，所以用 user_id 过滤
  if (message?.user_id !== currentUser.value?.id) return

  try {
    const n = new Notification(message.title || '两人食', {
      body: message.body || '',
      tag: message.id,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png'
    })
    n.onclick = () => {
      window.focus()
      n.close()
    }
  } catch (e) {
    // 某些浏览器在非安全上下文会抛错，忽略
  }
}

/** 启动未读数实时监听（应用启动时调用一次） */
export function startMessagesRealtime() {
  if (started) return
  started = true

  refreshUnreadCount()

  // messages 表的 insert/update/delete 都触发重新计数；INSERT 时弹系统通知
  countChannel = supabase
    .channel('messages-unread')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      (payload) => {
        refreshUnreadCount()
        if (payload.eventType === 'INSERT') {
          showIncomingNotification(payload.new)
        }
      }
    )
    .subscribe()
}

/** 停止监听（退出登录时调用） */
export function stopMessagesRealtime() {
  if (countChannel) {
    supabase.removeChannel(countChannel)
    countChannel = null
  }
  started = false
  unreadCount.value = 0
}
