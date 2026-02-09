<template>
  <div class="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
    <div class="w-full max-w-sm">
      <div class="text-center mb-8">
        <h2 class="text-3xl font-bold text-primary">
          HarvestPredictor
        </h2>
        <p class="text-sm text-gray-500 mt-1">
          {{ $t('landing.tagline') }}
        </p>
      </div>
      <UCard>
        <slot />
      </UCard>
    </div>
  </div>
</template>
