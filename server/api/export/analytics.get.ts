export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const query = getQuery(event)
  const fieldId = query.fieldId as string

  if (!fieldId) {
    throw createError({ statusCode: 400, statusMessage: 'fieldId is required' })
  }

  // Verify ownership
  const field = await prisma.field.findFirst({
    where: { id: fieldId, farm: { userId } }
  })
  if (!field) {
    throw createError({ statusCode: 404, statusMessage: 'Field not found' })
  }

  // Fetch sensor data
  const sensorReadings = await prisma.sensorReading.findMany({
    where: { sensorDevice: { fieldId } },
    orderBy: { timestamp: 'desc' },
    include: { sensorDevice: { select: { name: true } } }
  })

  // Fetch NDVI data
  const vegetationPoints = await prisma.vegetationIndexPoint.findMany({
    where: { droneFlight: { fieldId } },
    orderBy: { timestamp: 'desc' },
    include: { droneFlight: { select: { date: true } } }
  })

  // Build CSV
  const lines: string[] = []

  // Sensor section
  lines.push('--- Sensor Readings ---')
  lines.push('Date,Device,Moisture (%),Nitrogen (mg/kg),Phosphorus (mg/kg),Potassium (mg/kg),Temperature (C),pH')
  for (const r of sensorReadings) {
    lines.push([
      new Date(r.timestamp).toISOString(),
      r.sensorDevice.name,
      r.moisture ?? '',
      r.nitrogen ?? '',
      r.phosphorus ?? '',
      r.potassium ?? '',
      r.temperature ?? '',
      r.pH ?? ''
    ].join(','))
  }

  lines.push('')

  // NDVI section
  lines.push('--- Vegetation Index Points ---')
  lines.push('Date,NDVI,EVI,Lat,Lng')
  for (const p of vegetationPoints) {
    lines.push([
      new Date(p.timestamp).toISOString(),
      p.ndvi,
      p.evi ?? '',
      p.lat ?? '',
      p.lng ?? ''
    ].join(','))
  }

  const csv = lines.join('\n')
  const filename = `analytics-${field.name.replace(/\s+/g, '_')}-${new Date().toISOString().slice(0, 10)}.csv`

  setResponseHeaders(event, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`
  })

  return csv
})
