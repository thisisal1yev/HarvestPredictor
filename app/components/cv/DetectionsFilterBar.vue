<script setup lang="ts">
import type { CVDetectionFilters, CvDetectionSeverity } from '~/composables/useCVDetections'
import type { CVConnection } from '~/composables/useCVConnections'

const props = defineProps<{
  filters: CVDetectionFilters
  connections: CVConnection[]
}>()
const emit = defineEmits<{
  'update:filters': [filters: CVDetectionFilters]
}>()

const { t } = useI18n()

const local = reactive<CVDetectionFilters>({ ...props.filters })

watch(() => props.filters, (v) => {
  Object.assign(local, v)
}, { deep: true })

const connectionItems = computed(() => [
  { label: '—', value: undefined as string | undefined },
  ...props.connections.map(c => ({ label: c.name, value: c.id }))
])

const severityItems: { label: string, value: CvDetectionSeverity | undefined }[] = [
  { label: '—', value: undefined },
  { label: t('detection.detections.severity.confirmed'), value: 'confirmed' },
  { label: t('detection.detections.severity.likely'), value: 'likely' },
  { label: t('detection.detections.severity.possible'), value: 'possible' }
]

function emitUpdate() {
  emit('update:filters', { ...local, page: 1 })
}

function reset() {
  local.connectionId = undefined
  local.className = undefined
  local.severity = undefined
  local.from = undefined
  local.to = undefined
  emitUpdate()
}
</script>

<template>
  <div class="flex flex-wrap gap-3 items-end">
    <UFormField :label="t('detection.detections.filters.connection')">
      <USelect
        v-model="local.connectionId"
        :items="connectionItems"
        class="w-48"
        @update:model-value="emitUpdate"
      />
    </UFormField>

    <UFormField :label="t('detection.detections.filters.class')">
      <UInput
        v-model="local.className"
        class="w-40"
        @blur="emitUpdate"
        @keyup.enter="emitUpdate"
      />
    </UFormField>

    <UFormField :label="t('detection.detections.filters.severity')">
      <USelect
        v-model="local.severity"
        :items="severityItems"
        class="w-40"
        @update:model-value="emitUpdate"
      />
    </UFormField>

    <UFormField :label="t('detection.detections.filters.dateFrom')">
      <UInput
        v-model="local.from"
        type="date"
        class="w-40"
        @change="emitUpdate"
      />
    </UFormField>

    <UFormField :label="t('detection.detections.filters.dateTo')">
      <UInput
        v-model="local.to"
        type="date"
        class="w-40"
        @change="emitUpdate"
      />
    </UFormField>

    <UButton
      variant="ghost"
      icon="i-lucide-x"
      @click="reset"
    >
      Reset
    </UButton>
  </div>
</template>
