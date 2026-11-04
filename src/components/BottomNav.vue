<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import Icon from './Icon.vue'

const route = useRoute()

const items = [
  { name: 'feed', to: '/', icon: 'home', label: '首页' },
  { name: 'checkin', to: '/checkin', icon: 'camera', label: '打卡' },
  { name: 'dishes', to: '/dishes', icon: 'dice', label: '吃啥' },
  { name: 'board', to: '/board', icon: 'chat', label: '留言' },
  { name: 'settings', to: '/settings', icon: 'settings', label: '设置' }
]

const activeName = computed(() => route.name)
</script>

<template>
  <nav
    class="fixed inset-x-0 bottom-0 z-30 border-t border-line/70 bg-cream/95 shadow-nav backdrop-blur-md"
  >
    <div class="safe-bottom">
      <div class="mx-auto flex w-full max-w-app items-stretch justify-around px-2">
        <RouterLink
          v-for="item in items"
          :key="item.name"
          :to="item.to"
          class="flex flex-1 flex-col items-center gap-1 py-2 text-[11px]"
          :aria-current="activeName === item.name ? 'page' : undefined"
        >
          <span
            class="grid h-8 w-10 place-items-center rounded-full transition"
            :class="
              activeName === item.name ? 'bg-sage-100 text-sage-600' : 'text-muted'
            "
          >
            <Icon :name="item.icon" :size="20" />
          </span>
          <span
            class="tracking-wide"
            :class="activeName === item.name ? 'font-medium text-sage-600' : 'text-muted'"
          >
            {{ item.label }}
          </span>
        </RouterLink>
      </div>
    </div>
  </nav>
</template>
