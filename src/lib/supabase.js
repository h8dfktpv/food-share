import { createClient } from '@supabase/supabase-js'

/**
 * Supabase 客户端。
 * URL 与 anon key 通过 Vite 环境变量注入，anon key 可以公开，真正的访问控制由 RLS 完成。
 * 未配置时使用占位地址，保证本地开发仍能渲染登录页并看到配置提示。
 */
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://placeholder.supabase.co'
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'placeholder-anon-key'

export const isSupabaseConfigured = Boolean(
  import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY
)

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true
  }
})

export const supabaseUrl = SUPABASE_URL

/** Web Push 公钥（VAPID public key），为空时通知功能不可用 */
export const vapidPublickey = import.meta.env.VITE_VAPID_PUBLIC_KEY

/** 私有照片桶名称 */
export const PHOTO_BUCKET = 'checkin-photos'

/** 签名链接有效期：7 天（私密空间够用，也有利于离线缓存） */
export const SIGNED_URL_TTL = 60 * 60 * 24 * 7
