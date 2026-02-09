<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const id = route.params.id as string;

const { data: farm, status } = await useFetch(`/api/farms/${id}`);

const fieldColumns = computed(() => [
  { accessorKey: "name", header: t("common.name") },
  { accessorKey: "cropType", header: t("season.crop") },
  { accessorKey: "area", header: t("field.area") },
  {
    id: "seasonsCount",
    header: t("field.seasons"),
    accessorFn: (row: Record<string, unknown>) =>
      (row._count as Record<string, unknown>)?.seasons,
  },
]);
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
        <div v-if="status === 'pending'" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
        </div>
        <div v-else-if="farm">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-2xl font-bold">
                {{ farm.name }}
              </h1>
              <p v-if="farm.location" class="text-gray-500">
                {{ farm.location }}
              </p>
            </div>
            <UButton
              :to="`/dashboard/farms/${id}/edit`"
              icon="i-lucide-pencil"
              variant="outline"
            >
              {{ $t('common.edit') }}
            </UButton>
          </div>

          <h2 class="text-lg font-semibold mb-4">
            {{ $t('farm.fields') }} ({{ farm.fields?.length || 0 }})
          </h2>
          <UCard>
            <div
              v-if="!farm.fields?.length"
              class="text-center py-8 text-gray-500"
            >
              {{ $t('farm.noFields') }}
              <NuxtLink
                :to="`/dashboard/fields/new?farmId=${id}`"
                class="text-primary font-medium"
              >
                {{ $t('farm.addOne') }}
              </NuxtLink>
            </div>
            <UTable v-else :data="farm.fields" :columns="fieldColumns" />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
