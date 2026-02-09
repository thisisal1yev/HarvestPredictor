<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const { fields, loading, fetchFields, deleteField } = useFields();

await fetchFields();

const columns = computed(() => [
  { accessorKey: "name", header: t("common.name") },
  { accessorKey: "cropType", header: t("season.crop") },
  { accessorKey: "area", header: t("field.area") },
  {
    id: "farmName",
    header: t("field.farm"),
    accessorFn: (row: Record<string, unknown>) =>
      (row.farm as Record<string, unknown>)?.name,
  },
  {
    id: "seasonsCount",
    header: t("field.seasons"),
    accessorFn: (row: Record<string, unknown>) =>
      (row._count as Record<string, unknown>)?.seasons,
  },
  { id: "actions", header: "" },
]);

async function handleDelete(id: string) {
  await deleteField(id);
  await fetchFields();
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('field.title')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div>
        <UCard>
          <UTable :data="fields" :columns="columns" :loading="loading">
            <template #actions-cell="{ row }">
              <div class="flex gap-2 justify-end">
                <UButton
                  :to="`/dashboard/fields/${row.original.id}`"
                  variant="ghost"
                  icon="i-lucide-eye"
                  size="xs"
                />
                <UButton
                  :to="`/dashboard/fields/${row.original.id}/edit`"
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
