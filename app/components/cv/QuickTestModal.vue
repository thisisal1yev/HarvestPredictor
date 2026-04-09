<script setup lang="ts">
import type { CVModel, QuickTestResponse } from '~/composables/useCVModels'

const props = defineProps<{ model: CVModel | null }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()
const { quickTest } = useCVModels()

const MAX_SIZE = 10 * 1024 * 1024

const file = ref<File | null>(null)
const previewUrl = ref<string | null>(null)
const loading = ref(false)
const error = ref('')
const result = ref<QuickTestResponse | null>(null)
const isDragging = ref(false)

const overlayBoxes = computed(() => {
  if (!result.value) return []
  return result.value.detections.map(d => ({
    x: d.bbox.x,
    y: d.bbox.y,
    w: d.bbox.w,
    h: d.bbox.h,
    label: d.className,
    confidence: d.confidence
  }))
})

function reset() {
  file.value = null
  if (previewUrl.value) {
    URL.revokeObjectURL(previewUrl.value)
    previewUrl.value = null
  }
  result.value = null
  error.value = ''
}

function setFile(f: File | null) {
  if (!f) return
  if (!/^image\/(jpe?g|png)$/i.test(f.type)) {
    error.value = 'Only JPG/PNG images allowed'
    return
  }
  if (f.size > MAX_SIZE) {
    error.value = 'Image too large (max 10 MB)'
    return
  }
  error.value = ''
  file.value = f
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
  previewUrl.value = URL.createObjectURL(f)
  result.value = null
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  setFile(target.files?.[0] ?? null)
}

function onDrop(e: DragEvent) {
  e.preventDefault()
  isDragging.value = false
  const f = e.dataTransfer?.files?.[0] ?? null
  setFile(f)
}

async function submit() {
  if (!file.value || !props.model) return
  error.value = ''
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('file', file.value)
    result.value = await quickTest(props.model.id, fd)
  } catch (e: unknown) {
    const status = (e as { status?: number }).status
    if (status === 429) {
      error.value = t('detection.models.quickTest.rateLimit')
    } else {
      error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Quick test failed'
    }
  } finally {
    loading.value = false
  }
}

watch(open, (v) => {
  if (!v) reset()
})

onBeforeUnmount(() => {
  if (previewUrl.value) URL.revokeObjectURL(previewUrl.value)
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="t('detection.models.quickTest.title')"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />

        <div
          v-if="model"
          class="text-sm text-muted"
        >
          {{ model.name }}
        </div>

        <div
          v-if="!previewUrl"
          class="border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors"
          :class="isDragging ? 'border-primary bg-primary/5' : 'border-default'"
          @click="($refs.fileInput as HTMLInputElement)?.click()"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop="onDrop"
        >
          <UIcon
            name="i-lucide-upload-cloud"
            class="size-10 text-muted mx-auto mb-2"
          />
          <p class="text-sm">
            {{ t('detection.models.quickTest.drop') }}
          </p>
        </div>

        <input
          ref="fileInput"
          type="file"
          accept="image/jpeg,image/png"
          class="hidden"
          @change="onFileChange"
        >

        <div
          v-if="previewUrl && !result"
          class="space-y-2"
        >
          <img
            :src="previewUrl"
            class="max-w-full rounded"
            alt="preview"
          >
          <div class="flex gap-2">
            <UButton
              :loading="loading"
              @click="submit"
            >
              Run test
            </UButton>
            <UButton
              variant="outline"
              color="neutral"
              @click="reset"
            >
              {{ t('common.cancel') }}
            </UButton>
          </div>
        </div>

        <div
          v-if="previewUrl && result"
          class="space-y-3"
        >
          <BBoxOverlay
            :src="previewUrl"
            :boxes="overlayBoxes"
          />
          <div class="text-xs text-muted">
            Inference: {{ result.inferenceMs }}ms · {{ result.imageWidth }}×{{ result.imageHeight }}
          </div>
          <div
            v-if="result.detections.length === 0"
            class="text-sm text-muted"
          >
            {{ t('detection.models.quickTest.noDetections') }}
          </div>
          <div
            v-else
            class="flex flex-wrap gap-2"
          >
            <UBadge
              v-for="(d, i) in result.detections"
              :key="i"
              color="primary"
              variant="subtle"
            >
              {{ d.className }} {{ (d.confidence * 100).toFixed(0) }}%
            </UBadge>
          </div>
          <UButton
            size="sm"
            variant="outline"
            @click="reset"
          >
            Try another
          </UButton>
        </div>
      </div>
    </template>
  </UModal>
</template>
