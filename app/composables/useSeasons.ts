export function useSeasons(fieldId?: string) {
  const seasons = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchSeasons() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      seasons.value = await $fetch(`/api/seasons${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createSeason(data: { fieldId: string, year: number, crop: string, startDate?: string, endDate?: string, notes?: string }) {
    return $fetch('/api/seasons', { method: 'POST', body: data })
  }

  async function updateSeason(id: string, data: Record<string, unknown>) {
    return $fetch(`/api/seasons/${id}`, { method: 'PUT', body: data })
  }

  async function deleteSeason(id: string) {
    return $fetch(`/api/seasons/${id}`, { method: 'DELETE' })
  }

  return { seasons, loading, fetchSeasons, createSeason, updateSeason, deleteSeason }
}
