import bcrypt from 'bcryptjs';
import { prisma } from '@/lib/db';
import { money } from '@/lib/money';
import { getUserUsdRates, toUsd, usdRateFor } from '@/lib/pricing';
type AffiliateVisitType = 'unique' | 'repeat' | 'refresh' | 'new_tab' | 'same_tab' | 'back';

export function trackingLink(code: string) {
	const origin = (process.env.WINPEAK_SITE_URL || process.env.NEXT_PUBLIC_WINPEAK_SITE_URL || '').replace(/\/$/, '');
	const path = `?ref=${encodeURIComponent(code)}`;
	return origin ? `${origin}${path}` : path;
}

export function maskEmail(email: string) {
	const [user, domain] = email.split('@');

	if (!user || !domain) {
		return '***';
	}

	return `${user[0]}***@${domain}`;
}

export function makeAffiliateCode(name: string) {
	const base =
		name
			.replace(/[^a-zA-Z0-9]/g, '')
			.slice(0, 6)
			.toUpperCase() || 'AFF';
	const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
	return `${base}${suffix}`;
}

export function makeTempPassword() {
	return `Aff-${Math.random().toString(36).slice(2, 10)}`;
}

export async function hashAffiliatePassword(password: string) {
	return bcrypt.hash(password, 12);
}

export async function verifyAffiliatePassword(password: string, passwordHash: string) {
	return bcrypt.compare(password, passwordHash);
}

export function serializePartner(
	partner: {
		id: string;
		email: string;
		name: string;
		passwordHash?: string | null;
		code: string;
		dealType: string;
		cpaAmount: { toString(): string } | number | null;
		revSharePercent: { toString(): string } | number | null;
		minFtdAmount?: { toString(): string } | number | null;
		minWagerAmount?: { toString(): string } | number | null;
		status: string;
		notes: string | null;
		managerId?: string | null;
		manager?: { name: string } | null;
		createdAt: Date;
		updatedAt: Date;
	},
	extras: Record<string, unknown> = {}
) {
	return {
		id: partner.id,
		email: partner.email,
		name: partner.name,
		code: partner.code,
		dealType: partner.dealType,
		cpaAmount: money(partner.cpaAmount),
		revSharePercent: money(partner.revSharePercent),
		minFtdAmount: money(partner.minFtdAmount),
		minWagerAmount: money(partner.minWagerAmount),
		status: partner.status,
		notes: partner.notes || '',
		hasPassword: Boolean(partner.passwordHash),
		managerId: partner.managerId ?? null,
		managerName: partner.manager?.name || '',
		trackingLink: trackingLink(partner.code),
		createdAt: partner.createdAt.toISOString(),
		updatedAt: partner.updatedAt.toISOString(),
		...extras
	};
}

export function serializeCommission(row: {
	id: string;
	partnerId: string;
	userId: string | null;
	kind: string;
	amount: { toString(): string } | number;
	basisAmount: { toString(): string } | number;
	status: string;
	payoutId?: string | null;
	createdAt: Date;
	partner?: { name: string; email: string; code: string };
	user?: { firstName: string; lastName: string; email: string } | null;
	maskPlayer?: boolean;
}) {
	const email = row.user?.email || '';
	return {
		id: row.id,
		partnerId: row.partnerId,
		partnerName: row.partner?.name || '',
		partnerEmail: row.partner?.email || '',
		partnerCode: row.partner?.code || '',
		userId: row.userId,
		playerName: row.user ? `${row.user.firstName} ${row.user.lastName}`.trim() : '',
		playerEmail: row.maskPlayer ? maskEmail(email) : email,
		kind: row.kind,
		amount: money(row.amount),
		basisAmount: money(row.basisAmount),
		status: row.status,
		payoutId: row.payoutId || null,
		createdAt: row.createdAt.toISOString()
	};
}

export function serializePayout(row: {
	id: string;
	partnerId: string;
	amount: { toString(): string } | number;
	status: string;
	note: string | null;
	createdAt: Date;
	partner?: { name: string; email: string; code: string };
	_count?: { commissions: number };
}) {
	return {
		id: row.id,
		partnerId: row.partnerId,
		partnerName: row.partner?.name || '',
		partnerEmail: row.partner?.email || '',
		partnerCode: row.partner?.code || '',
		amount: money(row.amount),
		status: row.status,
		note: row.note || '',
		commissionCount: row._count?.commissions ?? 0,
		createdAt: row.createdAt.toISOString()
	};
}

function visitorLabel(visitorKey: string) {
	const compact = visitorKey.replace(/-/g, '').slice(0, 8).toUpperCase();
	return compact ? `V-${compact}` : 'Unknown';
}

function isoDate(value: Date | string) {
	return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

type ClickRecord = {
	id: string;
	landingPath: string;
	referrer: string;
	createdAt: Date | string;
	visitorKey?: string | null;
	visitNumber?: number | bigint | null;
	visitorVisits?: number | bigint | null;
	eventType?: string | null;
	deviceType?: string | null;
	os?: string | null;
	browser?: string | null;
	country?: string | null;
	region?: string | null;
	city?: string | null;
};

const VISIT_TYPES = new Set(['unique', 'repeat', 'refresh', 'new_tab', 'same_tab', 'back']);

function visitTypeOf(eventType: string | null | undefined, visitNumber: number): AffiliateVisitType {
	if (eventType === 'first' || !eventType) {
		return visitNumber > 1 ? 'repeat' : 'unique';
	}

	if (VISIT_TYPES.has(eventType)) {
		return eventType as AffiliateVisitType;
	}

	return visitNumber > 1 ? 'repeat' : 'unique';
}

export function serializeClick(row: ClickRecord) {
	const visitNumber = Math.max(1, Number(row.visitNumber || 1));
	const visitorVisits = Math.max(visitNumber, Number(row.visitorVisits || visitNumber));

	return {
		id: row.id,
		landingPath: row.landingPath || '/',
		source: row.referrer || 'Direct',
		createdAt: isoDate(row.createdAt),
		visitType: visitTypeOf(row.eventType, visitNumber),
		visitNumber,
		visitorVisits,
		visitorLabel: visitorLabel(row.visitorKey || ''),
		deviceType: row.deviceType || '',
		os: row.os || '',
		browser: row.browser || '',
		country: row.country || '',
		region: row.region || '',
		city: row.city || ''
	};
}

export const CLICKS_MAX_PAGE_SIZE = 100;

export type ClicksPageQuery = {
	page?: number;
	pageSize?: number;
	visitType?: string;
	search?: string;
	sort?: 'asc' | 'desc';
};

// Built as plain SQL with positional params: nested Prisma.sql fragments break when the
// globally cached client in db.ts outlives a dev hot reload.
function clickFilters(params: unknown[], visitType?: string, search?: string) {
	const conditions: string[] = [];
	const bind = (value: unknown) => {
		params.push(value);
		return `$${params.length}`;
	};
	const fallbackType = `c."eventType" NOT IN (${[...VISIT_TYPES].map((type) => `'${type}'`).join(', ')})`;
	const firstVisit = `NOT EXISTS (
		SELECT 1 FROM "AffiliateClick" e
		WHERE e."partnerId" = c."partnerId"
		  AND e."visitorKey" = c."visitorKey"
		  AND (e."createdAt" < c."createdAt" OR (e."createdAt" = c."createdAt" AND e.id < c.id))
	)`;

	if (visitType === 'unique') {
		conditions.push(`(c."eventType" = 'unique' OR (${fallbackType} AND ${firstVisit}))`);
	} else if (visitType === 'repeat') {
		conditions.push(`(c."eventType" = 'repeat' OR (${fallbackType} AND NOT ${firstVisit}))`);
	} else if (visitType && VISIT_TYPES.has(visitType)) {
		conditions.push(`c."eventType" = ${bind(visitType)}`);
	}

	const term = search?.trim();

	if (term) {
		const pattern = bind(`%${term.replace(/[\\%_]/g, (char) => `\\${char}`)}%`);
		conditions.push(`(
			c."landingPath" ILIKE ${pattern}
			OR (CASE WHEN c.referrer = '' THEN 'Direct' ELSE c.referrer END) ILIKE ${pattern}
			OR ('V-' || upper(substr(replace(c."visitorKey", '-', ''), 1, 8))) ILIKE ${pattern}
			OR c."deviceType" ILIKE ${pattern}
			OR c.os ILIKE ${pattern}
			OR c.browser ILIKE ${pattern}
			OR c.country ILIKE ${pattern}
			OR c.region ILIKE ${pattern}
			OR c.city ILIKE ${pattern}
		)`);
	}

	return conditions.map((condition) => ` AND ${condition}`).join('');
}

export async function getClicksPage(partnerId: string, query: ClicksPageQuery = {}) {
	const page = Math.max(0, Math.floor(Number(query.page) || 0));
	const pageSize = Math.min(CLICKS_MAX_PAGE_SIZE, Math.max(1, Math.floor(Number(query.pageSize) || 15)));
	const direction = query.sort === 'asc' ? 'ASC' : 'DESC';
	const params: unknown[] = [partnerId];
	const filters = clickFilters(params, query.visitType, query.search);
	const limit = `$${params.length + 1}`;
	const offset = `$${params.length + 2}`;

	const [rows, total] = await Promise.all([
		prisma
			.$queryRawUnsafe<ClickRecord[]>(
				`
				WITH page AS (
					SELECT
						c.id,
						c."visitorKey",
						c."landingPath",
						c.referrer,
						c."createdAt",
						c."eventType",
						c."deviceType",
						c.os,
						c.browser,
						c.country,
						c.region,
						c.city
					FROM "AffiliateClick" c
					WHERE c."partnerId" = $1${filters}
					ORDER BY c."createdAt" ${direction}, c.id ${direction}
					LIMIT ${limit} OFFSET ${offset}
				),
				scoped AS (
					SELECT
						id,
						ROW_NUMBER() OVER (PARTITION BY "visitorKey" ORDER BY "createdAt" ASC, id ASC) AS "visitNumber",
						COUNT(*) OVER (PARTITION BY "visitorKey") AS "visitorVisits"
					FROM "AffiliateClick"
					WHERE "partnerId" = $1
					  AND "visitorKey" IN (SELECT "visitorKey" FROM page)
				)
				SELECT
					p.*,
					s."visitNumber"::int AS "visitNumber",
					s."visitorVisits"::int AS "visitorVisits"
				FROM page p
				INNER JOIN scoped s ON s.id = p.id
				ORDER BY p."createdAt" ${direction}, p.id ${direction}
				`,
				...params,
				pageSize,
				page * pageSize
			)
			.catch((): ClickRecord[] => []),
		prisma
			.$queryRawUnsafe<{ total: number }[]>(
				`SELECT COUNT(*)::int AS total FROM "AffiliateClick" c WHERE c."partnerId" = $1${filters}`,
				...params
			)
			.then((result) => Number(result[0]?.total || 0))
			.catch(() => 0)
	]);

	return { rows: rows.map(serializeClick), total, page, pageSize };
}

async function getRecentClicks(partnerId: string) {
	const { rows } = await getClicksPage(partnerId, { pageSize: 20 });
	return rows;
}

function lastUtcDays(count: number) {
	const days: string[] = [];
	const now = new Date();

	for (let index = count - 1; index >= 0; index -= 1) {
		const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - index));
		days.push(day.toISOString().slice(0, 10));
	}

	return days;
}

async function getClickSeries(partnerId: string, days = 14) {
	const since = new Date();
	since.setUTCHours(0, 0, 0, 0);
	since.setUTCDate(since.getUTCDate() - (days - 1));

	const rows = await prisma.$queryRaw<{ day: string; clicks: number; uniqueClicks: number }[]>`
			SELECT to_char(date_trunc('day', "createdAt"), 'YYYY-MM-DD') AS day,
			       COUNT(*)::int AS clicks,
			       COUNT(DISTINCT "visitorKey")::int AS "uniqueClicks"
			FROM "AffiliateClick"
			WHERE "partnerId" = ${partnerId} AND "createdAt" >= ${since}
			GROUP BY 1
			ORDER BY 1
		`.catch((): { day: string; clicks: number; uniqueClicks: number }[] => []);

	const byDay = new Map(rows.map((row) => [String(row.day).slice(0, 10), row]));

	return lastUtcDays(days).map((date) => {
		const row = byDay.get(date);
		return {
			date,
			clicks: Number(row?.clicks || 0),
			uniqueClicks: Number(row?.uniqueClicks || 0)
		};
	});
}

/**
 * Cash turnover per player in USD: every stake less the slice that came out of the
 * bonus balance, less any stake an aggregator later reversed.
 *
 * This is both the turnover a CPA floor is judged against and the stake side of the
 * GGR rev share is owed on.
 *
 * Bets written before the `bonusAmount` column existed carry a zero bonus slice, so
 * they read as wholly cash and flatter whatever is measured on them.
 */
async function cashWageredByPlayer(playerIds: string[], rates: Map<string, number>) {
	const totals = new Map<string, number>();

	if (!playerIds.length) {
		return totals;
	}

	// A cancellation hands the stake back, so the bet it reverses leaves turnover
	// again, pro rata when only part of the stake was returned. It carries that bet's
	// own transaction id in `referenceId`, and ids repeat across aggregators, so the
	// join is scoped by source too.
	const sum = (cash: (alias: string) => string) =>
		prisma.$queryRawUnsafe<{ userId: string; wagered: unknown }[]>(
			`WITH staked AS (
				SELECT b."userId", ${cash('b')} AS cash
				FROM "LedgerEntry" b
				WHERE b.kind = 'BET' AND b."userId" = ANY($1)
			), reversed AS (
				SELECT c."userId", ${cash('b')} * LEAST(c.amount, b.amount) / NULLIF(b.amount, 0) AS cash
				FROM "LedgerEntry" c
				JOIN "LedgerEntry" b
					ON b.source = c.source
					AND b."providerTxId" = c."referenceId"
					AND b.kind = 'BET'
				WHERE c.kind = 'CANCEL' AND c."userId" = ANY($1)
			)
			SELECT "userId", GREATEST(COALESCE(SUM(cash), 0), 0) AS wagered
			FROM (
				SELECT "userId", cash FROM staked
				UNION ALL
				SELECT "userId", -cash FROM reversed
			) t
			GROUP BY "userId"`,
			playerIds
		);

	// Falls back to gross stakes on a database still short of the column, so the
	// partner page renders rather than erroring out.
	const rows = await sum((alias) => `(${alias}.amount - ${alias}."bonusAmount")`)
		.catch(() => sum((alias) => `(${alias}.amount)`))
		.catch((): { userId: string; wagered: unknown }[] => []);

	for (const row of rows) {
		totals.set(row.userId, toUsd(money(row.wagered), rates.get(row.userId) ?? 1));
	}

	return totals;
}

/** The USD value of each player's earliest deposit, which a CPA is booked against. */
async function firstDepositUsd(playerIds: string[]) {
	const basis = new Map<string, number>();

	if (!playerIds.length) {
		return basis;
	}

	const [rows, rates] = await Promise.all([
		prisma
			.$queryRawUnsafe<{ userId: string; amount: unknown }[]>(
				`SELECT DISTINCT ON ("userId") "userId", amount
				 FROM "LedgerEntry"
				 WHERE kind = 'DEPOSIT' AND "userId" = ANY($1)
				 ORDER BY "userId", "createdAt" ASC, id ASC`,
				playerIds
			)
			.catch((): { userId: string; amount: unknown }[] => []),
		getUserUsdRates(playerIds)
	]);

	for (const row of rows) {
		basis.set(row.userId, toUsd(money(row.amount), rates.get(row.userId) ?? 1));
	}

	return basis;
}

export const partnerManagerInclude = { manager: { select: { name: true } } } as const;

/** Support agents are staff accounts too, so a partner's manager has to be checked by role. */
export async function isAffiliateManager(staffId: string) {
	const staff = await prisma.staffAccount.findUnique({ where: { id: staffId }, select: { role: true } });
	return staff?.role === 'AFFILIATE_MANAGER';
}

export async function getPartnerBook(partnerId: string) {
	const partner = await prisma.affiliatePartner.findUnique({
		where: { id: partnerId },
		include: partnerManagerInclude
	});

	if (!partner) {
		return null;
	}

	const players = await prisma.user.findMany({
		where: { referredByAffiliateId: partnerId },
		orderBy: { createdAt: 'desc' },
		select: {
			id: true,
			email: true,
			firstName: true,
			lastName: true,
			status: true,
			firstDepositAt: true,
			createdAt: true
		}
	});

	const playerIds = players.map((player) => player.id);
	const ftds = players.filter((player) => player.firstDepositAt).length;

	let bets = 0;
	let wins = 0;
	let cashWagered = 0;
	let wageredByPlayer = new Map<string, number>();

	if (playerIds.length) {
		// Wallets differ in currency, so each player's play is priced in USD (at
		// today's market rate) before it is added up against a USD deal.
		const [rows, rates] = await Promise.all([
			prisma.ledgerEntry.groupBy({
				by: ['userId', 'kind'],
				where: { userId: { in: playerIds }, kind: { in: ['BET', 'WIN'] } },
				_sum: { amount: true }
			}),
			getUserUsdRates(playerIds)
		]);

		for (const row of rows) {
			const usd = toUsd(money(row._sum.amount), rates.get(row.userId) ?? 1);

			if (row.kind === 'BET') bets += usd;

			if (row.kind === 'WIN') wins += usd;
		}

		bets = money(bets);
		wins = money(wins);
		wageredByPlayer = await cashWageredByPlayer(playerIds, rates);

		for (const wagered of wageredByPlayer.values()) {
			cashWagered += wagered;
		}

		cashWagered = money(cashWagered);
	}

	// Rev share is owed on the cash the house actually took, so the stake side is cash
	// turnover rather than gross `bets`: a stake an aggregator later cancelled was handed
	// back, and a stake funded from the bonus balance was the house's money to begin with.
	// Wins are never reversed — `applyCancel` only ever unwinds a BET — so they come off whole.
	const ggr = Math.max(0, cashWagered - wins);
	const revSharePercent = money(partner.revSharePercent);
	const estimatedRevShare = partner.dealType === 'CPA' ? 0 : Number(((ggr * revSharePercent) / 100).toFixed(4));

	const [commissionRows, payoutSum, clickTotals, clicks, clickSeries] = await Promise.all([
		prisma.affiliateCommission.groupBy({
			by: ['status', 'kind'],
			where: { partnerId, status: { not: 'VOID' } },
			_sum: { amount: true }
		}),
		prisma.affiliatePayout.aggregate({
			where: { partnerId },
			_sum: { amount: true }
		}),
		prisma.$queryRaw<{ clicks: number; uniqueClicks: number; refreshClicks: number }[]>`
				SELECT
					COUNT(*)::int AS clicks,
					COUNT(DISTINCT "visitorKey")::int AS "uniqueClicks",
					COUNT(*) FILTER (WHERE "eventType" = 'refresh')::int AS "refreshClicks"
				FROM "AffiliateClick"
				WHERE "partnerId" = ${partnerId}
			`
			.then((rows) => rows[0] || { clicks: 0, uniqueClicks: 0, refreshClicks: 0 })
			.catch(() => ({ clicks: 0, uniqueClicks: 0, refreshClicks: 0 })),
		getRecentClicks(partnerId),
		getClickSeries(partnerId)
	]);

	let bookedCpa = 0;
	let bookedRevShare = 0;
	let pending = 0;
	let approved = 0;
	let paid = 0;

	for (const row of commissionRows) {
		const amount = money(row._sum.amount);

		if (row.kind === 'CPA') bookedCpa += amount;

		if (row.kind === 'REVSHARE') bookedRevShare += amount;

		if (row.status === 'PENDING') pending += amount;

		if (row.status === 'APPROVED') approved += amount;

		if (row.status === 'PAID') paid += amount;
	}

	const clickCount = Number(clickTotals.clicks || 0);

	const uniqueClicks = Number(clickTotals.uniqueClicks || 0);

	const refreshClicks = Number(clickTotals.refreshClicks || 0);

	return {
		partner,
		players,
		clicks,
		clickSeries,
		wageredByPlayer,
		stats: {
			clicks: clickCount,
			uniqueClicks,
			refreshClicks,
			repeatClicks: Math.max(0, clickCount - uniqueClicks - refreshClicks),
			signups: players.length,
			ftds,
			bets,
			wins,
			ggr,
			cashWagered,
			estimatedRevShare,
			bookedCpa,
			bookedRevShare,
			pending,
			approved,
			paid,
			paidOut: money(payoutSum._sum.amount)
		}
	};
}

/** `walletAmount` is in the player's wallet currency; partner deals are in USD. */
export async function accrueAffiliateCpa(userId: string, walletAmount: number) {
	const user = await prisma.user.findUnique({
		where: { id: userId },
		include: { referredBy: true, wallet: { select: { currency: true } } }
	});

	const usdRate = await usdRateFor(user?.market, user?.wallet?.currency);
	const depositAmount = toUsd(walletAmount, usdRate);

	if (!user || user.firstDepositAt) {
		return;
	}

	const floor = money(user.referredBy?.minFtdAmount);

	if (depositAmount < floor) {
		return;
	}

	const marked = await prisma.user.updateMany({
		where: { id: userId, firstDepositAt: null },
		data: { firstDepositAt: new Date() }
	});

	if (marked.count === 0) {
		return;
	}

	const partner = user.referredBy;

	if (!partner || partner.status !== 'ACTIVE' || partner.dealType === 'REVSHARE') {
		return;
	}

	const cpa = money(partner.cpaAmount);

	if (cpa <= 0) {
		return;
	}

	// A deal with a turnover floor almost never qualifies on the deposit itself,
	// since the player has usually staked nothing yet. Those wait for staff to sweep
	// them from the partner page with `bookQualifiedCpa`.
	const minWager = money(partner.minWagerAmount);

	if (minWager > 0) {
		const wagered = await cashWageredByPlayer([userId], new Map([[userId, usdRate]]));

		if ((wagered.get(userId) ?? 0) < minWager) {
			return;
		}
	}

	await prisma.affiliateCommission.create({
		data: {
			partnerId: partner.id,
			userId,
			kind: 'CPA',
			amount: cpa,
			basisAmount: depositAmount,
			status: 'PENDING'
		}
	});
}

/**
 * Books the CPA for every referred player who has cleared the deal's deposit and
 * turnover floors but has no commission yet.
 *
 * A wagering floor cannot be judged when the deposit lands, so those CPAs are never
 * accrued automatically and staff settle them from the partner page instead.
 */
export async function bookQualifiedCpa(partnerId: string) {
	const book = await getPartnerBook(partnerId);

	if (!book) {
		throw new Error('Partner not found');
	}

	const { partner } = book;

	if (partner.dealType === 'REVSHARE') {
		throw new Error('This partner is rev share only');
	}

	if (partner.status !== 'ACTIVE') {
		throw new Error('This partner is not active');
	}

	const cpa = money(partner.cpaAmount);

	if (cpa <= 0) {
		throw new Error('Set a CPA amount on this deal before booking');
	}

	const minWager = money(partner.minWagerAmount);
	const cleared = book.players.filter(
		(player) => player.firstDepositAt && (book.wageredByPlayer.get(player.id) ?? 0) >= minWager
	);

	if (!cleared.length) {
		throw new Error('No players have met this deal yet');
	}

	const basis = await firstDepositUsd(cleared.map((player) => player.id));

	// Nothing in the database stops a player holding two CPA rows, so the partner is
	// locked while the ones already booked are read back. Without it two sweeps landing
	// together would each see an unpaid player and both book them.
	const booked = await prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM "AffiliatePartner" WHERE id = ${partnerId} FOR UPDATE`;

		const settled = await tx.affiliateCommission.findMany({
			where: {
				partnerId,
				kind: 'CPA',
				status: { not: 'VOID' },
				userId: { in: cleared.map((player) => player.id) }
			},
			select: { userId: true }
		});
		const paid = new Set(settled.map((row) => row.userId));
		const due = cleared.filter((player) => !paid.has(player.id));

		if (due.length) {
			await tx.affiliateCommission.createMany({
				data: due.map((player) => ({
					partnerId,
					userId: player.id,
					kind: 'CPA' as const,
					amount: cpa,
					basisAmount: basis.get(player.id) ?? 0,
					status: 'PENDING' as const
				}))
			});
		}

		return due.length;
	});

	if (!booked) {
		throw new Error('Every qualified player has already been booked a CPA');
	}

	return { booked, amount: money(cpa * booked) };
}

export async function bookRevShare(partnerId: string) {
	const book = await getPartnerBook(partnerId);

	if (!book) {
		throw new Error('Partner not found');
	}

	const { partner } = book;

	if (partner.dealType === 'CPA') {
		throw new Error('This partner is CPA only');
	}

	if (partner.status !== 'ACTIVE') {
		throw new Error('This partner is not active');
	}

	const revSharePercent = money(partner.revSharePercent);

	if (revSharePercent <= 0) {
		throw new Error('Set a rev share % on this deal before booking');
	}

	// Nothing in the database stops the same GGR being booked twice, so the partner is
	// locked while the basis already booked is read back. Without it two bookings landing
	// together would each see the whole unbooked GGR and both record a commission on it.
	return prisma.$transaction(async (tx) => {
		await tx.$queryRaw`SELECT id FROM "AffiliatePartner" WHERE id = ${partnerId} FOR UPDATE`;

		const alreadyBooked = await tx.affiliateCommission.aggregate({
			where: { partnerId, kind: 'REVSHARE', status: { not: 'VOID' } },
			_sum: { basisAmount: true }
		});

		const unbookedGgr = Math.max(0, book.stats.ggr - money(alreadyBooked._sum.basisAmount));
		const amount = Number(((unbookedGgr * revSharePercent) / 100).toFixed(4));

		if (amount <= 0) {
			throw new Error('No unbooked rev share to record');
		}

		return tx.affiliateCommission.create({
			data: {
				partnerId,
				kind: 'REVSHARE',
				amount,
				basisAmount: unbookedGgr,
				status: 'PENDING'
			}
		});
	});
}
