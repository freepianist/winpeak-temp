import { randomBytes } from "crypto";
import type { Prisma } from '@prisma/client';
import { prisma } from "@/lib/db";
import { getUserUsdRate } from "@/lib/pricing";

type Client = Prisma.TransactionClient | typeof prisma;

function money(value: unknown) {
	if (value == null || value === "") return 0;
	return Number(Number(String(value)).toFixed(4));
}

function roundCash(value: number) {
	return Number(Math.max(0, value).toFixed(2));
}

export function previousUtcWeek(now = new Date()) {
	const day = now.getUTCDay();
	const daysFromMonday = (day + 6) % 7;
	const thisMonday = Date.UTC(
		now.getUTCFullYear(),
		now.getUTCMonth(),
		now.getUTCDate() - daysFromMonday
	);
	return {
		periodStart: new Date(thisMonday - 7 * 24 * 60 * 60 * 1000),
		periodEnd: new Date(thisMonday),
	};
}

/**
 * The offer a market runs for a slot: its own if it has written one, otherwise
 * the house offer that covers every market. A market with an offer of its own
 * never sees the house copy for that slot, so pausing the market's offer falls
 * back rather than leaving the slot empty.
 */
async function getOffer(
	client: Client,
	kind: "WELCOME" | "RELOAD" | "CASHBACK" | "REFERRAL",
	depositNumber?: number | null,
	market?: string | null
) {
	const slot = {
		kind,
		status: "ACTIVE" as const,
		...(depositNumber ? { depositNumber } : {}),
	};

	if (market) {
		const own = await client.promoOffer.findFirst({
			where: { ...slot, market },
			orderBy: { createdAt: "asc" },
		});
		if (own) return own;
	}

	return client.promoOffer.findFirst({
		where: { ...slot, market: null },
		orderBy: { createdAt: "asc" },
	});
}

/**
 * What multiplies an offer's amounts to reach the player's wallet. A market's
 * own offer is written in that market's currency, which is the currency of
 * every wallet it can be granted to, so its amounts already are the wallet's;
 * the house set is USD and is priced at the market rate. An offer left in a
 * currency its market has since stopped using is read as local too, since
 * reading a local figure as dollars would multiply the payout by the rate.
 */
function offerRate(offer: { currency: string | null }, usdRate: number) {
	return offer.currency ? 1 : usdRate;
}

/**
 * One of an offer's amounts in USD, whatever currency the offer is written in.
 * `usdRate` is the rate of the market the offer belongs to, so this only makes
 * sense for paying an offer out somewhere other than that market.
 */
function offerUsd(offer: { currency: string | null }, amount: number, usdRate: number) {
	return offer.currency && usdRate > 0 ? amount / usdRate : amount;
}

/**
 * A bonus's max bet in the wallet's own currency, which is what a stake is
 * measured in everywhere it is checked. Reads the rate only for the one case
 * that needs it: a house offer's USD held against a local wallet.
 */
export async function bonusMaxBet(
	bonus: { offer: { maxBet: { toString(): string } | number; currency: string | null } },
	userId: string,
	walletCurrency: string | null | undefined,
	client: Client = prisma
) {
	const maxBet = money(bonus.offer.maxBet);
	if (maxBet <= 0) return 0;
	if (bonus.offer.currency || (walletCurrency || "USD").toUpperCase() === "USD") {
		return maxBet;
	}
	return roundCash(maxBet * (await getUserUsdRate(userId, client)));
}

/** Which market's promotions a player is on. Null accounts run the house set. */
async function marketOf(userId: string, client: Client = prisma) {
	const user = await client.user.findUnique({
		where: { id: userId },
		select: { market: true },
	});
	return user?.market || null;
}

export async function getActiveBonus(userId: string, client: Client = prisma) {
	const bonus = await client.playerBonus.findFirst({
		where: { userId, status: "ACTIVE" },
		include: { offer: true },
		orderBy: { grantedAt: "desc" },
	});
	if (!bonus) return null;
	if (bonus.expiresAt && bonus.expiresAt.getTime() <= Date.now()) {
		await expireBonus(bonus.id, userId, client);
		return null;
	}
	return bonus;
}

async function expireBonus(bonusId: string, userId: string, client: Client) {
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (wallet && money(wallet.bonusBalance) > 0) {
		await client.wallet.update({
			where: { userId },
			data: { bonusBalance: 0 },
		});
	}
	return client.playerBonus.update({
		where: { id: bonusId },
		data: {
			status: "EXPIRED",
			completedAt: new Date(),
			note: "Bonus expired before wagering was completed",
			wagerRemaining: 0,
		},
		include: { offer: true },
	});
}

export async function forfeitActiveBonus(
	userId: string,
	reason: string,
	client: Client = prisma
) {
	const bonus = await client.playerBonus.findFirst({
		where: { userId, status: "ACTIVE" },
		include: { offer: true },
	});
	if (!bonus) return null;

	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (wallet && money(wallet.bonusBalance) > 0) {
		await client.wallet.update({
			where: { userId },
			data: { bonusBalance: 0 },
		});
	}

	return client.playerBonus.update({
		where: { id: bonus.id },
		data: {
			status: "FORFEITED",
			completedAt: new Date(),
			note: reason,
			wagerRemaining: 0,
		},
		include: { offer: true },
	});
}

async function creditCash(
	userId: string,
	amount: number,
	kind: "CASHBACK" | "REFERRAL" | "BONUS",
	client: Client,
	referenceId?: string
) {
	if (amount <= 0) return 0;
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (!wallet) throw new Error("Wallet not found");
	const next = money(wallet.balance) + amount;
	await client.wallet.update({
		where: { userId },
		data: { balance: next },
	});
	await client.ledgerEntry.create({
		data: {
			userId,
			kind,
			amount,
			balanceAfter: next,
			referenceId: referenceId || null,
		},
	});
	return next;
}

async function creditBonus(
	userId: string,
	amount: number,
	client: Client,
	referenceId?: string
) {
	if (amount <= 0) return 0;
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (!wallet) throw new Error("Wallet not found");
	const nextBonus = money(wallet.bonusBalance) + amount;
	await client.wallet.update({
		where: { userId },
		data: { bonusBalance: nextBonus },
	});
	await client.ledgerEntry.create({
		data: {
			userId,
			kind: "BONUS",
			amount,
			balanceAfter: money(wallet.balance),
			referenceId: referenceId || null,
		},
	});
	return nextBonus;
}

async function convertBonusToCash(userId: string, client: Client, bonusId: string) {
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (!wallet) return;
	const bonus = money(wallet.bonusBalance);
	if (bonus <= 0) return;
	const next = money(wallet.balance) + bonus;
	await client.wallet.update({
		where: { userId },
		data: { balance: next, bonusBalance: 0 },
	});
	await client.ledgerEntry.create({
		data: {
			userId,
			kind: "BONUS",
			amount: bonus,
			balanceAfter: next,
			referenceId: `bonus-clear:${bonusId}`,
		},
	});
}

async function grantMatchBonus(
	userId: string,
	depositAmount: number,
	depositCount: number,
	usdRate: number,
	market: string | null,
	client: Client
) {
	const active = await client.playerBonus.findFirst({
		where: { userId, status: "ACTIVE" },
		select: { id: true },
	});
	if (active) return null;

	const kind = depositCount === 1 ? "WELCOME" : "RELOAD";
	if (kind === "RELOAD" && depositCount !== 2 && depositCount !== 3) {
		return null;
	}

	const offer = await getOffer(client, kind, depositCount, market);
	if (!offer) return null;

	const rate = offerRate(offer, usdRate);
	if (depositAmount < money(offer.minDeposit) * rate) return null;

	const matched = roundCash(
		Math.min(
			money(offer.maxAmount) * rate,
			(depositAmount * money(offer.matchPercent)) / 100
		)
	);
	if (matched <= 0) return null;

	const wagerRequired = roundCash(matched * money(offer.wagerMultiplier));
	const expiresAt =
		offer.expireDays > 0
			? new Date(Date.now() + offer.expireDays * 24 * 60 * 60 * 1000)
			: null;

	const bonus = await client.playerBonus.create({
		data: {
			userId,
			offerId: offer.id,
			status: "ACTIVE",
			bonusAmount: matched,
			wagerRequired,
			wagerRemaining: wagerRequired,
			depositAmount,
			expiresAt,
			note: `${offer.name} on deposit #${depositCount}`,
		},
		include: { offer: true },
	});

	await creditBonus(userId, matched, client, `bonus:${bonus.id}`);
	return bonus;
}

async function grantReferralRewards(
	userId: string,
	depositAmount: number,
	isFirstDeposit: boolean,
	usdRate: number,
	market: string | null,
	client: Client
) {
	if (!isFirstDeposit) return null;

	const user = await client.user.findUnique({
		where: { id: userId },
		select: {
			referredByUserId: true,
			referredByAffiliateId: true,
		},
	});
	if (!user?.referredByUserId || user.referredByAffiliateId) return null;
	if (user.referredByUserId === userId) return null;

	const existing = await client.referralReward.findUnique({
		where: { referredId: userId },
		select: { id: true },
	});
	if (existing) return null;

	// The deposit that triggers the reward is the friend's, so the friend's
	// market sets the terms; the amount is still paid at the referrer's rate,
	// into the referrer's wallet.
	const offer = await getOffer(client, "REFERRAL", null, market);
	if (!offer) return null;
	if (depositAmount < money(offer.minDeposit) * offerRate(offer, usdRate)) return null;

	const referrer = await client.user.findUnique({
		where: { id: user.referredByUserId },
		select: { id: true, status: true },
	});
	if (!referrer || referrer.status !== "ACTIVE") return null;

	// Paid into the referrer's wallet, so in the referrer's currency. The reward
	// on a market's own offer is written in the friend's currency, so a referrer
	// on another market is paid the same value through USD, not the same number.
	const amount = roundCash(
		offerUsd(offer, money(offer.rewardAmount), usdRate) *
			(await getUserUsdRate(referrer.id, client))
	);
	if (amount <= 0) return null;

	await client.referralReward.create({
		data: {
			referrerId: referrer.id,
			referredId: userId,
			amount,
		},
	});

	await creditCash(referrer.id, amount, "REFERRAL", client, `referral:${userId}`);
	return amount;
}

export async function grantDepositPromos(
	userId: string,
	depositAmount: number,
	client: Client
) {
	const depositCount = await client.ledgerEntry.count({
		where: { userId, kind: "DEPOSIT" },
	});
	// The house offers are set in USD; the deposit is in the wallet's currency,
	// which is what a market's own offer is already written in.
	const usdRate = await getUserUsdRate(userId, client);
	const market = await marketOf(userId, client);
	await grantMatchBonus(userId, depositAmount, depositCount, usdRate, market, client);
	await grantReferralRewards(userId, depositAmount, depositCount === 1, usdRate, market, client);
}

export async function applyWagerOnBet(
	userId: string,
	betAmount: number,
	client: Client
) {
	const bonus = await getActiveBonus(userId, client);
	if (!bonus) return null;

	const wallet = await client.wallet.findUnique({ where: { userId } });
	const maxBet = await bonusMaxBet(bonus, userId, wallet?.currency, client);
	if (betAmount > maxBet && maxBet > 0) {
		return { maxBetExceeded: true as const, maxBet, bonus };
	}

	const remaining = Math.max(0, money(bonus.wagerRemaining) - betAmount);
	const bonusLeft = wallet ? money(wallet.bonusBalance) : 0;

	if (remaining <= 0) {
		await client.playerBonus.update({
			where: { id: bonus.id },
			data: {
				wagerRemaining: 0,
				status: "COMPLETED",
				completedAt: new Date(),
				note: bonus.note,
			},
		});
		await convertBonusToCash(userId, client, bonus.id);
		return { completed: true as const, bonus };
	}

	if (bonusLeft <= 0) {
		await client.playerBonus.update({
			where: { id: bonus.id },
			data: {
				wagerRemaining: remaining,
				status: "FORFEITED",
				completedAt: new Date(),
				note: "Bonus balance reached zero before wagering was completed",
			},
		});
		return { forfeited: true as const, bonus };
	}

	await client.playerBonus.update({
		where: { id: bonus.id },
		data: { wagerRemaining: remaining },
	});
	return { progressed: true as const, remaining, bonus };
}

export async function reverseWagerOnCancel(
	userId: string,
	betAmount: number,
	client: Client
) {
	const bonus = await client.playerBonus.findFirst({
		where: { userId, status: "ACTIVE" },
		include: { offer: true },
	});
	if (!bonus) return;
	const restored = Math.min(
		money(bonus.wagerRequired),
		money(bonus.wagerRemaining) + betAmount
	);
	await client.playerBonus.update({
		where: { id: bonus.id },
		data: { wagerRemaining: restored },
	});
}

export async function creditPlayWin(
	userId: string,
	amount: number,
	client: Client
) {
	const bonus = await getActiveBonus(userId, client);
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (!wallet) throw new Error("Wallet not found");

	if (bonus) {
		const nextBonus = money(wallet.bonusBalance) + amount;
		await client.wallet.update({
			where: { userId },
			data: { bonusBalance: nextBonus },
		});
		return {
			cash: money(wallet.balance),
			bonus: nextBonus,
			held: money(wallet.heldBalance),
		};
	}

	const next = money(wallet.balance) + amount;
	await client.wallet.update({
		where: { userId },
		data: { balance: next },
	});
	return {
		cash: next,
		bonus: money(wallet.bonusBalance),
		held: money(wallet.heldBalance),
	};
}

export async function restorePlayFunds(
	userId: string,
	amount: number,
	client: Client
) {
	const bonus = await client.playerBonus.findFirst({
		where: { userId, status: "ACTIVE" },
		select: { id: true },
	});
	const wallet = await client.wallet.findUnique({ where: { userId } });
	if (!wallet) throw new Error("Wallet not found");

	if (bonus) {
		const nextBonus = money(wallet.bonusBalance) + amount;
		await client.wallet.update({
			where: { userId },
			data: { bonusBalance: nextBonus },
		});
		return {
			cash: money(wallet.balance),
			bonus: nextBonus,
			held: money(wallet.heldBalance),
		};
	}

	const next = money(wallet.balance) + amount;
	await client.wallet.update({
		where: { userId },
		data: { balance: next },
	});
	return {
		cash: next,
		bonus: money(wallet.bonusBalance),
		held: money(wallet.heldBalance),
	};
}

async function creditCashbackForUser(
	userId: string,
	periodStart: Date,
	periodEnd: Date,
	client: Client = prisma
) {
	const offer = await getOffer(client, "CASHBACK", null, await marketOf(userId, client));
	if (!offer) return null;

	const existing = await client.cashbackPayout.findUnique({
		where: { userId_periodStart: { userId, periodStart } },
		select: { id: true },
	});
	if (existing) return null;

	const [bets, wins] = await Promise.all([
		client.ledgerEntry.aggregate({
			where: {
				userId,
				kind: "BET",
				createdAt: { gte: periodStart, lt: periodEnd },
			},
			_sum: { amount: true },
		}),
		client.ledgerEntry.aggregate({
			where: {
				userId,
				kind: "WIN",
				createdAt: { gte: periodStart, lt: periodEnd },
			},
			_sum: { amount: true },
		}),
	]);

	const netLoss = money(bets._sum.amount) - money(wins._sum.amount);
	const usdRate = await getUserUsdRate(userId, client);
	// A dollar of net loss is the floor, in the wallet's currency, whatever the
	// offer is written in.
	if (netLoss < usdRate) return null;

	const cap = (money(offer.maxAmount) || money(offer.rewardAmount)) * offerRate(offer, usdRate);
	const amount = roundCash(Math.min(cap, (netLoss * money(offer.matchPercent)) / 100));
	if (amount < 0.01) return null;

	await client.cashbackPayout.create({
		data: {
			userId,
			offerId: offer.id,
			periodStart,
			periodEnd,
			netLoss,
			amount,
		},
	});
	await creditCash(userId, amount, "CASHBACK", client, `cashback:${periodStart.toISOString()}`);
	return { amount, netLoss, periodStart, periodEnd };
}

export async function maybeCreditWeeklyCashback(userId: string) {
	const { periodStart, periodEnd } = previousUtcWeek();
	try {
		return await prisma.$transaction((tx) =>
			creditCashbackForUser(userId, periodStart, periodEnd, tx)
		);
	} catch (error) {
		if (
			error instanceof Error &&
			/unique|Unique constraint/i.test(error.message)
		) {
			return null;
		}
		console.error("Weekly cashback credit failed", error);
		return null;
	}
}

export async function runWeeklyCashback() {
	const { periodStart, periodEnd } = previousUtcWeek();
	const players = await prisma.ledgerEntry.findMany({
		where: {
			kind: "BET",
			createdAt: { gte: periodStart, lt: periodEnd },
		},
		distinct: ["userId"],
		select: { userId: true },
	});

	let credited = 0;
	let amount = 0;
	for (const row of players) {
		const result = await prisma
			.$transaction((tx) => creditCashbackForUser(row.userId, periodStart, periodEnd, tx))
			.catch((error) => {
				if (error instanceof Error && /unique|Unique constraint/i.test(error.message)) {
					return null;
				}
				throw error;
			});
		if (result) {
			credited += 1;
			amount += result.amount;
		}
	}

	return { credited, amount, periodStart, periodEnd, scanned: players.length };
}

function makeReferralCode() {
	return `WP${randomBytes(4).toString("hex").toUpperCase()}`;
}

export async function ensureReferralCode(userId: string) {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		select: { referralCode: true },
	});
	if (user?.referralCode) return user.referralCode;

	for (let i = 0; i < 8; i += 1) {
		const code = makeReferralCode();
		try {
			const updated = await prisma.user.update({
				where: { id: userId },
				data: { referralCode: code },
				select: { referralCode: true },
			});
			if (updated.referralCode) return updated.referralCode;
		} catch (error) {
			if (error instanceof Error && /unique|Unique constraint/i.test(error.message)) {
				continue;
			}
			throw error;
		}
	}

	throw new Error("Could not create a referral code");
}

export async function resolvePlayerReferrer(code?: string | null, excludeUserId?: string) {
	const normalized = String(code || "")
		.trim()
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, "")
		.slice(0, 32);
	if (!normalized) return null;

	const referrer = await prisma.user.findFirst({
		where: {
			referralCode: normalized,
			status: "ACTIVE",
			...(excludeUserId ? { id: { not: excludeUserId } } : {}),
		},
		select: { id: true },
	});
	return referrer?.id || null;
}

/**
 * What a market advertises: its own offers, filled out with the house offers for
 * the slots it has not written itself.
 */
export async function listPublicOffers(market: string | null = null) {
	const offers = await prisma.promoOffer.findMany({
		where: {
			status: "ACTIVE",
			...(market ? { OR: [{ market }, { market: null }] } : { market: null }),
		},
		orderBy: [{ depositNumber: "asc" }, { createdAt: "asc" }],
	});

	// One offer per slot, matching what `getOffer` would actually grant: the
	// market's own where it has one, the house copy otherwise.
	const bySlot = new Map<string, (typeof offers)[number]>();
	for (const offer of offers) {
		const slot = `${offer.kind}:${offer.depositNumber ?? ""}`;
		const chosen = bySlot.get(slot);
		if (!chosen || (offer.market && !chosen.market)) bySlot.set(slot, offer);
	}

	const rank: Record<string, number> = {
		WELCOME: 0,
		RELOAD: 1,
		CASHBACK: 2,
		REFERRAL: 3,
	};
	return [...bySlot.values()]
		.map(serializeOffer)
		.sort((a, b) => (rank[a.kind] ?? 9) - (rank[b.kind] ?? 9));
}

export function serializeOffer(offer: {
	id: string;
	market: string | null;
	slug: string;
	kind: string;
	name: string;
	headline: string;
	details: string;
	currency: string | null;
	matchPercent: { toString(): string } | number;
	maxAmount: { toString(): string } | number;
	minDeposit: { toString(): string } | number;
	wagerMultiplier: { toString(): string } | number;
	expireDays: number;
	maxBet: { toString(): string } | number;
	depositNumber: number | null;
	rewardAmount: { toString(): string } | number;
	status: string;
}) {
	return {
		id: offer.id,
		market: offer.market,
		slug: offer.slug,
		kind: offer.kind,
		name: offer.name,
		headline: offer.headline,
		details: offer.details,
		currency: offer.currency,
		matchPercent: money(offer.matchPercent),
		maxAmount: money(offer.maxAmount),
		minDeposit: money(offer.minDeposit),
		wagerMultiplier: money(offer.wagerMultiplier),
		expireDays: offer.expireDays,
		maxBet: money(offer.maxBet),
		depositNumber: offer.depositNumber,
		rewardAmount: money(offer.rewardAmount),
		status: offer.status,
	};
}

export async function getPlayerPromoState(userId: string) {
	await maybeCreditWeeklyCashback(userId);
	const referralCode = await ensureReferralCode(userId);
	const market = await marketOf(userId);
	const [bonus, referrals, latestCashback, offers] = await Promise.all([
		getActiveBonus(userId),
		prisma.referralReward.count({ where: { referrerId: userId } }),
		prisma.cashbackPayout.findFirst({
			where: { userId },
			orderBy: { periodStart: "desc" },
		}),
		listPublicOffers(market),
	]);

	const welcome = offers.find((offer) => offer.kind === "WELCOME");
	const cashback = offers.find((offer) => offer.kind === "CASHBACK");
	const referral = offers.find((offer) => offer.kind === "REFERRAL");
	const { periodStart, periodEnd } = previousUtcWeek();

	return {
		referralCode,
		referralCount: referrals,
		referralAmount: referral ? referral.rewardAmount : 0,
		cashback: cashback
			? {
					percent: cashback.matchPercent,
					maxAmount: cashback.maxAmount,
					lastAmount: latestCashback ? money(latestCashback.amount) : 0,
					lastPeriodStart: latestCashback?.periodStart.toISOString() || null,
					pendingPeriodStart: periodStart.toISOString(),
					pendingPeriodEnd: periodEnd.toISOString(),
				}
			: null,
		welcomeHeadline: welcome?.headline || null,
		bonus: bonus
			? {
					id: bonus.id,
					name: bonus.offer.name,
					headline: bonus.offer.headline,
					amount: money(bonus.bonusAmount),
					wagerRequired: money(bonus.wagerRequired),
					wagerRemaining: money(bonus.wagerRemaining),
					maxBet: money(bonus.offer.maxBet),
					expiresAt: bonus.expiresAt?.toISOString() || null,
				}
			: null,
	};
}

export function serializePlayerBonus(row: {
	id: string;
	userId: string;
	offerId: string;
	status: string;
	bonusAmount: { toString(): string } | number;
	wagerRequired: { toString(): string } | number;
	wagerRemaining: { toString(): string } | number;
	depositAmount: { toString(): string } | number;
	expiresAt: Date | null;
	grantedAt: Date;
	completedAt: Date | null;
	note: string | null;
	offer?: { name: string; kind: string; market?: string | null };
	user?: { firstName: string; lastName: string; email: string; wallet?: { currency: string } | null };
}) {
	return {
		id: row.id,
		userId: row.userId,
		playerName: row.user ? `${row.user.firstName} ${row.user.lastName}`.trim() : "",
		playerEmail: row.user?.email || "",
		currency: row.user?.wallet?.currency || "USD",
		offerId: row.offerId,
		offerName: row.offer?.name || "",
		offerMarket: row.offer?.market || null,
		kind: row.offer?.kind || "",
		status: row.status,
		bonusAmount: money(row.bonusAmount),
		wagerRequired: money(row.wagerRequired),
		wagerRemaining: money(row.wagerRemaining),
		depositAmount: money(row.depositAmount),
		expiresAt: row.expiresAt?.toISOString() || null,
		grantedAt: row.grantedAt.toISOString(),
		completedAt: row.completedAt?.toISOString() || null,
		note: row.note || "",
	};
}
