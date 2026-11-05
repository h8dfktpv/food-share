<script setup>
import { onMounted, watch } from 'vue'
import BrandMark from './components/BrandMark.vue'
import ToastHost from './components/ToastHost.vue'
import Mailbox from './components/Mailbox.vue'
import { authReady, currentUser, initAuth } from './lib/auth'
import { startInPageReminder, stopInPageReminder } from './lib/inPageReminder'
// 新增导入消息实时监听函数
import { startMessagesRealtime, stopMessagesRealtime } from './lib/messages'

onMounted(initAuth)

// 从锁屏通知冷启动进来时，地址栏会带 ?from=meal_reminder，
// 登录后自动拉开信箱抽屉，并把参数清掉（免得刷新又弹一次）
function maybeOpenMailboxFromLaunch() {
  const params = new URLSearchParams(window.location.search)
  if (params.get('from') !== 'meal_reminder') return
  setTimeout(() => window.dispatchEvent(new Event('open-mailbox')), 400)
  history.replaceState(null, '', window.location.pathname)
}

// 登录后启动网页内提醒（华为等收不到系统推送时的兜底），登出时停止
watch(
  currentUser,
  (user) => {
    if (user) {
      startInPageReminder()
      startMessagesRealtime() // 登录成功，开启消息未读数实时监听
      maybeOpenMailboxFromLaunch()
    } else {
      stopInPageReminder()
      stopMessagesRealtime() // 退出登录，关闭消息监听
    }
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

    <!-- 全局悬浮信箱铃铛，登录后才显示 -->
    <Mailbox v-if="authReady" />

    <ToastHost />
  </div>
</template>

