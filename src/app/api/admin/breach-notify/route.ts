import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'crypto';
import { db } from '@/db';
import { user, breachEvents, breachNotifications } from '@/db/schema';
import { getUser } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { safeError } from '@/lib/safe-log';

function safeBearerEquals(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * POST /api/admin/breach-notify
 *
 * Admin-only endpoint. Two accepted credentials (either suffices):
 *   1. ADMIN_API_KEY bearer header — the pre-migration mechanism, preserved
 *      for scripted/off-session use;
 *   2. a signed-in session whose user has role 'admin' (breach tables were
 *      service-role-only under RLS; the instance admin replaces that role).
 *
 * Creates a breach event and queues notification rows for every user.
 *
 * FTC Health Breach Notification Rule: must notify affected individuals
 * within 60 calendar days of discovering a breach. This endpoint handles
 * step 1 (recording the breach and queuing notifications). Actual email
 * delivery should be handled by a scheduled job that reads
 * breach_notifications WHERE notified_at IS NULL.
 *
 * Body: { title: string, description: string }
 */
export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const adminKey = process.env.ADMIN_API_KEY;

  let authorized = false;

  if (
    adminKey &&
    authHeader?.startsWith('Bearer ') &&
    safeBearerEquals(authHeader.slice(7), adminKey)
  ) {
    authorized = true;
  }

  if (!authorized) {
    const sessionUser = await getUser();
    if (sessionUser?.role === 'admin') {
      authorized = true;
    }
  }

  if (!authorized) {
    return apiError(401, 'unauthorized', 'Invalid admin credentials');
  }

  try {
    const body = await request.json();
    const { title, description } = body as {
      title?: string;
      description?: string;
    };

    if (!title || !description) {
      return apiError(400, 'validation_error', 'Title and description are required');
    }

    // 1. Create the breach event
    let eventId: string;
    try {
      const [event] = await db
        .insert(breachEvents)
        .values({ title, description, discoveredAt: new Date().toISOString() })
        .returning({ id: breachEvents.id });
      eventId = event.id;
    } catch (eventError) {
      safeError('Failed to create breach event', eventError);
      return apiError(500, 'db_error', 'Failed to create breach event');
    }

    // 2. Fetch all user emails
    let users: { id: string; email: string | null }[];
    try {
      users = await db.select({ id: user.id, email: user.email }).from(user);
    } catch (usersError) {
      safeError('Failed to list users for breach notification', usersError);
      return apiError(500, 'db_error', 'Failed to fetch user list');
    }

    if (users.length === 0) {
      return NextResponse.json({
        breach_event_id: eventId,
        notifications_queued: 0,
      });
    }

    // 3. Queue a notification row for each user
    const notificationRows = users
      .filter((u) => u.email) // Only users with email addresses
      .map((u) => ({
        breachEventId: eventId,
        userId: u.id,
        userEmail: u.email!,
        notifiedAt: null,
      }));

    try {
      if (notificationRows.length > 0) {
        await db.insert(breachNotifications).values(notificationRows);
      }
    } catch (insertError) {
      safeError('Failed to queue breach notifications', insertError);
      return apiError(500, 'db_error', 'Failed to queue notifications');
    }

    return NextResponse.json({
      breach_event_id: eventId,
      notifications_queued: notificationRows.length,
      message: `Breach event recorded. ${notificationRows.length} users queued for notification.`,
    });
  } catch (err) {
    safeError('Breach notification error', err);
    return apiError(500, 'internal_error', 'Failed to process breach notification');
  }
}
