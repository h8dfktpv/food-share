/**
 * 上传前压缩图片：最长边 1600px、JPEG 质量 0.82。
 * 既节省 Supabase 存储，也避免 iPhone 原图（HEIC/48MP）上传过慢。
 */

const MAX_EDGE = 1600
const QUALITY = 0.82
const MAX_FILE_BYTES = 20 * 1024 * 1024

function loadImageElement(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片解码失败'))
    }
    img.src = url
  })
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('图片压缩失败'))
      },
      type,
      quality
    )
  })
}

/**
 * @returns {Promise<{ blob: Blob, contentType: string, extension: string }>}
 */
export async function prepareImage(file) {
  if (!file) throw new Error('没有选择图片')
  if (!file.type.startsWith('image/')) throw new Error('请选择图片文件')
  if (file.size > MAX_FILE_BYTES) throw new Error('图片超过 20MB，请换一张')

  let source = null
  try {
    // Safari 15+ 支持 createImageBitmap，速度更快
    if ('createImageBitmap' in window) {
      source = await createImageBitmap(file)
    }
  } catch {
    source = null
  }
  if (!source) {
    try {
      source = await loadImageElement(file)
    } catch {
      // 极少数 HEIC 无法被 canvas 解码，原图上传（iOS 端仍可显示）
      return {
        blob: file,
        contentType: file.type || 'image/jpeg',
        extension: (file.name.split('.').pop() || 'jpg').toLowerCase()
      }
    }
  }

  const width = source.width
  const height = source.height
  const scale = Math.min(1, MAX_EDGE / Math.max(width, height))
  const targetW = Math.round(width * scale)
  const targetH = Math.round(height * scale)

  const canvas = document.createElement('canvas')
  canvas.width = targetW
  canvas.height = targetH
  const ctx = canvas.getContext('2d')
  ctx.drawImage(source, 0, 0, targetW, targetH)
  if (source.close) source.close()

  const blob = await canvasToBlob(canvas, 'image/jpeg', QUALITY)
  return { blob, contentType: 'image/jpeg', extension: 'jpg' }
}
