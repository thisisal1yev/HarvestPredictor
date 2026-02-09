<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const { createFarm } = useFarms();
const name = ref("");
const location = ref("");
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await createFarm({
      name: name.value,
      location: location.value || undefined,
    });
    await navigateTo("/dashboard/farms");
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ||
      t("farm.createFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('farm.createNew')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-lg">
        <h1 class="text-2xl font-bold mb-6">{{ $t('farm.createNew') }}</h1>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UCard>
          <form class="space-y-4" @submit.prevent="handleSubmit">
            <UFormField :label="$t('common.name')" required>
              <UInput
                v-model="name"
                :placeholder="$t('farm.name')"
                required
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('farm.location')">
              <UInput
                v-model="location"
                placeholder="City, Region"
                class="w-full"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" :loading="loading"> {{ $t('common.create') }} </UButton>
              <UButton to="/dashboard/farms" variant="outline" color="neutral">
                {{ $t('common.cancel') }}
              </UButton>
            </div>
          </form>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
