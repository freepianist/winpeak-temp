'use client';

import { useActionState, useState, useTransition } from 'react';
import { approve, login } from './actions';

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

export function ApproveButton({ id, name }: { id: string; name: string }) {
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
			}
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
