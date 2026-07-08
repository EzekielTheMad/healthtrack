/**
 * Personal-access-token scopes — shared between the server PAT layer
 * (src/lib/api-auth.ts) and client UI (ApiKeyManager). Kept dependency-free:
 * client components must not pull in the DB via api-auth.
 */
export const AVAILABLE_SCOPES = [
  { value: 'read:all', label: 'Read All', description: 'Read access to all health data' },
  { value: 'write:all', label: 'Write All', description: 'Write access to all health data' },
  { value: 'read:medications', label: 'Read Medications', description: 'Read medication list' },
  { value: 'read:conditions', label: 'Read Conditions', description: 'Read medical conditions' },
  { value: 'read:allergies', label: 'Read Allergies', description: 'Read allergies' },
  { value: 'read:vitals', label: 'Read Vitals', description: 'Read vital signs and trends' },
  { value: 'read:labs', label: 'Read Labs', description: 'Read lab results' },
  { value: 'read:procedures', label: 'Read Procedures', description: 'Read procedures history' },
  { value: 'read:vaccines', label: 'Read Vaccines', description: 'Read vaccine records' },
  { value: 'read:providers', label: 'Read Providers', description: 'Read healthcare providers' },
  { value: 'read:profile', label: 'Read Profile', description: 'Read profile (DOB, height, weight)' },
] as const;

export type ScopeValue = typeof AVAILABLE_SCOPES[number]['value'];
