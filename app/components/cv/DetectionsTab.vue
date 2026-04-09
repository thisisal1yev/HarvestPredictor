<script setup lang="ts">
import type { CVDetection, CVDetectionDetail, CVDetectionFilters } from '~/composables/useCVDetections'

const { t } = useI18n()
const {
  detections,
  total,
  loading,
  error,
  fetchDetections,
  fetchDetection
} = useCVDetections()
const { connections, fetchConnections } = useCVConnections()

const filters = ref<CVDetectionFilters>({ page: 1, limit: 50 })
const detailOpen = ref(false)
const activeDetail = ref<CVDetectionDetail | null>(null)

await Promise.all([
  fetchDetections(filters.value),
  fetchConnections()
])

async function onFiltersUpdate(next: CVDetectionFilters) {
  filters.value = { ...next }
  await fetchDetections(filters.value)
}

async function onCardClick(d: CVDetection) {
  try {
    activeDetail.value = await fetchDetection(d.id)
    detailOpen.value = true
  } catch (e: unknown) {
    alert((e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Failed to load detection')
  }
}
</script>

<template>
  <div class="space-y-4 h-full flex flex-col">
    <DetectionsFilterBar
      :filters="filters"
      :connections="connections"
      @update:filters="onFiltersUpdate"
    />

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
      v-else-if="detections.length === 0"
      class="text-center text-muted py-12"
    >
      {{ t('detection.detections.empty') }}
    </div>

    <UScrollArea
      v-else
      :items="detections"
      :virtualize="{ estimateSize: 96, gap: 8 }"
      class="flex-1 min-h-[400px]"
    >
      <template #default="{ item }">
        <DetectionCard
          :detection="item as CVDetection"
          @click="onCardClick"
        />
      </template>
    </UScrollArea>

    <div
      v-if="total > 0"
      class="text-xs text-muted text-right"
    >
      {{ detections.length }} / {{ total }}
    </div>

    <DetectionDetailModal
      v-model:open="detailOpen"
      :detection="activeDetail"
    />
  </div>
</template>
