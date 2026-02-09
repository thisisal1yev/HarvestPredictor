export function useFarms() {
  const farms = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchFarms() {
    loading.value = true
    try {
      farms.value = await $fetch('/api/farms')
    } finally {
      loading.value = false
    }
  }

  async function createFarm(data: { name: string, location?: string }) {
    return $fetch('/api/farms', { method: 'POST', body: data })
  }

  async function updateFarm(id: string, data: { name?: string, location?: string }) {
    return $fetch(`/api/farms/${id}`, { method: 'PUT', body: data })
  }

  async function deleteFarm(id: string) {
    return $fetch(`/api/farms/${id}`, { method: 'DELETE' })
  }

  return { farms, loading, fetchFarms, createFarm, updateFarm, deleteFarm }
}
