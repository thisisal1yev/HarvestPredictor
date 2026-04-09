<script setup lang="ts">
definePageMeta({ layout: 'dashboard', middleware: 'auth' })

const { t } = useI18n()
const route = useRoute()
const router = useRouter()

const activeTab = computed({
  get: () => (route.query.tab as string) || 'models',
  set: (v: string) => router.replace({ query: { ...route.query, tab: v } })
})

const tabs = computed(() => [
  { label: t('detection.tabs.models'), value: 'models', icon: 'i-lucide-boxes' },
  { label: t('detection.tabs.connections'), value: 'connections', icon: 'i-lucide-plug' },
  { label: t('detection.tabs.detections'), value: 'detections', icon: 'i-lucide-scan-eye' }
])
</script>

<template>
  <UDashboardPanel id="detection">
    <template #header>
      <UDashboardNavbar :title="t('detection.title')">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-4">
        <UTabs
          v-model="activeTab"
          :items="tabs"
        />
        <ModelsTab v-if="activeTab === 'models'" />
        <ConnectionsTab v-if="activeTab === 'connections'" />
        <DetectionsTab v-if="activeTab === 'detections'" />
      </div>
    </template>
  </UDashboardPanel>
</template>
