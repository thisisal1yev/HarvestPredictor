<script setup lang="ts">
import type { DropdownMenuItem } from "@nuxt/ui";

defineProps<{
  collapsed?: boolean;
}>();

const colorMode = useColorMode();
const { user, clear } = useUserSession();
const { t, locale, locales, setLocale } = useI18n();

async function handleLogout() {
  await $fetch("/api/auth/logout", { method: "POST" });
  await clear();
  await navigateTo("/login");
}

const items = computed<DropdownMenuItem[][]>(() => [
  [
    {
      label: t('user.profile'),
      icon: "i-lucide-user",
      to: '/',
    },
    {
      label: t('user.appearance'),
      icon: "i-lucide-sun-moon",
      children: [
        {
          label: t('user.light'),
          icon: "i-lucide-sun",
          type: "checkbox",
          checked: colorMode.value === "light",
          onSelect(e: Event) {
            e.preventDefault();
            colorMode.preference = "light";
          },
        },
        {
          label: t('user.dark'),
          icon: "i-lucide-moon",
          type: "checkbox",
          checked: colorMode.value === "dark",
          onSelect(e: Event) {
            e.preventDefault();
            colorMode.preference = "dark";
          },
        },
      ],
    },
    {
      label: t('user.language'),
      icon: "i-lucide-languages",
      children: (locales.value as { code: string; name?: string }[]).map((l) => ({
        label: l.name || l.code.toUpperCase(),
        type: "checkbox" as const,
        checked: locale.value === l.code,
        onSelect(e: Event) {
          e.preventDefault();
          setLocale(l.code);
        },
      })),
    },
  ],
  [
    {
      label: t('auth.logout'),
      icon: "i-lucide-log-out",
      color: "error",
      onSelect: handleLogout,
    },
  ],
]);
</script>

<template>
  <UDropdownMenu
    :items="items"
    :content="{ align: 'center', collisionPadding: 12 }"
    :ui="{
      content: collapsed ? 'w-48' : 'w-(--reka-dropdown-menu-trigger-width)',
    }"
  >
    <UButton
      trailing-icon="i-lucide-chevrons-up-down"
      color="neutral"
      variant="ghost"
      block
      :square="collapsed"
      class="data-[state=open]:bg-elevated"
      :ui="{
        trailingIcon: 'text-dimmed',
      }"
    >
      <template v-if="!collapsed" #default>
        <div class="flex items-center gap-2 truncate">
          <span class="truncate">{{ user?.name }}</span>
          <span
            v-if="user?.role === 'admin'"
            class="text-[10px] px-1.5 py-0.5 rounded-full bg-purple-100 text-purple-600 dark:bg-purple-900 dark:text-purple-300 font-medium shrink-0"
          >
            {{ $t('role.admin') }}
          </span>
        </div>
      </template>
    </UButton>

    <template #chip-leading="{ item }">
      <div class="inline-flex items-center justify-center shrink-0 size-5">
        <span
          class="rounded-full ring ring-bg bg-(--chip-light) dark:bg-(--chip-dark) size-2"
          :style="{
            '--chip-light': `var(--color-${(item as any).chip}-500)`,
            '--chip-dark': `var(--color-${(item as any).chip}-400)`,
          }"
        />
      </div>
    </template>
  </UDropdownMenu>
</template>
