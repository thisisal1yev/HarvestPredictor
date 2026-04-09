<script setup lang="ts">
const open = defineModel<boolean>('open', { default: false })
const emit = defineEmits<{ uploaded: [] }>()

const { t } = useI18n()
const { createModel } = useCVModels()

const MAX_SIZE = 100 * 1024 * 1024

const name = ref('')
const cropType = ref('')
const file = ref<File | null>(null)
const loading = ref(false)
const error = ref('')

function reset() {
  name.value = ''
  cropType.value = ''
  file.value = null
  error.value = ''
}

function onFileChange(e: Event) {
  const target = e.target as HTMLInputElement
  const f = target.files?.[0] ?? null
  if (f && f.size > MAX_SIZE) {
    error.value = 'File too large (max 100 MB)'
    file.value = null
    target.value = ''
    return
  }
  error.value = ''
  file.value = f
}

async function submit() {
  if (!file.value || !name.value) return
  error.value = ''
  loading.value = true
  try {
    const fd = new FormData()
    fd.append('name', name.value)
    if (cropType.value) fd.append('cropType', cropType.value)
    fd.append('file', file.value)
    await createModel(fd)
    emit('uploaded')
    reset()
    open.value = false
  } catch (e: unknown) {
    error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Upload failed'
  } finally {
    loading.value = false
  }
}

watch(open, (v) => {
  if (!v) reset()
})
</script>

<template>
  <USlideover
    v-model:open="open"
    :title="t('detection.models.upload')"
  >
    <template #body>
      <form
        class="space-y-4"
        @submit.prevent="submit"
      >
        <UAlert
          v-if="error"
          color="error"
          :title="error"
        />

        <UFormField
          :label="t('detection.models.form.name')"
          required
        >
          <UInput
            v-model="name"
            required
            class="w-full"
          />
        </UFormField>

        <UFormField :label="t('detection.models.form.cropType')">
          <UInput
            v-model="cropType"
            class="w-full"
          />
        </UFormField>

        <UFormField
          :label="t('detection.models.form.file')"
          required
        >
          <input
            type="file"
            accept=".onnx"
            class="block w-full text-sm"
            @change="onFileChange"
          >
        </UFormField>

        <div class="flex gap-2 pt-2">
          <UButton
            type="submit"
            :loading="loading"
            :disabled="!file || !name"
          >
            {{ t('common.save') }}
          </UButton>
          <UButton
            variant="outline"
            color="neutral"
            :disabled="loading"
            @click="open = false"
          >
            {{ t('common.cancel') }}
          </UButton>
        </div>
      </form>
    </template>
  </USlideover>
</template>
