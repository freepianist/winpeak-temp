import { isSignedIn } from '@/lib/auth';
import { listPendingDeposits } from '@/lib/deposits';
import { logout } from './actions';
import { ApproveButton, LoginForm } from './components';

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
									<ApproveButton id={deposit.id} name={deposit.name} />
								</td>
							</tr>
						))
					)}
				</tbody>
			</table>
		</main>
	);
}
