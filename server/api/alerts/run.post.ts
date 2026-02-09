export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id
  const newAlerts: { fieldId: string, rule: string, message: string, severity: string }[] = []

  const fields = await prisma.field.findMany({
    where: { farm: { userId } },
    include: {
      sensorDevices: {
        include: {
          readings: { orderBy: { timestamp: 'desc' }, take: 10 }
        }
      },
      droneFlights: {
        include: {
          vegetationPoints: { orderBy: { timestamp: 'desc' }, take: 10 }
        },
        orderBy: { date: 'desc' },
        take: 3
      }
    }
  })

  // Get existing active alerts to avoid duplicates
  const existingAlerts = await prisma.alert.findMany({
    where: { field: { farm: { userId } }, status: 'active' },
    select: { rule: true, fieldId: true }
  })
  const activeAlertKeys = new Set(existingAlerts.map(a => `${a.fieldId}:${a.rule}`))

  for (const field of fields) {
    // --- Sensor-based alerts ---
    for (const device of field.sensorDevices) {
      const latest = device.readings[0]
      if (!latest) continue

      // Low moisture (absolute)
      if (latest.moisture !== null && latest.moisture < 20) {
        newAlerts.push({
          fieldId: field.id,
          rule: 'low_moisture',
          message: `Low soil moisture (${latest.moisture}%) detected on ${field.name}`,
          severity: latest.moisture < 10 ? 'critical' : 'warning'
        })
      }

      // Moisture declining trend (last 3 readings all decreasing)
      const moistureReadings = device.readings
        .filter(r => r.moisture !== null)
        .slice(0, 5)
        .map(r => r.moisture!)
      if (moistureReadings.length >= 3) {
        const declining = moistureReadings.slice(0, 3).every((v, i, arr) =>
          i === 0 || v < arr[i - 1]
        )
        if (declining) {
          newAlerts.push({
            fieldId: field.id,
            rule: 'moisture_declining',
            message: `Soil moisture is consistently declining on ${field.name} (${moistureReadings[0]}% → ${moistureReadings[2]}%)`,
            severity: 'warning'
          })
        }
      }

      // Low nitrogen
      if (latest.nitrogen !== null && latest.nitrogen < 15) {
        newAlerts.push({
          fieldId: field.id,
          rule: 'low_nitrogen',
          message: `Low nitrogen level (${latest.nitrogen} mg/kg) on ${field.name}`,
          severity: 'warning'
        })
      }

      // pH out of range
      if (latest.pH !== null && (latest.pH < 5.5 || latest.pH > 8.0)) {
        newAlerts.push({
          fieldId: field.id,
          rule: 'ph_out_of_range',
          message: `pH level (${latest.pH}) out of optimal range on ${field.name}`,
          severity: 'warning'
        })
      }
    }

    // --- NDVI-based alerts ---
    const allNdviPoints = field.droneFlights.flatMap(f => f.vegetationPoints)
    const sortedNdvi = allNdviPoints.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
    )

    if (sortedNdvi.length > 0) {
      const latestNdvi = sortedNdvi[0]

      // Absolute low NDVI
      if (latestNdvi.ndvi < 0.3) {
        newAlerts.push({
          fieldId: field.id,
          rule: 'low_ndvi',
          message: `Low NDVI (${latestNdvi.ndvi.toFixed(2)}) detected on ${field.name}`,
          severity: latestNdvi.ndvi < 0.15 ? 'critical' : 'warning'
        })
      }

      // NDVI drop detection: compare latest to average of previous readings
      if (sortedNdvi.length >= 3) {
        const previous = sortedNdvi.slice(1, 6)
        const avgPrevious = previous.reduce((sum, p) => sum + p.ndvi, 0) / previous.length
        const dropPercent = ((avgPrevious - latestNdvi.ndvi) / avgPrevious) * 100

        if (dropPercent > 20 && avgPrevious > 0.3) {
          newAlerts.push({
            fieldId: field.id,
            rule: 'ndvi_drop',
            message: `NDVI dropped ${dropPercent.toFixed(0)}% on ${field.name} (avg ${avgPrevious.toFixed(2)} → ${latestNdvi.ndvi.toFixed(2)})`,
            severity: dropPercent > 40 ? 'critical' : 'warning'
          })
        }
      }
    }
  }

  // Filter out duplicates (same rule + field already active)
  const uniqueAlerts = newAlerts.filter(a => !activeAlertKeys.has(`${a.fieldId}:${a.rule}`))

  const created = await Promise.all(
    uniqueAlerts.map(a => prisma.alert.create({
      data: { ...a, status: 'active' }
    }))
  )

  return { alertsCreated: created.length, alerts: created }
})
