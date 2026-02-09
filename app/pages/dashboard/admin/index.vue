<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })

const { t } = useI18n()
const { user } = useUserSession()

const { data: stats, status } = await useFetch('/api/admin/stats')
const pending = computed(() => status.value === 'pending')

const statCards = computed(() => [
  {
    label: t('admin.totalUsers'),
    value: stats.value?.totalUsers ?? 0,
    icon: 'i-lucide-users',
    color: 'text-blue-500',
  },
  {
    label: t('admin.farmerCount'),
    value: stats.value?.farmers ?? 0,
    icon: 'i-lucide-sprout',
    color: 'text-green-500',
  },
  {
    label: t('admin.adminCount'),
    value: stats.value?.admins ?? 0,
    icon: 'i-lucide-shield',
    color: 'text-purple-500',
  },
  {
    label: t('admin.totalFarms'),
    value: stats.value?.totalFarms ?? 0,
    icon: 'i-lucide-warehouse',
    color: 'text-amber-500',
  },
  {
    label: t('admin.totalFieldsSystem'),
    value: stats.value?.totalFields ?? 0,
    icon: 'i-lucide-map',
    color: 'text-emerald-500',
  },
  {
    label: t('admin.activeAlertsSystem'),
    value: stats.value?.activeAlerts ?? 0,
    icon: 'i-lucide-bell-ring',
    color: 'text-red-500',
  },
])

const farmerColumns = [
  { accessorKey: 'name', header: t('common.name') },
  { accessorKey: 'email', header: t('auth.email') },
  { accessorKey: 'farmsCount', header: t('admin.farms') },
  { accessorKey: 'fieldsCount', header: t('admin.fields') },
  { accessorKey: 'totalArea', header: t('admin.area') },
  { accessorKey: 'activeAlerts', header: t('admin.alertsCol') },
  {
    id: 'createdAt',
    header: t('admin.registered'),
    accessorFn: (row: Record<string, any>) =>
      row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'
  },
  { id: 'actions', header: t('common.actions') }
]

const recentColumns = [
  { accessorKey: 'name', header: t('common.name') },
  { accessorKey: 'email', header: t('auth.email') },
  {
    id: 'role',
    header: t('admin.role'),
    accessorFn: (row: Record<string, any>) => row.role
  },
  {
    id: 'createdAt',
    header: t('common.date'),
    accessorFn: (row: Record<string, any>) =>
      row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'
  },
]

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
  <UDashboardPanel id="admin-dashboard">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="pending" class="flex items-center justify-center h-64">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <div v-else-if="stats" class="space-y-6">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold">
              {{ t('admin.greeting', { name: user?.name ?? 'Admin' }) }}
            </h1>
            <p class="text-sm text-muted">{{ t('admin.subtitle') }}</p>
          </div>
          <UButton
            color="primary"
            icon="i-lucide-user-plus"
            :label="t('admin.manageUsers')"
            to="/dashboard/admin/users"
          />
        </div>

        <!-- Stat Cards -->
        <div class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
          <UCard v-for="card in statCards" :key="card.label" class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ card.label }}</p>
                <p class="text-3xl font-bold mt-1">{{ card.value }}</p>
              </div>
              <UIcon :name="card.icon" class="w-5 h-5" :class="card.color" />
            </div>
          </UCard>
        </div>

        <!-- Farmers Table -->
        <div>
          <div class="flex items-center justify-between mb-3">
            <h2 class="text-lg font-semibold">{{ t('admin.farmerOverview') }}</h2>
            <UButton variant="link" to="/dashboard/admin/users" size="xs">
              {{ t('dashboard.viewAll') }}
            </UButton>
          </div>
          <UTable
            :columns="farmerColumns"
            :data="stats.farmerStats"
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
            <template #actions-cell="{ row }">
              <UButton
                size="xs"
                variant="soft"
                icon="i-lucide-eye"
                :label="t('admin.viewDetails')"
              />
            </template>
          </UTable>
        </div>

        <!-- Recent Users -->
        <div>
          <h2 class="text-lg font-semibold mb-3">{{ t('admin.recentUsers') }}</h2>
          <UTable
            :columns="recentColumns"
            :data="stats.recentUsers"
            :ui="tableUi"
            class="shrink-0"
          >
            <template #role-cell="{ row }">
              <span
                class="text-xs px-2 py-0.5 rounded-full font-medium"
                :class="row.original.role === 'admin' ? 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-900/30' : 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30'"
              >
                {{ t(`role.${row.original.role}`) }}
              </span>
            </template>
          </UTable>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
