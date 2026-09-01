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
  { value: 'write:vitals', label: 'Write Vitals', description: 'Write vitals & device metrics' },
  { value: 'read:fitness', label: 'Read Fitness', description: 'Read workouts, exercises, check-ins & goals' },
  { value: 'write:fitness', label: 'Write Fitness', description: 'Write workouts, exercises, check-ins & goals' },
  { value: 'read:nutrition', label: 'Read Nutrition', description: 'Read daily nutrition totals' },
  // Narrow ingest scope for the Life Dashboard companion app. It admits the
  // Health Connect receiver and NOTHING else — no clinical writes, no vitals
  // or fitness writes — so a phone token cannot become a general write token.
  { value: 'write:health_connect', label: 'Write Health Connect', description: 'Deliver Health Connect webhooks (phone relay only)' },
  // Read counterpart, deliberately SEPARATE from the ingest scope: the token
  // pasted into a phone can deliver records but must not be able to read the
  // retained history back out. `read:all` satisfies this; write:health_connect
  // never does.
  { value: 'read:health_connect', label: 'Read Health Connect', description: 'Read the Health Connect source inventory and retained raw records' },
  { value: 'read:labs', label: 'Read Labs', description: 'Read lab results' },
  { value: 'read:procedures', label: 'Read Procedures', description: 'Read procedures history' },
  { value: 'read:vaccines', label: 'Read Vaccines', description: 'Read vaccine records' },
  { value: 'read:providers', label: 'Read Providers', description: 'Read healthcare providers' },
  { value: 'read:profile', label: 'Read Profile', description: 'Read profile (DOB, height, weight)' },
] as const;

export type ScopeValue = typeof AVAILABLE_SCOPES[number]['value'];
