<script setup lang="ts">
import type { CVDetectionDetail } from '~/composables/useCVDetections'

const props = defineProps<{ detection: CVDetectionDetail | null }>()
const open = defineModel<boolean>('open', { default: false })

const { t } = useI18n()

const overlayBoxes = computed(() => {
  if (!props.detection) return []
  const d = props.detection
  return [{
    x: d.bbox.x,
    y: d.bbox.y,
    w: d.bbox.w,
    h: d.bbox.h,
    label: d.className,
    confidence: d.confidence
  }]
})

const severityColor = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
  switch (props.detection?.severity) {
    case 'confirmed': return 'error'
    case 'likely': return 'warning'
    case 'possible': return 'success'
    default: return 'neutral'
  }
})

const detectedAtLabel = computed(() => {
  if (!props.detection) return ''
  try {
    return new Date(props.detection.detectedAt).toLocaleString()
  } catch {
    return props.detection.detectedAt
  }
})
</script>

<template>
  <UModal
    v-model:open="open"
    :title="detection?.className ?? ''"
    :ui="{ content: 'max-w-4xl' }"
  >
    <template #body>
      <div
        v-if="detection"
        class="space-y-4"
      >
        <BBoxOverlay
          v-if="detection.fullUrl"
          :src="detection.fullUrl"
          :boxes="overlayBoxes"
        />

        <div class="flex flex-wrap gap-2">
          <UBadge
            :color="severityColor"
            variant="subtle"
          >
            {{ t(`detection.detections.severity.${detection.severity}`) }}
          </UBadge>
          <UBadge
            color="neutral"
            variant="outline"
          >
            {{ (detection.confidence * 100).toFixed(0) }}%
          </UBadge>
          <UBadge
            color="primary"
            variant="subtle"
          >
            {{ detection.category }}
          </UBadge>
        </div>

        <dl class="text-sm space-y-1">
          <div class="flex gap-2">
            <dt class="text-muted">
              Detected at:
            </dt>
            <dd>{{ detectedAtLabel }}</dd>
          </div>
          <div
            v-if="detection.connectionName"
            class="flex gap-2"
          >
            <dt class="text-muted">
              Connection:
            </dt>
            <dd>{{ detection.connectionName }}</dd>
          </div>
        </dl>

        <div
          v-if="detection.treatment"
          class="rounded border border-default p-3 bg-elevated/40"
        >
          <h4 class="font-semibold mb-1">
            {{ t('detection.detailTreatment') }}
          </h4>
          <p
            v-if="detection.treatment.description"
            class="text-sm"
          >
            {{ detection.treatment.description }}
          </p>
          <p
            v-if="detection.treatment.recommendation"
            class="text-sm mt-2"
          >
            {{ detection.treatment.recommendation }}
          </p>
        </div>
      </div>
    </template>

    <template #footer>
      <UButton
        variant="outline"
        color="neutral"
        @click="open = false"
      >
        {{ t('common.back') }}
      </UButton>
    </template>
  </UModal>
</template>
