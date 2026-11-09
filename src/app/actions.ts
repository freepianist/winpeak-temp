'use server';

import { revalidatePath } from 'next/cache';
import { isSignedIn, signIn, signOut } from '@/lib/auth';
import { approveManualDeposit } from '@/lib/deposits';

export async function login(_prev: string | null, formData: FormData) {
	const ok = await signIn(String(formData.get('password') || ''));
	if (!ok) {
		return 'Wrong password';
	}
	revalidatePath('/');
	return null;
}

export async function logout() {
	await signOut();
	revalidatePath('/');
}

export async function approve(requestId: string) {
	if (!(await isSignedIn())) {
		return { error: 'Signed out. Reload and sign in again.' };
	}

	try {
		await approveManualDeposit(requestId, process.env.REVIEWER_NAME || 'winpeak-temp');
	} catch (error) {
		return { error: error instanceof Error ? error.message : 'Could not approve' };
	}

	revalidatePath('/');
	return { error: null };
}
