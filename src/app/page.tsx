import { isSignedIn } from '@/lib/auth';
import { listPendingDeposits } from '@/lib/deposits';
import { logout } from './actions';
import { DepositTable, LoginForm } from './components';

export const dynamic = 'force-dynamic';

export default async function Page() {
	if (!(await isSignedIn())) {
		return <LoginForm />;
	}

	const deposits = await listPendingDeposits();

	return (
		<main>
			<header>
				<h1>Deposit requests</h1>
				<form action={logout}>
					<button type="submit" className="link">
						Sign out
					</button>
				</form>
			</header>
			<DepositTable initial={deposits} />
		</main>
	);
}
