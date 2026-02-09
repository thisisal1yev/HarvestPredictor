<script setup lang="ts">
definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const route = useRoute();
const id = route.params.id as string;
const { updateSeason } = useSeasons();

const { data: season } = await useFetch(`/api/seasons/${id}`);

const year = ref(season.value?.year || new Date().getFullYear());
const crop = ref(season.value?.crop || "");
const startDate = ref(
  season.value?.startDate ? season.value.startDate.substring(0, 10) : "",
);
const endDate = ref(
  season.value?.endDate ? season.value.endDate.substring(0, 10) : "",
);
const notes = ref(season.value?.notes || "");
const loading = ref(false);
const error = ref("");

async function handleSubmit() {
  error.value = "";
  loading.value = true;
  try {
    await updateSeason(id, {
      year: year.value,
      crop: crop.value,
      startDate: startDate.value || undefined,
      endDate: endDate.value || undefined,
      notes: notes.value || undefined,
    });
    await navigateTo(`/dashboard/seasons/${id}`);
  } catch (e: unknown) {
    error.value =
      (e as { data?: { statusMessage?: string } }).data?.statusMessage ||
      t("season.updateFailed");
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar :title="$t('season.editTitle')" :ui="{ right: 'gap-3' }">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="max-w-lg">
        <h1 class="text-2xl font-bold mb-6">{{ $t('season.editTitle') }}</h1>
        <UAlert v-if="error" color="error" :title="error" class="mb-4" />
        <UCard>
          <form class="space-y-4" @submit.prevent="handleSubmit">
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
              <UButton type="submit" :loading="loading"> {{ $t('common.save') }} </UButton>
              <UButton
                :to="`/dashboard/seasons/${id}`"
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
