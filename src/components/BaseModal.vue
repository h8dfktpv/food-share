<script setup>
import Icon from './Icon.vue'

defineProps({
  open: { type: Boolean, default: false },
  title: { type: String, default: '' }
})
const emit = defineEmits(['close'])
</script>

<template>
  <Teleport to="body">
    <Transition name="sheet">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-end justify-center bg-ink/25 backdrop-blur-[2px]"
        style="
          padding: 2.5rem 0.75rem calc(0.75rem + env(safe-area-inset-bottom)) 0.75rem;
        "
        @click.self="emit('close')"
      >
        <div
          class="max-h-[88dvh] w-full max-w-app overflow-y-auto rounded-3xl bg-paper shadow-soft"
        >
          <header
            class="sticky top-0 z-10 flex items-center justify-between border-b border-line/70 bg-paper/95 px-5 py-3 backdrop-blur"
          >
            <h2 class="text-[16px] font-medium">{{ title }}</h2>
            <button
              type="button"
              aria-label="关闭"
              class="-mr-1 rounded-full p-2 text-muted transition active:bg-sage-50"
              @click="emit('close')"
            >
              <Icon name="close" :size="18" />
            </button>
          </header>
          <div class="px-5 pb-6 pt-4">
            <slot />
          </div>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.sheet-enter-active,
.sheet-leave-active {
  transition: opacity 0.22s ease;
}
.sheet-enter-active > div,
.sheet-leave-active > div {
  transition: transform 0.24s cubic-bezier(0.2, 0.8, 0.2, 1);
}
.sheet-enter-from,
.sheet-leave-to {
  opacity: 0;
}
.sheet-enter-from > div,
.sheet-leave-to > div {
  transform: translateY(18px);
}
</style>
