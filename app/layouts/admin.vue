<script setup lang="ts">
import type { NavigationMenuItem } from "@nuxt/ui";

const { t } = useI18n();
const open = ref(false);

const links = computed<NavigationMenuItem[][]>(() => {
  const mainLinks: NavigationMenuItem[] = [
    {
      label: t("admin.dashboard"),
      icon: "i-lucide-layout-dashboard",
      to: "/dashboard/admin",
      onSelect: () => (open.value = false),
    },
    {
      label: t("admin.users"),
      icon: "i-lucide-users",
      to: "/dashboard/admin/users",
      onSelect: () => (open.value = false),
    },
    {
      label: t("admin.systemOverview"),
      icon: "i-lucide-activity",
      to: "/dashboard/admin/system",
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
      id="admin"
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

        <div v-if="!collapsed" class="px-3 py-2 mb-1">
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-shield" class="w-5 h-5 text-purple-500" />
            <span class="text-sm font-semibold text-purple-600 dark:text-purple-400">
              {{ t('admin.title') }}
            </span>
          </div>
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
