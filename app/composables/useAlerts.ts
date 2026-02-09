export function useAlerts(fieldId?: string) {
  const alerts = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchAlerts(status?: string) {
    loading.value = true
    try {
      const params = new URLSearchParams()
      if (fieldId) params.set('fieldId', fieldId)
      if (status) params.set('status', status)
      const query = params.toString() ? `?${params}` : ''
      alerts.value = await $fetch(`/api/alerts${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createAlert(data: { fieldId: string, rule: string, message: string, severity?: string }) {
    return $fetch('/api/alerts', { method: 'POST', body: data })
  }

  async function updateAlert(id: string, data: { status?: string, severity?: string }) {
    return $fetch(`/api/alerts/${id}`, { method: 'PUT', body: data })
  }

  async function deleteAlert(id: string) {
    return $fetch(`/api/alerts/${id}`, { method: 'DELETE' })
  }

  async function runAlerts() {
    return $fetch('/api/alerts/run', { method: 'POST' })
  }

  return { alerts, loading, fetchAlerts, createAlert, updateAlert, deleteAlert, runAlerts }
}
