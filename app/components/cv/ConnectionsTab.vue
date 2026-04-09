<script setup lang="ts">
import type { CVConnection } from '~/composables/useCVConnections'

const { t } = useI18n()
const {
  connections,
  loading,
  error,
  fetchConnections,
  deleteConnection,
  startConnection,
  stopConnection
} = useCVConnections()

const formOpen = ref(false)
const editingConnection = ref<CVConnection | null>(null)

await fetchConnections()

function onCreate() {
  editingConnection.value = null
  formOpen.value = true
}

function onEdit(c: CVConnection) {
  editingConnection.value = c
  formOpen.value = true
}

async function onStart(c: CVConnection) {
  try {
    await startConnection(c.id)
    await fetchConnections()
  } catch (e: unknown) {
    alert((e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Start failed')
  }
}

async function onStop(c: CVConnection) {
  try {
    await stopConnection(c.id)
    await fetchConnections()
  } catch (e: unknown) {
    alert((e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Stop failed')
  }
}

async function onDelete(c: CVConnection) {
  if (!confirm(`Delete connection "${c.name}"?`)) return
  try {
    await deleteConnection(c.id)
    await fetchConnections()
  } catch (e: unknown) {
    alert((e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Delete failed')
  }
}

async function onSaved() {
  await fetchConnections()
}
</script>

<template>
  <div class="space-y-4">
    <div class="flex justify-end">
      <UButton
        icon="i-lucide-plus"
        @click="onCreate"
      >
        {{ t('detection.connections.create') }}
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
      v-else-if="connections.length === 0"
      class="text-center text-muted py-12"
    >
      {{ t('common.noData') }}
    </div>

    <div
      v-else
      class="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
    >
      <ConnectionCard
        v-for="c in connections"
        :key="c.id"
        :connection="c"
        @start="onStart"
        @stop="onStop"
        @edit="onEdit"
        @delete="onDelete"
      />
    </div>

    <ConnectionFormDrawer
      v-model:open="formOpen"
      :connection="editingConnection"
      @saved="onSaved"
    />
  </div>
</template>
