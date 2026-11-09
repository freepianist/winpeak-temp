'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { PendingDeposit, ReceivingAddress } from '@/lib/deposits';
import { approve } from './actions';
import { AlertIcon, CheckIcon, CopyIcon, InboxIcon, WalletIcon } from './icons';

const POLL_MS = 5_000;
const FRESH_MS = 8_000;

type DesktopBridge = {
	notify: (title: string, body: string) => void;
	setPendingCount: (count: number) => void;
};

declare global {
	interface Window {
		desktop?: DesktopBridge;
	}
}

type Toast = { id: number; kind: 'success' | 'error'; title: string; body?: string };

function notify(title: string, body: string) {
	if (window.desktop) {
		window.desktop.notify(title, body);
		return;
	}
	if ('Notification' in window && Notification.permission === 'granted') {
		new Notification(title, { body, icon: '/brand.png' });
	}
}

function shortHash(hash: string) {
	return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}

function initials(name: string) {
	const parts = name.split(/\s+/).filter(Boolean);
	return ((parts[0]?.[0] || '') + (parts[1]?.[0] || '')).toUpperCase() || '?';
}

function hue(text: string) {
	let h = 0;
	for (const char of text) h = (h * 31 + char.charCodeAt(0)) % 360;
	return h;
}

function since(date: Date | null, now: number) {
	if (!date) return 'connecting';
	const seconds = Math.max(0, Math.round((now - date.getTime()) / 1000));
	return seconds < 2 ? 'just now' : `${seconds}s ago`;
}

function CopyField(props: {
	value: string;
	label: string;
	tags?: string[];
	onCopy: (value: string, label: string) => void;
}) {
	const { value, label, tags = [], onCopy } = props;

	return (
		<div className="copy-field">
			<div className="field-head">
				<span className="caption">{label}</span>
				{tags.map((tag) => (
					<span key={tag} className="network">
						{tag}
					</span>
				))}
			</div>
			<div className="copy-line">
				<code title={value}>{value || '—'}</code>
				{value ? (
					<button type="button" className="icon-btn" onClick={() => onCopy(value, label)} title={`Copy ${label.toLowerCase()}`}>
						<CopyIcon size={14} />
					</button>
				) : null}
			</div>
		</div>
	);
}

export function DepositBoard({ initial, wallets }: { initial: PendingDeposit[]; wallets: ReceivingAddress[] }) {
	const [deposits, setDeposits] = useState(initial);
	const [fresh, setFresh] = useState<Set<string>>(new Set());
	const [leaving, setLeaving] = useState<Set<string>>(new Set());
	const [lastSync, setLastSync] = useState<Date | null>(new Date());
	const [online, setOnline] = useState(true);
	const [now, setNow] = useState(() => Date.now());
	const [confirming, setConfirming] = useState<PendingDeposit | null>(null);
	const [approving, setApproving] = useState<string | null>(null);
	const [toasts, setToasts] = useState<Toast[]>([]);
	const known = useRef(new Set(initial.map((deposit) => deposit.id)));
	const toastId = useRef(0);

	const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
		const id = ++toastId.current;
		setToasts((current) => [...current, { ...toast, id }]);
		window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), 4_500);
	}, []);

	const refresh = useCallback(async () => {
		const response = await fetch('/api/pending', { cache: 'no-store' }).catch(() => null);

		if (response?.status === 401) {
			notify('Signed out', 'Sign in again to keep getting deposit alerts.');
			window.location.reload();
			return;
		}
		if (!response?.ok) {
			setOnline(false);
			return;
		}

		const { deposits: next } = (await response.json()) as { deposits: PendingDeposit[] };
		const arrived = next.filter((deposit) => !known.current.has(deposit.id));

		if (arrived.length === 1) {
			notify('New deposit request', `${arrived[0].name} · ${shortHash(arrived[0].txHash)}`);
		} else if (arrived.length > 1) {
			notify(`${arrived.length} new deposit requests`, arrived.map((deposit) => deposit.name).join(', '));
		}

		if (arrived.length) {
			const ids = arrived.map((deposit) => deposit.id);
			setFresh((current) => new Set([...current, ...ids]));
			window.setTimeout(() => {
				setFresh((current) => new Set([...current].filter((id) => !ids.includes(id))));
			}, FRESH_MS);
		}

		known.current = new Set(next.map((deposit) => deposit.id));
		setDeposits(next);
		setOnline(true);
		setLastSync(new Date());
	}, []);

	useEffect(() => {
		if (!window.desktop && 'Notification' in window && Notification.permission === 'default') {
			void Notification.requestPermission();
		}
		if (initial.length > 0) {
			notify('Deposits waiting', `${initial.length} pending deposit request${initial.length === 1 ? '' : 's'}`);
		}

		const poll = window.setInterval(refresh, POLL_MS);
		const clock = window.setInterval(() => setNow(Date.now()), 1_000);
		return () => {
			window.clearInterval(poll);
			window.clearInterval(clock);
		};
	}, [initial.length, refresh]);

	useEffect(() => {
		document.title = deposits.length ? `(${deposits.length}) Deposit requests` : 'Deposit requests';
		window.desktop?.setPendingCount(deposits.length);
	}, [deposits.length]);

	useEffect(() => {
		if (!confirming) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === 'Escape' && !approving) setConfirming(null);
		};
		window.addEventListener('keydown', onKey);
		return () => window.removeEventListener('keydown', onKey);
	}, [confirming, approving]);

	const confirmApprove = async () => {
		if (!confirming) return;
		const deposit = confirming;
		setApproving(deposit.id);

		const result = await approve(deposit.id).catch(() => ({ error: 'Network error. Try again.' }));

		setApproving(null);
		setConfirming(null);

		if (result.error) {
			pushToast({ kind: 'error', title: 'Could not approve', body: result.error });
			return;
		}

		pushToast({ kind: 'success', title: 'Deposit approved', body: `${deposit.name} has been credited` });
		setLeaving((current) => new Set(current).add(deposit.id));
		window.setTimeout(() => {
			setDeposits((current) => current.filter((item) => item.id !== deposit.id));
			setLeaving((current) => {
				const next = new Set(current);
				next.delete(deposit.id);
				return next;
			});
			void refresh();
		}, 350);
	};

	const copy = async (value: string, label: string) => {
		try {
			await navigator.clipboard.writeText(value);
			pushToast({ kind: 'success', title: `${label} copied` });
		} catch {
			pushToast({ kind: 'error', title: 'Could not copy' });
		}
	};

	return (
		<>
			<section className="wallets">
				<div className="section-title">
					<WalletIcon size={16} />
					<h2>Receiving addresses</h2>
				</div>
				{wallets.length === 0 ? (
					<p className="muted">No receiving wallets are enabled right now.</p>
				) : (
					<div className="wallet-grid">
						{wallets.map((wallet) => (
							<div key={wallet.address} className="wallet-card">
								<CopyField value={wallet.address} label="Address" tags={wallet.networks} onCopy={copy} />
							</div>
						))}
					</div>
				)}
			</section>

			<section className="board-head">
				<div>
					<h2>Pending deposits</h2>
					<p className="muted">Manual crypto deposits waiting for review</p>
				</div>
				<div className="board-stats">
					<div className={`live ${online ? '' : 'live-off'}`}>
						<span className="live-dot" />
						{online ? 'Live' : 'Reconnecting'}
						<span className="live-time">· {since(lastSync, now)}</span>
					</div>
					<div className="count-pill">
						<span>{deposits.length}</span> pending
					</div>
				</div>
			</section>

			<section className="panel">
				{deposits.length > 0 ? (
					<div className="row row-head">
						<span>Player</span>
						<span>Transaction hash</span>
						<span />
					</div>
				) : null}

				{deposits.length === 0 ? (
					<div className="empty">
						<div className="empty-icon">
							<InboxIcon size={26} />
						</div>
						<h3>All caught up</h3>
						<p className="muted">New deposit requests appear here automatically.</p>
					</div>
				) : (
					deposits.map((deposit) => (
						<div
							key={deposit.id}
							className={`row ${fresh.has(deposit.id) ? 'row-fresh' : ''} ${leaving.has(deposit.id) ? 'row-leaving' : ''}`}
						>
							<div className="player">
								<span className="avatar" style={{ '--h': hue(deposit.name) } as React.CSSProperties}>
									{initials(deposit.name)}
								</span>
								<span className="player-name">{deposit.name}</span>
								{fresh.has(deposit.id) ? <span className="badge-new">New</span> : null}
							</div>
							<CopyField value={deposit.txHash} label="Tx hash" onCopy={copy} />
							<div className="row-action">
								<button
									type="button"
									className="btn btn-primary"
									onClick={() => setConfirming(deposit)}
									disabled={approving === deposit.id}
								>
									<CheckIcon size={15} />
									Approve
								</button>
							</div>
						</div>
					))
				)}
			</section>

			{confirming ? (
				<div className="modal-backdrop" onClick={() => !approving && setConfirming(null)}>
					<div className="modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
						<div className="modal-icon">
							<CheckIcon size={22} />
						</div>
						<h3>Approve this deposit?</h3>
						<p className="muted">The requested amount will be credited to the player&apos;s wallet right away.</p>
						<dl className="modal-details">
							<div>
								<dt>Player</dt>
								<dd>{confirming.name}</dd>
							</div>
							<div>
								<dt>Tx hash</dt>
								<dd>
									<code>{confirming.txHash}</code>
								</dd>
							</div>
						</dl>
						<div className="modal-actions">
							<button type="button" className="btn btn-ghost" onClick={() => setConfirming(null)} disabled={!!approving}>
								Cancel
							</button>
							<button type="button" className="btn btn-primary" onClick={confirmApprove} disabled={!!approving} autoFocus>
								{approving ? <span className="spinner" /> : <CheckIcon size={15} />}
								{approving ? 'Approving' : 'Approve deposit'}
							</button>
						</div>
					</div>
				</div>
			) : null}

			<div className="toasts">
				{toasts.map((toast) => (
					<div key={toast.id} className={`toast toast-${toast.kind}`}>
						<span className="toast-icon">{toast.kind === 'success' ? <CheckIcon size={14} /> : <AlertIcon size={14} />}</span>
						<div>
							<strong>{toast.title}</strong>
							{toast.body ? <p>{toast.body}</p> : null}
						</div>
					</div>
				))}
			</div>
		</>
	);
}
