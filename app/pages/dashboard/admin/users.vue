<script setup lang="ts">
definePageMeta({ layout: 'admin', middleware: 'admin' })

const { t } = useI18n()
const { user } = useUserSession()

const { data: users, refresh } = await useFetch('/api/admin/users')

const columns = [
  { accessorKey: 'name', header: t('common.name') },
  { accessorKey: 'email', header: t('auth.email') },
  { id: 'role', header: t('admin.role') },
  {
    id: 'createdAt',
    header: t('common.date'),
    accessorFn: (row: Record<string, any>) =>
      row.createdAt ? new Date(row.createdAt).toLocaleDateString() : '—'
  },
  { id: 'actions', header: t('common.actions') }
]

async function toggleRole(userId: string, currentRole: string) {
  const newRole = currentRole === 'admin' ? 'farmer' : 'admin'
  await $fetch(`/api/admin/users/${userId}`, {
    method: 'PUT',
    body: { role: newRole }
  })
  await refresh()
}

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
  <UDashboardPanel id="admin-users">
    <template #header>
      <UDashboardNavbar :title="t('admin.users')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <div class="flex items-center justify-between">
          <h2 class="text-lg font-semibold">{{ t('admin.users') }}</h2>
        </div>
        <UTable :data="users || []" :columns="columns" :ui="tableUi" class="shrink-0">
          <template #role-cell="{ row }">
            <span
              class="text-xs px-2 py-0.5 rounded-full font-medium"
              :class="row.original.role === 'admin' ? 'text-purple-600 bg-purple-50 dark:text-purple-400 dark:bg-purple-900/30' : 'text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/30'"
            >
              {{ t(`role.${row.original.role}`) }}
            </span>
          </template>
          <template #actions-cell="{ row }">
            <UButton
              v-if="row.original.id !== user?.id"
              size="xs"
              variant="soft"
              @click="toggleRole(row.original.id, row.original.role)"
            >
              {{ row.original.role === 'admin' ? t('admin.demote') : t('admin.promote') }}
            </UButton>
            <span v-else class="text-xs text-muted">{{ t('admin.you') }}</span>
          </template>
        </UTable>
      </div>
    </template>
  </UDashboardPanel>
</template>
