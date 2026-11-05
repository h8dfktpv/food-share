import { computed, ref } from 'vue'
import { supabase } from './supabase'

/**
 * 全局登录状态。
 * 小应用只有两个账号，不需要 Pinia，用模块级 reactive 状态即可。
 */
export const currentUser = ref(null)
export const currentMember = ref(null)
export const members = ref([])
export const authReady = ref(false)

let initStarted = false
let authListener = null

/** 对方（另一个账号） */
export const partner = computed(() => {
  return members.value.find((m) => m.user_id !== currentUser.value?.id) || null
})

/** 根据 user_id 取展示名，用于打卡/评论列表 */
export function memberName(userId) {
  if (!userId) return 'TA'
  if (userId === currentUser.value?.id) {
    return currentMember.value?.display_name || '我'
  }
  return members.value.find((m) => m.user_id === userId)?.display_name || 'TA'
}

/** 拉取空间内的成员（RLS 保证只有两个账号能读到） */
export async function loadMembers() {
  const { data, error } = await supabase
    .from('members')
    .select('user_id, email, display_name, partner_id')
    .order('created_at', { ascending: true })

  if (error) {
    // 触发器等配置未完成时可能读不到，静默降级为默认称呼
    console.warn('[auth] 读取成员失败：', error.message)
    return
  }
  members.value = data || []
  currentMember.value = members.value.find((m) => m.user_id === currentUser.value?.id) || null
}

/** 应用启动时初始化会话，只执行一次 */
export async function initAuth() {
  if (initStarted) return
  initStarted = true

  const {
    data: { session }
  } = await supabase.auth.getSession()

  currentUser.value = session?.user ?? null
  if (currentUser.value) await loadMembers()
  authReady.value = true

  // 监听登录态变化（刷新 token、退出登录）
  const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
    currentUser.value = nextSession?.user ?? null
    if (nextSession?.user) {
      // 不在回调里直接 await Supabase 请求，避免 auth 锁竞争
      window.setTimeout(() => {
        loadMembers()
      }, 0)
    } else {
      currentMember.value = null
      members.value = []
    }
  })
  authListener = data?.subscription ?? null
}

export async function signInWithPassword(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim(),
    password
  })
  if (error) throw new Error(translateAuthError(error.message))
  currentUser.value = data.user
  await loadMembers()
  return data
}

export async function signOut() {
  await supabase.auth.signOut()
  currentUser.value = null
  currentMember.value = null
  members.value = []
}

function translateAuthError(message = '') {
  const text = message.toLowerCase()
  if (text.includes('invalid login credentials')) return '邮箱或密码不正确'
  if (text.includes('email not confirmed')) return '邮箱尚未确认，请在 Supabase 后台确认该账号'
  if (text.includes('too many requests')) return '尝试次数太多，请稍后再试'
  if (text.includes('signups not allowed')) return '注册已关闭，只能使用预先生成的两个账号'
  return message
}

/** 组件卸载时可调用，正常情况下应用生命周期内不需要 */
export function disposeAuthListener() {
  authListener?.unsubscribe?.()
  authListener = null
}
