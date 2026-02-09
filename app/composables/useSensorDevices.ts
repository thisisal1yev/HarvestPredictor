export function useSensorDevices(fieldId?: string) {
  const devices = ref<Record<string, unknown>[]>([])
  const loading = ref(false)

  async function fetchDevices() {
    loading.value = true
    try {
      const query = fieldId ? `?fieldId=${fieldId}` : ''
      devices.value = await $fetch(`/api/sensor-devices${query}`)
    } finally {
      loading.value = false
    }
  }

  async function createDevice(data: { name: string, type: string, fieldId: string }) {
    return $fetch('/api/sensor-devices', { method: 'POST', body: data })
  }

  async function deleteDevice(id: string) {
    return $fetch(`/api/sensor-devices/${id}`, { method: 'DELETE' })
  }

  return { devices, loading, fetchDevices, createDevice, deleteDevice }
}
