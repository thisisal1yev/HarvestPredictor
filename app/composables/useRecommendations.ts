export function useRecommendations(fieldId?: string) {
  const recommendations = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchRecommendations() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      recommendations.value = await $fetch(`/api/recommendations${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createRecommendation(data: {
    fieldId: string
    type: string
    title: string
    description: string
    priority?: string
    seasonId?: string
  }) {
    return $fetch('/api/recommendations', { method: 'POST', body: data })
  }

  async function updateRecommendation(id: string, data: Record<string, unknown>) {
    return $fetch(`/api/recommendations/${id}`, { method: 'PUT', body: data })
  }

  async function deleteRecommendation(id: string) {
    return $fetch(`/api/recommendations/${id}`, { method: 'DELETE' })
  }

  return { recommendations, loading, fetchRecommendations, createRecommendation, updateRecommendation, deleteRecommendation }
}
