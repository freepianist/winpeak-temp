import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { money } from '@/lib/money';
import { accrueAffiliateCpa } from '@/lib/affiliates';
import { grantDepositPromos } from '@/lib/promos';
import { notifyWalletOutcome } from '@/lib/payments/notify';
import { PAY_CURRENCIES, payCurrencyLabel } from '@/lib/payments/currencies';

const TX = { maxWait: 15_000, timeout: 30_000 } as const;

export type PendingDeposit = {
	id: string;
	name: string;
	txHash: string;
	payCurrency: string | null;
};

export type ReceivingAddress = {
	address: string;
	networks: string[];
};

export async function listPendingDeposits(): Promise<PendingDeposit[]> {
	const rows = await prisma.walletRequest.findMany({
		where: { type: 'DEPOSIT', status: 'PENDING', manual: true },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			txHash: true,
			payCurrency: true,
			user: { select: { firstName: true, lastName: true } }
		}
	});

	return rows.map((row) => ({
		id: row.id,
		name: `${row.user.firstName} ${row.user.lastName}`.trim(),
		txHash: row.txHash || '',
		payCurrency: row.payCurrency
	}));
}

/** The casino wallets players are currently shown, one entry per address with every network it serves. */
export async function listReceivingAddresses(): Promise<ReceivingAddress[]> {
	const wallets = await prisma.manualWallet.findMany({
		where: { enabled: true },
		select: { payCurrency: true, address: true }
	});
	const order = (id: string) => {
		const index = PAY_CURRENCIES.findIndex((coin) => coin.id === id);
		return index === -1 ? PAY_CURRENCIES.length : index;
	};
	const grouped = new Map<string, string[]>();

	for (const wallet of wallets.sort((a, b) => order(a.payCurrency) - order(b.payCurrency))) {
		const address = wallet.address.trim();
		if (!address) continue;
		grouped.set(address, [...(grouped.get(address) || []), payCurrencyLabel(wallet.payCurrency)]);
	}

	return [...grouped].map(([address, networks]) => ({ address, networks }));
}

async function lockWallet(client: Prisma.TransactionClient, userId: string) {
	await client.$queryRaw`SELECT 1 FROM "Wallet" WHERE "userId" = ${userId} FOR UPDATE`;
	return client.wallet.findUnique({ where: { userId } });
}

async function lockWalletRequest(client: Prisma.TransactionClient, id: string) {
	await client.$queryRaw`SELECT 1 FROM "WalletRequest" WHERE "id" = ${id} FOR UPDATE`;
	return client.walletRequest.findUnique({ where: { id } });
}

/** Same ledger write as winpeak-admin's applyDeposit, always inside the caller's transaction. */
async function applyDeposit(client: Prisma.TransactionClient, userId: string, amount: number) {
	const wallet = await lockWallet(client, userId);

	if (!wallet) {
		throw new Error('Wallet not found');
	}

	const next = money(wallet.balance) + amount;
	await client.wallet.update({ where: { userId }, data: { balance: next } });
	await client.ledgerEntry.create({
		data: { userId, kind: 'DEPOSIT', amount, balanceAfter: next }
	});
	await grantDepositPromos(userId, amount, client);
}

/**
 * Approves a pending manual deposit for the amount the player requested,
 * mirroring winpeak-admin's approveWalletRequest on the manual rail.
 */
export async function approveManualDeposit(requestId: string, reviewedBy: string) {
	const result = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
		const latest = await lockWalletRequest(tx, requestId);

		if (!latest) {
			throw new Error('Request not found');
		}

		if (latest.type !== 'DEPOSIT' || !latest.manual) {
			throw new Error('Only manual deposits can be approved here');
		}

		if (latest.status !== 'PENDING') {
			throw new Error('Request is no longer pending');
		}

		const requested = money(latest.amount);
		const alreadyCredited = latest.creditedAmount == null ? 0 : money(latest.creditedAmount);
		const toCredit = Number((requested - alreadyCredited).toFixed(2));

		if (toCredit < 0.01) {
			throw new Error('This deposit has already been credited that amount');
		}

		await applyDeposit(tx, latest.userId, toCredit);
		await tx.depositPayment.create({
			data: {
				requestId,
				paymentId: `manual:${requestId}`,
				creditedAmount: toCredit,
				providerStatus: latest.providerStatus
			}
		});
		await tx.walletRequest.update({
			where: { id: requestId },
			data: {
				status: 'APPROVED',
				creditedAmount: requested,
				paymentOutcome: 'EXACT',
				reviewedBy,
				reviewedAt: new Date(),
				reviewNote: 'Credited the requested amount'
			}
		});

		return { userId: latest.userId, credited: toCredit };
	}, TX);

	try {
		await accrueAffiliateCpa(result.userId, result.credited);
	} catch (error) {
		console.error('Affiliate CPA accrual failed', error);
	}

	await notifyWalletOutcome(requestId, { kind: 'deposit_credited', credited: result.credited });
}
