<script setup>
import { onMounted, watch } from 'vue'
import BrandMark from './components/BrandMark.vue'
import ToastHost from './components/ToastHost.vue'
import { authReady, currentUser, initAuth } from './lib/auth'
import { startInPageReminder, stopInPageReminder } from './lib/inPageReminder'

onMounted(initAuth)

// 登录后启动网页内提醒（华为等收不到系统推送时的兜底），登出时停止
watch(
  currentUser,
  (user) => {
    if (user) startInPageReminder()
    else stopInPageReminder()
  },
  { immediate: true }
)
</script>

<template>
  <div class="min-h-dvh bg-cream">
    <!-- 会话恢复期间的一秒过渡，避免白屏 -->
    <div v-if="!authReady" class="flex min-h-dvh items-center justify-center">
      <BrandMark :size="64" />
    </div>

    <router-view v-else v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>

    <ToastHost />
  </div>
</template>
