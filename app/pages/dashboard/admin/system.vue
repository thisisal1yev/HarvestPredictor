<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })

const { t } = useI18n()

const { data: stats } = await useFetch('/api/admin/stats')

const systemCards = computed(() => [
  { label: t('admin.totalFarms'), value: stats.value?.totalFarms ?? 0, icon: 'i-lucide-warehouse' },
  { label: t('admin.totalFieldsSystem'), value: stats.value?.totalFields ?? 0, icon: 'i-lucide-map' },
  { label: t('admin.totalSeasons'), value: stats.value?.totalSeasons ?? 0, icon: 'i-lucide-calendar' },
  { label: t('admin.activeAlertsSystem'), value: stats.value?.activeAlerts ?? 0, icon: 'i-lucide-bell-ring' },
])

const tableUi = {
  base: 'table-fixed border-separate border-spacing-0',
  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
  tbody: '[&>tr]:last:[&>td]:border-b-0',
  th: 'py-2 first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
  td: 'border-b border-default',
  separator: 'h-0'
}
</script>

<template>
  <UDashboardPanel id="admin-system">
    <template #header>
      <UDashboardNavbar :title="t('admin.systemOverview')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <UCard v-for="card in systemCards" :key="card.label" class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ card.label }}</p>
                <p class="text-3xl font-bold mt-1">{{ card.value }}</p>
              </div>
              <UIcon :name="card.icon" class="w-5 h-5 text-muted" />
            </div>
          </UCard>
        </div>

        <!-- Farmer breakdown -->
        <div>
          <h2 class="text-lg font-semibold mb-3">{{ t('admin.farmerOverview') }}</h2>
          <UTable
            :columns="[
              { accessorKey: 'name', header: t('common.name') },
              { accessorKey: 'email', header: t('auth.email') },
              { accessorKey: 'farmsCount', header: t('admin.farms') },
              { accessorKey: 'fieldsCount', header: t('admin.fields') },
              { accessorKey: 'totalArea', header: t('admin.area') },
              { accessorKey: 'activeAlerts', header: t('admin.alertsCol') },
            ]"
            :data="stats?.farmerStats ?? []"
            :ui="tableUi"
            class="shrink-0"
          >
            <template #activeAlerts-cell="{ row }">
              <UBadge
                v-if="row.original.activeAlerts > 0"
                color="error"
                variant="subtle"
                size="sm"
              >
                {{ row.original.activeAlerts }}
              </UBadge>
              <span v-else class="text-sm text-muted">0</span>
            </template>
          </UTable>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
