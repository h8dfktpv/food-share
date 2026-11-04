<script setup>
import Icon from './Icon.vue'

defineProps({
  icon: { type: String, default: 'bowl' },
  title: { type: String, required: true },
  description: { type: String, default: '' }
})
</script>

<template>
  <div class="flex flex-col items-center justify-center px-6 py-14 text-center">
    <div class="grid h-16 w-16 place-items-center rounded-full bg-sage-100 text-sage-500">
      <Icon :name="icon" :size="28" />
    </div>
    <p class="mt-4 text-[15px] font-medium">{{ title }}</p>
    <p v-if="description" class="mt-1.5 max-w-[260px] text-[13px] leading-relaxed text-muted">
      {{ description }}
    </p>
    <div class="mt-5">
      <slot />
    </div>
  </div>
</template>
