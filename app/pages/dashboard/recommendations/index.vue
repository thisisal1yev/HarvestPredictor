<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' })

const { t } = useI18n()
const { recommendations, loading, fetchRecommendations, deleteRecommendation } = useRecommendations()

await fetchRecommendations()

const priorityColor: Record<string, string> = {
  high: 'text-red-500',
  medium: 'text-yellow-500',
  low: 'text-green-500'
}

const typeIcon: Record<string, string> = {
  fertilizer: 'i-lucide-flask-conical',
  irrigation: 'i-lucide-droplets',
  treatment: 'i-lucide-bug',
  crop: 'i-lucide-sprout'
}

async function handleDelete(id: string) {
  await deleteRecommendation(id)
  await fetchRecommendations()
}
</script>

<template>
  <UDashboardPanel id="recommendations">
    <template #header>
      <UDashboardNavbar :title="t('recommendation.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-download"
            variant="outline"
            size="sm"
            @click="navigateTo('/api/export/recommendations', { external: true, open: { target: '_blank' } })"
          >
            {{ t('common.exportCSV') }}
          </UButton>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="loading" class="flex justify-center py-12">
        <UIcon name="i-lucide-loader-2" class="size-8 animate-spin" />
      </div>

      <div v-else-if="!recommendations.length" class="text-center py-12 text-gray-500">
        {{ t('common.noData') }}
      </div>

      <div v-else class="space-y-4">
        <UCard v-for="rec in recommendations" :key="(rec.id as string)" class="p-5">
          <div class="flex items-start justify-between">
            <div class="flex items-start gap-3">
              <UIcon
                :name="typeIcon[(rec.type as string)] || 'i-lucide-lightbulb'"
                class="size-6 mt-0.5 text-primary"
              />
              <div>
                <h3 class="font-semibold text-base">{{ rec.title }}</h3>
                <p class="text-sm text-gray-500 mt-1">{{ rec.description }}</p>
                <div class="flex gap-4 mt-2 text-xs text-gray-400">
                  <span>{{ (rec.field as Record<string, unknown>)?.name }}</span>
                  <span v-if="rec.season">
                    {{ (rec.season as Record<string, unknown>)?.year }} — {{ (rec.season as Record<string, unknown>)?.crop }}
                  </span>
                  <span :class="priorityColor[(rec.priority as string)] || ''">
                    {{ t(`recommendation.${rec.priority}`) }}
                  </span>
                </div>
              </div>
            </div>
            <UButton
              icon="i-lucide-trash-2"
              variant="ghost"
              color="error"
              size="xs"
              @click="handleDelete(rec.id as string)"
            />
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
