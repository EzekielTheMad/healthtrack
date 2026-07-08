import { NextRequest, NextResponse } from 'next/server';
import { getSessionInfo } from '@/lib/auth/session';
import { apiError } from '@/lib/api-error';
import { isRecentlyAuthenticated } from '@/lib/require-recent-auth';
import { rowToSnake, rowsToSnake } from '@/lib/api/snake';
import { getProfile } from '@/lib/repos/profiles';
import { listMedications } from '@/lib/repos/medications';
import { listConditions } from '@/lib/repos/conditions';
import { listLabVisitsWithResults } from '@/lib/repos/labs';
import { listVitals } from '@/lib/repos/vitals';
import { listAppointments } from '@/lib/repos/appointments';
import { listNotes } from '@/lib/repos/notes';
import { listProviders } from '@/lib/repos/providers';

export async function GET(request: NextRequest) {
  const info = await getSessionInfo();

  if (!info) {
    return apiError(401, 'unauthorized', 'Authentication required');
  }

  // Require recent re-authentication for data export (sensitive action):
  // the Better Auth session must have been created within the last 5 minutes
  // (same window the old last_sign_in_at check used).
  if (!isRecentlyAuthenticated(info.session)) {
    return apiError(
      403,
      'reauth_required',
      'Please re-enter your password before exporting data.',
    );
  }

  const userId = info.user.id;
  const format = request.nextUrl.searchParams.get('format') ?? 'json';

  if (format !== 'json') {
    return apiError(400, 'bad_request', 'Only JSON format is currently supported');
  }

  try {
    const ninetyDaysAgo = new Date();
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const ninetyDaysAgoISO = ninetyDaysAgo.toISOString();

    // Everything the account owns, across own + dependent scopes — the
    // legacy export filtered on user_id only.
    const scope = { ownerId: userId, dependentId: 'all' as const };

    const [
      profile,
      medications,
      conditions,
      labVisitsWithResults,
      vitals,
      appointments,
      notes,
      providers,
    ] = await Promise.all([
      getProfile(userId, userId),
      listMedications(userId, scope), // created_at desc
      listConditions(userId, scope), // created_at desc
      listLabVisitsWithResults(userId, scope), // visit_date desc
      listVitals(userId, scope, { startDate: ninetyDaysAgoISO }), // recorded_at desc
      listAppointments(userId, scope), // appointment_date desc
      listNotes(userId, scope), // recorded_at desc
      listProviders(userId, scope), // sorted by name below (legacy: name asc)
    ]);

    // Nest lab_results under their lab_visits (legacy key: `results`,
    // ordered created_at desc)
    const labVisits = labVisitsWithResults.map(({ labResults, ...visit }) => ({
      ...rowToSnake(visit),
      results: rowsToSnake(
        [...labResults].sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
      ),
    }));

    const exportDate = new Date().toISOString().split('T')[0];

    const exportPayload = {
      metadata: {
        exported_at: new Date().toISOString(),
        user_id: userId,
        version: '1.0',
        vitals_window: 'last_90_days',
      },
      profile: profile ? rowToSnake(profile) : null,
      medications: rowsToSnake(medications),
      conditions: rowsToSnake(conditions),
      lab_visits: labVisits,
      vitals: rowsToSnake(vitals),
      appointments: rowsToSnake(appointments),
      notes: rowsToSnake(notes),
      providers: rowsToSnake(
        [...providers].sort((a, b) => a.name.localeCompare(b.name)),
      ),
    };

    return NextResponse.json(exportPayload, {
      headers: {
        'Content-Disposition': `attachment; filename="healthtrack-export-${exportDate}.json"`,
      },
    });
  } catch {
    return apiError(500, 'internal_error', 'Failed to export data');
  }
}
