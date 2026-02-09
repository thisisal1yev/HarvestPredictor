<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const { seasons, loading, fetchSeasons, deleteSeason } = useSeasons();

await fetchSeasons();

const columns = computed(() => [
  { accessorKey: "year", header: t("season.year") },
  { accessorKey: "crop", header: t("season.crop") },
  { accessorKey: "field.name", header: t("field.title") },
  { accessorKey: "field.farm.name", header: t("farm.title") },
  { accessorKey: "notes", header: t("season.notes") },
  { accessorKey: "actions", header: "" },
]);

async function handleDelete(id: string) {
  await deleteSeason(id);
  await fetchSeasons();
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('season.title')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div>
        <UCard>
          <UTable :data="seasons" :columns="columns" :loading="loading">
            <template #actions-cell="{ row }">
              <div class="flex gap-2 justify-end">
                <UButton
                  :to="`/dashboard/seasons/${row.original.id}`"
                  variant="ghost"
                  icon="i-lucide-eye"
                  size="xs"
                />
                <UButton
                  :to="`/dashboard/seasons/${row.original.id}/edit`"
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
