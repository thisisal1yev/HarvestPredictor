export interface CVModel {
  id: string
  name: string
  filename: string
  originalName: string
  format: string
  cropType: string | null
  isDefault: boolean
  fileSize: number
  hash: string
  metadata: Record<string, unknown> | null
  userId: string
  createdAt: string
  updatedAt: string
}

export interface QuickTestDetection {
  className: string
  category: 'disease' | 'pest' | 'weed'
  confidence: number
  severity: 'confirmed' | 'likely' | 'possible'
  bbox: { x: number, y: number, w: number, h: number }
}

export interface QuickTestResponse {
  modelId: string
  inferenceMs: number
  imageWidth: number
  imageHeight: number
  detections: QuickTestDetection[]
}

export function useCVModels() {
  const models = ref<CVModel[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchModels() {
    loading.value = true
    error.value = null
    try {
      models.value = await $fetch<CVModel[]>('/api/cv/models')
    } catch (e: unknown) {
      error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Failed to load models'
    } finally {
      loading.value = false
    }
  }

  async function createModel(body: FormData) {
    return await $fetch<CVModel>('/api/cv/models', { method: 'POST', body })
  }

  async function updateModel(id: string, body: { name?: string, cropType?: string | null, isDefault?: boolean }) {
    return await $fetch<CVModel>(`/api/cv/models/${id}`, { method: 'PUT', body })
  }

  async function deleteModel(id: string) {
    return await $fetch(`/api/cv/models/${id}`, { method: 'DELETE' })
  }

  async function setDefault(id: string) {
    return await updateModel(id, { isDefault: true })
  }

  async function quickTest(id: string, body: FormData) {
    return await $fetch<QuickTestResponse>(`/api/cv/models/${id}/quick-test`, {
      method: 'POST',
      body
    })
  }

  return {
    models,
    loading,
    error,
    fetchModels,
    createModel,
    updateModel,
    deleteModel,
    setDefault,
    quickTest
  }
}
