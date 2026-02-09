<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const id = route.params.id as string;

const { data: field, status } = await useFetch(`/api/fields/${id}`);

const seasonColumns = computed(() => [
  { accessorKey: 'year', header: t('season.year') },
  { accessorKey: 'crop', header: t('season.crop') },
  { accessorKey: 'startDate', header: t('season.startDate') },
  { accessorKey: 'endDate', header: t('season.endDate') },
  { accessorKey: 'notes', header: t('season.notes') }
]);
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
        <div v-if="status === 'pending'" class="flex justify-center py-12">
          <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
        </div>
        <div v-else-if="field">
          <div class="flex items-center justify-between mb-6">
            <div>
              <h1 class="text-2xl font-bold">
                {{ field.name }}
              </h1>
              <p class="text-gray-500">
                {{ field.farm?.name }}
                <span v-if="field.cropType">
                  &middot; {{ field.cropType }}</span>
                <span v-if="field.area"> &middot; {{ field.area }} ha</span>
              </p>
            </div>
            <UButton
              :to="`/dashboard/fields/${id}/edit`"
              icon="i-lucide-pencil"
              variant="outline"
            >
              {{ $t('common.edit') }}
            </UButton>
          </div>

          <h2 class="text-lg font-semibold mb-4">
            {{ $t('field.seasons') }} ({{ field.seasons?.length || 0 }})
          </h2>
          <UCard>
            <div
              v-if="!field.seasons?.length"
              class="text-center py-8 text-gray-500"
            >
              {{ $t('field.noSeasons') }}
              <NuxtLink
                :to="`/dashboard/seasons/new?fieldId=${id}`"
                class="text-primary font-medium"
              >
                {{ $t('field.addOne') }}
              </NuxtLink>
            </div>
            <UTable
              v-else
              :data="field.seasons"
              :columns="seasonColumns"
            />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
