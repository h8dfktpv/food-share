// @ts-nocheck
/**
 * 两人食 · 即时事件推送
 *
 * 用途：打卡、留言、新增菜品等事件发生时，由前端调用本函数，
 *       给「对方」的所有设备推送一条系统通知（锁屏/通知栏）。
 *       同时也会写入 messages 信箱（由前端负责插入，本函数只负责推送）。
 *
 * 触发方式：前端在 pushMessage 成功后调用，带用户 JWT。
 * 请求体：{ userId: string, title: string, body: string, url?: string, tag?: string }
 *
 * 需要的环境变量（与 send-reminders 共用）：
 *   VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入。
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const env = {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  vapidPublic: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  vapidPrivate: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  vapidSubject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com'
}

const admin = createClient(env.url, env.serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false }
})

if (env.vapidPublic && env.vapidPrivate) {
  webpush.setVapidDetails(env.vapidSubject, env.vapidPublic, env.vapidPrivate)
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  })
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

/** 向一组订阅发送通知；404/410 说明设备已注销，顺手清理 */
async function sendToSubscriptions(subscriptions: SubscriptionRow[], payload: { title: string; body: string; url: string; tag: string }) {
  let sent = 0
  let removed = 0
  let failed = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          JSON.stringify(payload),
          { TTL: 60 * 60, urgency: 'high' }
        )
        sent += 1
      } catch (error) {
        const statusCode = (error as { statusCode?: number }).statusCode
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id)
          removed += 1
        } else {
          failed += 1
          console.error('[send-push] 发送失败', sub.id, statusCode, error)
        }
      }
    })
  )

  return { sent, removed, failed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }
  if (!env.vapidPublic || !env.vapidPrivate) {
    return json({ error: 'VAPID 未配置' }, 500)
  }

  // 校验调用者身份（必须是空间成员）
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '缺少登录凭证' }, 401)

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return json({ error: '登录凭证无效' }, 401)

  const callerId = data.user.id
  const { data: callerMember } = await admin
    .from('members')
    .select('user_id')
    .eq('user_id', callerId)
    .maybeSingle()
  if (!callerMember) return json({ error: '无权操作' }, 403)

  // 解析请求体
  let body: any
  try {
    body = await req.json()
  } catch {
    return json({ error: '请求体不是合法 JSON' }, 400)
  }

  const { userId, title, body: pushBody, url = '/', tag = 'liangrenshi-event' } = body || {}
  if (!userId || !title) {
    return json({ error: '缺少 userId 或 title' }, 400)
  }

  // 查出收件人的所有设备订阅
  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId)

  if (!subscriptions?.length) {
    return json({ ok: true, sent: 0, message: '对方还没有推送订阅（需先在设置页开启通知）' })
  }

  const result = await sendToSubscriptions(subscriptions, {
    title,
    body: pushBody || '',
    url,
    tag
  })

  return json({ ok: true, ...result })
})
