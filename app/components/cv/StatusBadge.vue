<script setup lang="ts">
import type { CvConnectionStatus } from '~/composables/useCVConnections'

const props = defineProps<{ status: CvConnectionStatus }>()
const { t } = useI18n()

const color = computed<'neutral' | 'success' | 'warning' | 'error'>(() => {
  switch (props.status) {
    case 'active': return 'success'
    case 'disconnected': return 'warning'
    case 'error': return 'error'
    case 'idle':
    default: return 'neutral'
  }
})

const label = computed(() => t(`detection.connections.status.${props.status}`))
</script>

<template>
  <UBadge
    :color="color"
    variant="subtle"
    class="capitalize"
  >
    {{ label }}
  </UBadge>
</template>
