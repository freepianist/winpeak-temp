import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

const globalForPrisma = globalThis as unknown as {
	prisma?: PrismaClient;
	pool?: Pool;
};

function createPrisma() {
	const connectionString = process.env.DATABASE_URL;

	if (!connectionString) {
		throw new Error('DATABASE_URL is not set. Copy it from the winpeak-admin .env');
	}

	const ssl =
		/\.neon\.tech/i.test(connectionString) || /sslmode=require/i.test(connectionString)
			? { rejectUnauthorized: true }
			: undefined;

	const pool = globalForPrisma.pool ?? new Pool({ connectionString, max: 5, idleTimeoutMillis: 30_000, ssl });

	if (process.env.NODE_ENV !== 'production') {
		globalForPrisma.pool = pool;
	}

	return new PrismaClient({
		adapter: new PrismaPg(pool),
		log: ['error'],
		transactionOptions: { maxWait: 10_000, timeout: 20_000 }
	});
}

export const prisma = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== 'production') {
	globalForPrisma.prisma = prisma;
}
