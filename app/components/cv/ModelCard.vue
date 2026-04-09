<script setup lang="ts">
import type { CVModel } from '~/composables/useCVModels'

const props = defineProps<{ model: CVModel }>()
const emit = defineEmits<{
  try: [model: CVModel]
  edit: [model: CVModel]
  delete: [model: CVModel]
  setDefault: [model: CVModel]
}>()

const { t } = useI18n()

const humanSize = computed(() => {
  const bytes = props.model.fileSize
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
})

const formattedDate = computed(() => {
  try {
    return new Date(props.model.createdAt).toLocaleDateString()
  } catch {
    return props.model.createdAt
  }
})
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-2">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2">
          <h3 class="font-semibold truncate">
            {{ model.name }}
          </h3>
          <UBadge
            v-if="model.isDefault"
            color="primary"
            variant="subtle"
            size="xs"
          >
            Default
          </UBadge>
        </div>
        <p
          v-if="model.cropType"
          class="text-sm text-muted mt-1"
        >
          {{ model.cropType }}
        </p>
        <p class="text-xs text-muted mt-1">
          {{ humanSize }} · {{ formattedDate }}
        </p>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 mt-4">
      <UButton
        size="xs"
        icon="i-lucide-play"
        color="primary"
        @click="emit('try', model)"
      >
        {{ t('detection.models.try') }}
      </UButton>
      <UButton
        size="xs"
        variant="outline"
        icon="i-lucide-pencil"
        @click="emit('edit', model)"
      >
        {{ t('common.edit') }}
      </UButton>
      <UButton
        v-if="!model.isDefault"
        size="xs"
        variant="outline"
        icon="i-lucide-star"
        @click="emit('setDefault', model)"
      >
        Set default
      </UButton>
      <UButton
        size="xs"
        variant="ghost"
        color="error"
        icon="i-lucide-trash-2"
        @click="emit('delete', model)"
      >
        {{ t('common.delete') }}
      </UButton>
    </div>
  </UCard>
</template>
