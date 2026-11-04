<script setup>
import { toasts } from '../lib/toast'
import Icon from './Icon.vue'
</script>

<template>
  <Teleport to="body">
    <div
      class="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 px-4"
      style="padding-top: calc(0.75rem + env(safe-area-inset-top))"
    >
      <TransitionGroup name="toast">
        <div
          v-for="item in toasts"
          :key="item.id"
          class="max-w-[92%] rounded-full px-4 py-2 text-[13px] shadow-soft"
          :class="
            item.type === 'error'
              ? 'bg-clay-500 text-white'
              : item.type === 'success'
                ? 'bg-sage-500 text-white'
                : item.type === 'remind'
                  ? 'flex items-center gap-2 rounded-2xl border border-sage-200 bg-paper px-4 py-3 text-ink shadow-soft'
                  : 'bg-ink/90 text-white'
          "
        >
          <Icon v-if="item.type === 'remind'" name="bell" :size="16" class="text-sage-500" />
          {{ item.message }}
        </div>
      </TransitionGroup>
    </div>
  </Teleport>
</template>

<style scoped>
.toast-enter-active,
.toast-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.toast-enter-from,
.toast-leave-to {
  opacity: 0;
  transform: translateY(-6px);
}
</style>
