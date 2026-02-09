<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const { farms, loading, fetchFarms, deleteFarm } = useFarms();

await fetchFarms();

const columns = computed(() => [
  { accessorKey: "name", header: t("common.name") },
  { accessorKey: "location", header: t("farm.location") },
  {
    id: "fieldsCount",
    header: t("farm.fields"),
    accessorFn: (row: Record<string, unknown>) =>
      (row._count as Record<string, unknown>)?.fields,
  },
  { id: "actions", header: "" },
]);

async function handleDelete(id: string) {
  await deleteFarm(id);
  await fetchFarms();
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('farm.title')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div>
        <UCard>
          <UTable :data="farms" :columns="columns" :loading="loading">
            <template #actions-cell="{ row }">
              <div class="flex gap-2 justify-end">
                <UButton
                  :to="`/dashboard/farms/${row.original.id}`"
                  variant="ghost"
                  icon="i-lucide-eye"
                  size="xs"
                />
                <UButton
                  :to="`/dashboard/farms/${row.original.id}/edit`"
                  variant="ghost"
                  icon="i-lucide-pencil"
                  size="xs"
                />
                <UButton
                  variant="ghost"
                  icon="i-lucide-trash-2"
                  color="error"
                  size="xs"
                  @click="handleDelete(row.original.id)"
                />
              </div>
            </template>
          </UTable>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
