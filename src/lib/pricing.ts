import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Wallets hold their market's currency (USD when the account has no market), while crypto,
 * partner deals and promo offers are set in USD. Mirrors the player site's
 * `lib/payments/pricing.ts`: rates are wallet units per 1 USD at the market's
 * staff-set rate, before spread.
 */

type Client = Prisma.TransactionClient | typeof prisma;

const CACHE_MS = 15_000;
let cache: { rates: Map<string, { currency: string; fxRate: number }>; expiresAt: number } | null = null;

async function marketRates() {
	if (cache && cache.expiresAt > Date.now()) return cache.rates;

	const rows = await prisma.localPaymentCountry.findMany({
		select: { country: true, currency: true, fxRate: true }
	});
	const rates = new Map<string, { currency: string; fxRate: number }>();

	for (const row of rows) {
		const fxRate = Number(row.fxRate);

		if (Number.isFinite(fxRate) && fxRate > 0) {
			rates.set(row.country, { currency: row.currency.toUpperCase(), fxRate });
		}
	}

	cache = { rates, expiresAt: Date.now() + CACHE_MS };
	return rates;
}

export function invalidatePricingCache() {
	cache = null;
}

/** 1 for USD wallets, and for any wallet whose market rate cannot be read. */
export async function usdRateFor(market: string | null | undefined, currency: string | null | undefined) {
	const code = (currency || 'USD').toUpperCase();

	if (code === 'USD' || !market) return 1;

	const rate = (await marketRates()).get(market);

	if (!rate || rate.currency !== code) {
		console.error(`No ${code} rate for market ${market}`);
		return 1;
	}

	return rate.fxRate;
}

export async function getUserUsdRate(userId: string, client: Client = prisma) {
	const user = await client.user.findUnique({
		where: { id: userId },
		select: { market: true, wallet: { select: { currency: true } } }
	});
	return usdRateFor(user?.market, user?.wallet?.currency);
}

/** Rates for many players at once, keyed by user id. */
export async function getUserUsdRates(userIds: string[]) {
	const rates = new Map<string, number>();

	if (!userIds.length) return rates;

	const users = await prisma.user.findMany({
		where: { id: { in: userIds } },
		select: { id: true, market: true, wallet: { select: { currency: true } } }
	});

	for (const user of users) {
		rates.set(user.id, await usdRateFor(user.market, user.wallet?.currency));
	}

	return rates;
}

export function toUsd(amount: number, rate: number) {
	return rate === 1 ? amount : Math.round((amount / rate) * 100) / 100;
}

/**
 * The USD a crypto withdrawal pays out, at the rate stored on the request.
 * Rounded down, so the casino never sends more than the wallet was debited.
 */
export function payoutUsd(
	amount: { toString(): string } | number,
	usdRate: { toString(): string } | number | null | undefined
) {
	const value = Number(amount.toString());
	const rate = usdRate == null ? 1 : Number(usdRate.toString());

	if (!(rate > 0) || rate === 1) return value;

	return Math.floor((value / rate) * 100 + 1e-6) / 100;
}
