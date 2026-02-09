export function useYieldRecords(fieldId?: string) {
  const yieldRecords = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchYieldRecords() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      yieldRecords.value = await $fetch(`/api/yield-records${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createYieldRecord(data: {
    seasonId: string
    yieldValue: number
    unit?: string
    harvestDate?: string
  }) {
    return $fetch('/api/yield-records', { method: 'POST', body: data })
  }

  async function deleteYieldRecord(id: string) {
    return $fetch(`/api/yield-records/${id}`, { method: 'DELETE' })
  }

  return { yieldRecords, loading, fetchYieldRecords, createYieldRecord, deleteYieldRecord }
}
