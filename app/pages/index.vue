<script setup lang="ts">
const { loggedIn } = useUserSession()

if (loggedIn.value) {
  await navigateTo('/dashboard')
}
</script>

<template>
  <div class="min-h-screen flex flex-col items-center justify-center bg-gray-50 dark:bg-gray-950">
    <h1 class="text-5xl font-bold text-primary mb-4">
      HarvestPredictor
    </h1>
    <p class="text-lg text-gray-600 dark:text-gray-400 mb-8">
      {{ $t('landing.subtitle') }}
    </p>
    <div class="flex gap-3">
      <UButton
        to="/login"
        size="lg"
      >
        {{ $t('auth.signIn') }}
      </UButton>
      <UButton
        to="/register"
        size="lg"
        variant="outline"
      >
        {{ $t('auth.createAccount') }}
      </UButton>
    </div>
  </div>
</template>
