<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const route = useRoute();
const id = route.params.id as string;

const { data: season, status } = await useFetch(`/api/seasons/${id}`);

function formatDate(d: string | null) {
  if (!d) return "—";
  return new Date(d).toLocaleDateString();
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
        <div v-if="status === 'pending'" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
        </div>
        <div v-else-if="season">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-2xl font-bold">
                {{ season.crop }} — {{ season.year }}
              </h1>
              <p class="text-gray-500">
                {{ season.field?.name }} &middot; {{ season.field?.farm?.name }}
              </p>
            </div>
            <UButton
              :to="`/dashboard/seasons/${id}/edit`"
              icon="i-lucide-pencil"
              variant="outline"
            >
              {{ $t('common.edit') }}
            </UButton>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <UCard>
              <div class="text-sm text-gray-500">{{ $t('season.startDate') }}</div>
              <div class="text-lg font-semibold">
                {{ formatDate(season.startDate) }}
              </div>
            </UCard>
            <UCard>
              <div class="text-sm text-gray-500">{{ $t('season.endDate') }}</div>
              <div class="text-lg font-semibold">
                {{ formatDate(season.endDate) }}
              </div>
            </UCard>
            <UCard>
              <div class="text-sm text-gray-500">{{ $t('season.crop') }}</div>
              <div class="text-lg font-semibold">
                {{ season.crop }}
              </div>
            </UCard>
          </div>

          <UCard v-if="season.notes">
            <div class="text-sm text-gray-500 mb-1">{{ $t('season.notes') }}</div>
            <p>{{ season.notes }}</p>
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
