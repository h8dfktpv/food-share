<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import BaseModal from '../components/BaseModal.vue'
import BottomNav from '../components/BottomNav.vue'
import EmptyState from '../components/EmptyState.vue'
import Icon from '../components/Icon.vue'
import { currentMember, currentUser, getPartnerId } from '../lib/auth'
import { pushMessage } from '../lib/messages'
import { supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'

/** 预设标签，够日常使用又不会太杂 */
const TAGS = ['家常菜', '外卖', '面食', '甜品', '汤羹', '其他']

const dishes = ref([])
const favoriteIds = ref(new Set())
const loading = ref(true)
const blockedTags = ref([])
const onlyFavorites = ref(false)

const drawState = ref('idle') // idle | rolling | result
const rollingName = ref('')
const result = ref(null)
const showResult = ref(false)

const showAdd = ref(false)
const newName = ref('')
const newTags = ref([])
const saving = ref(false)

let rollTimer = null
let rollTimeout = null
let channel = null

const isFavorite = (dish) => Boolean(dish) && favoriteIds.value.has(dish.id)

/** 当前可抽的菜池：排除屏蔽标签 + 只收藏过滤 */
const pool = computed(() =>
  dishes.value.filter((dish) => {
    if (onlyFavorites.value && !favoriteIds.value.has(dish.id)) return false
    const tags = dish.tags || []
    if (blockedTags.value.length && tags.some((tag) => blockedTags.value.includes(tag))) {
      return false
    }
    return true
  })
)

const displayName = computed(() => {
  if (drawState.value === 'rolling') return rollingName.value || '…'
  if (drawState.value === 'result' && result.value) return result.value.name
  return '？'
})

const heroSub = computed(() => {
  if (drawState.value === 'rolling') return '正在翻菜单…'
  if (!dishCount.value) return '菜单还是空的，先加几道菜吧'
  if (!pool.value.length) return '当前条件下一道菜都没有'
  return `从 ${pool.value.length} 道菜里选`
})

const dishCount = computed(() => dishes.value.length)

async function loadDishes() {
  const { data, error } = await supabase
    .from('dishes')
    .select('*')
    .order('created_at', { ascending: false })
  if (error) {
    toastError(`读取菜单失败：${error.message}`)
  } else {
    dishes.value = data || []
  }
  loading.value = false
}

async function loadFavorites() {
  if (!currentUser.value) return
  const { data, error } = await supabase
    .from('dish_favorites')
    .select('dish_id')
    .eq('user_id', currentUser.value.id)
  if (error) {
    console.warn('[dishes] 读取收藏失败：', error.message)
    return
  }
  favoriteIds.value = new Set((data || []).map((item) => item.dish_id))
}

function toggleBlocked(tag) {
  const list = blockedTags.value
  blockedTags.value = list.includes(tag) ? list.filter((item) => item !== tag) : [...list, tag]
}

function resetFilters() {
  blockedTags.value = []
  onlyFavorites.value = false
}

/** 随机抽签：先滚动 1.1 秒，再定格结果 */
function startRoll() {
  if (!pool.value.length) {
    toastError('没有可抽的菜，先放宽标签或加几道菜')
    return
  }
  if (rollTimer) clearInterval(rollTimer)
  if (rollTimeout) clearTimeout(rollTimeout)

  drawState.value = 'rolling'
  result.value = null

  const candidates = [...pool.value]
  rollTimer = window.setInterval(() => {
    rollingName.value = candidates[Math.floor(Math.random() * candidates.length)]?.name || '…'
  }, 90)

  rollTimeout = window.setTimeout(() => {
    clearInterval(rollTimer)
    rollTimer = null
    rollTimeout = null
    const pick = candidates[Math.floor(Math.random() * candidates.length)]
    result.value = pick
    drawState.value = 'result'
    showResult.value = true
  }, 1100)
}

function redraw() {
  showResult.value = false
  startRoll()
}

async function toggleFavorite(dish) {
  if (!dish || !currentUser.value) return
  const next = new Set(favoriteIds.value)

  if (next.has(dish.id)) {
    next.delete(dish.id)
    favoriteIds.value = next
    const { error } = await supabase
      .from('dish_favorites')
      .delete()
      .eq('dish_id', dish.id)
      .eq('user_id', currentUser.value.id)
    if (error) {
      next.add(dish.id)
      favoriteIds.value = new Set(next)
      toastError(`取消失藏失败：${error.message}`)
    }
  } else {
    next.add(dish.id)
    favoriteIds.value = next
    const { error } = await supabase
      .from('dish_favorites')
      .insert({ dish_id: dish.id, user_id: currentUser.value.id })
    if (error) {
      next.delete(dish.id)
      favoriteIds.value = new Set(next)
      toastError(`收藏失败：${error.message}`)
    }
  }
}

function openAdd() {
  newName.value = ''
  newTags.value = []
  showAdd.value = true
}

function toggleNewTag(tag) {
  newTags.value = newTags.value.includes(tag)
    ? newTags.value.filter((item) => item !== tag)
    : [...newTags.value, tag]
}

async function createDish() {
  const name = newName.value.trim()
  if (!name || saving.value || !currentUser.value) return

  if (dishes.value.some((dish) => dish.name === name)) {
    toastError('菜单里已经有这道菜了')
    return
  }

  saving.value = true
  const { data, error } = await supabase
    .from('dishes')
    .insert({ name, tags: newTags.value, created_by: currentUser.value.id })
    .select()
    .single()
  saving.value = false

  if (error) {
    toastError(`新增失败：${error.message}`)
    return
  }

  if (data && !dishes.value.some((dish) => dish.id === data.id)) {
    dishes.value.unshift(data)
  }
  showAdd.value = false
  toastSuccess('已加入菜单')

  // 给对方写一条站内消息
  if (data) {
    const partnerId = await getPartnerId()
    if (partnerId) {
      const myName = currentMember.value?.display_name || '我'
      const tagText = (data.tags || []).join('、')
      await pushMessage({
        userId: partnerId,
        type: 'dish',
        title: `${myName} 加了新菜品：${name}`,
        body: tagText ? `标签：${tagText}` : '去抽签看看会不会抽到它',
        data: { dish_id: data.id }
      })
    } else {
      console.warn('[dishes] 未找到对方账号，跳过站内消息')
    }
  }
}

async function removeDish(dish) {
  if (!window.confirm(`把「${dish.name}」从菜单里删掉吗？`)) return
  const { error } = await supabase.from('dishes').delete().eq('id', dish.id)
  if (error) {
    toastError(`删除失败：${error.message}`)
    return
  }
  dishes.value = dishes.value.filter((item) => item.id !== dish.id)
  toastSuccess('已删除')
}

function subscribe() {
  channel = supabase
    .channel('dishes-realtime')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'dishes' }, () => {
      loadDishes()
    })
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'dish_favorites' },
      () => loadFavorites()
    )
    .subscribe()
}

onMounted(async () => {
  await Promise.all([loadDishes(), loadFavorites()])
  subscribe()
})

onBeforeUnmount(() => {
  if (rollTimer) clearInterval(rollTimer)
  if (rollTimeout) clearTimeout(rollTimeout)
  if (channel) supabase.removeChannel(channel)
})
</script>

<template>
  <div class="min-h-dvh">
    <header class="safe-top">
      <div class="app-container flex items-start justify-between pb-4 pt-2">
        <div>
          <p class="text-[12px] text-muted">把选择交给运气</p>
          <h1 class="mt-1 text-[24px] font-semibold tracking-tight">今天吃什么</h1>
        </div>
        <button type="button" class="btn-soft mt-1 px-3.5 py-2 text-[12px]" @click="openAdd">
          <Icon name="plus" :size="15" />
          菜品
        </button>
      </div>
    </header>

    <main class="app-container page-with-nav space-y-4">
      <!-- 抽签 -->
      <section class="card bg-gradient-to-b from-sage-50 to-paper px-6 py-7 text-center">
        <p class="text-[10px] tracking-[0.22em] text-muted">TODAY'S PICK</p>
        <div class="mt-4 flex min-h-[76px] items-center justify-center">
          <p
            class="text-[30px] font-semibold tracking-tight"
            :class="drawState === 'rolling' ? 'rolling text-sage-500' : ''"
          >
            {{ displayName }}
          </p>
        </div>
        <p class="mt-1 text-[12px] text-muted">{{ heroSub }}</p>
        <button
          type="button"
          class="btn-primary mt-5 w-full py-3.5"
          :disabled="drawState === 'rolling'"
          @click="startRoll"
        >
          <Icon name="dice" :size="18" />
          {{ drawState === 'rolling' ? '正在抽…' : '抽一道' }}
        </button>
      </section>

      <!-- 临时屏蔽标签 -->
      <section class="card p-4">
        <div class="flex items-center justify-between">
          <p class="section-title">暂时不想吃</p>
          <button
            v-if="blockedTags.length || onlyFavorites"
            type="button"
            class="text-[11px] text-sage-500"
            @click="resetFilters"
          >
            清除筛选
          </button>
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          <button
            v-for="tag in TAGS"
            :key="tag"
            type="button"
            class="chip"
            :class="blockedTags.includes(tag) ? 'border-clay-200 bg-clay-50 text-clay-600' : ''"
            @click="toggleBlocked(tag)"
          >
            {{ tag }}
          </button>
          <button
            type="button"
            class="chip gap-1"
            :class="onlyFavorites ? 'chip-on' : ''"
            @click="onlyFavorites = !onlyFavorites"
          >
            <Icon name="heart" :size="12" :filled="onlyFavorites" />
            只看收藏
          </button>
        </div>
        <p class="mt-3 text-[11px] leading-relaxed text-muted">
          选中的标签会被临时屏蔽，只影响这次抽签，不改动菜单。
        </p>
      </section>

      <!-- 菜单 -->
      <section>
        <div class="mb-2 flex items-center justify-between px-1">
          <p class="section-title">菜单 · {{ dishCount }} 道</p>
          <p class="text-[11px] text-muted">{{ pool.length }} 道可选</p>
        </div>

        <div v-if="loading" class="card space-y-3 p-4">
          <div v-for="n in 3" :key="n" class="h-10 animate-pulse rounded-xl bg-sage-50" />
        </div>

        <EmptyState
          v-else-if="!dishes.length"
          icon="bowl"
          title="菜单还是空的"
          description="把你们常吃的菜加进来，抽签才有得选。"
        >
          <button type="button" class="btn-primary" @click="openAdd">新增第一道菜</button>
        </EmptyState>

        <div v-else class="card divide-y divide-line/70 overflow-hidden">
          <div v-for="dish in dishes" :key="dish.id" class="flex items-center gap-2 px-4 py-3.5">
            <div class="min-w-0 flex-1">
              <p class="truncate text-[15px]">{{ dish.name }}</p>
              <div v-if="(dish.tags || []).length" class="mt-1 flex flex-wrap gap-1.5">
                <span
                  v-for="tag in dish.tags"
                  :key="tag"
                  class="rounded-full bg-sage-50 px-2 py-0.5 text-[10px] text-sage-500"
                >
                  {{ tag }}
                </span>
              </div>
            </div>

            <button
              type="button"
              :aria-label="isFavorite(dish) ? '取消收藏' : '收藏'"
              class="p-2 transition active:scale-90"
              :class="isFavorite(dish) ? 'text-clay-500' : 'text-muted/50'"
              @click="toggleFavorite(dish)"
            >
              <Icon name="heart" :size="18" :filled="isFavorite(dish)" />
            </button>

            <button
              type="button"
              aria-label="删除菜品"
              class="p-2 text-muted/40 transition active:text-clay-500"
              @click="removeDish(dish)"
            >
              <Icon name="trash" :size="16" />
            </button>
          </div>
        </div>
      </section>
    </main>

    <BottomNav />

    <!-- 新增菜品 -->
    <BaseModal :open="showAdd" title="新增菜品" @close="showAdd = false">
      <form class="space-y-4" @submit.prevent="createDish">
        <label class="block">
          <span class="section-title">菜名</span>
          <input
            v-model="newName"
            maxlength="40"
            placeholder="比如：番茄炒蛋"
            class="input mt-1.5"
          />
        </label>

        <div>
          <p class="section-title mb-2">标签（可多选）</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="tag in TAGS"
              :key="tag"
              type="button"
              class="chip"
              :class="newTags.includes(tag) ? 'chip-on' : ''"
              @click="toggleNewTag(tag)"
            >
              {{ tag }}
            </button>
          </div>
        </div>

        <button type="submit" class="btn-primary w-full" :disabled="!newName.trim() || saving">
          {{ saving ? '保存中…' : '加入菜单' }}
        </button>
        <p class="text-center text-[11px] text-muted">两个人都能看到并一起抽签</p>
      </form>
    </BaseModal>

    <!-- 抽签结果 -->
    <BaseModal :open="showResult" title="就吃这个" @close="showResult = false">
      <div class="pb-2 text-center">
        <div class="mx-auto grid h-16 w-16 place-items-center rounded-full bg-sage-100">
          <Icon name="bowl" :size="30" class="text-sage-500" />
        </div>
        <p class="mt-4 text-[28px] font-semibold tracking-tight">{{ result?.name }}</p>
        <div class="mt-3 flex flex-wrap justify-center gap-2">
          <span
            v-for="tag in result?.tags || []"
            :key="tag"
            class="rounded-full bg-sage-50 px-2.5 py-1 text-[11px] text-sage-500"
          >
            {{ tag }}
          </span>
        </div>

        <div class="mt-6 flex gap-2">
          <button type="button" class="btn-ghost flex-1" @click="showResult = false">
            先想想
          </button>
          <button type="button" class="btn-primary flex-1" @click="redraw">再抽一次</button>
        </div>

        <button
          type="button"
          class="mt-4 inline-flex items-center gap-1.5 text-[12px]"
          :class="isFavorite(result) ? 'text-clay-500' : 'text-muted'"
          @click="toggleFavorite(result)"
        >
          <Icon name="heart" :size="14" :filled="isFavorite(result)" />
          {{ isFavorite(result) ? '已收藏' : '收藏这道菜' }}
        </button>
      </div>
    </BaseModal>
  </div>
</template>
