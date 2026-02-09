export function useFields(farmId?: string) {
  const fields = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchFields() {
    loading.value = true
    try {
      const query = farmId ? `?farmId=${farmId}` : ''
      fields.value = await $fetch(`/api/fields${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createField(data: { name: string, farmId: string, area?: number, cropType?: string }) {
    return $fetch('/api/fields', { method: 'POST', body: data })
  }

  async function updateField(id: string, data: { name?: string, area?: number, cropType?: string }) {
    return $fetch(`/api/fields/${id}`, { method: 'PUT', body: data })
  }

  async function deleteField(id: string) {
    return $fetch(`/api/fields/${id}`, { method: 'DELETE' })
  }

  return { fields, loading, fetchFields, createField, updateField, deleteField }
}
