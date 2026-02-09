export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const userFilter = { farm: { userId } }

  // Parallel queries
  const [fields, sensorReadings, recommendations, alerts, user] = await Promise.all([
    prisma.field.findMany({
      where: userFilter,
      select: {
        id: true,
        name: true,
        area: true,
        cropType: true,
        sensorDevices: {
          select: {
            readings: {
              orderBy: { timestamp: 'desc' as const },
              take: 10,
              select: {
                timestamp: true,
                moisture: true,
                nitrogen: true,
                phosphorus: true,
                potassium: true,
                temperature: true,
                pH: true,
              }
            }
          }
        }
      }
    }),
    // All sensor readings in last 30 days for charts
    prisma.sensorReading.findMany({
      where: {
        sensorDevice: { field: userFilter },
        timestamp: { gte: new Date(Date.now() - 30 * 86400000) }
      },
      select: {
        timestamp: true,
        moisture: true,
        nitrogen: true,
        phosphorus: true,
        potassium: true,
        temperature: true,
        pH: true,
        sensorDevice: {
          select: { field: { select: { id: true, name: true } } }
        }
      },
      orderBy: { timestamp: 'asc' }
    }),
    prisma.recommendation.findMany({
      where: { field: userFilter, type: 'irrigation' },
      select: {
        title: true,
        priority: true,
        createdAt: true,
        field: { select: { name: true } }
      },
      orderBy: { createdAt: 'desc' },
      take: 5
    }),
    prisma.alert.findMany({
      where: { field: userFilter, status: 'active' },
      select: {
        severity: true,
        message: true,
        triggeredAt: true,
        field: { select: { name: true } }
      },
      orderBy: { triggeredAt: 'desc' },
      take: 5
    }),
    prisma.user.findUnique({
      where: { id: userId },
      select: { name: true }
    })
  ])

  // ── Stat cards ──
  const fieldsCount = fields.length
  const totalArea = fields.reduce((sum, f) => sum + (f.area ?? 0), 0)

  // Compute soil health from latest readings
  const allLatestReadings = fields.flatMap(f =>
    f.sensorDevices.flatMap(sd => sd.readings.length > 0 ? [sd.readings[0]!] : [])
  )

  let soilHealthPct = 0
  if (allLatestReadings.length > 0) {
    const scores = allLatestReadings.map(r => {
      let score = 0
      let factors = 0
      // Moisture: ideal 25-35
      if (r.moisture != null) {
        const m = r.moisture
        score += m >= 25 && m <= 35 ? 100 : m >= 15 && m <= 45 ? 70 : 40
        factors++
      }
      // pH: ideal 6.0-7.5
      if (r.pH != null) {
        const p = r.pH
        score += p >= 6.0 && p <= 7.5 ? 100 : p >= 5.0 && p <= 8.5 ? 70 : 40
        factors++
      }
      // Nitrogen: ideal 20-30
      if (r.nitrogen != null) {
        const n = r.nitrogen
        score += n >= 20 && n <= 30 ? 100 : n >= 10 && n <= 40 ? 70 : 40
        factors++
      }
      return factors > 0 ? score / factors : 50
    })
    soilHealthPct = Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
  }

  const soilHealthLabel = soilHealthPct >= 75 ? 'good' : soilHealthPct >= 50 ? 'fair' : 'poor'

  // Next irrigation
  const irrigationFields = recommendations.slice(0, 3).map(r => r.field.name)
  const nextIrrigationWhen = recommendations.length > 0 ? 'tomorrow' : 'none'

  // Temperature from latest readings
  const temps = allLatestReadings.filter(r => r.temperature != null).map(r => r.temperature!)
  const avgTemp = temps.length > 0 ? Math.round(temps.reduce((a, b) => a + b, 0) / temps.length) : 24

  // ── Field Health Chart (30 days) ──
  // Group readings by field and date
  const fieldMap = new Map<string, { name: string, dateMap: Map<string, number[]> }>()
  for (const r of sensorReadings) {
    const fieldId = r.sensorDevice.field.id
    const fieldName = r.sensorDevice.field.name
    if (!fieldMap.has(fieldId)) {
      fieldMap.set(fieldId, { name: fieldName, dateMap: new Map() })
    }
    const dateKey = r.timestamp.toISOString().slice(0, 10)
    const entry = fieldMap.get(fieldId)!
    if (!entry.dateMap.has(dateKey)) entry.dateMap.set(dateKey, [])

    // Compute per-reading health score
    let score = 0, factors = 0
    if (r.moisture != null) {
      score += r.moisture >= 25 && r.moisture <= 35 ? 100 : r.moisture >= 15 && r.moisture <= 45 ? 70 : 40
      factors++
    }
    if (r.pH != null) {
      score += r.pH >= 6.0 && r.pH <= 7.5 ? 100 : r.pH >= 5.0 && r.pH <= 8.5 ? 70 : 40
      factors++
    }
    if (r.nitrogen != null) {
      score += r.nitrogen >= 20 && r.nitrogen <= 30 ? 100 : r.nitrogen >= 10 && r.nitrogen <= 40 ? 70 : 40
      factors++
    }
    entry.dateMap.get(dateKey)!.push(factors > 0 ? score / factors : 50)
  }

  // Build chart labels (all unique dates sorted)
  const allDates = new Set<string>()
  for (const f of fieldMap.values()) {
    for (const d of f.dateMap.keys()) allDates.add(d)
  }
  const sortedDates = Array.from(allDates).sort()

  const fieldHealthChart = {
    labels: sortedDates.map(d => {
      const date = new Date(d)
      return `${date.getDate()}/${date.getMonth() + 1}`
    }),
    datasets: Array.from(fieldMap.values()).map(f => ({
      label: f.name,
      data: sortedDates.map(d => {
        const vals = f.dateMap.get(d)
        if (!vals || vals.length === 0) return null
        return Math.round(vals.reduce((a, b) => a + b, 0) / vals.length)
      })
    }))
  }

  // ── Soil Nutrients Chart ──
  // Average latest readings per field for nutrients
  const nutrientLabels = ['nitrogen', 'phosphorus', 'potassium'] as const
  const nutrientDatasets = fields.map(f => {
    const latestReadings = f.sensorDevices.flatMap(sd => sd.readings.length > 0 ? [sd.readings[0]!] : [])
    const avg = (key: typeof nutrientLabels[number]) => {
      const vals = latestReadings.filter(r => r[key] != null).map(r => r[key]!)
      return vals.length > 0 ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : 0
    }
    return {
      label: f.name,
      data: nutrientLabels.map(n => avg(n))
    }
  })

  const soilNutrientsChart = {
    labels: [...nutrientLabels],
    datasets: nutrientDatasets
  }

  // ── Irrigation Schedule ──
  const irrigationSchedule = recommendations.map(r => ({
    fieldName: r.field.name,
    title: r.title,
    priority: r.priority,
    when: 'tomorrow'
  }))

  // ── Weather Forecast (mock based on sensor temp) ──
  const days = ['today', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
  const weatherForecast = days.map((day, i) => ({
    day,
    high: avgTemp + Math.round(Math.random() * 4 - 1),
    low: avgTemp - Math.round(3 + Math.random() * 3),
    condition: i < 2 ? 'sunny' : i < 4 ? 'partly_cloudy' : i === 4 ? 'rainy' : 'cloudy'
  }))

  return {
    userName: user?.name ?? 'Farmer',
    fieldsCount,
    totalArea: Math.round(totalArea * 10) / 10,
    soilHealth: { label: soilHealthLabel, percentage: soilHealthPct },
    nextIrrigation: { when: nextIrrigationWhen, fields: irrigationFields },
    weather: { temperature: avgTemp, condition: 'sunny', wind: 'light' },
    fieldHealthChart,
    soilNutrientsChart,
    irrigationSchedule,
    weatherForecast,
    activeAlerts: alerts,
  }
})
