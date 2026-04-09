<script setup lang="ts">
import type { CVDetection } from '~/composables/useCVDetections'

const props = defineProps<{ detection: CVDetection }>()
const emit = defineEmits<{ click: [detection: CVDetection] }>()

const { t } = useI18n()

const severityColor = computed<'success' | 'warning' | 'error' | 'neutral'>(() => {
  switch (props.detection.severity) {
    case 'confirmed': return 'error'
    case 'likely': return 'warning'
    case 'possible': return 'success'
    default: return 'neutral'
  }
})

const detectedAtLabel = computed(() => {
  try {
    return new Date(props.detection.detectedAt).toLocaleString()
  } catch {
    return props.detection.detectedAt
  }
})
</script>

<template>
  <button
    type="button"
    class="w-full text-left"
    @click="emit('click', detection)"
  >
    <UCard
      :ui="{ body: 'p-3' }"
      class="hover:bg-elevated/50 transition-colors"
    >
      <div class="flex items-center gap-3">
        <div class="size-16 rounded bg-elevated shrink-0 overflow-hidden flex items-center justify-center">
          <img
            v-if="detection.thumbUrl"
            :src="detection.thumbUrl"
            loading="lazy"
            decoding="async"
            class="size-full object-cover"
            :alt="detection.className"
          >
          <USkeleton
            v-else
            class="size-full"
          />
        </div>

        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="font-medium truncate">{{ detection.className }}</span>
            <UBadge
              :color="severityColor"
              variant="subtle"
              size="xs"
            >
              {{ t(`detection.detections.severity.${detection.severity}`) }}
            </UBadge>
            <UBadge
              color="neutral"
              variant="outline"
              size="xs"
            >
              {{ (detection.confidence * 100).toFixed(0) }}%
            </UBadge>
          </div>
          <div class="text-xs text-muted mt-1 truncate">
            <span v-if="detection.connectionName">{{ detection.connectionName }} · </span>
            {{ detectedAtLabel }}
          </div>
        </div>
      </div>
    </UCard>
  </button>
</template>
