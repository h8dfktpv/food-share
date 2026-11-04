<script setup>
import { ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import BrandMark from '../components/BrandMark.vue'
import { isSupabaseConfigured } from '../lib/supabase'
import { signInWithPassword } from '../lib/auth'

const router = useRouter()
const route = useRoute()

const email = ref('')
const password = ref('')
const loading = ref(false)
const errorText = ref('')

async function submit() {
  if (!email.value.trim() || !password.value) {
    errorText.value = '请输入邮箱和密码'
    return
  }

  loading.value = true
  errorText.value = ''
  try {
    await signInWithPassword(email.value, password.value)
    const redirect =
      typeof route.query.redirect === 'string' && route.query.redirect.startsWith('/')
        ? route.query.redirect
        : '/'
    router.replace(redirect)
  } catch (error) {
    errorText.value = error.message || '登录失败'
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <main
    class="flex min-h-dvh flex-col px-6"
    style="
      padding-top: calc(1.5rem + env(safe-area-inset-top));
      padding-bottom: calc(1.5rem + env(safe-area-inset-bottom));
    "
  >
    <div class="mx-auto flex w-full max-w-app flex-1 flex-col justify-center pb-16">
      <div class="flex flex-col items-center text-center">
        <BrandMark :size="76" />
        <h1 class="mt-5 text-[26px] font-semibold tracking-tight">两人食</h1>
        <p class="mt-2 text-[13px] text-muted">只属于两个人的伙食簿</p>
      </div>

      <form class="card mt-9 space-y-4 p-5" @submit.prevent="submit">
        <label class="block">
          <span class="section-title">邮箱</span>
          <input
            v-model="email"
            type="email"
            autocomplete="username"
            inputmode="email"
            autocapitalize="none"
            placeholder="you@example.com"
            class="input mt-1.5"
          />
        </label>

        <label class="block">
          <span class="section-title">密码</span>
          <input
            v-model="password"
            type="password"
            autocomplete="current-password"
            placeholder="请输入密码"
            class="input mt-1.5"
          />
        </label>

        <p
          v-if="errorText"
          class="rounded-2xl bg-clay-50 px-3.5 py-2.5 text-[12px] leading-relaxed text-clay-600"
        >
          {{ errorText }}
        </p>

        <button type="submit" class="btn-primary w-full py-3.5" :disabled="loading">
          {{ loading ? '登录中…' : '进入' }}
        </button>
      </form>

      <div
        v-if="!isSupabaseConfigured"
        class="mt-4 rounded-2xl border border-butter bg-butter/50 px-4 py-3 text-[11px] leading-relaxed text-ink/70"
      >
        当前还未配置 Supabase 环境变量。请按 DEPLOY.md 创建项目，并把
        <code class="rounded bg-white/70 px-1">VITE_SUPABASE_URL</code> 与
        <code class="rounded bg-white/70 px-1">VITE_SUPABASE_ANON_KEY</code> 写入
        <code class="rounded bg-white/70 px-1">.env.local</code>。
      </div>

      <p class="mt-8 text-center text-[11px] leading-relaxed text-muted">
        仅限两位预设账号登录<br />
        其他邮箱无法注册，也读不到任何数据
      </p>
    </div>
  </main>
</template>
