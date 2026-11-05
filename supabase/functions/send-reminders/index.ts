// @ts-nocheck
/**
 * 两人食 · 定时饭点提醒 / 测试推送
 *
 * 触发方式：
 *   1. pg_cron 每分钟调用一次（带 x-cron-secret 请求头）；
 *   2. 设置页「发送测试通知」按钮调用（带用户 JWT，body: { mode: "test" }）。
 *
 * 需要的环境变量（supabase secrets set ...）：
 *   VAPID_PUBLIC_KEY    Web Push 公钥
 *   VAPID_PRIVATE_KEY   Web Push 私钥（只放服务端）
 *   VAPID_SUBJECT       mailto:你的邮箱
 *   CRON_SECRET         自定义随机串，与 cron SQL 中一致
 *   REMINDER_TIMEZONE   可选，默认 Asia/Shanghai
 *
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 由 Supabase 自动注入。
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import webpush from 'npm:web-push@3.6.7'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const env = {
  url: Deno.env.get('SUPABASE_URL') ?? '',
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  cronSecret: Deno.env.get('CRON_SECRET') ?? '',
  vapidPublic: Deno.env.get('VAPID_PUBLIC_KEY') ?? '',
  vapidPrivate: Deno.env.get('VAPID_PRIVATE_KEY') ?? '',
  vapidSubject: Deno.env.get('VAPID_SUBJECT') ?? 'mailto:admin@example.com',
  timezone: Deno.env.get('REMINDER_TIMEZONE') ?? 'Asia/Shanghai'
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

/** 取指定时区的当前日期与 HH:mm，避免依赖服务器 UTC 时间 */
function nowInTimezone(timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date())

  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}:00`,
    display: `${get('hour')}:${get('minute')}`
  }
}

type SubscriptionRow = {
  id: string
  endpoint: string
  p256dh: string
  auth: string
}

type Payload = {
  title: string
  body: string
  url: string
  tag: string
}

/** 向一组订阅发送通知；404/410 说明设备已注销，顺手清理 */
async function sendToSubscriptions(subscriptions: SubscriptionRow[], payload: Payload) {
  let sent = 0
  let removed = 0
  let failed = 0

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: { p256dh: sub.p256dh, auth: sub.auth }
          },
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
          console.error('[push] 发送失败', sub.id, statusCode, error)
        }
      }
    })
  )

  return { sent, removed, failed }
}

/** 测试推送：只发给调用者自己，验证订阅链路 */
async function handleTest(req: Request) {
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!token) return json({ error: '缺少登录凭证' }, 401)

  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user) return json({ error: '登录凭证无效' }, 401)

  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', data.user.id)

  if (!subscriptions?.length) {
    return json({ ok: true, sent: 0, message: '该账号还没有推送订阅' })
  }

  const result = await sendToSubscriptions(subscriptions, {
    title: '两人食 · 测试通知',
    body: '通知已开启，饭点会准时提醒你～',
    url: '/',
    tag: 'liangrenshi-test'
  })

  return json({ ok: true, ...result })
}

/** 定时任务：找出当前分钟启用的提醒，推送给创建者的对方 */
async function handleCron(req: Request) {
  if (!env.cronSecret) {
    return json({ error: 'CRON_SECRET 未配置' }, 500)
  }
  if (req.headers.get('x-cron-secret') !== env.cronSecret) {
    return json({ error: 'unauthorized' }, 401)
  }

  const now = nowInTimezone(env.timezone)

  const { data: reminders, error } = await admin
    .from('reminders')
    .select('id, owner_id, label, message, remind_at')
    .eq('enabled', true)
    .eq('remind_at', now.time)

  if (error) throw error
  if (!reminders?.length) {
    return json({ ok: true, time: now.display, reminders: 0, sent: 0 })
  }

  const { data: members } = await admin.from('members').select('user_id')
  const allMemberIds = (members ?? []).map((member) => member.user_id)

  let sent = 0
  let skipped = 0
  let remindersReceived = 0

  for (const reminder of reminders) {
    // 每条提醒只提醒「对方」，不打扰设置提醒的人
    const targetIds = allMemberIds.filter((id) => id !== reminder.owner_id)
    if (!targetIds.length) {
      skipped += 1
      continue
    }

    const { data: subscriptions } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .in('user_id', targetIds)

    if (!subscriptions?.length) {
      skipped += 1
      continue
    }

    // 同一提醒每天只发一次；并发/重复调用时唯一约束会拦住
    const { error: logError } = await admin
      .from('reminder_logs')
      .insert({ reminder_id: reminder.id, sent_date: now.date })

    if (logError) {
      if (logError.code !== '23505') {
        console.error('[push] 写入发送日志失败', reminder.id, logError)
      }
      skipped += 1
      continue
    }

    remindersReceived += 1
    const pushTitle = `${reminder.label} 该吃饭啦 🍚`
    const result = await sendToSubscriptions(subscriptions, {
      title: pushTitle,
      body: reminder.message,
      url: '/',
      tag: `reminder-${reminder.id}`
    })
    sent += result.sent

    // 同时给每位收件人写一条站内信箱消息（Web Push 是瞬时的，信箱是永久记录）
    if (targetIds.length) {
      const { error: msgError } = await admin.from('messages').insert(
        targetIds.map((userId) => ({
          user_id: userId,
          type: 'meal_reminder',
          title: pushTitle,
          body: reminder.message,
          data: { reminder_id: reminder.id }
        }))
      )
      if (msgError) {
        console.error('[push] 写入站内消息失败', reminder.id, msgError)
      }
    }
  }

  // 清理 30 天前的发送日志，避免表无限增长
  const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
  await admin.from('reminder_logs').delete().lt('sent_date', cutoff)

  return json({
    ok: true,
    time: now.display,
    reminders: reminders.length,
    remindersReceived,
    sent,
    skipped
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return json({ error: 'method not allowed' }, 405)
  }
  if (!env.vapidPublic || !env.vapidPrivate) {
    return json({ error: 'VAPID 密钥未配置' }, 500)
  }

  let body: { mode?: string } = {}
  try {
    body = await req.json()
  } catch {
    body = {}
  }

  try {
    if (body.mode === 'test') return await handleTest(req)
    return await handleCron(req)
  } catch (error) {
    console.error('[send-reminders] 未捕获错误', error)
    return json({ error: (error as Error)?.message ?? 'internal error' }, 500)
  }
})
