<script setup>
import { onBeforeUnmount, onMounted, ref } from 'vue'
import BottomNav from '../components/BottomNav.vue'
import EmptyState from '../components/EmptyState.vue'
import Icon from '../components/Icon.vue'
import { currentUser, memberName } from '../lib/auth'
import { shortTime } from '../lib/date'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'

const messages = ref([])
const loading = ref(true)
const draft = ref('')
const sending = ref(false)
let channel = null

async function loadMessages() {
  const { data, error } = await supabase
    .from('board_messages')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) {
    toastError(`读取留言失败：${error.message}`)
  } else {
    messages.value = data || []
  }
  loading.value = false
}

async function sendMessage() {
  const content = draft.value.trim()
  if (!content || sending.value || !currentUser.value) return

  sending.value = true
  const { data, error } = await supabase
    .from('board_messages')
    .insert({ author_id: currentUser.value.id, content })
    .select()
    .single()
  sending.value = false

  if (error) {
    toastError(`发送失败：${error.message}`)
    return
  }

  if (data && !messages.value.some((item) => item.id === data.id)) {
    messages.value.unshift(data)
  }
  draft.value = ''
  toastSuccess('已发送')
}

async function removeMessage(message) {
  if (!window.confirm('删除这条留言吗？')) return
  const { error } = await supabase.from('board_messages').delete().eq('id', message.id)
  if (error) {
    toastError(`删除失败：${error.message}`)
    return
  }
  messages.value = messages.value.filter((item) => item.id !== message.id)
}

function subscribe() {
  channel = supabase
    .channel('board-realtime')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'board_messages' },
      (payload) => {
        const message = payload.new
        if (!message?.id || messages.value.some((item) => item.id === message.id)) return
        messages.value.unshift(message)
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'board_messages' },
      (payload) => {
        messages.value = messages.value.filter((item) => item.id !== payload.old?.id)
      }
    )
    .subscribe()
}

onMounted(async () => {
  await loadMessages()
  subscribe()
})

onBeforeUnmount(() => {
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="min-h-dvh">
    <header class="safe-top">
      <div class="app-container pb-4 pt-2">
        <p class="text-[12px] text-muted">不在饭点，也可以说两句</p>
        <h1 class="mt-1 text-[24px] font-semibold tracking-tight">留言板</h1>
      </div>
    </header>

    <main class="app-container page-with-nav">
      <!-- 发言 -->
      <section class="card p-4">
        <textarea
          v-model="draft"
          rows="3"
          maxlength="300"
          placeholder="想对 TA 说点什么…"
          class="input text-[14px] leading-relaxed"
        />
        <div class="mt-2 flex items-center justify-between">
          <span class="text-[11px] text-muted">{{ draft.length }}/300</span>
          <button
            type="button"
            class="btn-primary px-4 py-2 text-[13px]"
            :disabled="!draft.trim() || sending"
            @click="sendMessage"
          >
            <Icon name="send" :size="14" />
            {{ sending ? '发送中…' : '发送' }}
          </button>
        </div>
      </section>

      <!-- 留言列表 -->
      <div v-if="loading" class="mt-5 space-y-3">
        <div v-for="n in 3" :key="n" class="card h-16 animate-pulse bg-white/70" />
      </div>

      <EmptyState
        v-else-if="!messages.length"
        icon="chat"
        title="还没有留言"
        description="一句「今晚想吃什么」也可以。"
      />

      <div v-else class="mt-5 space-y-4">
        <div
          v-for="message in messages"
          :key="message.id"
          class="flex"
          :class="message.author_id === currentUser?.id ? 'justify-end' : 'justify-start'"
        >
          <div class="max-w-[84%]">
            <div
              class="mb-1 flex items-center gap-2 text-[10px] text-muted"
              :class="message.author_id === currentUser?.id ? 'justify-end' : ''"
            >
              <span>{{ memberName(message.author_id) }}</span>
              <span>{{ shortTime(message.created_at) }}</span>
              <button
                v-if="message.author_id === currentUser?.id"
                type="button"
                aria-label="删除留言"
                class="transition active:text-clay-500"
                @click="removeMessage(message)"
              >
                <Icon name="trash" :size="12" />
              </button>
            </div>
            <div
              class="whitespace-pre-wrap break-words rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed"
              :class="
                message.author_id === currentUser?.id
                  ? 'rounded-br-md bg-sage-100 text-ink'
                  : 'rounded-bl-md border border-line bg-white'
              "
            >
              {{ message.content }}
            </div>
          </div>
        </div>

        <p class="pb-2 pt-1 text-center text-[11px] text-muted/70">留言只有你们两个人能看到</p>
      </div>
    </main>

    <BottomNav />
  </div>
</template>
