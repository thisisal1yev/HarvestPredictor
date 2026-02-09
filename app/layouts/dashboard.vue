<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const { t } = useI18n();
const open = ref(false);
const links = computed<NavigationMenuItem[][]>(() => {
  const mainLinks: NavigationMenuItem[] = [
    {
      label: t("nav.dashboard"),
      icon: "i-lucide-layout-dashboard",
      to: "/dashboard",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.farms"),
      icon: "i-lucide-users",
      to: "/dashboard/farms",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.fields"),
      icon: "i-lucide-graduation-cap",
      to: "/dashboard/fields",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.seasons"),
      icon: "i-lucide-file-text",
      to: "/dashboard/seasons",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.analytics"),
      icon: "i-lucide-bar-chart-3",
      to: "/dashboard/analytics",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.recommendations"),
      icon: "i-lucide-lightbulb",
      to: "/dashboard/recommendations",
      onSelect: () => (open.value = false),
    },
    {
      label: t("nav.alerts"),
      icon: "i-lucide-bell",
      to: "/dashboard/alerts",
      onSelect: () => (open.value = false),
    },
  ];

  const secondaryLinks: NavigationMenuItem[] = [
    {
      label: t("nav.feedback"),
      icon: "i-lucide-message-circle",
      to: "mailto:polonchihonkok@gmail.com",
      target: "_blank",
    },
    {
      label: t("nav.support"),
      icon: "i-lucide-info",
      to: "mailto:polonchihonkok@gmail.com",
      target: "_blank",
    },
  ];

  return [mainLinks, secondaryLinks];
});

const groups = computed(() => [
  {
    id: "links",
    label: t("nav.goTo"),
    items: links.value.flat(),
  },
]);
</script>

<template>
  <UDashboardGroup unit="rem">
    <UDashboardSidebar
      id="default"
      v-model:open="open"
      portal="body"
      collapsible
      resizable
      class="bg-elevated/25"
      :ui="{ footer: 'lg:border-t lg:border-default' }"
    >
      <template #default="{ collapsed }">
        <div class="flex items-center gap-1 mt-2.5">
          <UDashboardSearchButton
            :collapsed="collapsed"
            class="bg-transparent ring-default flex-1"
            tooltip
          />
        </div>

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[0]"
          orientation="vertical"
          size="xl"
          tooltip
          popover
        />

        <UNavigationMenu
          :collapsed="collapsed"
          :items="links[1]"
          orientation="vertical"
          tooltip
          class="mt-auto"
        />
      </template>

      <template #footer="{ collapsed }">
        <UserMenu :collapsed="collapsed" />
      </template>
    </UDashboardSidebar>

    <UDashboardSearch :groups="groups" />

    <slot />

  </UDashboardGroup>
</template>
