/**
 * Player-facing email, sent from admin when staff settle a wallet request.
 *
 * Mirrors the player site's `lib/email.ts` — the branding, the layout and the
 * wording of a payment email have to match whichever app sent it, because a
 * player cannot tell the two apart and should not be able to. Keep the two in
 * step when either changes.
 */

const BRAND = {
	bg: '#1d1e24',
	card: '#23262b',
	border: '#2a2d33',
	text: '#ffffff',
	muted: '#b8bcc4',
	primary: '#9cecfe',
	accent: '#ffba23'
};

const PRODUCTION_SITE_URL = 'https://winpeakgames.com';

type Mail = {
	to: string;
	subject: string;
	text: string;
	html: string;
};

/** One figure a payment email has to state plainly, already formatted. */
export type PaymentFact = {
	label: string;
	value: string;
};

/**
 * The player site, not this one. Every link in these emails is somewhere the
 * player can actually go, so admin's own origin would be a dead end.
 */
function playerSiteUrl() {
	const raw = (process.env.WINPEAK_SITE_URL || process.env.NEXT_PUBLIC_SITE_URL || '').trim().replace(/\/+$/, '');

	return raw || PRODUCTION_SITE_URL;
}

function escapeHtml(value: string) {
	return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function emailLayout(options: {
	preview: string;
	title: string;
	bodyHtml: string;
	footnote: string;
	ctaLabel: string;
	ctaUrl: string;
}) {
	const site = playerSiteUrl();
	const year = new Date().getFullYear();
	const safeTitle = escapeHtml(options.title);
	const safePreview = escapeHtml(options.preview);
	const safeFootnote = escapeHtml(options.footnote);
	const safeUrl = escapeHtml(options.ctaUrl);
	const safeCta = escapeHtml(options.ctaLabel);

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="dark" />
  <meta name="supported-color-schemes" content="dark" />
  <title>${safeTitle}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.bg};color:${BRAND.text};font-family:Arial,Helvetica,sans-serif;">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">
    ${safePreview}
  </div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:${BRAND.bg};padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;background:${BRAND.card};border:1px solid ${BRAND.border};border-radius:16px;overflow:hidden;">
          <tr>
            <td style="padding:28px 32px 12px 32px;border-bottom:1px solid ${BRAND.border};">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td style="font-size:22px;font-weight:700;letter-spacing:0.02em;color:${BRAND.primary};">
                    WinPeak
                  </td>
                  <td align="right" style="font-size:12px;color:${BRAND.muted};text-transform:uppercase;letter-spacing:0.08em;">
                    Payments
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:32px;">
              <h1 style="margin:0 0 16px 0;font-size:24px;line-height:1.3;font-weight:700;color:${BRAND.text};">
                ${safeTitle}
              </h1>
              ${options.bodyHtml}
              <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:28px 0 8px 0;">
                <tr>
                  <td align="center" bgcolor="${BRAND.primary}" style="border-radius:999px;">
                    <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;color:#122027;text-decoration:none;border-radius:999px;">
                      ${safeCta}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:20px 0 0 0;font-size:13px;line-height:1.6;color:${BRAND.muted};">
                ${safeFootnote}
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:18px 32px;background:${BRAND.bg};border-top:1px solid ${BRAND.border};">
              <p style="margin:0;font-size:12px;line-height:1.6;color:${BRAND.muted};text-align:center;">
                © ${year} WinPeak ·
                <a href="${escapeHtml(site)}" style="color:${BRAND.accent};text-decoration:none;">${escapeHtml(site.replace(/^https?:\/\//, ''))}</a>
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function factsHtml(facts: PaymentFact[]) {
	const rows = facts
		.map(
			(fact) => `
                <tr>
                  <td style="padding:11px 0;font-size:14px;line-height:1.5;color:${BRAND.muted};border-bottom:1px solid ${BRAND.border};">
                    ${escapeHtml(fact.label)}
                  </td>
                  <td align="right" style="padding:11px 0 11px 12px;font-size:14px;line-height:1.5;font-weight:700;color:${BRAND.text};border-bottom:1px solid ${BRAND.border};word-break:break-all;">
                    ${escapeHtml(fact.value)}
                  </td>
                </tr>`
		)
		.join('');

	return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                ${rows}
              </table>`;
}

export async function sendMail(mail: Mail) {
	const from = process.env.EMAIL_FROM || 'WinPeak <noreply@winpeak.local>';
	const apiKey = process.env.RESEND_API_KEY;

	// A missing key is a valid local setup, so this returns rather than throwing:
	// staff have to be able to settle a payment whether or not mail is wired up.
	// On a hosted deploy it is a misconfiguration, and this line is the only sign
	// of it, since nothing downstream treats a skipped email as a failure.
	if (!apiKey) {
		console.error(`[email] RESEND_API_KEY is not set, so "${mail.subject}" was not sent to ${mail.to}`);
		return;
	}

	const response = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${apiKey}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from,
			to: [mail.to],
			subject: mail.subject,
			text: mail.text,
			html: mail.html
		})
	});

	if (!response.ok) {
		const detail = await response.text();
		throw new Error(`Email send failed: ${detail || response.status}`);
	}
}

/**
 * The shared shape of every wallet email: what happened, the figures behind it,
 * and the review note staff left. The note is already shown against the request
 * in the player's account activity, so it is safe to repeat here.
 */
async function sendPaymentEmail(options: {
	to: string;
	subject: string;
	preview: string;
	title: string;
	intro: string;
	facts: PaymentFact[];
	note: string | null;
	ctaLabel: string;
	footnote: string;
}) {
	const url = `${playerSiteUrl()}/account`;
	const noteHtml = options.note
		? `
              <p style="margin:22px 0 0 0;padding:14px 16px;font-size:14px;line-height:1.6;color:${BRAND.text};background:${BRAND.bg};border-left:3px solid ${BRAND.accent};border-radius:8px;">
                ${escapeHtml(options.note)}
              </p>`
		: '';

	await sendMail({
		to: options.to,
		subject: options.subject,
		text: [options.intro, factsText(options.facts), options.note, `View your account: ${url}`]
			.filter(Boolean)
			.join('\n\n'),
		html: emailLayout({
			preview: options.preview,
			title: options.title,
			bodyHtml: `
              <p style="margin:0 0 22px 0;font-size:15px;line-height:1.7;color:${BRAND.muted};">
                ${escapeHtml(options.intro)}
              </p>
              ${factsHtml(options.facts)}
              ${noteHtml}
            `,
			ctaLabel: options.ctaLabel,
			ctaUrl: url,
			footnote: options.footnote
		})
	});
}

function factsText(facts: PaymentFact[]) {
	return facts.map((fact) => `${fact.label}: ${fact.value}`).join('\n');
}

export async function sendDepositCreditedEmail(options: {
	to: string;
	/** What this approval put in the wallet, formatted. */
	credited: string;
	/** What the deposit asked for, formatted. */
	invoiced: string;
	outcome: 'EXACT' | 'UNDERPAID' | 'OVERPAID' | null;
	facts: PaymentFact[];
	note: string | null;
}) {
	const intro =
		options.outcome === 'OVERPAID'
			? `Your payment has landed and ${options.credited} has been credited to your wallet. That is more than the ${options.invoiced} this deposit asked for, and every bit that reached us has been credited.`
			: options.outcome === 'UNDERPAID'
				? `Your payment has landed, but it came in short of the ${options.invoiced} this deposit asked for. The ${options.credited} that reached us has been credited to your wallet.`
				: `Your payment has been confirmed and ${options.credited} is now available in your wallet.`;

	await sendPaymentEmail({
		to: options.to,
		subject: `${options.credited} credited to your WinPeak wallet`,
		preview: `Your deposit is complete — ${options.credited} is ready to play with.`,
		title: 'Deposit complete',
		intro,
		facts: options.facts,
		note: options.note,
		ctaLabel: 'View your wallet',
		footnote: 'You are receiving this because a deposit on your WinPeak account completed.'
	});
}

export async function sendDepositDeclinedEmail(options: {
	to: string;
	/** What the deposit asked for, formatted. */
	requested: string;
	facts: PaymentFact[];
	note: string | null;
}) {
	await sendPaymentEmail({
		to: options.to,
		subject: 'Your WinPeak deposit was not completed',
		preview: `Your ${options.requested} deposit has been closed with nothing credited.`,
		title: 'Deposit not completed',
		intro: `Your ${options.requested} deposit has been closed and nothing was credited to your wallet. You are free to start a new one whenever you like.`,
		facts: options.facts,
		note: options.note,
		ctaLabel: 'Start a new deposit',
		footnote:
			'If you did send funds and they have not arrived, contact support with the reference above and we will trace it.'
	});
}

export async function sendWithdrawSentEmail(options: {
	to: string;
	/** What is being paid out, formatted. */
	amount: string;
	facts: PaymentFact[];
	note: string | null;
}) {
	await sendPaymentEmail({
		to: options.to,
		subject: `Withdrawal sent — ${options.amount}`,
		preview: `Your ${options.amount} withdrawal is on its way.`,
		title: 'Withdrawal sent',
		intro: `Your ${options.amount} withdrawal has been approved and paid out to the address below. Crypto transfers normally arrive within a few minutes, once the network has confirmed them.`,
		facts: options.facts,
		note: options.note,
		ctaLabel: 'View your account',
		footnote: 'You are receiving this because a withdrawal from your WinPeak account was paid out.'
	});
}

export async function sendWithdrawDeclinedEmail(options: {
	to: string;
	/** What was held for the payout and has now been released, formatted. */
	amount: string;
	facts: PaymentFact[];
	note: string | null;
}) {
	await sendPaymentEmail({
		to: options.to,
		subject: 'Your WinPeak withdrawal was declined',
		preview: `Your ${options.amount} withdrawal did not go through and the funds are back in your balance.`,
		title: 'Withdrawal declined',
		intro: `Your ${options.amount} withdrawal did not go through. The full amount has been released back into your balance, so it is yours to play with or withdraw again.`,
		facts: options.facts,
		note: options.note,
		ctaLabel: 'View your account',
		footnote: 'Nothing has left your account. Contact support if you would like a hand with this.'
	});
}
