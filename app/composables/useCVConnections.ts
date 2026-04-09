export type CvStreamProtocol = 'rtsp' | 'rtmp' | 'http_mjpeg'
export type CvConnectionStatus = 'idle' | 'active' | 'disconnected' | 'error'

export interface CVConnection {
  id: string
  name: string
  protocol: CvStreamProtocol
  streamUrl: string
  usernameEnc: string | null
  passwordEnc: string | null
  status: CvConnectionStatus
  lastFrameAt: string | null
  lastDetectionAt: string | null
  errorMessage: string | null
  reconnectAttempt: number
  modelId: string
  userId: string
  fieldId: string | null
  createdAt: string
  updatedAt: string
  model?: { id: string, name: string } | null
  field?: { id: string, name: string } | null
}

export interface CVConnectionInput {
  name: string
  protocol: CvStreamProtocol
  streamUrl: string
  username?: string
  password?: string
  modelId: string
  fieldId?: string | null
}

export interface CVConnectionTestResult {
  ok: boolean
  message: string
}

export function useCVConnections() {
  const connections = ref<CVConnection[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchConnections() {
    loading.value = true
    error.value = null
    try {
      connections.value = await $fetch<CVConnection[]>('/api/cv/connections')
    } catch (e: unknown) {
      error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Failed to load connections'
    } finally {
      loading.value = false
    }
  }

  async function createConnection(body: CVConnectionInput) {
    return await $fetch<CVConnection>('/api/cv/connections', { method: 'POST', body })
  }

  async function updateConnection(id: string, body: Partial<CVConnectionInput>) {
    return await $fetch<CVConnection>(`/api/cv/connections/${id}`, { method: 'PUT', body })
  }

  async function deleteConnection(id: string) {
    return await $fetch(`/api/cv/connections/${id}`, { method: 'DELETE' })
  }

  async function testConnection(body: CVConnectionInput) {
    return await $fetch<CVConnectionTestResult>('/api/cv/connections/test', {
      method: 'POST',
      body
    })
  }

  async function startConnection(id: string) {
    return await $fetch<{ status: 'active', streamToken: string }>(
      `/api/cv/connections/${id}/start`,
      { method: 'POST' }
    )
  }

  async function stopConnection(id: string) {
    return await $fetch<{ status: 'idle' }>(`/api/cv/connections/${id}/stop`, {
      method: 'POST'
    })
  }

  return {
    connections,
    loading,
    error,
    fetchConnections,
    createConnection,
    updateConnection,
    deleteConnection,
    testConnection,
    startConnection,
    stopConnection
  }
}
