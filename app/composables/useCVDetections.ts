export type CvDetectionSeverity = 'confirmed' | 'likely' | 'possible'
export type CvDetectionCategory = 'disease' | 'pest' | 'weed'

export interface CVDetection {
  id: string
  className: string
  category: CvDetectionCategory
  confidence: number
  severity: CvDetectionSeverity
  bbox: { x: number, y: number, w: number, h: number }
  snapshotKey: string | null
  thumbReady: boolean
  thumbUrl: string | null
  connectionId: string
  connectionName?: string | null
  detectedAt: string
  lastSeenAt: string
}

export interface CVDetectionDetail extends CVDetection {
  fullUrl: string | null
  treatment?: {
    description?: string
    recommendation?: string
  } | null
}

export interface CVDetectionFilters {
  connectionId?: string
  className?: string
  severity?: CvDetectionSeverity
  from?: string
  to?: string
  page?: number
  limit?: number
}

export function useCVDetections() {
  const detections = ref<CVDetection[]>([])
  const total = ref(0)
  const page = ref(1)
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function fetchDetections(filters: CVDetectionFilters = {}) {
    loading.value = true
    error.value = null
    try {
      const query: Record<string, string | number> = {}
      if (filters.connectionId) query.connectionId = filters.connectionId
      if (filters.className) query.className = filters.className
      if (filters.severity) query.severity = filters.severity
      if (filters.from) query.from = filters.from
      if (filters.to) query.to = filters.to
      query.page = filters.page ?? 1
      query.limit = filters.limit ?? 50

      const res = await $fetch<{ items: CVDetection[], total: number, page: number }>(
        '/api/cv/detections',
        { query }
      )
      detections.value = res.items
      total.value = res.total
      page.value = res.page
    } catch (e: unknown) {
      error.value = (e as { data?: { statusMessage?: string } }).data?.statusMessage ?? 'Failed to load detections'
    } finally {
      loading.value = false
    }
  }

  async function fetchDetection(id: string) {
    return await $fetch<CVDetectionDetail>(`/api/cv/detections/${id}`)
  }

  async function deleteDetection(id: string) {
    return await $fetch(`/api/cv/detections/${id}`, { method: 'DELETE' })
  }

  return {
    detections,
    total,
    page,
    loading,
    error,
    fetchDetections,
    fetchDetection,
    deleteDetection
  }
}
