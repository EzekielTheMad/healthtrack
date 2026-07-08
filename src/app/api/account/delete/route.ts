/**
 * POST /api/account/delete — permanently deletes the signed-in user's
 * account (replaces the legacy `delete_own_account()` RPC (migration 009)).
 *
 * Requires recent authentication (same 5-minute window as data export): the
 * client should have the user re-enter their password immediately before
 * calling this, minting a fresh session.
 */
import { NextResponse } from 'next/server';
import { getSessionInfo, UnauthorizedError } from '@/lib/auth/session';
import { deleteAccount } from '@/lib/auth/delete-account';
import { isRecentlyAuthenticated } from '@/lib/require-recent-auth';

const SESSION_COOKIES = [
  'better-auth.session_token',
  '__Secure-better-auth.session_token',
];

export async function POST() {
  try {
    const info = await getSessionInfo();
    if (!info) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    if (!isRecentlyAuthenticated(info.session)) {
      const message =
        'Please sign in again before deleting your account.';
      return NextResponse.json(
        { error: message, message, code: 'reauth_required', status: 403 },
        { status: 403 },
      );
    }

    await deleteAccount(info.user.id);

    // Sessions are already gone (FK cascade); expire the cookie so the
    // proxy's presence check stops admitting this browser.
    const response = NextResponse.json({ success: true });
    for (const name of SESSION_COOKIES) {
      response.cookies.set(name, '', { maxAge: 0, path: '/' });
    }
    return response;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Account deletion failed:', error);
    return NextResponse.json(
      { error: 'Failed to delete account' },
      { status: 500 },
    );
  }
}
