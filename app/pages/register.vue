<script setup lang="ts">
definePageMeta({
  layout: 'auth',
  middleware: 'auth'
})

const { t } = useI18n()
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const loading = ref(false)

const { fetch: refreshSession } = useUserSession()

async function handleRegister() {
  error.value = ''
  loading.value = true
  try {
    await $fetch('/api/auth/register', {
      method: 'POST',
      body: { name: name.value, email: email.value, password: password.value }
    })
    await refreshSession()
    await navigateTo('/dashboard')
  } catch (e: unknown) {
    error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage || t('auth.registrationFailed')
  } finally {
    loading.value = false
  }
}
</script>

<template>
  <div>
    <h1 class="text-2xl font-bold mb-6 text-center">
      {{ $t('auth.createAccount') }}
    </h1>
    <UAlert
      v-if="error"
      color="error"
      :title="error"
      class="mb-4"
    />
    <form
      class="space-y-4"
      @submit.prevent="handleRegister"
    >
      <UFormField :label="$t('auth.name')">
        <UInput
          v-model="name"
          placeholder="John Doe"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField :label="$t('auth.email')">
        <UInput
          v-model="email"
          type="email"
          placeholder="you@example.com"
          required
          class="w-full"
        />
      </UFormField>
      <UFormField :label="$t('auth.password')">
        <UInput
          v-model="password"
          type="password"
          placeholder="••••••••"
          required
          class="w-full"
        />
      </UFormField>
      <UButton
        type="submit"
        block
        :loading="loading"
      >
        {{ $t('auth.createAccount') }}
      </UButton>
    </form>
    <p class="mt-4 text-center text-sm text-gray-500">
      {{ $t('auth.alreadyHaveAccount') }}
      <NuxtLink
        to="/login"
        class="text-primary font-medium"
      >
        {{ $t('auth.signIn') }}
      </NuxtLink>
    </p>
  </div>
</template>
