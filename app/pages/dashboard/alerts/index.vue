<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' })

const { t } = useI18n()
const toast = useToast()
const { alerts, loading, fetchAlerts, updateAlert, deleteAlert, runAlerts } = useAlerts()

const activeFilter = ref('all')
const filters = computed(() => [
  { label: t('alert.all'), value: 'all' },
  { label: t('alert.active'), value: 'active' },
  { label: t('alert.resolved'), value: 'resolved' },
  { label: t('alert.dismissed'), value: 'dismissed' }
])

await fetchAlerts()

const filteredAlerts = computed(() => {
  if (activeFilter.value === 'all') return alerts.value
  return alerts.value.filter((a: Record<string, any>) => a.status === activeFilter.value)
})

const severityColor: Record<string, string> = {
  critical: 'text-red-600 bg-red-50 dark:bg-red-950 dark:text-red-400',
  warning: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950 dark:text-yellow-400',
  info: 'text-blue-600 bg-blue-50 dark:bg-blue-950 dark:text-blue-400'
}

const statusIcon: Record<string, string> = {
  active: 'i-lucide-bell-ring',
  resolved: 'i-lucide-check-circle',
  dismissed: 'i-lucide-x-circle'
}

async function handleResolve(id: string) {
  await updateAlert(id, { status: 'resolved' })
  await fetchAlerts()
}

async function handleDismiss(id: string) {
  await updateAlert(id, { status: 'dismissed' })
  await fetchAlerts()
}

async function handleDelete(id: string) {
  await deleteAlert(id)
  await fetchAlerts()
}

const runningAlerts = ref(false)
async function handleRunAlerts() {
  runningAlerts.value = true
  try {
    const result = await runAlerts()
    await fetchAlerts()
    toast.add({
      title: t('alert.runSuccess'),
      description: t('alert.newAlerts', { count: (result as any)?.alertsCreated ?? 0 }),
      color: 'success'
    })
  } finally {
    runningAlerts.value = false
  }
}

function formatDate(d: string) {
  return d ? new Date(d).toLocaleString() : '—'
}
</script>

<template>
  <UDashboardPanel id="alerts">
    <template #header>
      <UDashboardNavbar :title="t('alert.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-download"
            variant="outline"
            size="sm"
            @click="navigateTo('/api/export/alerts', { external: true, open: { target: '_blank' } })"
          >
            {{ t('common.exportCSV') }}
          </UButton>
          <UButton
            icon="i-lucide-scan"
            :loading="runningAlerts"
            @click="handleRunAlerts"
          >
            {{ t('alert.runCheck') }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- Filter tabs -->
      <div class="flex gap-2 mb-4">
        <UButton
          v-for="filter in filters"
          :key="filter.value"
          size="sm"
          :variant="activeFilter === filter.value ? 'solid' : 'outline'"
          @click="activeFilter = filter.value"
        >
          {{ filter.label }}
        </UButton>
      </div>

      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
      </div>

      <div v-else-if="!filteredAlerts.length" class="text-center py-12 text-gray-500">
        {{ t('common.noData') }}
      </div>

      <div v-else class="space-y-3">
        <UCard v-for="alert in filteredAlerts" :key="(alert.id as string)" class="p-4">
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <UIcon
                :name="statusIcon[(alert.status as string)] || 'i-lucide-bell'"
                class="size-5 mt-0.5"
                :class="alert.status === 'active' ? 'text-red-500' : 'text-gray-400'"
              />
              <div>
                <div class="flex items-center gap-2">
                  <span
                    class="text-xs px-2 py-0.5 rounded-full font-medium"
                    :class="severityColor[(alert.severity as string)] || 'text-gray-600 bg-gray-50'"
                  >
                    {{ t(`alert.${alert.severity}`) }}
                  </span>
                  <span class="text-xs text-gray-400">{{ alert.rule }}</span>
                </div>
                <p class="text-sm mt-1">{{ alert.message }}</p>
                <div class="flex gap-3 mt-1 text-xs text-gray-400">
                  <span>{{ (alert.field as Record<string, unknown>)?.name }}</span>
                  <span>{{ formatDate(alert.triggeredAt as string) }}</span>
                  <span class="capitalize">{{ alert.status }}</span>
                </div>
              </div>
            </div>
            <div class="flex gap-1">
              <UButton
                v-if="alert.status === 'active'"
                icon="i-lucide-check"
                variant="ghost"
                color="success"
                size="xs"
                :title="t('alert.resolved')"
                @click="handleResolve(alert.id as string)"
              />
              <UButton
                v-if="alert.status === 'active'"
                icon="i-lucide-x"
                variant="ghost"
                color="warning"
                size="xs"
                :title="t('alert.dismissed')"
                @click="handleDismiss(alert.id as string)"
              />
              <UButton
                icon="i-lucide-trash-2"
                variant="ghost"
                color="error"
                size="xs"
                @click="handleDelete(alert.id as string)"
              />
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
