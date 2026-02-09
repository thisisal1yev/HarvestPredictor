export default defineEventHandler(async (event) => {
  const session = await requireUserSession(event)
  const userId = session.user.id

  const alerts = await prisma.alert.findMany({
    where: { field: { farm: { userId } } },
    include: { field: { select: { name: true } } },
    orderBy: { triggeredAt: 'desc' }
  })

  const lines: string[] = []
  lines.push('Severity,Rule,Message,Field,Status,Triggered At')
  for (const a of alerts) {
    lines.push([
      a.severity,
      a.rule,
      `"${a.message.replace(/"/g, '""')}"`,
      a.field.name,
      a.status,
      new Date(a.triggeredAt).toISOString()
    ].join(','))
  }

  const csv = lines.join('\n')
  const filename = `alerts-${new Date().toISOString().slice(0, 10)}.csv`

  setResponseHeaders(event, {
    'Content-Type': 'text/csv',
    'Content-Disposition': `attachment; filename="${filename}"`
  })

  return csv
})
