export function money(value: { toString(): string } | number | string | null | undefined) {
	if (value === null || value === undefined || value === '') {
		return 0;
	}

	return Number(Number(value.toString()).toFixed(4));
}

/** Symbols staff read every day that Intl has no narrow form for, so it would print the code. */
const SYMBOL_OVERRIDES: Record<string, string> = {
	KES: 'KSh',
	UGX: 'USh',
	TZS: 'TSh'
};

const symbolCache = new Map<string, string>();

/**
 * `$`, `₦`, `GH₵`… falling back to the ISO code where no symbol is known.
 *
 * `en-US` only carries a symbol for the currencies it trades in, so every local
 * market would otherwise print as its code. The narrow form is the one that
 * reaches them.
 */
export function currencySymbol(currency: string) {
	const code = (currency || 'USD').toUpperCase();
	const cached = symbolCache.get(code);

	if (cached) {
		return cached;
	}

	let symbol = SYMBOL_OVERRIDES[code];

	if (!symbol) {
		try {
			symbol =
				new Intl.NumberFormat('en-US', {
					style: 'currency',
					currency: code,
					currencyDisplay: 'narrowSymbol'
				})
					.formatToParts(0)
					.find((part) => part.type === 'currency')?.value || code;
		} catch {
			symbol = code;
		}
	}

	symbolCache.set(code, symbol);

	return symbol;
}

/** `decimals` is for local currencies with no minor unit, where cents read as a typo. */
export function formatMoney(value: number, currency = 'USD', decimals = 2) {
	const amount = value || 0;
	const number = Math.abs(amount).toLocaleString('en-US', {
		minimumFractionDigits: decimals,
		maximumFractionDigits: decimals
	});
	const symbol = currencySymbol(currency);
	// "₦1,000.00" but "KSh 1,000.00", so a lettered symbol does not run into the digits.
	const gap = /[A-Za-z]$/.test(symbol) ? ' ' : '';

	return `${amount < 0 ? '-' : ''}${symbol}${gap}${number}`;
}

export function slugify(value: string) {
	return value
		.toLowerCase()
		.trim()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
}
