/**
 * GET /api/files/<ownerId>/<file> — authenticated download of stored uploads
 * (lab PDFs / images), replacing the hosted storage bucket's signed URLs.
 *
 * Authorization: the first path segment is the owning user id, but lab PDFs
 * can belong to dependent-scoped lab visits, so ownership alone is not the
 * whole story. If a lab_visits row references this path, the actor must pass
 * the labs 'read' check for THAT visit's scope (owner, accepted share with
 * exact dependent match, or delegate). If no row references the file (e.g. a
 * parse that was never saved as a visit), only the owner may fetch it.
 * Denials and traversal probes are indistinguishable from missing files (404).
 */
import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db';
import { labVisits } from '@/db/schema';
import { requireUser } from '@/lib/auth/session';
import { requireAuthz, NotFoundError } from '@/lib/authz';
import { errorResponse } from '@/lib/api/respond';
import { readUpload, UploadNotFoundError } from '@/lib/storage';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  try {
    const user = await requireUser();
    const { path: segments } = await context.params;
    if (!segments || segments.length < 2) throw new NotFoundError();
    const relPath = segments.join('/');

    // Resolve the owning record: a lab visit referencing this path decides
    // the authz scope (its user_id + dependent_id).
    const [visit] = await db
      .select({ userId: labVisits.userId, dependentId: labVisits.dependentId })
      .from(labVisits)
      .where(eq(labVisits.sourcePdfPath, relPath))
      .limit(1);

    if (visit) {
      await requireAuthz(
        user.id,
        { ownerId: visit.userId, dependentId: visit.dependentId },
        'labs',
        'read',
      );
    } else if (segments[0] !== user.id) {
      // Unreferenced file: owner-only.
      throw new NotFoundError();
    }

    const { data, mime, size } = await readUpload(relPath);
    const filename = segments[segments.length - 1];
    return new NextResponse(new Uint8Array(data), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Content-Disposition': `inline; filename="${filename}"`,
        // Medical documents: never let a shared cache hold these.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (error) {
    if (error instanceof UploadNotFoundError) {
      return errorResponse(new NotFoundError());
    }
    return errorResponse(error);
  }
}
