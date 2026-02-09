export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const recommendations = await prisma.recommendation.findMany({
    where: { field: { farm: { userId } } },
    include: {
      field: { select: { name: true } },
      season: { select: { year: true, crop: true } }
    },
    orderBy: { createdAt: 'desc' }
  })

  const lines: string[] = []
  lines.push('Type,Title,Description,Priority,Field,Season,Created At')
  for (const r of recommendations) {
    lines.push([
      r.type,
      `"${r.title.replace(/"/g, '""')}"`,
      `"${r.description.replace(/"/g, '""')}"`,
      r.priority,
      r.field.name,
      r.season ? `${r.season.year} - ${r.season.crop}` : '',
      new Date(r.createdAt).toISOString()
    ].join(','))
  }

  const csv = lines.join('\n')
  const filename = `recommendations-${new Date().toISOString().slice(0, 10)}.csv`

  setResponseHeaders(event, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`
  })

  return csv
})
