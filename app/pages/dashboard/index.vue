<script setup lang="ts">
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler,
} from "chart.js";
import { Line, Bar } from "vue-chartjs";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  BarElement,
  Tooltip,
  Legend,
  Filler
);

definePageMeta({ layout: "dashboard", middleware: "auth" });

const { t } = useI18n();
const { data: stats, status } = await useFetch("/api/dashboard/stats");
const pending = computed(() => status.value === "pending");

const activeTab = ref("overview");
const tabs = computed(() => [
  { label: t("dashboard.tabOverview"), value: "overview" },
  { label: t("dashboard.tabFields"), value: "fields" },
  { label: t("dashboard.tabSensors"), value: "sensors" },
  { label: t("dashboard.tabDrones"), value: "drones" },
]);

const soilHealthLabel = computed(() => {
  const label = stats.value?.soilHealth?.label;
  if (label === "good") return t("dashboard.soilHealthGood");
  if (label === "fair") return t("dashboard.soilHealthFair");
  return t("dashboard.soilHealthPoor");
});

const irrigationWhenLabel = computed(() => {
  const when = stats.value?.nextIrrigation?.when;
  if (when === "tomorrow") return t("dashboard.irrigationTomorrow");
  if (when === "today") return t("dashboard.irrigationToday");
  return t("dashboard.irrigationNone");
});

const weatherLabel = computed(() => {
  const c = stats.value?.weather?.condition;
  if (c === "sunny") return t("dashboard.weatherSunny");
  if (c === "partly_cloudy") return t("dashboard.weatherPartlyCloudy");
  if (c === "rainy") return t("dashboard.weatherRainy");
  return t("dashboard.weatherCloudy");
});

const FIELD_COLORS = [
  { border: "#22c55e", bg: "rgba(34,197,94,0.1)" },
  { border: "#f97316", bg: "rgba(249,115,22,0.1)" },
  { border: "#3b82f6", bg: "rgba(59,130,246,0.1)" },
  { border: "#a855f7", bg: "rgba(168,85,247,0.1)" },
];

const BAR_COLORS = ["#22c55e", "#f97316", "#3b82f6"];

const lineChartData = computed(() => {
  const chart = stats.value?.fieldHealthChart;
  if (!chart) return { labels: [], datasets: [] };
  return {
    labels: chart.labels,
    datasets: chart.datasets.map((ds: any, i: number) => ({
      label: ds.label,
      data: ds.data,
      borderColor: FIELD_COLORS[i % FIELD_COLORS.length]!.border,
      backgroundColor: FIELD_COLORS[i % FIELD_COLORS.length]!.bg,
      tension: 0.3,
      pointRadius: 5,
      pointBackgroundColor: "#fff",
      pointBorderWidth: 2,
      pointBorderColor: FIELD_COLORS[i % FIELD_COLORS.length]!.border,
      fill: false,
      spanGaps: true,
    })),
  };
});

const lineChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: "bottom" as const },
  },
  scales: {
    y: {
      min: 0,
      max: 100,
      ticks: {
        callback: (value: any) => value + "%",
        stepSize: 25,
      },
      grid: { color: "rgba(0,0,0,0.05)" },
    },
    x: {
      grid: { display: false },
    },
  },
};

const NUTRIENT_LABELS_MAP: Record<string, string> = {
  nitrogen: "N (Azot)",
  phosphorus: "P (Fosfor)",
  potassium: "K (Kaliy)",
};

const barChartData = computed(() => {
  const chart = stats.value?.soilNutrientsChart;
  if (!chart) return { labels: [], datasets: [] };
  return {
    labels: chart.labels.map(
      (l: string) => NUTRIENT_LABELS_MAP[l] ?? l
    ),
    datasets: chart.datasets.map((ds: any, i: number) => ({
      label: ds.label,
      data: ds.data,
      backgroundColor: BAR_COLORS[i % BAR_COLORS.length],
      borderRadius: 4,
      barPercentage: 0.7,
    })),
  };
});

const barChartOptions = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: {
    legend: { display: true, position: "bottom" as const },
  },
  scales: {
    y: {
      beginAtZero: true,
      grid: { color: "rgba(0,0,0,0.05)" },
    },
    x: {
      grid: { display: false },
    },
  },
};

const weatherConditionIcon = (condition: string) => {
  if (condition === "sunny") return "i-lucide-sun";
  if (condition === "partly_cloudy") return "i-lucide-cloud-sun";
  if (condition === "rainy") return "i-lucide-cloud-rain";
  return "i-lucide-cloud";
};

const dayLabels: Record<string, string> = {
  today: "Bugun",
  mon: "Du",
  tue: "Se",
  wed: "Cho",
  thu: "Pa",
  fri: "Ju",
  sat: "Sha",
  sun: "Ya",
};
</script>

<template>
  <UDashboardPanel id="dashboard">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="pending" class="flex items-center justify-center h-64">
        <UIcon name="i-lucide-loader-2" class="w-8 h-8 animate-spin text-primary" />
      </div>

      <div v-else-if="stats" class="space-y-6">
        <!-- Header -->
        <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold">
              {{ t('dashboard.greeting', { name: stats.userName }) }}
            </h1>
            <p class="text-sm text-muted">{{ t('dashboard.subtitle') }}</p>
          </div>
          <div class="flex items-center gap-2">
            <UButton
              variant="outline"
              icon="i-lucide-calendar"
              :label="t('dashboard.today')"
            />
            
            <UButton
              color="primary"
              icon="i-lucide-plus"
              :label="t('dashboard.addField')"
              to="/dashboard/fields"
            />
          </div>
        </div>

        <!-- Stat Cards -->
        <div class="grid grid-cols-2 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <!-- Total Fields -->
          <UCard class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('dashboard.totalFields') }}</p>
                <p class="text-3xl font-bold mt-1">{{ stats.fieldsCount }}</p>
                <p class="text-xs text-muted mt-1">
                  {{ t('dashboard.totalArea', { area: stats.totalArea }) }}
                </p>
              </div>
              <UIcon name="i-lucide-settings" class="w-5 h-5 text-muted" />
            </div>
          </UCard>

          <!-- Soil Health -->
          <UCard class="p-5">
            <div class="flex items-start justify-between">
              <div class="w-full">
                <p class="text-sm text-muted">{{ t('dashboard.soilHealth') }}</p>
                <p class="text-2xl font-bold mt-1">{{ soilHealthLabel }}</p>
                <div class="mt-2">
                  <div class="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2">
                    <div
                      class="bg-primary rounded-full h-2 transition-all"
                      :style="{ width: stats.soilHealth.percentage + '%' }"
                    />
                  </div>
                  <p class="text-xs text-muted mt-1">
                    {{ t('dashboard.healthIndicator', { pct: stats.soilHealth.percentage }) }}
                  </p>
                </div>
              </div>
              <UIcon name="i-lucide-trending-up" class="w-5 h-5 text-muted shrink-0 ml-3" />
            </div>
          </UCard>

          <!-- Next Irrigation -->
          <UCard class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('dashboard.nextIrrigation') }}</p>
                <p class="text-2xl font-bold mt-1">{{ irrigationWhenLabel }}</p>
                <p v-if="stats.nextIrrigation.fields.length" class="text-xs text-muted mt-1">
                  {{ t('dashboard.irrigationFields', { fields: stats.nextIrrigation.fields.join(', ') }) }}
                </p>
              </div>
              <UIcon name="i-lucide-droplets" class="w-5 h-5 text-muted" />
            </div>
          </UCard>

          <!-- Weather -->
          <UCard class="p-5">
            <div class="flex items-start justify-between">
              <div>
                <p class="text-sm text-muted">{{ t('dashboard.weather') }}</p>
                <p class="text-3xl font-bold mt-1">{{ stats.weather.temperature }}&deg;C</p>
                <p class="text-xs text-muted mt-1">{{ weatherLabel }}</p>
              </div>
              <UIcon name="i-lucide-thermometer" class="w-5 h-5 text-muted" />
            </div>
          </UCard>
        </div>

        <!-- Tabs -->
        <div class="flex gap-1 border-b border-default">
          <button
            v-for="tab in tabs"
            :key="tab.value"
            class="px-4 py-2 text-sm font-medium transition-colors relative"
            :class="activeTab === tab.value
              ? 'text-foreground after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:bg-primary'
              : 'text-muted hover:text-foreground'"
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Tab Content: Overview -->
        <template v-if="activeTab === 'overview'">
          <!-- Charts Row -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Field Health Chart -->
            <UCard class="p-6">
              <h3 class="text-lg font-semibold">{{ t('dashboard.fieldHealth') }}</h3>
              <p class="text-sm text-muted mb-4">{{ t('dashboard.fieldHealthDesc') }}</p>
              <div class="h-64">
                <Line :data="lineChartData" :options="lineChartOptions" />
              </div>
            </UCard>

            <!-- Soil Nutrients Chart -->
            <UCard class="p-6">
              <h3 class="text-lg font-semibold">{{ t('dashboard.soilNutrients') }}</h3>
              <p class="text-sm text-muted mb-4">{{ t('dashboard.soilNutrientsDesc') }}</p>
              <div class="h-64">
                <Bar :data="barChartData" :options="barChartOptions" />
              </div>
            </UCard>
          </div>

          <!-- Bottom Row -->
          <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <!-- Irrigation Schedule -->
            <UCard class="p-6">
              <h3 class="text-lg font-semibold">{{ t('dashboard.irrigationSchedule') }}</h3>
              <p class="text-sm text-muted mb-4">{{ t('dashboard.irrigationScheduleDesc') }}</p>
              <div class="space-y-3">
                <div
                  v-for="(item, idx) in stats.irrigationSchedule"
                  :key="idx"
                  class="flex items-center justify-between py-2 border-b border-default last:border-0"
                >
                  <div class="flex items-center gap-3">
                    <UIcon name="i-lucide-droplets" class="w-4 h-4 text-blue-500" />
                    <span class="text-sm font-medium">{{ item.fieldName }}</span>
                    <span class="text-sm text-muted">{{ item.title }}</span>
                  </div>
                  <UBadge
                    :color="item.priority === 'high' ? 'error' : 'neutral'"
                    variant="subtle"
                    size="sm"
                  >
                    {{ item.when === 'tomorrow' ? t('dashboard.irrigationTomorrow') : t('dashboard.irrigationToday') }}
                  </UBadge>
                </div>
                <p v-if="!stats.irrigationSchedule.length" class="text-sm text-muted text-center py-4">
                  {{ t('dashboard.irrigationNone') }}
                </p>
              </div>
            </UCard>

            <!-- Weather Forecast -->
            <UCard class="p-6">
              <h3 class="text-lg font-semibold">{{ t('dashboard.weatherForecast') }}</h3>
              <p class="text-sm text-muted mb-4">{{ t('dashboard.weatherForecastDesc') }}</p>
              <div class="grid grid-cols-7 gap-2">
                <div
                  v-for="(day, idx) in stats.weatherForecast"
                  :key="idx"
                  class="flex flex-col items-center gap-1 py-2 rounded-lg"
                  :class="idx === 0 ? 'bg-primary/10' : ''"
                >
                  <span class="text-xs font-medium" :class="idx === 0 ? 'text-primary' : 'text-muted'">
                    {{ dayLabels[day.day] ?? day.day }}
                  </span>
                  <UIcon
                    :name="weatherConditionIcon(day.condition)"
                    class="w-5 h-5"
                    :class="day.condition === 'rainy' ? 'text-blue-500' : day.condition === 'sunny' ? 'text-amber-500' : 'text-gray-400'"
                  />
                  <span class="text-xs font-semibold">{{ day.high }}&deg;</span>
                  <span class="text-xs text-muted">{{ day.low }}&deg;</span>
                </div>
              </div>
            </UCard>
          </div>
        </template>

        <!-- Tab Content: Fields -->
        <template v-if="activeTab === 'fields'">
          <UCard class="p-6">
            <div class="text-center py-8">
              <UIcon name="i-lucide-map" class="w-12 h-12 text-muted mx-auto mb-3" />
              <p class="text-muted">{{ t('dashboard.tabFields') }}</p>
              <UButton
                class="mt-3"
                variant="outline"
                to="/dashboard/fields"
                :label="t('dashboard.viewAll')"
              />
            </div>
          </UCard>
        </template>

        <!-- Tab Content: Sensors -->
        <template v-if="activeTab === 'sensors'">
          <UCard class="p-6">
            <div class="text-center py-8">
              <UIcon name="i-lucide-activity" class="w-12 h-12 text-muted mx-auto mb-3" />
              <p class="text-muted">{{ t('dashboard.tabSensors') }}</p>
              <UButton
                class="mt-3"
                variant="outline"
                to="/dashboard/analytics"
                :label="t('dashboard.viewAll')"
              />
            </div>
          </UCard>
        </template>

        <!-- Tab Content: Drones -->
        <template v-if="activeTab === 'drones'">
          <UCard class="p-6">
            <div class="text-center py-8">
              <UIcon name="i-lucide-plane" class="w-12 h-12 text-muted mx-auto mb-3" />
              <p class="text-muted">{{ t('dashboard.tabDrones') }}</p>
              <UButton
                class="mt-3"
                variant="outline"
                to="/dashboard/analytics"
                :label="t('dashboard.viewAll')"
              />
            </div>
          </UCard>
        </template>
      </div>
    </template>
  </UDashboardPanel>
</template>
