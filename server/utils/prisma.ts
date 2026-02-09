import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL ?? 'postgresql://thisisaliyev:@localhost:5432/harvestpredictor' })
const prisma = new PrismaClient({ adapter })

export default prisma
