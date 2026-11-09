/**
 * The networks players can deposit and withdraw on. Mirrors `PAY_CURRENCIES` in
 * the player site's `lib/payments/config.ts` — the two lists have to agree, or
 * staff would configure a receiving wallet for a coin no wallet form offers.
 *
 * Safe to import from client components: no server-only dependencies.
 */

export const PAY_CURRENCIES = [
	{ id: 'usdttrc20', label: 'USDT (TRC20)' },
	{ id: 'usdterc20', label: 'USDT (ERC20)' },
	{ id: 'usdtbsc', label: 'USDT (BEP20)' },
	{ id: 'btc', label: 'Bitcoin' },
	{ id: 'eth', label: 'Ethereum' },
	{ id: 'ltc', label: 'Litecoin' }
] as const;

export type PayCurrency = (typeof PAY_CURRENCIES)[number]['id'];

export function isPayCurrency(value: string): value is PayCurrency {
	return PAY_CURRENCIES.some((coin) => coin.id === value);
}

export function payCurrencyLabel(id: string) {
	return PAY_CURRENCIES.find((coin) => coin.id === id)?.label || id.toUpperCase();
}

/**
 * The block explorer page for a transaction, or '' when the network is unknown
 * or the hash is not a well-formed 64-hex-digit id. The hash is typed by the
 * player, so anything else (a pasted URL, a typo) is never turned into a link.
 */
export function explorerTxUrl(payCurrency: string, txHash: string) {
	const hash = txHash.trim();

	if (!/^(0x)?[0-9a-fA-F]{64}$/.test(hash)) return '';

	const bare = hash.replace(/^0x/, '');

	switch (payCurrency.toLowerCase()) {
		case 'usdttrc20':
			return `https://tronscan.org/#/transaction/${bare}`;
		case 'usdterc20':
		case 'eth':
			return `https://etherscan.io/tx/0x${bare}`;
		case 'usdtbsc':
			return `https://bscscan.com/tx/0x${bare}`;
		case 'btc':
			return `https://mempool.space/tx/${bare}`;
		case 'ltc':
			return `https://blockchair.com/litecoin/transaction/${bare}`;
		default:
			return '';
	}
}

/**
 * Currencies with no minor unit in everyday use, so a local figure is only ever
 * whole. Mirrors `ZERO_DECIMAL` in the player site's `lib/payments/local-config.ts`.
 */
const ZERO_DECIMAL = new Set([
	'BIF',
	'CLP',
	'COP',
	'IDR',
	'ISK',
	'JPY',
	'KRW',
	'MMK',
	'PYG',
	'UGX',
	'VND',
	'XAF',
	'XOF'
]);

export function localDecimals(currency: string) {
	return ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
}
