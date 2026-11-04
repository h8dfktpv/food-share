<script setup>
import { computed, ref } from 'vue'
import { memberName } from '../lib/auth'
import { relativeTime } from '../lib/date'
import { toastError } from '../lib/toast'
import { supabase } from '../lib/supabase'
import CommentItem from './CommentItem.vue'
import Icon from './Icon.vue'

const props = defineProps({
  checkin: { type: Object, required: true },
  currentUserId: { type: String, default: '' }
})

const emit = defineEmits(['delete-checkin', 'comment-created', 'comment-deleted', 'open-image'])

const draft = ref('')
const replyTarget = ref(null)
const replyParentId = ref(null)
const sending = ref(false)
const inputRef = ref(null)

const isMine = computed(() => props.checkin.author_id === props.currentUserId)
const authorName = computed(() => memberName(props.checkin.author_id))
const initial = computed(() => authorName.value.slice(0, 1))

/** 找到一条评论的根评论（楼层最多两层，回复的回复归到根楼层下） */
function findRoot(comment) {
  let current = comment
  let guard = 0
  while (current?.parent_id && guard < 10) {
    const parent = (props.checkin.comments || []).find((c) => c.id === current.parent_id)
    if (!parent) break
    current = parent
    guard += 1
  }
  return current
}

/** 把扁平评论整理成「楼层 + 回复」结构 */
const threads = computed(() => {
  const all = props.checkin.comments || []
  const byId = new Map(all.map((c) => [c.id, c]))
  const byTime = (a, b) => new Date(a.created_at) - new Date(b.created_at)

  return all
    .filter((c) => !c.parent_id)
    .sort(byTime)
    .map((root) => ({
      root,
      replies: all
        .filter((c) => c.parent_id && findRoot(c)?.id === root.id)
        .sort(byTime)
        .map((c) => ({
          ...c,
          parentName: memberName(byId.get(c.parent_id)?.author_id)
        }))
    }))
})

function startReply(comment) {
  replyTarget.value = comment
  replyParentId.value = findRoot(comment)?.id || comment.id
  inputRef.value?.focus()
}

function cancelReply() {
  replyTarget.value = null
  replyParentId.value = null
}

async function submitComment() {
  const content = draft.value.trim()
  if (!content || sending.value) return

  sending.value = true
  const { data, error } = await supabase
    .from('comments')
    .insert({
      checkin_id: props.checkin.id,
      author_id: props.currentUserId,
      parent_id: replyParentId.value,
      content
    })
    .select()
    .single()
  sending.value = false

  if (error) {
    toastError(`留言失败：${error.message}`)
    return
  }

  draft.value = ''
  cancelReply()
  emit('comment-created', data)
}

async function removeComment(comment) {
  if (!window.confirm('删除这条留言吗？')) return
  const { error } = await supabase.from('comments').delete().eq('id', comment.id)
  if (error) {
    toastError(`删除失败：${error.message}`)
    return
  }
  emit('comment-deleted', comment.id)
}
</script>

<template>
  <article class="card overflow-hidden">
    <!-- 作者与时间 -->
    <div class="flex items-center gap-3 px-4 pt-4">
      <div
        class="grid h-9 w-9 place-items-center rounded-full bg-sage-100 text-[13px] font-medium text-sage-600"
      >
        {{ initial }}
      </div>
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <p class="truncate text-[14px] font-medium">{{ authorName }}</p>
          <span
            v-if="isMine"
            class="rounded-full bg-sage-50 px-2 py-0.5 text-[10px] text-sage-500"
          >
            我
          </span>
        </div>
        <p class="text-[11px] text-muted">{{ relativeTime(checkin.created_at) }}</p>
      </div>
      <button
        v-if="isMine"
        type="button"
        aria-label="删除这条打卡"
        class="rounded-full p-2 text-muted/70 transition active:bg-sage-50"
        @click="emit('delete-checkin')"
      >
        <Icon name="trash" :size="16" />
      </button>
    </div>

    <!-- 照片 -->
    <div v-if="checkin.imageUrl" class="mt-3 px-3">
      <button
        type="button"
        class="block w-full overflow-hidden rounded-2xl bg-sage-50"
        @click="emit('open-image', checkin.imageUrl)"
      >
        <img
          :src="checkin.imageUrl"
          alt="伙食照片"
          loading="lazy"
          decoding="async"
          class="max-h-[430px] w-full object-cover"
        />
      </button>
    </div>

    <!-- 文字备注 -->
    <p
      v-if="checkin.note"
      class="whitespace-pre-wrap break-words px-4 pt-3 text-[14px] leading-relaxed"
    >
      {{ checkin.note }}
    </p>

    <!-- 评论区 -->
    <div class="mt-3 border-t border-line/70 bg-sage-50/40 px-4 py-3">
      <div v-if="threads.length" class="space-y-3">
        <div v-for="thread in threads" :key="thread.root.id">
          <CommentItem
            :comment="thread.root"
            :name="memberName(thread.root.author_id)"
            :is-mine="thread.root.author_id === currentUserId"
            @reply="startReply"
            @remove="removeComment"
          />

          <div
            v-if="thread.replies.length"
            class="ml-8 mt-2 space-y-2.5 border-l border-sage-200/80 pl-3"
          >
            <CommentItem
              v-for="reply in thread.replies"
              :key="reply.id"
              :comment="reply"
              :name="memberName(reply.author_id)"
              :is-mine="reply.author_id === currentUserId"
              :reply-to-name="reply.parentName"
              @reply="startReply"
              @remove="removeComment"
            />
          </div>
        </div>
      </div>

      <p v-else class="pb-1 text-[11px] text-muted">还没有留言，说一句吧。</p>

      <!-- 输入框 -->
      <form class="mt-3" @submit.prevent="submitComment">
        <div
          v-if="replyTarget"
          class="mb-1.5 flex items-center gap-2 text-[11px] text-muted"
        >
          <span>回复 @{{ memberName(replyTarget.author_id) }}</span>
          <button type="button" class="text-sage-500" @click="cancelReply">取消</button>
        </div>
        <div class="flex items-end gap-2">
          <input
            ref="inputRef"
            v-model="draft"
            type="text"
            maxlength="200"
            enterkeyhint="send"
            :placeholder="replyTarget ? '写下你的回复…' : '说点什么…'"
            class="input min-w-0 flex-1 py-2.5 text-[13px]"
          />
          <button
            type="submit"
            aria-label="发送留言"
            :disabled="!draft.trim() || sending"
            class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sage-500 text-white transition active:bg-sage-600 disabled:opacity-40"
          >
            <Icon name="send" :size="16" />
          </button>
        </div>
      </form>
    </div>
  </article>
</template>
