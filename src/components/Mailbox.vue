<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import Icon from './Icon.vue'
import { currentMember, memberName } from '../lib/auth'
import { relativeTime } from '../lib/date'
import {
  fetchMessages,
  markAllRead,
  markAsRead,
  unreadCount
} from '../lib/messages'
import { supabase } from '../lib/supabase'

const open = ref(false)
const messages = ref([])
const loading = ref(false)

let channel = null

const hasUnread = computed(() => unreadCount.value > 0)
const displayBadge = computed(() => (unreadCount.value > 99 ? '99+' : String(unreadCount.value)))

/** 按类型取小图标与颜色 */
function typeMeta(type) {
  switch (type) {
    case 'meal_reminder':
      return { icon: 'bell', color: 'text-clay-500', bg: 'bg-clay-50' }
    case 'photo':
      return { icon: 'camera', color: 'text-sage-500', bg: 'bg-sage-50' }
    case 'note':
      return { icon: 'chat', color: 'text-sage-500', bg: 'bg-sage-50' }
    case 'dish':
      return { icon: 'bowl', color: 'text-butter', bg: 'bg-butter/40' }
    default:
      return { icon: 'bell', color: 'text-muted', bg: 'bg-line/60' }
  }
}

async function load() {
  loading.value = true
  messages.value = await fetchMessages()
  loading.value = false
}

async function openDrawer() {
  open.value = true
  await load()
}

function closeDrawer() {
  open.value = false
}

/** 点击消息：标记已读 + 预留跳转（data 里存了关联 id，目前只做标记） */
async function handleClick(msg) {
  if (!msg.is_read) {
    msg.is_read = true
    markAsRead(msg.id)
  }
  // 预留：根据 msg.type 和 msg.data 做页面跳转
  // 例如 type === 'photo' 时跳转到首页并定位到某条打卡
}

async function handleMarkAll() {
  await markAllRead()
  messages.value.forEach((m) => (m.is_read = true))
}

/** 被 Service Worker / 启动参数召唤时，自动拉开抽屉 */
function openFromOutside() {
  openDrawer()
}

onMounted(() => {
  // 锁屏通知点进来时，sw 会 postMessage，main.js 再转发成这个 window 事件
  window.addEventListener('open-mailbox', openFromOutside)

  // 抽屉打开期间实时刷新
  channel = supabase
    .channel('messages-drawer')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'messages' },
      () => {
        if (open.value) load()
      }
    )
    .subscribe()
})

onBeforeUnmount(() => {
  window.removeEventListener('open-mailbox', openFromOutside)
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <!-- 铃铛按钮：固定在右上角，覆盖所有页面（登录页由父组件控制是否渲染） -->
  <button
    type="button"
    aria-label="信箱"
    class="fixed right-3 top-[max(env(safe-area-inset-top),0.75rem)] z-40 grid h-10 w-10 place-items-center rounded-full bg-white/90 text-ink shadow-soft backdrop-blur transition active:scale-95"
    @click="openDrawer"
  >
    <Icon name="bell" :size="20" />
    <span
      v-if="hasUnread"
      class="absolute -right-0.5 -top-0.5 grid min-h-[18px] min-w-[18px] place-items-center rounded-full bg-clay-500 px-1 text-[10px] font-semibold text-white shadow"
    >
      {{ displayBadge }}
    </span>
  </button>

  <!-- 遮罩 -->
  <transition name="fade">
    <div
      v-if="open"
      class="fixed inset-0 z-40 bg-ink/30 backdrop-blur-[2px]"
      @click="closeDrawer"
    />
  </transition>

  <!-- 抽屉 -->
  <transition name="sheet">
    <aside
      v-if="open"
      class="fixed inset-y-0 right-0 z-50 flex w-[88%] max-w-[400px] flex-col bg-cream shadow-2xl"
    >
      <header class="safe-top">
        <div class="flex items-center justify-between px-5 pb-3 pt-2">
          <h2 class="text-[18px] font-semibold tracking-tight">信箱</h2>
          <button
            type="button"
            aria-label="关闭"
            class="grid h-8 w-8 place-items-center rounded-full text-muted transition active:scale-90"
            @click="closeDrawer"
          >
            <Icon name="close" :size="18" />
          </button>
        </div>
      </header>

      <div class="flex items-center justify-between px-5 pb-2">
        <span class="text-[11px] text-muted">
          共 {{ messages.length }} 条 · 未读 {{ unreadCount }}
        </span>
        <button
          v-if="unreadCount > 0"
          type="button"
          class="text-[11px] text-sage-600"
          @click="handleMarkAll"
        >
          全部标为已读
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-4 pb-8">
        <p v-if="loading" class="py-10 text-center text-[12px] text-muted">加载中…</p>

        <div v-else-if="!messages.length" class="flex flex-col items-center py-16 text-muted">
          <Icon name="bell" :size="36" class="text-line" />
          <p class="mt-3 text-[13px]">还没有消息</p>
          <p class="mt-1 text-[11px]">对方的打卡、留言、饭点提醒都会出现在这里</p>
        </div>

        <ul v-else class="space-y-2">
          <li v-for="msg in messages" :key="msg.id">
            <button
              type="button"
              class="flex w-full gap-3 rounded-2xl border px-3.5 py-3 text-left transition active:scale-[0.99]"
              :class="
                msg.is_read
                  ? 'border-line/50 bg-white/60'
                  : 'border-sage-200/60 bg-white shadow-soft'
              "
              @click="handleClick(msg)"
            >
              <span
                class="grid h-9 w-9 shrink-0 place-items-center rounded-full"
                :class="typeMeta(msg.type).bg"
              >
                <Icon :name="typeMeta(msg.type).icon" :size="17" :class="typeMeta(msg.type).color" />
              </span>

              <div class="min-w-0 flex-1">
                <div class="flex items-center gap-2">
                  <p class="truncate text-[14px] font-medium" :class="msg.is_read ? 'text-ink/70' : 'text-ink'">
                    {{ msg.title }}
                  </p>
                  <span
                    v-if="!msg.is_read"
                    class="h-2 w-2 shrink-0 rounded-full bg-clay-500"
                  />
                </div>
                <p v-if="msg.body" class="mt-0.5 truncate text-[12px] text-muted">{{ msg.body }}</p>
                <p class="mt-1 text-[10px] text-muted">{{ relativeTime(msg.created_at) }}</p>
              </div>
            </button>
          </li>
        </ul>
      </div>
    </aside>
  </transition>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: transform 0.28s ease;
}
.sheet-enter-from,
.sheet-leave-to {
  transform: translateX(100%);
}
</style>
