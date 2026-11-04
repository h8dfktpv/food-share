<script setup>
import { shortTime } from '../lib/date'

defineProps({
  comment: { type: Object, required: true },
  name: { type: String, default: 'TA' },
  isMine: { type: Boolean, default: false },
  replyToName: { type: String, default: '' }
})
const emit = defineEmits(['reply', 'remove'])
</script>

<template>
  <div class="flex gap-2">
    <div
      class="mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full border border-line bg-white text-[10px] text-muted"
    >
      {{ name.slice(0, 1) }}
    </div>

    <div class="min-w-0 flex-1">
      <div class="flex items-baseline gap-2">
        <span class="text-[12px] font-medium">{{ name }}</span>
        <span class="text-[10px] text-muted">{{ shortTime(comment.created_at) }}</span>
      </div>

      <p class="mt-0.5 whitespace-pre-wrap break-words text-[13px] leading-relaxed">
        <span v-if="replyToName" class="text-sage-500">回复 @{{ replyToName }}：</span>
        {{ comment.content }}
      </p>

      <div class="mt-1 flex items-center gap-3 text-[11px] text-muted">
        <button type="button" class="transition active:text-sage-600" @click="emit('reply', comment)">
          回复
        </button>
        <button
          v-if="isMine"
          type="button"
          class="text-clay-500/80 transition active:text-clay-600"
          @click="emit('remove', comment)"
        >
          删除
        </button>
      </div>
    </div>
  </div>
</template>
