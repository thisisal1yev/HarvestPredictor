<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const { createField } = useFields();
const { farms, fetchFarms } = useFarms();

await fetchFarms();

const name = ref("");
const farmId = ref((route.query.farmId as string) || "");
const area = ref<number | undefined>();
const cropType = ref("");
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await createField({
      name: name.value,
      farmId: farmId.value,
      area: area.value,
      cropType: cropType.value || undefined,
    });
    await navigateTo("/dashboard/fields");
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ||
      t("field.createFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('field.createNew')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-lg">
        <h1 class="text-2xl font-bold mb-6">{{ $t('field.createNew') }}</h1>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UCard>
          <form class="space-y-4" @submit.prevent="handleSubmit">
            <UFormField :label="$t('field.farm')" required>
              <USelect
                v-model="farmId"
                :items="farms.map((f) => ({ label: f.name, value: f.id }))"
                :placeholder="$t('field.selectFarm')"
                required
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('common.name')" required>
              <UInput
                v-model="name"
                :placeholder="$t('field.name')"
                required
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('field.cropType')">
              <UInput
                v-model="cropType"
                placeholder="e.g. Wheat, Corn"
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('field.area')">
              <UInput
                v-model="area"
                type="number"
                step="0.1"
                placeholder="0.0"
                class="w-full"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" :loading="loading"> {{ $t('common.create') }} </UButton>
              <UButton to="/dashboard/fields" variant="outline" color="neutral">
                {{ $t('common.cancel') }}
              </UButton>
            </div>
          </form>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
