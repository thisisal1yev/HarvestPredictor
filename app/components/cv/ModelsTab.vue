<script setup lang="ts">
import type { CVModel } from '~/composables/useCVModels'

const { t } = useI18n()
const { models, loading, error, fetchModels, deleteModel, setDefault } = useCVModels()

const uploadOpen = ref(false)
const quickTestOpen = ref(false)
const activeModel = ref<CVModel | null>(null)

await fetchModels()

function onTry(model: CVModel) {
  activeModel.value = model
  quickTestOpen.value = true
}

function onEdit(_model: CVModel) {
  // Edit uses inline drawer in a future iteration; re-use upload drawer scope is out of scope here.
  // For now just re-open upload drawer — minimal editing path handled server-side via PUT.
  uploadOpen.value = true
}

async function onDelete(model: CVModel) {
  if (!confirm(`Delete model "${model.name}"?`)) return
  try {
    await deleteModel(model.id)
    await fetchModels()
  } catch (e: unknown) {
    const status = (e as { status?: number }).status
    if (status === 409) {
      alert(t('detection.models.deleteBlocked', { n: '?' }))
    } else {
      alert((e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Delete failed')
    }
  }
}

async function onSetDefault(model: CVModel) {
  await setDefault(model.id)
  await fetchModels()
}

async function onUploaded() {
  await fetchModels()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <UButton
        icon="i-lucide-upload"
        @click="uploadOpen = true"
      >
        {{ t('detection.models.upload') }}
      </UButton>
    </div>

    <UAlert
      v-if="error"
      color="error"
      :title="error"
    />

    <div
      v-if="loading"
      class="text-sm text-muted"
    >
      {{ t('common.loading') }}
    </div>

    <div
      v-else-if="models.length === 0"
      class="text-center text-muted py-12"
    >
      {{ t('detection.models.noModels') }}
    </div>

    <div
      v-else
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <ModelCard
        v-for="m in models"
        :key="m.id"
        :model="m"
        @try="onTry"
        @edit="onEdit"
        @delete="onDelete"
        @set-default="onSetDefault"
      />
    </div>

    <ModelUploadDrawer
      v-model:open="uploadOpen"
      @uploaded="onUploaded"
    />
    <QuickTestModal
      v-model:open="quickTestOpen"
      :model="activeModel"
    />
  </div>
</template>
