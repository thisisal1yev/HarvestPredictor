<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const { createSeason } = useSeasons();
const { fields, fetchFields } = useFields();

await fetchFields();

const fieldId = ref((route.query.fieldId as string) || "");
const year = ref(new Date().getFullYear());
const crop = ref("");
const startDate = ref("");
const endDate = ref("");
const notes = ref("");
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await createSeason({
      fieldId: fieldId.value,
      year: year.value,
      crop: crop.value,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      notes: notes.value || undefined,
    });
    await navigateTo("/dashboard/seasons");
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ||
      t("season.createFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('season.createNew')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-lg">
        <h1 class="text-2xl font-bold mb-6">{{ $t('season.createNew') }}</h1>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UCard>
          <form class="space-y-4" @submit.prevent="handleSubmit">
            <UFormField :label="$t('field.title')" required>
              <USelect
                v-model="fieldId"
                :items="
                  fields.map((f) => ({
                    label: `${f.name} (${f.farm?.name})`,
                    value: f.id,
                  }))
                "
                :placeholder="$t('season.selectField')"
                required
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('season.year')" required>
              <UInput v-model="year" type="number" required class="w-full" />
            </UFormField>
            <UFormField :label="$t('season.crop')" required>
              <UInput
                v-model="crop"
                placeholder="e.g. Wheat, Corn"
                required
                class="w-full"
              />
            </UFormField>
            <UFormField :label="$t('season.startDate')">
              <UInput v-model="startDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="$t('season.endDate')">
              <UInput v-model="endDate" type="date" class="w-full" />
            </UFormField>
            <UFormField :label="$t('season.notes')">
              <UTextarea
                v-model="notes"
                class="w-full"
              />
            </UFormField>
            <div class="flex gap-2">
              <UButton type="submit" :loading="loading"> {{ $t('common.create') }} </UButton>
              <UButton
                to="/dashboard/seasons"
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
