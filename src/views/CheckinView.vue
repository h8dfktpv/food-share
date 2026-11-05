<script setup>
import { onBeforeUnmount, ref } from 'vue'
import { useRouter } from 'vue-router'
import BottomNav from '../components/BottomNav.vue'
import Icon from '../components/Icon.vue'
import { currentUser, currentMember } from '../lib/auth'
import { prepareImage } from '../lib/image'
import { PHOTO_BUCKET, supabase } from '../lib/supabase'
import { toastError, toastSuccess } from '../lib/toast'
import { pushMessage } from '../lib/messages'

const router = useRouter()
const cameraInput = ref(null)
const libraryInput = ref(null)
const prepared = ref(null) // { blob, contentType, extension }
const previewUrl = ref('')
const note = ref('')
const preparing = ref(false)
const submitting = ref(false)

async function handleFile(event) {
  const file = event.target.files?.[0]
  // 清空 input，允许再次选择同一张照片
  event.target.value = ''
  if (!file) return
  preparing.value = true
  try {
    const result = await prepareImage(file)
    if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
    prepared.value = result
    previewUrl.value = URL.createObjectURL(result.blob)
  } catch (error) {
    toastError(error.message || '图片处理失败')
  } finally {
    preparing.value = false
  }
}

function clearPhoto() {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = ''
  prepared.value = null
}

async function submit() {
  if (!prepared.value) {
    toastError('先选一张照片吧')
    return
  }
  if (!currentUser.value) {
    toastError('登录状态已失效')
    return
  }
  submitting.value = true
  const suffix = Math.random().toString(36).slice(2, 8)
  const path = `${currentUser.value.id}/${Date.now()}-${suffix}.${prepared.value.extension}`
  const { error: uploadError } = await supabase.storage
    .from(PHOTO_BUCKET)
    .upload(path, prepared.value.blob, {
      contentType: prepared.value.contentType,
      cacheControl: '31536000',
      upsert: false
    })
  if (uploadError) {
    submitting.value = false
    toastError(`照片上传失败：${uploadError.message}`)
    return
  }
  const { error } = await supabase.from('checkins').insert({
    author_id: currentUser.value.id,
    image_path: path,
    note: note.value.trim()
  })
  if (error) {
    // 记录写入失败时清理已上传的照片，避免产生孤儿文件
    await supabase.storage.from(PHOTO_BUCKET).remove([path])
    submitting.value = false
    toastError(`发布失败：${error.message}`)
    return
  }



  submitting.value = false
  toastSuccess('打卡成功')
  clearPhoto()
  note.value = ''
  router.push('/')
}

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <div class="min-h-dvh">
    <header class="safe-top">
      <div class="app-container pb-4 pt-2">
        <p class="text-[12px] text-muted">只属于你们两个</p>
        <h1 class="mt-1 text-[24px] font-semibold tracking-tight">记录这一餐</h1>
      </div>
    </header>
    <main class="app-container page-with-nav space-y-4">

  <!-- 照片区域 -->
  <section class="card overflow-hidden">
    <button
      v-if="!previewUrl"
      type="button"
      class="flex aspect-[4/3] w-full flex-col items-center justify-center gap-3 bg-sage-50/60 transition active:bg-sage-100/70"
      @click="libraryInput?.click()"
    >
      <div class="grid h-14 w-14 place-items-center rounded-full bg-white text-sage-500 shadow-soft">
        <Icon name="image" :size="26" />
      </div>
          <p class="text-[14px]">{{ preparing ? '正在处理照片…' : '从相册选一张，或现场拍' }}</p>
          <p class="text-[11px] text-muted">上传前会自动压缩，省流量</p>
        </button>
        <div v-else class="relative">
          <img :src="previewUrl" alt="打卡照片预览" class="aspect-[4/3] w-full object-cover" />
          <button
            type="button"
            aria-label="移除照片"
            class="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-ink shadow-soft backdrop-blur transition active:scale-95"
            @click="clearPhoto"
          >
            <Icon name="close" :size="17" />
          </button>
        </div>
      </section>
      <!-- 拍照 / 相册 -->
      <div class="grid grid-cols-2 gap-3">
        <button
          type="button"
          class="btn-ghost py-3"
          :disabled="preparing || submitting"
          @click="cameraInput?.click()"
        >
          <Icon name="camera" :size="18" />
          拍照
        </button>
        <button
          type="button"
          class="btn-ghost py-3"
          :disabled="preparing || submitting"
          @click="libraryInput?.click()"
        >
          <Icon name="image" :size="18" />
          相册
        </button>
      </div>
      <!-- 备注 -->
      <section class="card p-4">
        <div class="flex items-center justify-between">
          <label for="note" class="section-title">写点什么（可选）</label>
          <span class="text-[10px] text-muted">{{ note.length }}/200</span>
        </div>
        <textarea
          id="note"
          v-model="note"
          rows="4"
          maxlength="200"
          placeholder="比如：今天的番茄炒蛋有点咸，但还是吃光了。"
          class="input mt-2 text-[14px] leading-relaxed"
        />
      </section>
      <button
        type="button"
        class="btn-primary w-full py-3.5"
        :disabled="submitting || preparing || !prepared"
        @click="submit"
      >
        {{ submitting ? '正在发布…' : '发布打卡' }}
      </button>
      <p class="text-center text-[11px] leading-relaxed text-muted">
        照片与备注仅你们两人可见 · 存放在私有存储桶
      </p>
      <input
        ref="cameraInput"
        type="file"
        accept="image/*"
        capture="environment"
        class="hidden"
        @change="handleFile"
      />
      <input
        ref="libraryInput"
        type="file"
        accept="image/*"
        class="hidden"
        @change="handleFile"
      />
    </main>
    <BottomNav />
  </div>
</template>

