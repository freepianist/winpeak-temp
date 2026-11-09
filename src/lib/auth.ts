import { createHmac, timingSafeEqual } from 'crypto';
import { cookies } from 'next/headers';

const COOKIE = 'wpt_session';

function password() {
	const value = process.env.DASHBOARD_PASSWORD;
	if (!value) {
		throw new Error('DASHBOARD_PASSWORD is not set');
	}
	return value;
}

function token() {
	return createHmac('sha256', password()).update('winpeak-temp-session').digest('hex');
}

function same(a: string, b: string) {
	const left = Buffer.from(a);
	const right = Buffer.from(b);
	return left.length === right.length && timingSafeEqual(left, right);
}

export async function isSignedIn() {
	const value = (await cookies()).get(COOKIE)?.value;
	return Boolean(value) && same(value!, token());
}

export async function signIn(attempt: string) {
	if (!same(attempt, password())) {
		return false;
	}

	(await cookies()).set(COOKIE, token(), {
		httpOnly: true,
		sameSite: 'strict',
		secure: process.env.NODE_ENV === 'production',
		path: '/',
		maxAge: 60 * 60 * 12
	});
	return true;
}

export async function signOut() {
	(await cookies()).delete(COOKIE);
}
