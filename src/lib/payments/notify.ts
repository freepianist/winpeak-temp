import { prisma } from '@/lib/db';
import { formatMoney, money } from '@/lib/money';
import {
	sendDepositCreditedEmail,
	sendDepositDeclinedEmail,
	sendWithdrawDeclinedEmail,
	sendWithdrawSentEmail,
	type PaymentFact
} from '@/lib/email';
import { payCurrencyLabel } from '@/lib/payments/currencies';

/**
 * Tells a player by email that staff have settled their deposit or withdrawal.
 *
 * Mirrors the player site's `lib/payments/notify.ts`, which covers the same
 * events on the automatic rail. Between them every terminal status a wallet
 * request can reach sends exactly one email, and neither duplicates the other:
 * an automatic crypto payout approved here is only settled once its IPN reaches
 * the player site, so this stays quiet until then.
 *
 * Call this only after the settling transaction has committed, never inside it:
 * a provider outage at Resend must not roll back money that has already moved.
 * Nothing here throws for the same reason — a failed email is logged and the
 * approval stands, because the player's activity list records it either way.
 */

export type WalletOutcomeEvent =
	/** New money this approval put in the wallet, which is what is worth an email. */
	| { kind: 'deposit_credited'; credited: number }
	| { kind: 'deposit_declined' }
	| { kind: 'withdraw_sent' }
	| { kind: 'withdraw_declined' };

function formatDateTime(value: Date) {
	return value.toLocaleString('en-US', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit'
	});
}

export async function notifyWalletOutcome(requestId: string, event: WalletOutcomeEvent) {
	try {
		const request = await prisma.walletRequest.findUnique({
			where: { id: requestId },
			select: {
				id: true,
				amount: true,
				creditedAmount: true,
				paymentOutcome: true,
				payCurrency: true,
				payoutAddress: true,
				provider: true,
				country: true,
				channel: true,
				localAmount: true,
				localCurrency: true,
				reviewNote: true,
				reviewedAt: true,
				user: {
					select: { email: true, wallet: { select: { currency: true } } }
				}
			}
		});

		const to = request?.user.email;

		if (!request || !to) {
			return;
		}

		const currency = request.user.wallet?.currency || 'USD';
		const requested = money(request.amount);
		const note = request.reviewNote;
		const settledAt = formatDateTime(request.reviewedAt || new Date());
		const network: PaymentFact[] =
			request.provider === 'daypgl'
				? [
						{
							label: 'Method',
							value: `Local payment (${[request.country, request.channel].filter(Boolean).join(' · ')})`
						},
						...(request.localAmount != null && request.localCurrency
							? [
									{
										label: 'Local amount',
										value: `${request.localCurrency} ${money(request.localAmount).toFixed(2)}`
									}
								]
							: [])
					]
				: request.payCurrency
					? [{ label: 'Network', value: payCurrencyLabel(request.payCurrency) }]
					: [];
		const reference: PaymentFact = { label: 'Reference', value: request.id };

		if (event.kind === 'deposit_credited') {
			// On the manual rail what staff credit can differ from what the player
			// asked to deposit, and a top-up only covers a shortfall, so the figure
			// credited now and the deposit total are both stated rather than letting
			// one stand for the other.
			const total = request.creditedAmount == null ? event.credited : money(request.creditedAmount);

			await sendDepositCreditedEmail({
				to,
				credited: formatMoney(event.credited, currency),
				invoiced: formatMoney(requested, currency),
				outcome: outcomeLabel(request.paymentOutcome),
				note,
				facts: [
					{ label: 'Credited now', value: formatMoney(event.credited, currency) },
					...(total - event.credited >= 0.01
						? [{ label: 'Credited on this deposit', value: formatMoney(total, currency) }]
						: []),
					{ label: 'Deposit requested', value: formatMoney(requested, currency) },
					...network,
					reference,
					{ label: 'Completed', value: settledAt }
				]
			});
			return;
		}

		if (event.kind === 'deposit_declined') {
			await sendDepositDeclinedEmail({
				to,
				requested: formatMoney(requested, currency),
				note,
				facts: [
					{ label: 'Deposit requested', value: formatMoney(requested, currency) },
					...network,
					reference,
					{ label: 'Closed', value: settledAt }
				]
			});
			return;
		}

		if (event.kind === 'withdraw_sent') {
			await sendWithdrawSentEmail({
				to,
				amount: formatMoney(requested, currency),
				note,
				facts: [
					{ label: 'Amount', value: formatMoney(requested, currency) },
					...network,
					...(request.payoutAddress ? [{ label: 'Sent to', value: request.payoutAddress }] : []),
					reference,
					{ label: 'Sent', value: settledAt }
				]
			});
			return;
		}

		await sendWithdrawDeclinedEmail({
			to,
			amount: formatMoney(requested, currency),
			note,
			facts: [
				{ label: 'Amount returned', value: formatMoney(requested, currency) },
				...network,
				reference,
				{ label: 'Declined', value: settledAt }
			]
		});
	} catch (error) {
		console.error(`Payment email for ${requestId} failed`, error);
	}
}

function outcomeLabel(value: string | null) {
	return value === 'UNDERPAID' || value === 'OVERPAID' || value === 'EXACT' ? value : null;
}
