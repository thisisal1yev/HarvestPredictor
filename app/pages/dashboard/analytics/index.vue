<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' })

const { t } = useI18n()

const { data: fields } = await useFetch('/api/fields')
const selectedFieldId = ref<string>('')

const { data: metrics, pending, refresh } = await useFetch(() =>
  selectedFieldId.value ? `/api/fields/${selectedFieldId.value}/metrics` : null, {
  watch: [selectedFieldId]
})

const fieldOptions = computed(() =>
  (fields.value || []).map((f: Record<string, unknown>) => ({
    label: f.name as string,
    value: f.id as string
  }))
)

watch(fields, (val) => {
  if (val?.length && !selectedFieldId.value) {
    selectedFieldId.value = (val[0] as Record<string, unknown>).id as string
  }
}, { immediate: true })

const sensorColumns = [
  { accessorKey: 'timestamp', header: t('common.date') },
  { accessorKey: 'moisture', header: t('analytics.moisture') },
  { accessorKey: 'nitrogen', header: t('analytics.nitrogen') },
  { accessorKey: 'phosphorus', header: t('analytics.phosphorus') },
  { accessorKey: 'potassium', header: t('analytics.potassium') },
  { accessorKey: 'temperature', header: t('analytics.temperature') },
  { accessorKey: 'pH', header: t('analytics.ph') }
]

const ndviColumns = [
  { accessorKey: 'timestamp', header: t('common.date') },
  { accessorKey: 'ndvi', header: t('analytics.ndvi') },
  { accessorKey: 'evi', header: t('analytics.evi') },
  { accessorKey: 'lat', header: t('analytics.lat') },
  { accessorKey: 'lng', header: t('analytics.lng') }
]

const yieldColumns = [
  { id: 'year', header: t('season.year'), accessorFn: (row: Record<string, any>) => row.season?.year },
  { id: 'crop', header: t('season.crop'), accessorFn: (row: Record<string, any>) => row.season?.crop },
  { accessorKey: 'yieldValue', header: t('analytics.yieldHistory') },
  { accessorKey: 'unit', header: t('analytics.unit') }
]

const predictionColumns = [
  { id: 'year', header: t('season.year'), accessorFn: (row: Record<string, any>) => row.season?.year },
  { id: 'crop', header: t('season.crop'), accessorFn: (row: Record<string, any>) => row.season?.crop },
  { accessorKey: 'predictedYield', header: t('prediction.predictedYield') },
  { accessorKey: 'confidence', header: t('prediction.confidence') },
  { accessorKey: 'modelVersion', header: t('prediction.modelVersion') }
]

function formatDate(d: string) {
  return d ? new Date(d).toLocaleDateString() : '—'
}

const sensorData = computed(() =>
  (metrics.value?.sensorReadings || []).map((r: Record<string, any>) => ({
    ...r,
    timestamp: formatDate(r.timestamp)
  }))
)

const ndviData = computed(() =>
  (metrics.value?.vegetationPoints || []).map((p: Record<string, any>) => ({
    ...p,
    timestamp: formatDate(p.timestamp),
    ndvi: p.ndvi?.toFixed(3),
    evi: p.evi?.toFixed(3) ?? '—'
  }))
)
</script>

<template>
  <UDashboardPanel id="analytics">
    <template #header>
      <UDashboardNavbar :title="t('analytics.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            v-if="selectedFieldId"
            icon="i-lucide-download"
            variant="outline"
            size="sm"
            @click="navigateTo(`/api/export/analytics?fieldId=${selectedFieldId}`, { external: true, open: { target: '_blank' } })"
          >
            {{ t('common.exportCSV') }}
          </UButton>
          <USelectMenu
            v-model="selectedFieldId"
            :items="fieldOptions"
            value-key="value"
            :placeholder="t('dashboard.selectField')"
            class="w-60"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="!selectedFieldId" class="text-center py-12 text-gray-500">
        {{ t('common.noData') }} — {{ t('dashboard.selectField') }}.
      </div>

      <div v-else-if="pending" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
      </div>

      <div v-else class="space-y-8">
        <!-- Sensor Data -->
        <div>
          <h2 class="text-lg font-semibold mb-4">{{ t('analytics.sensorData') }}</h2>
          <UCard>
            <div v-if="!sensorData.length" class="text-center py-6 text-gray-500">
              {{ t('common.noData') }}
            </div>
            <UTable v-else :data="sensorData" :columns="sensorColumns" />
          </UCard>
        </div>

        <!-- NDVI/EVI Data -->
        <div>
          <h2 class="text-lg font-semibold mb-4">{{ t('analytics.ndviTrend') }}</h2>
          <UCard>
            <div v-if="!ndviData.length" class="text-center py-6 text-gray-500">
              {{ t('common.noData') }}
            </div>
            <UTable v-else :data="ndviData" :columns="ndviColumns" />
          </UCard>
        </div>

        <!-- Yield History -->
        <div>
          <h2 class="text-lg font-semibold mb-4">{{ t('analytics.yieldHistory') }}</h2>
          <UCard>
            <div v-if="!metrics?.yieldRecords?.length" class="text-center py-6 text-gray-500">
              {{ t('common.noData') }}
            </div>
            <UTable v-else :data="metrics?.yieldRecords" :columns="yieldColumns" />
          </UCard>
        </div>

        <!-- Predictions -->
        <div>
          <h2 class="text-lg font-semibold mb-4">{{ t('prediction.title') }}</h2>
          <UCard>
            <div v-if="!metrics?.predictions?.length" class="text-center py-6 text-gray-500">
              {{ t('common.noData') }}
            </div>
            <UTable v-else :data="metrics?.predictions" :columns="predictionColumns" />
          </UCard>
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
