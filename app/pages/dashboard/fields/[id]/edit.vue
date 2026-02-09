<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const id = route.params.id as string;
const { updateField } = useFields();

const { data: field } = await useFetch(`/api/fields/${id}`);

const name = ref(field.value?.name || "");
const cropType = ref(field.value?.cropType || "");
const area = ref(field.value?.area || undefined);
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await updateField(id, {
      name: name.value,
      cropType: cropType.value || undefined,
      area: area.value,
    });
    await navigateTo(`/dashboard/fields/${id}`);
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ||
      t("field.updateFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('field.editTitle')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-lg">
        <h1 class="text-2xl font-bold mb-6">{{ $t('field.editTitle') }}</h1>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UCard>
          <form class="space-y-4" @submit.prevent="handleSubmit">
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
              <UButton type="submit" :loading="loading"> {{ $t('common.save') }} </UButton>
              <UButton
                :to="`/dashboard/fields/${id}`"
                variant="outline"
                color="neutral"
              >
                {{ $t('common.cancel') }}
              </UButton>
            </div>
          </form>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
