<script setup>
/** 轻量图标集，避免引入图标库依赖 */
defineProps({
  name: { type: String, required: true },
  size: { type: Number, default: 20 },
  filled: { type: Boolean, default: false }
})
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    :fill="filled ? 'currentColor' : 'none'"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    class="shrink-0"
  >
    <template v-if="name === 'home'">
      <path d="M3.5 10.8 12 3.5l8.5 7.3" />
      <path d="M5.5 9.4V20h13V9.4" />
      <path d="M9.8 20v-5.2h4.4V20" />
    </template>

    <template v-else-if="name === 'camera'">
      <rect x="3" y="6.5" width="18" height="13" rx="3" />
      <circle cx="12" cy="13" r="3.6" />
      <path d="M8.5 6.5 10 4.3h4l1.5 2.2" />
    </template>

    <template v-else-if="name === 'bowl'">
      <path d="M3.5 11.5h17a8.5 8.5 0 0 1-17 0Z" />
      <path d="M8 8.3c0-1.3 1-1.6 1-2.9M12 8.3c0-1.3 1-1.6 1-2.9M16 8.3c0-1.3 1-1.6 1-2.9" />
    </template>

    <template v-else-if="name === 'chat'">
      <path d="M20.5 11.5a8.5 8.5 0 0 1-8.5 8.5H7.6L3.5 22l1-4.2A8.5 8.5 0 1 1 20.5 11.5Z" />
    </template>

    <template v-else-if="name === 'settings'">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.4v2M12 18.6v2M3.4 12h2M18.6 12h2M6 6l1.4 1.4M16.6 16.6 18 18M18 6l-1.4 1.4M7.4 16.6 6 18" />
    </template>

    <template v-else-if="name === 'heart'">
      <path
        d="M12 20.4c-.4 0-.8-.14-1.1-.37C7.3 17.4 3.6 14 3.6 10.4 3.6 7.9 5.5 6 7.9 6c1.6 0 3.1.9 4.1 2.4C13 6.9 14.5 6 16.1 6c2.4 0 4.3 1.9 4.3 4.4 0 3.6-3.7 7-7.3 9.6-.3.23-.7.37-1.1.37Z"
      />
    </template>

    <template v-else-if="name === 'trash'">
      <path d="M4 7h16" />
      <path d="M9 7V4.6h6V7" />
      <path d="m6.4 7 1 13h9.2l1-13" />
      <path d="M10.4 10.6v6M13.6 10.6v6" />
    </template>

    <template v-else-if="name === 'plus'">
      <path d="M12 5v14M5 12h14" />
    </template>

    <template v-else-if="name === 'close'">
      <path d="m6 6 12 12M18 6 6 18" />
    </template>

    <template v-else-if="name === 'bell'">
      <path d="M6 9.2a6 6 0 0 1 12 0c0 5.3 2 6.8 2 6.8H4s2-1.5 2-6.8Z" />
      <path d="M10 19a2 2 0 0 0 4 0" />
    </template>

    <template v-else-if="name === 'image'">
      <rect x="3" y="4.5" width="18" height="15" rx="3" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 5-4.5 4 3.5 3-2.5 4 3.5" />
    </template>

    <template v-else-if="name === 'send'">
      <path d="M20 4 3.5 11l6.5 2.5L12.5 20 20 4Z" />
      <path d="M10 13.5 20 4" />
    </template>

    <template v-else-if="name === 'check'">
      <path d="m5 12.5 4.5 4.5L19 7" />
    </template>

    <template v-else-if="name === 'chevron'">
      <path d="m9 5.5 6.5 6.5L9 18.5" />
    </template>

    <template v-else-if="name === 'dice'">
      <rect x="4" y="4" width="16" height="16" rx="4.5" />
      <circle cx="9" cy="9" r="1.1" fill="currentColor" />
      <circle cx="15" cy="9" r="1.1" fill="currentColor" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
      <circle cx="9" cy="15" r="1.1" fill="currentColor" />
      <circle cx="15" cy="15" r="1.1" fill="currentColor" />
    </template>

    <template v-else-if="name === 'refresh'">
      <path d="M20 6v5h-5" />
      <path d="M4 18v-5h5" />
      <path d="M18.5 11a7 7 0 0 0-12-3.4L4 10M5.5 13a7 7 0 0 0 12 3.4L20 14" />
    </template>

    <template v-else-if="name === 'logout'">
      <path d="M14 4h5v16h-5" />
      <path d="M10 12H3.5" />
      <path d="m7 8.5-3.5 3.5L7 15.5" />
    </template>
  </svg>
</template>
