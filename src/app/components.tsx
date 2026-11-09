'use client';

import { useActionState, useCallback, useEffect, useRef, useState, useTransition } from 'react';
import type { PendingDeposit } from '@/lib/deposits';
import { approve, login } from './actions';

const POLL_MS = 5_000;

type DesktopBridge = {
	notify: (title: string, body: string) => void;
	setPendingCount: (count: number) => void;
};

declare global {
	interface Window {
		desktop?: DesktopBridge;
	}
}

function notify(title: string, body: string) {
	if (window.desktop) {
		window.desktop.notify(title, body);
		return;
	}
	if ('Notification' in window && Notification.permission === 'granted') {
		new Notification(title, { body });
	}
}

function shortHash(hash: string) {
	return hash.length > 20 ? `${hash.slice(0, 10)}…${hash.slice(-8)}` : hash;
}

export function LoginForm() {
	const [error, action, pending] = useActionState(login, null);

	return (
		<form action={action} className="login">
			<h1>Deposit requests</h1>
			<input type="password" name="password" placeholder="Password" autoFocus required />
			<button type="submit" disabled={pending}>
				{pending ? 'Signing in…' : 'Sign in'}
			</button>
			{error ? <p className="error">{error}</p> : null}
		</form>
	);
}

export function DepositTable({ initial }: { initial: PendingDeposit[] }) {
	const [deposits, setDeposits] = useState(initial);
	const known = useRef(new Set(initial.map((deposit) => deposit.id)));

	const refresh = useCallback(async () => {
		const response = await fetch('/api/pending', { cache: 'no-store' }).catch(() => null);

		if (response?.status === 401) {
			notify('Signed out', 'Sign in again to keep getting deposit alerts.');
			window.location.reload();
			return;
		}
		if (!response?.ok) {
			return;
		}

		const { deposits: next } = (await response.json()) as { deposits: PendingDeposit[] };
		const fresh = next.filter((deposit) => !known.current.has(deposit.id));

		if (fresh.length === 1) {
			notify('New deposit request', `${fresh[0].name} · ${shortHash(fresh[0].txHash)}`);
		} else if (fresh.length > 1) {
			notify(`${fresh.length} new deposit requests`, fresh.map((deposit) => deposit.name).join(', '));
		}

		known.current = new Set(next.map((deposit) => deposit.id));
		setDeposits(next);
	}, []);

	useEffect(() => {
		if (!window.desktop && 'Notification' in window && Notification.permission === 'default') {
			void Notification.requestPermission();
		}
		if (initial.length > 0) {
			notify('Deposits waiting', `${initial.length} pending deposit request${initial.length === 1 ? '' : 's'}`);
		}

		const timer = window.setInterval(refresh, POLL_MS);
		return () => window.clearInterval(timer);
	}, [initial.length, refresh]);

	useEffect(() => {
		document.title = deposits.length ? `(${deposits.length}) Deposit requests` : 'Deposit requests';
		window.desktop?.setPendingCount(deposits.length);
	}, [deposits.length]);

	return (
		<table>
			<thead>
				<tr>
					<th>Name</th>
					<th>Tx hash</th>
					<th />
				</tr>
			</thead>
			<tbody>
				{deposits.length === 0 ? (
					<tr>
						<td colSpan={3} className="empty">
							No pending deposits
						</td>
					</tr>
				) : (
					deposits.map((deposit) => (
						<tr key={deposit.id}>
							<td>{deposit.name}</td>
							<td className="hash">{deposit.txHash}</td>
							<td className="action">
								<ApproveButton id={deposit.id} name={deposit.name} onApproved={refresh} />
							</td>
						</tr>
					))
				)}
			</tbody>
		</table>
	);
}

function ApproveButton({ id, name, onApproved }: { id: string; name: string; onApproved: () => Promise<void> }) {
	const [pending, startTransition] = useTransition();
	const [error, setError] = useState<string | null>(null);

	const onClick = () => {
		if (!window.confirm(`Approve the deposit from ${name}?`)) {
			return;
		}
		setError(null);
		startTransition(async () => {
			const result = await approve(id);
			if (result.error) {
				setError(result.error);
				return;
			}
			await onApproved();
		});
	};

	return (
		<>
			<button type="button" onClick={onClick} disabled={pending}>
				{pending ? 'Approving…' : 'Approve'}
			</button>
			{error ? <div className="error">{error}</div> : null}
		</>
	);
}
