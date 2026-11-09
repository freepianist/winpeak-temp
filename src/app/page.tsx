import { isSignedIn } from '@/lib/auth';
import { listPendingDeposits, listReceivingAddresses } from '@/lib/deposits';
import { logout } from './actions';
import { DepositBoard } from './deposit-board';
import { LogOutIcon } from './icons';
import { LoginForm } from './login-form';

export const dynamic = 'force-dynamic';

export default async function Page() {
	if (!(await isSignedIn())) {
		return <LoginForm />;
	}

	const [deposits, wallets] = await Promise.all([listPendingDeposits(), listReceivingAddresses()]);

	return (
		<div className="shell">
			<header className="topbar">
				<div className="brand">
					<img src="/brand.png" alt="" />
					<span>Deposit Requests</span>
				</div>
				<form action={logout}>
					<button type="submit" className="btn btn-ghost btn-sm">
						<LogOutIcon size={15} />
						Sign out
					</button>
				</form>
			</header>
			<main className="content">
				<DepositBoard initial={deposits} wallets={wallets} />
			</main>
		</div>
	);
}
