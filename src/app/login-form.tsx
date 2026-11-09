'use client';

import { useActionState } from 'react';
import { login } from './actions';
import { AlertIcon, LockIcon } from './icons';

export function LoginForm() {
	const [error, action, pending] = useActionState(login, null);

	return (
		<div className="login-screen">
			<form action={action} className="login-card">
				<img src="/brand.png" alt="" className="login-logo" />
				<h1>Deposit Requests</h1>
				<p className="login-sub">Sign in to review and approve deposits</p>

				<label className="field">
					<LockIcon />
					<input type="password" name="password" placeholder="Password" autoFocus required />
				</label>

				<button type="submit" className="btn btn-primary btn-block" disabled={pending}>
					{pending ? <span className="spinner" /> : null}
					{pending ? 'Signing in' : 'Sign in'}
				</button>

				{error ? (
					<p className="form-error">
						<AlertIcon size={14} />
						{error}
					</p>
				) : null}
			</form>
		</div>
	);
}
