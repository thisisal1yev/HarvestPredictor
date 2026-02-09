export function useDroneFlights(fieldId?: string) {
  const flights = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchFlights() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      flights.value = await $fetch(`/api/drone-flights${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createFlight(data: { fieldId: string, date: string, altitude?: number, notes?: string }) {
    return $fetch('/api/drone-flights', { method: 'POST', body: data })
  }

  async function deleteFlight(id: string) {
    return $fetch(`/api/drone-flights/${id}`, { method: 'DELETE' })
  }

  return { flights, loading, fetchFlights, createFlight, deleteFlight }
}
