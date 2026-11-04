<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BottomNav from '../components/BottomNav.vue'
import BrandMark from '../components/BrandMark.vue'
import CheckinCard from '../components/CheckinCard.vue'
import EmptyState from '../components/EmptyState.vue'
import Icon from '../components/Icon.vue'
import { currentUser } from '../lib/auth'
import { greeting, todayLabel } from '../lib/date'
import { loadFeedSnapshot, saveFeedSnapshot } from '../lib/feedCache'
import { PHOTO_BUCKET, SIGNED_URL_TTL, supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'

const PAGE_SIZE = 20

const snapshot = loadFeedSnapshot()
const rows = ref(snapshot?.rows || [])
const cachedAt = ref(snapshot?.savedAt || null)
const loading = ref(rows.value.length === 0)
const loadingMore = ref(false)
const hasMore = ref(false)
const offlineMode = ref(typeof navigator !== 'undefined' ? !navigator.onLine : false)
const lightboxUrl = ref(null)

let channel = null
let snapshotTimer = null

const offlineText = computed(() => {
  if (!offlineMode.value) return ''
  if (!cachedAt.value) return '离线模式 · 当前没有可显示的缓存记录'
  const date = new Date(cachedAt.value)
  const time = `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`
  return `离线模式 · 显示上次同步的记录（${date.getMonth() + 1}月${date.getDate()}日 ${time}）`
})

function scheduleSnapshot() {
  window.clearTimeout(snapshotTimer)
  snapshotTimer = window.setTimeout(() => saveFeedSnapshot(rows.value), 200)
}

/** 私有照片批量生成签名链接（7 天有效，便于离线缓存） */
async function signImages(paths) {
  const valid = (paths || []).filter(Boolean)
  if (!valid.length) return {}
  const { data, error } = await supabase.storage
    .from(PHOTO_BUCKET)
    .createSignedUrls(valid, SIGNED_URL_TTL)
  if (error) {
    console.warn('[feed] 生成图片链接失败：', error.message)
    return {}
  }
  const map = {}
  for (const item of data || []) {
    if (item.signedUrl) map[item.path] = item.signedUrl
  }
  return map
}

async function fetchComments(checkinIds) {
  const map = {}
  checkinIds.forEach((id) => {
    map[id] = []
  })
  if (!checkinIds.length) return map

  const { data, error } = await supabase
    .from('comments')
    .select('*')
    .in('checkin_id', checkinIds)
    .order('created_at', { ascending: true })

  if (error) {
    console.warn('[feed] 读取留言失败：', error.message)
    return map
  }
  for (const comment of data || []) {
    if (map[comment.checkin_id]) map[comment.checkin_id].push(comment)
  }
  return map
}

async function fetchPage({ append = false } = {}) {
  let query = supabase
    .from('checkins')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(PAGE_SIZE)

  if (append) {
    const last = rows.value[rows.value.length - 1]
    if (!last) return
    query = query.lt('created_at', last.created_at)
  }

  const { data, error } = await query
  if (error) throw error

  const list = data || []
  const signed = await signImages(list.map((item) => item.image_path))
  const comments = await fetchComments(list.map((item) => item.id))

  const made = list.map((item) => ({
    ...item,
    imageUrl: signed[item.image_path] || '',
    comments: comments[item.id] || []
  }))

  if (append) {
    const existing = new Set(rows.value.map((row) => row.id))
    rows.value.push(...made.filter((row) => !existing.has(row.id)))
  } else {
    rows.value = made
  }

  hasMore.value = made.length === PAGE_SIZE
  cachedAt.value = Date.now()
  scheduleSnapshot()
}

async function loadInitial() {
  loading.value = true
  try {
    await fetchPage()
    offlineMode.value = false
  } catch (error) {
    offlineMode.value = true
    if (!rows.value.length) toastError('暂时连不上服务器，请检查网络')
  } finally {
    loading.value = false
  }
}

async function loadMore() {
  if (loadingMore.value) return
  loadingMore.value = true
  try {
    await fetchPage({ append: true })
  } catch (error) {
    toastError('加载更多失败')
  } finally {
    loadingMore.value = false
  }
}

/** 实时：新增打卡 */
async function onCheckinInsert(payload) {
  const row = payload.new
  if (!row?.id || rows.value.some((item) => item.id === row.id)) return
  const signed = await signImages([row.image_path])
  rows.value.unshift({ ...row, imageUrl: signed[row.image_path] || '', comments: [] })
  scheduleSnapshot()
}

/** 实时：新增/删除留言 */
function addCommentRow(comment) {
  if (!comment?.id) return
  const target = rows.value.find((row) => row.id === comment.checkin_id)
  if (!target || target.comments.some((item) => item.id === comment.id)) return
  target.comments.push(comment)
  scheduleSnapshot()
}

function removeCommentRow(id) {
  if (!id) return
  let changed = false
  rows.value.forEach((row) => {
    const before = row.comments.length
    row.comments = row.comments.filter((item) => item.id !== id)
    if (row.comments.length !== before) changed = true
  })
  if (changed) scheduleSnapshot()
}

async function removeCheckin(checkin) {
  if (!window.confirm('删除这条打卡吗？照片也会一起删除。')) return

  const { error } = await supabase.from('checkins').delete().eq('id', checkin.id)
  if (error) {
    toastError(`删除失败：${error.message}`)
    return
  }

  rows.value = rows.value.filter((row) => row.id !== checkin.id)
  // 照片删除失败不影响打卡记录删除
  supabase.storage
    .from(PHOTO_BUCKET)
    .remove([checkin.image_path])
    .catch(() => {})
  scheduleSnapshot()
  toastSuccess('已删除')
}

function subscribeRealtime() {
  channel = supabase
    .channel('feed-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'checkins' },
      onCheckinInsert
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'checkins' },
      (payload) => {
        rows.value = rows.value.filter((row) => row.id !== payload.old?.id)
        scheduleSnapshot()
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'comments' },
      (payload) => addCommentRow(payload.new)
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'comments' },
      (payload) => removeCommentRow(payload.old?.id)
    )
    .subscribe()
}

function handleOnline() {
  offlineMode.value = false
  loadInitial()
}

function handleOffline() {
  offlineMode.value = true
}

onMounted(async () => {
  await loadInitial()
  subscribeRealtime()
  window.addEventListener('online', handleOnline)
  window.addEventListener('offline', handleOffline)
})

onBeforeUnmount(() => {
  if (channel) supabase.removeChannel(channel)
  window.clearTimeout(snapshotTimer)
  window.removeEventListener('online', handleOnline)
  window.removeEventListener('offline', handleOffline)
})
</script>

<template>
  <div class="min-h-dvh">
    <header class="safe-top">
      <div class="app-container flex items-start justify-between pb-4 pt-2">
        <div>
          <p class="text-[12px] text-muted">{{ greeting() }} · {{ todayLabel() }}</p>
          <h1 class="mt-1 text-[24px] font-semibold tracking-tight">今天吃了吗</h1>
        </div>
        <div class="pt-1">
          <BrandMark :size="42" />
        </div>
      </div>
    </header>

    <main class="app-container page-with-nav">
      <!-- 离线提示 -->
      <div
        v-if="offlineMode"
        class="mb-4 rounded-2xl border border-butter bg-butter/50 px-4 py-2.5 text-[12px] leading-relaxed text-ink/70"
      >
        {{ offlineText }}
      </div>

      <!-- 首屏加载 -->
      <div v-if="loading" class="space-y-4">
        <div v-for="n in 2" :key="n" class="card overflow-hidden p-4">
          <div class="flex items-center gap-3">
            <div class="h-9 w-9 animate-pulse rounded-full bg-sage-100" />
            <div class="flex-1 space-y-2">
              <div class="h-3 w-20 animate-pulse rounded-full bg-sage-100" />
              <div class="h-2.5 w-12 animate-pulse rounded-full bg-sage-50" />
            </div>
          </div>
          <div class="mt-3 h-52 animate-pulse rounded-2xl bg-sage-50" />
          <div class="mt-3 h-3 w-2/3 animate-pulse rounded-full bg-sage-50" />
        </div>
      </div>

      <!-- 空状态 -->
      <EmptyState
        v-else-if="!rows.length"
        icon="bowl"
        title="还没有打卡"
        description="拍下今天这一顿，让另一个人的手机也香一下。"
      >
        <RouterLink to="/checkin" class="btn-primary">去打卡</RouterLink>
      </EmptyState>

      <!-- 时间流 -->
      <div v-else class="space-y-4">
        <CheckinCard
          v-for="row in rows"
          :key="row.id"
          :checkin="row"
          :current-user-id="currentUser?.id"
          @delete-checkin="removeCheckin(row)"
          @comment-created="addCommentRow"
          @comment-deleted="removeCommentRow"
          @open-image="lightboxUrl = $event"
        />

        <div v-if="hasMore" class="pt-1">
          <button
            type="button"
            class="btn-ghost w-full"
            :disabled="loadingMore"
            @click="loadMore"
          >
            <Icon name="refresh" :size="16" />
            {{ loadingMore ? '加载中…' : '加载更早的打卡' }}
          </button>
        </div>

        <p class="pb-2 pt-1 text-center text-[11px] text-muted/70">
          只有你们两个人能看见这里的一切
        </p>
      </div>
    </main>

    <BottomNav />

    <!-- 查看大图 -->
    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="lightboxUrl"
          class="fixed inset-0 z-[70] flex items-center justify-center bg-ink/90 p-4"
          @click="lightboxUrl = null"
        >
          <img
            :src="lightboxUrl"
            alt="伙食大图"
            class="max-h-[86dvh] max-w-full rounded-2xl object-contain"
          />
          <button
            type="button"
            aria-label="关闭大图"
            class="absolute right-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white backdrop-blur"
            style="top: calc(0.75rem + env(safe-area-inset-top))"
            @click="lightboxUrl = null"
          >
            <Icon name="close" :size="20" />
          </button>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
