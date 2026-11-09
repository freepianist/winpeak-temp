import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { money } from '@/lib/money';
import { accrueAffiliateCpa } from '@/lib/affiliates';
import { grantDepositPromos } from '@/lib/promos';
import { notifyWalletOutcome } from '@/lib/payments/notify';
import { payCurrencyLabel } from '@/lib/payments/currencies';

const TX = { maxWait: 15_000, timeout: 30_000 } as const;

export type PendingDeposit = {
	id: string;
	name: string;
	txHash: string;
	address: string;
	network: string;
};

/** The player site writes the wallet shown to the player as "Sent to <address>[ · …]". */
function addressFromNote(note: string | null) {
	const match = note?.match(/^Sent to (\S+)/);
	return match ? match[1] : '';
}

export async function listPendingDeposits(): Promise<PendingDeposit[]> {
	const [rows, wallets] = await Promise.all([
		prisma.walletRequest.findMany({
			where: { type: 'DEPOSIT', status: 'PENDING', manual: true },
			orderBy: { createdAt: 'desc' },
			select: {
				id: true,
				txHash: true,
				note: true,
				payCurrency: true,
				user: { select: { firstName: true, lastName: true } }
			}
		}),
		prisma.manualWallet.findMany({ select: { payCurrency: true, address: true } })
	]);
	const currentAddress = new Map(wallets.map((wallet) => [wallet.payCurrency, wallet.address.trim()]));

	return rows.map((row) => ({
		id: row.id,
		name: `${row.user.firstName} ${row.user.lastName}`.trim(),
		txHash: row.txHash || '',
		address: addressFromNote(row.note) || currentAddress.get(row.payCurrency || '') || '',
		network: row.payCurrency ? payCurrencyLabel(row.payCurrency) : ''
	}));
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
