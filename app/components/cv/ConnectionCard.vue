<script setup lang="ts">
import type { CVConnection } from '~/composables/useCVConnections'

const props = defineProps<{ connection: CVConnection }>()
const emit = defineEmits<{
  start: [conn: CVConnection]
  stop: [conn: CVConnection]
  edit: [conn: CVConnection]
  delete: [conn: CVConnection]
}>()

const { t } = useI18n()

const canStart = computed(() =>
  props.connection.status === 'idle'
  || props.connection.status === 'disconnected'
  || props.connection.status === 'error'
)
const canStop = computed(() => props.connection.status === 'active')

const lastDetection = computed(() => {
  if (!props.connection.lastDetectionAt) return null
  try {
    return new Date(props.connection.lastDetectionAt).toLocaleString()
  } catch {
    return props.connection.lastDetectionAt
  }
})
</script>

<template>
  <UCard>
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0 flex-1">
        <div class="flex items-center gap-2 flex-wrap">
          <h3 class="font-semibold truncate">
            {{ connection.name }}
          </h3>
          <StatusBadge :status="connection.status" />
        </div>

        <div class="mt-2 text-sm text-muted space-y-0.5">
          <p v-if="connection.model">
            Model: {{ connection.model.name }}
          </p>
          <p v-if="connection.field">
            Field: {{ connection.field.name }}
          </p>
          <p v-if="lastDetection">
            Last detection: {{ lastDetection }}
          </p>
          <p
            v-if="connection.errorMessage"
            class="text-error"
          >
            {{ connection.errorMessage }}
          </p>
        </div>
      </div>
    </div>

    <div class="flex flex-wrap gap-2 mt-4">
      <UButton
        v-if="canStart"
        size="xs"
        color="primary"
        icon="i-lucide-play"
        @click="emit('start', connection)"
      >
        {{ t('detection.connections.start') }}
      </UButton>
      <UButton
        v-if="canStop"
        size="xs"
        color="warning"
        icon="i-lucide-square"
        @click="emit('stop', connection)"
      >
        {{ t('detection.connections.stop') }}
      </UButton>
      <UButton
        size="xs"
        variant="outline"
        icon="i-lucide-pencil"
        @click="emit('edit', connection)"
      >
        {{ t('common.edit') }}
      </UButton>
      <UButton
        size="xs"
        variant="ghost"
        color="error"
        icon="i-lucide-trash-2"
        @click="emit('delete', connection)"
      >
        {{ t('common.delete') }}
      </UButton>
    </div>
  </UCard>
</template>
