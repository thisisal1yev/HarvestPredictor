export function usePredictions(fieldId?: string) {
  const predictions = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchPredictions() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      predictions.value = await $fetch(`/api/predictions${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createPrediction(data: {
    seasonId: string
    predictedYield: number
    confidence?: number
    modelVersion?: string
  }) {
    return $fetch('/api/predictions', { method: 'POST', body: data })
  }

  async function deletePrediction(id: string) {
    return $fetch(`/api/predictions/${id}`, { method: 'DELETE' })
  }

  return { predictions, loading, fetchPredictions, createPrediction, deletePrediction }
}
