/**
 * Account deletion — replaces the legacy `delete_own_account()` RPC
 * (migration 009).
 *
 * Order matters:
 * 1. Null out `dependents.transitioned_to` pointing at this user in ANY
 *    owner's rows — that FK has no delete action and would block step 2.
 * 2. Delete the Better Auth `user` row. ON DELETE CASCADE wipes every
 *    domain table plus session/account rows; delegates.delegate_user_id
 *    is SET NULL per schema.
 * 3. Remove the user's uploads directory (may not exist yet — force).
 *
 * Steps 1–2 run in one SQLite transaction. The row delete is done with
 * drizzle directly (not auth.api.deleteUser) so it participates in the
 * same transaction as the FK fix; the DB effect is identical since all
 * Better Auth tables cascade from `user`.
 */
import fs from 'fs';
import path from 'path';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { user, dependents } from '@/db/schema';
import { getUploadsDir } from '@/lib/runtime/paths';

export async function deleteAccount(userId: string): Promise<void> {
  db.transaction((tx) => {
    tx.update(dependents)
      .set({ transitionedTo: null })
      .where(eq(dependents.transitionedTo, userId))
      .run();
    const deleted = tx.delete(user).where(eq(user.id, userId)).run();
    if (deleted.changes === 0) {
      throw new Error(`Account deletion failed: user ${userId} not found`);
    }
  });

  // Path is built from our own user id (not client input); resolve defensively anyway.
  const uploadsRoot = getUploadsDir();
  const userUploads = path.resolve(uploadsRoot, userId);
  if (userUploads.startsWith(uploadsRoot + path.sep)) {
    await fs.promises.rm(userUploads, { recursive: true, force: true });
  }
}
