import { isSignedIn } from '@/lib/auth';
import { listPendingDeposits } from '@/lib/deposits';

export const dynamic = 'force-dynamic';

export async function GET() {
	if (!(await isSignedIn())) {
		return Response.json({ error: 'Signed out' }, { status: 401 });
	}

	return Response.json({ deposits: await listPendingDeposits() }, { headers: { 'Cache-Control': 'no-store' } });
}
