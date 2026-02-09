export default defineEventHandler(async (event) => {
  await requireAdmin(event)

  const [
    totalUsers,
    farmers,
    admins,
    totalFarms,
    totalFields,
    totalSeasons,
    activeAlerts,
    recentUsers,
    farmerDetails
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { role: 'farmer' } }),
    prisma.user.count({ where: { role: 'admin' } }),
    prisma.farm.count(),
    prisma.field.count(),
    prisma.season.count(),
    prisma.alert.count({ where: { status: 'active' } }),
    prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 5
    }),
    prisma.user.findMany({
      where: { role: 'farmer' },
      select: {
        id: true,
        name: true,
        email: true,
        createdAt: true,
        farms: {
          select: {
            id: true,
            name: true,
            fields: {
              select: {
                id: true,
                area: true,
                alerts: { where: { status: 'active' }, select: { id: true } }
              }
            }
          }
        }
      },
      orderBy: { createdAt: 'asc' }
    })
  ])

  const farmerStats = farmerDetails.map(f => ({
    id: f.id,
    name: f.name,
    email: f.email,
    createdAt: f.createdAt,
    farmsCount: f.farms.length,
    fieldsCount: f.farms.reduce((sum, farm) => sum + farm.fields.length, 0),
    totalArea: Math.round(f.farms.reduce((sum, farm) => sum + farm.fields.reduce((s, field) => s + (field.area ?? 0), 0), 0) * 10) / 10,
    activeAlerts: f.farms.reduce((sum, farm) => sum + farm.fields.reduce((s, field) => s + field.alerts.length, 0), 0),
  }))

  return {
    totalUsers,
    farmers,
    admins,
    totalFarms,
    totalFields,
    totalSeasons,
    activeAlerts,
    recentUsers,
    farmerStats,
  }
})
