import { createHash } from 'node:crypto';
import { buildDoctorSummary } from '@/lib/doctor-summary';
import { MobileDeviceError, ownedMobileSubjects, requireMobileDevice } from './devices';

/** JSON and PDF share this DTO and fingerprint. Generation time never changes the content hash. */
export async function mobileDoctorBundle(request: Request) {
  const device = await requireMobileDevice(request, 'read:doctor_summary');
  const subjectId = new URL(request.url).searchParams.get('subject');
  if (!subjectId || !device.allowedSubjects.includes(subjectId))
    throw new MobileDeviceError(404, 'subject_unavailable');
  const subject = ownedMobileSubjects(device.userId).find((s) => s.id === subjectId);
  if (!subject) throw new MobileDeviceError(404, 'subject_unavailable');
  const summary = await buildDoctorSummary(device.userId, subjectId === 'self' ? null : subjectId);
  // Recheck after async reads. A revocation/replacement or grant edit cannot yield a stale authorized bundle.
  const current = await requireMobileDevice(request, 'read:doctor_summary');
  if (
    current.id !== device.id ||
    current.grantRevision !== device.grantRevision ||
    !current.allowedSubjects.includes(subjectId)
  )
    throw new MobileDeviceError(409, 'grant_changed');
  const content = {
    schema_version: 1,
    server_url: process.env.APP_URL,
    user_id: device.userId,
    subject,
    grant_revision: current.grantRevision,
    allowed_subjects: current.allowedSubjects,
    summary,
  };
  const fingerprint = createHash('sha256').update(JSON.stringify(content)).digest('hex');
  return {
    schema_version: 1,
    subject,
    generated_at: new Date().toISOString(),
    fingerprint,
    grant_revision: current.grantRevision,
    summary,
  };
}
