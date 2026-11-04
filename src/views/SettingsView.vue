<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import BaseModal from '../components/BaseModal.vue'
import BottomNav from '../components/BottomNav.vue'
import Icon from '../components/Icon.vue'
import {
  currentMember,
  currentUser,
  loadMembers,
  partner,
  signOut
} from '../lib/auth'
import { displayReminderTime, toDbTime } from '../lib/date'
import {
  disablePush,
  enablePush,
  getPushState,
  isStandalone,
  sendTestPush
} from '../lib/push'
import { supabase } from '../lib/supabase'
import { toast, toastError, toastSuccess } from '../lib/toast'

const router = useRouter()

const DEFAULT_MESSAGE = '到饭点啦，记得上传你的伙食打卡～'
const PRESETS = [
  { label: '早餐', time: '08:00', message: '早安，记得上传你的早餐打卡～' },
  { label: '午餐', time: '12:00', message: DEFAULT_MESSAGE },
  { label: '晚餐', time: '18:30', message: '晚饭时间到，今天吃了什么？' }
]

const nameDraft = ref('')
const savingName = ref(false)

const pushState = ref(null)
const pushBusy = ref(false)
const testBusy = ref(false)

const reminders = ref([])
const showEditor = ref(false)
const editingId = ref(null)
const formSaving = ref(false)
const form = reactive({ label: '午餐', time: '12:00', message: DEFAULT_MESSAGE })

let channel = null

const email = computed(() => currentUser.value?.email || '')
const initial = computed(() => (currentMember.value?.display_name || '我').slice(0, 1))
const partnerName = computed(() => partner.value?.display_name || 'TA')
const hasSubscription = computed(() => Boolean(pushState.value?.subscription))
const standalone = computed(() => pushState.value?.standalone ?? isStandalone())

const canEnable = computed(() => {
  const state = pushState.value
  if (!state) return false
  if (!state.supported || !state.configured) return false
  if (state.ios && !state.standalone) return false
  return true
})

const statusText = computed(() => {
  const state = pushState.value
  if (!state) return '检查中'
  if (!state.supported) return '不支持'
  if (!state.configured) return '未配置'
  if (state.subscription && state.permission === 'granted') return '已开启'
  if (state.permission === 'denied') return '已拒绝'
  return '未开启'
})

const statusClass = computed(() => {
  if (statusText.value === '已开启') return 'bg-sage-100 text-sage-600'
  if (statusText.value === '未开启' || statusText.value === '检查中') {
    return 'bg-butter/70 text-ink/70'
  }
  return 'bg-clay-50 text-clay-600'
})

const myReminders = computed(() =>
  reminders.value
    .filter((item) => item.owner_id === currentUser.value?.id)
    .sort((a, b) => String(a.remind_at).localeCompare(String(b.remind_at)))
)

const partnerReminders = computed(() =>
  reminders.value
    .filter((item) => item.owner_id !== currentUser.value?.id)
    .sort((a, b) => String(a.remind_at).localeCompare(String(b.remind_at)))
)

watch(
  currentMember,
  (member) => {
    nameDraft.value = member?.display_name || ''
  },
  { immediate: true }
)

async function saveName() {
  const name = nameDraft.value.trim()
  if (!name || !currentUser.value || savingName.value) return
  if (name === currentMember.value?.display_name) return

  savingName.value = true
  const { error } = await supabase
    .from('members')
    .update({ display_name: name })
    .eq('user_id', currentUser.value.id)
  savingName.value = false

  if (error) {
    toastError(`保存失败：${error.message}`)
    return
  }
  await loadMembers()
  toastSuccess('称呼已更新')
}

async function refreshPush() {
  pushState.value = await getPushState()
}

async function enableNotifications() {
  if (!currentUser.value) return
  pushBusy.value = true
  try {
    await enablePush(currentUser.value.id)
    await refreshPush()
    toastSuccess('通知已开启，可以发一条测试通知看看')
  } catch (error) {
    toastError(error.message)
  } finally {
    pushBusy.value = false
  }
}

async function testNotification() {
  testBusy.value = true
  try {
    let result = await sendTestPush()
    if (result?.sent === 0 && !result.failed) {
      // 浏览器本地有订阅，但数据库里没有（当初登记失败，或已被推送服务判定失效并清理），重新登记后再试
      await enablePush(currentUser.value.id, { renew: result.removed > 0 })
      result = await sendTestPush()
    }

    if (result?.sent > 0) {
      toastSuccess('已发送，请留意通知栏')
    } else if (result?.failed) {
      const codes = result.statuses?.length ? `（状态码 ${result.statuses.join('/')}）` : ''
      toastError(`推送服务拒绝发送${codes}，请检查前后端 VAPID 密钥是否为同一对`)
    } else {
      toastError('没有可用的订阅，请先开启通知')
    }
    await refreshPush()
  } catch (error) {
    toastError(error.message)
  } finally {
    testBusy.value = false
  }
}

async function turnOffPush() {
  if (!window.confirm('关闭后，到点将收不到对方的提醒。继续吗？')) return
  pushBusy.value = true
  try {
    await disablePush()
    await refreshPush()
    toast('通知已关闭')
  } catch (error) {
    toastError(error.message)
  } finally {
    pushBusy.value = false
  }
}

async function loadReminders() {
  const { data, error } = await supabase.from('reminders').select('*')
  if (error) {
    console.warn('[settings] 读取提醒失败：', error.message)
    return
  }
  reminders.value = data || []
}

function openAdd() {
  editingId.value = null
  form.label = '午餐'
  form.time = '12:00'
  form.message = DEFAULT_MESSAGE
  showEditor.value = true
}

function openEdit(reminder) {
  editingId.value = reminder.id
  form.label = reminder.label
  form.time = displayReminderTime(reminder.remind_at)
  form.message = reminder.message
  showEditor.value = true
}

function applyPreset(preset) {
  form.label = preset.label
  form.time = preset.time
  form.message = preset.message
}

async function saveReminder() {
  if (!currentUser.value || formSaving.value) return

  const payload = {
    label: form.label.trim() || '饭点',
    remind_at: toDbTime(form.time || '12:00'),
    message: form.message.trim() || DEFAULT_MESSAGE
  }

  formSaving.value = true
  const query = editingId.value
    ? supabase.from('reminders').update(payload).eq('id', editingId.value)
    : supabase
        .from('reminders')
        .insert({ ...payload, owner_id: currentUser.value.id, enabled: true })

  const { error } = await query
  formSaving.value = false

  if (error) {
    toastError(`保存失败：${error.message}`)
    return
  }

  showEditor.value = false
  await loadReminders()
  toastSuccess(editingId.value ? '提醒已更新' : '提醒已添加')
}

async function toggleReminder(reminder) {
  const next = !reminder.enabled
  const { error } = await supabase
    .from('reminders')
    .update({ enabled: next })
    .eq('id', reminder.id)
  if (error) {
    toastError(`操作失败：${error.message}`)
    return
  }
  reminder.enabled = next
}

async function removeReminder(reminder) {
  if (!window.confirm(`删除「${reminder.label} ${displayReminderTime(reminder.remind_at)}」这个提醒吗？`)) {
    return
  }
  const { error } = await supabase.from('reminders').delete().eq('id', reminder.id)
  if (error) {
    toastError(`删除失败：${error.message}`)
    return
  }
  reminders.value = reminders.value.filter((item) => item.id !== reminder.id)
  toastSuccess('提醒已删除')
}

function logout() {
  if (!window.confirm('退出后需要重新输入邮箱和密码，确定吗？')) return
  signOut().finally(() => router.replace('/login'))
}

function subscribeReminders() {
  channel = supabase
    .channel('reminders-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reminders' }, () => {
      loadReminders()
    })
    .subscribe()
}

function handleVisibility() {
  if (document.visibilityState === 'visible') refreshPush()
}

onMounted(async () => {
  nameDraft.value = currentMember.value?.display_name || ''
  await Promise.all([refreshPush(), loadReminders()])
  subscribeReminders()
  document.addEventListener('visibilitychange', handleVisibility)
})

onBeforeUnmount(() => {
  if (channel) supabase.removeChannel(channel)
  document.removeEventListener('visibilitychange', handleVisibility)
})
</script>

<template>
  <div class="min-h-dvh">
    <header class="safe-top">
      <div class="app-container pb-4 pt-2">
        <p class="text-[12px] text-muted">两个人的小空间</p>
        <h1 class="mt-1 text-[24px] font-semibold tracking-tight">设置</h1>
      </div>
    </header>

    <main class="app-container page-with-nav space-y-4">
      <!-- 账号 -->
      <section class="card p-5">
        <p class="section-title">账号</p>
        <div class="mt-3 flex items-center gap-3">
          <div
            class="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-sage-100 text-[16px] font-medium text-sage-600"
          >
            {{ initial }}
          </div>
          <div class="min-w-0 flex-1">
            <input v-model="nameDraft" maxlength="12" class="input py-2 text-[14px]" />
            <p class="mt-1 truncate text-[11px] text-muted">{{ email }}</p>
          </div>
        </div>
        <div class="mt-3 flex justify-end">
          <button
            type="button"
            class="btn-soft px-4 py-2 text-[12px]"
            :disabled="
              savingName || !nameDraft.trim() || nameDraft.trim() === currentMember?.display_name
            "
            @click="saveName"
          >
            {{ savingName ? '保存中…' : '保存称呼' }}
          </button>
        </div>
        <div class="divider my-4" />
        <p class="text-[12px] leading-relaxed text-muted">
          和 <span class="text-ink">{{ partnerName }}</span> 共享这个空间 · 仅两个账号可见
        </p>
      </section>

      <!-- 通知 -->
      <section class="card p-5">
        <div class="flex items-center justify-between">
          <p class="section-title">系统通知</p>
          <span class="rounded-full px-2.5 py-1 text-[11px]" :class="statusClass">
            {{ statusText }}
          </span>
        </div>

        <p class="mt-2 text-[12px] leading-relaxed text-muted">
          饭点提醒到时间后，会推送到对方的手机锁屏和通知中心，不需要打开网页。
        </p>

        <div
          v-if="pushState?.ios && !pushState?.standalone"
          class="mt-3 rounded-2xl bg-butter/50 px-3.5 py-3 text-[11px] leading-relaxed text-ink/70"
        >
          当前是 Safari 网页模式。iOS 只允许「主屏幕应用」接收推送：点底部分享按钮 →
          「添加到主屏幕」，再从桌面上的「两人食」打开，回到这里开启通知。
        </div>

        <div
          v-else-if="pushState?.permission === 'denied'"
          class="mt-3 rounded-2xl bg-clay-50 px-3.5 py-3 text-[11px] leading-relaxed text-clay-600"
        >
          通知权限被拒绝。请到 iPhone「设置 → 通知 → 两人食」中允许通知，再回到这里重新检查。
        </div>

        <div
          v-else-if="pushState && !pushState.supported"
          class="mt-3 rounded-2xl bg-clay-50 px-3.5 py-3 text-[11px] leading-relaxed text-clay-600"
        >
          当前浏览器不支持 Web Push，请使用 iPhone Safari 或 Android Chrome。
        </div>

        <div
          v-else-if="pushState && !pushState.configured"
          class="mt-3 rounded-2xl bg-butter/50 px-3.5 py-3 text-[11px] leading-relaxed text-ink/70"
        >
          还未配置 VAPID 公钥，部署时请设置环境变量
          <code class="rounded bg-white/70 px-1">VITE_VAPID_PUBLIC_KEY</code>。
        </div>

        <div class="mt-4 space-y-2">
          <button
            v-if="!hasSubscription"
            type="button"
            class="btn-primary w-full py-2.5 text-[13px]"
            :disabled="pushBusy || !canEnable"
            @click="enableNotifications"
          >
            <Icon name="bell" :size="16" />
            {{ pushBusy ? '正在开启…' : '开启通知' }}
          </button>

          <div v-else class="flex gap-2">
            <button
              type="button"
              class="btn-primary flex-1 py-2.5 text-[13px]"
              :disabled="testBusy"
              @click="testNotification"
            >
              <Icon name="bell" :size="16" />
              {{ testBusy ? '发送中…' : '发送测试通知' }}
            </button>
            <button
              type="button"
              class="btn-ghost px-4 py-2.5 text-[13px]"
              :disabled="pushBusy"
              @click="turnOffPush"
            >
              关闭
            </button>
          </div>
        </div>
      </section>

      <!-- 提醒时间 -->
      <section class="card p-5">
        <div class="flex items-center justify-between">
          <p class="section-title">饭点提醒</p>
          <button
            type="button"
            class="inline-flex items-center gap-1 text-[12px] text-sage-600"
            @click="openAdd"
          >
            <Icon name="plus" :size="14" />
            新增
          </button>
        </div>
        <p class="mt-1 text-[11px] leading-relaxed text-muted">
          支持早、午、晚餐多组时间，到点提醒对方，推送文案可自定义。
        </p>

        <div v-if="myReminders.length" class="mt-4 space-y-3">
          <div
            v-for="reminder in myReminders"
            :key="reminder.id"
            class="flex items-center gap-3 rounded-2xl border border-line/70 bg-white px-3.5 py-3"
          >
            <div class="w-[58px] shrink-0">
              <p class="text-[18px] font-semibold tabular-nums">
                {{ displayReminderTime(reminder.remind_at) }}
              </p>
              <p class="text-[10px] text-muted">{{ reminder.label }}</p>
            </div>

            <div class="min-w-0 flex-1">
              <p class="truncate text-[12px] text-ink/80">{{ reminder.message }}</p>
              <div class="mt-1 flex items-center gap-2 text-[10px]">
                <span :class="reminder.enabled ? 'text-sage-500' : 'text-muted'">
                  {{ reminder.enabled ? '已开启' : '已暂停' }}
                </span>
                <button type="button" class="text-sage-500" @click="openEdit(reminder)">编辑</button>
                <button type="button" class="text-clay-500/80" @click="removeReminder(reminder)">
                  删除
                </button>
              </div>
            </div>

            <button
              type="button"
              role="switch"
              :aria-checked="reminder.enabled"
              aria-label="开关提醒"
              class="relative h-6 w-11 shrink-0 rounded-full transition"
              :class="reminder.enabled ? 'bg-sage-400' : 'bg-line'"
              @click="toggleReminder(reminder)"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all"
                :class="reminder.enabled ? 'left-[22px]' : 'left-0.5'"
              />
            </button>
          </div>
        </div>

        <p
          v-else
          class="mt-4 rounded-2xl bg-sage-50/70 px-4 py-4 text-center text-[12px] text-muted"
        >
          还没有提醒，加一个早餐或晚餐吧。
        </p>

        <div v-if="partnerReminders.length" class="mt-5">
          <p class="text-[11px] text-muted">TA 设置的提醒</p>
          <div class="mt-2 space-y-1.5">
            <div
              v-for="reminder in partnerReminders"
              :key="reminder.id"
              class="flex items-center justify-between rounded-xl bg-sage-50/60 px-3 py-2 text-[12px]"
            >
              <span>
                {{ displayReminderTime(reminder.remind_at) }} · {{ reminder.label }}
                <span v-if="!reminder.enabled" class="text-muted">（已暂停）</span>
              </span>
              <span class="text-[10px] text-muted">只读</span>
            </div>
          </div>
        </div>
      </section>

      <!-- 菜品管理入口 -->
      <RouterLink to="/dishes" class="card flex items-center gap-3 px-5 py-4">
        <div class="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-sage-100 text-sage-600">
          <Icon name="bowl" :size="19" />
        </div>
        <div class="min-w-0 flex-1">
          <p class="text-[14px] font-medium">菜品管理</p>
          <p class="text-[11px] text-muted">新增、收藏或删除「吃什么」里的菜</p>
        </div>
        <Icon name="chevron" :size="16" class="text-muted" />
      </RouterLink>

      <!-- 安装说明 -->
      <section class="card p-5">
        <p class="section-title">添加到主屏幕</p>
        <p v-if="standalone" class="mt-2 text-[12px] leading-relaxed text-muted">
          你已经在使用独立应用模式，可以接收通知，也能离线查看记录。
        </p>
        <p v-else-if="pushState?.ios" class="mt-2 text-[12px] leading-relaxed text-muted">
          用 Safari 打开本页 → 点底部「分享」→「添加到主屏幕」→ 从桌面图标打开「两人食」。
          只有这样 iPhone 才允许接收推送。
        </p>
        <p v-else class="mt-2 text-[12px] leading-relaxed text-muted">
          在 Chrome 菜单里选择「安装应用」或「添加到主屏幕」。华为手机同样支持。
        </p>
      </section>

      <!-- 退出 -->
      <button
        type="button"
        class="btn-ghost w-full py-3 text-[14px] text-clay-600"
        @click="logout"
      >
        <Icon name="logout" :size="17" />
        退出登录
      </button>

      <p class="pb-2 text-center text-[11px] leading-relaxed text-muted/70">
        两人食 v1.0 · 仅两个账号 · RLS 已启用
      </p>
    </main>

    <BottomNav />

    <!-- 提醒编辑 -->
    <BaseModal
      :open="showEditor"
      :title="editingId ? '修改提醒' : '新增提醒'"
      @close="showEditor = false"
    >
      <div class="space-y-4">
        <div v-if="!editingId">
          <p class="section-title mb-2">快捷模板</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="preset in PRESETS"
              :key="preset.label"
              type="button"
              class="chip"
              @click="applyPreset(preset)"
            >
              {{ preset.label }} {{ preset.time }}
            </button>
          </div>
        </div>

        <label class="block">
          <span class="section-title">提醒名称</span>
          <input v-model="form.label" maxlength="10" class="input mt-1.5" placeholder="早餐 / 午餐 / 晚餐" />
        </label>

        <label class="block">
          <span class="section-title">提醒时间</span>
          <input v-model="form.time" type="time" class="input mt-1.5" />
        </label>

        <label class="block">
          <span class="section-title">推送文案</span>
          <textarea v-model="form.message" rows="3" maxlength="120" class="input mt-1.5 text-[14px]" />
        </label>

        <p class="text-[11px] leading-relaxed text-muted">
          保存后，到点会推送给对方账号。示例：「{{ form.message || DEFAULT_MESSAGE }}」
        </p>

        <button
          type="button"
          class="btn-primary w-full"
          :disabled="formSaving"
          @click="saveReminder"
        >
          {{ formSaving ? '保存中…' : '保存提醒' }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>
