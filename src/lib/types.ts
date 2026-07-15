// ---------------------------------------------------------------------------
// Enums / Union types
// ---------------------------------------------------------------------------

export type ProviderType =
  | "pcp"
  | "specialist"
  | "lab"
  | "imaging"
  | "urgent_care"
  | "hospital"
  | "pharmacy"
  | "therapist"
  | "dentist"
  | "other";

export type MedicationFrequency =
  | "once_daily"
  | "twice_daily"
  | "three_times_daily"
  | "four_times_daily"
  | "every_other_day"
  | "weekly"
  | "biweekly"
  | "monthly"
  | "as_needed"
  | "other";

export type ConditionStatus = "active" | "resolved" | "managed" | "monitoring";

export type NoteType = "symptom" | "observation" | "general";

export type AlertSeverity = "info" | "warning" | "critical";

export type AccessLevel = "read" | "read_write";

export type DependentRelationship = 'child' | 'spouse' | 'parent' | 'sibling' | 'other';

export type Flag = "normal" | "high" | "low" | "critical";

export type AllergySeverity = 'mild' | 'moderate' | 'severe' | 'life_threatening';

export type DashboardWidgetType = 'vital' | 'lab_result';

export type DelegatePermissionLevel = 'read_only' | 'read_write' | 'admin';
export type DelegateStatus = 'pending' | 'accepted' | 'rejected';
export interface Delegate {
  id: string;
  owner_id: string;
  delegate_user_id: string | null;
  delegate_email: string;
  permission_level: DelegatePermissionLevel;
  status: DelegateStatus;
  invited_at: string;
  accepted_at: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
  owner_display_name?: string;
}

// ---------------------------------------------------------------------------
// Database row types
// ---------------------------------------------------------------------------

export interface Profile {
  id: string;
  display_name: string | null;
  date_of_birth: string | null;
  biological_sex: "male" | "female" | "prefer_not_to_say" | null;
  height_inches: number | null;
  weight_lbs: number | null;
  unit_system: "imperial" | "metric";
  created_at: string;
  updated_at: string;
}

export interface Dependent {
  id: string;
  parent_user_id: string;
  name: string;
  date_of_birth: string;
  biological_sex: 'male' | 'female' | null;
  relationship: DependentRelationship;
  transition_age: number;
  transitioned: boolean;
  transitioned_to: string | null;
  created_at: string;
  updated_at: string;
}

export interface Provider {
  id: string;
  user_id: string;
  name: string;
  provider_type: ProviderType | null;
  specialty: string | null;
  organization: string | null;
  phone: string | null;
  fax: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  portal_url: string | null;
  specialty_taxonomy?: string | null;
  notes: string | null;
  is_favorite: boolean;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Medication {
  id: string;
  user_id: string;
  name: string;
  dosage: string | null;
  frequency: string | null;
  category: string | null;
  prescriber_id: string | null;
  start_date: string | null;
  end_date: string | null;
  active: boolean;
  rxcui?: string | null;
  notes: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface LabVisit {
  id: string;
  user_id: string;
  visit_date: string;
  provider_id: string | null;
  source_pdf_path: string | null;
  notes: string | null;
  dependent_id?: string | null;
  created_at: string;
}

export interface LabResult {
  id: string;
  user_id: string;
  lab_visit_id: string;
  panel_name: string | null;
  test_name: string;
  value: number;
  unit: string | null;
  reference_range_low: number | null;
  reference_range_high: number | null;
  reference_range_text: string | null;
  flag: Flag | null;
  loinc_code?: string | null;
  dependent_id?: string | null;
  created_at: string;
}

export interface Vital {
  id: string;
  user_id: string;
  metric_key: string;
  value: number;
  unit: string | null;
  source: string;
  recorded_at: string;
  metadata: Record<string, unknown>;
  dependent_id?: string | null;
  created_at: string;
}

export interface VitalSourcePreference {
  id: string;
  user_id: string;
  metric_key: string;
  preferred_source: string;
}

export interface VitalReferenceRange {
  id: string;
  metric_key: string;
  label: string;
  unit: string | null;
  range_low: number | null;
  range_high: number | null;
  age_min: number | null;
  age_max: number | null;
  sex: string | null;
  source_citation: string | null;
  created_at: string;
}

export interface QueryHistoryEntry {
  id: string;
  user_id: string;
  query_text: string;
  response_text: string;
  dependent_id?: string | null;
  created_at: string;
}

export interface ConnectedSource {
  id: string;
  user_id: string;
  source_name: string;
  access_token_encrypted: string | null;
  refresh_token_encrypted: string | null;
  token_expires_at: string | null;
  last_sync_at: string | null;
  status: string;
  created_at: string;
}

export interface Condition {
  id: string;
  user_id: string;
  name: string;
  status: ConditionStatus;
  diagnosed_date: string | null;
  provider_id: string | null;
  icd10_code?: string | null;
  notes: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface InteractionAlert {
  id: string;
  user_id: string;
  trigger_medication_id: string;
  alert_text: string;
  severity: AlertSeverity;
  dismissed: boolean;
  /** ISO instant the alert is snoozed until; null/past means it is shown. */
  snoozed_until?: string | null;
  /** Stable key for one interaction (sorted, lowercased med names). */
  signature?: string | null;
  checked_at: string;
  medication_snapshot: Record<string, unknown>;
  dependent_id?: string | null;
}

/** Latest interaction-check outcome for a scope (from GET /interaction-alerts). */
export interface InteractionStatus {
  checked_at: string;
  has_interactions: boolean;
}

export interface Appointment {
  id: string;
  user_id: string;
  provider_id: string | null;
  appointment_date: string;
  reason: string | null;
  notes: string | null;
  follow_up_date: string | null;
  lab_visit_id: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Note {
  id: string;
  user_id: string;
  content: string;
  note_type: NoteType;
  severity: number | null;
  tags: string[];
  recorded_at: string;
  dependent_id?: string | null;
  created_at: string;
}

export interface HealthShare {
  id: string;
  owner_id: string;
  dependent_id: string | null;
  shared_with_email: string;
  shared_with_id: string | null;
  access_level: AccessLevel;
  shared_sections: string[];
  share_token: string | null;
  accepted: boolean;
  expires_at: string | null;
  created_at: string;
}

export interface Allergy {
  id: string;
  user_id: string;
  name: string;
  rxcui?: string | null;
  severity: AllergySeverity;
  reaction?: string | null;
  diagnosed_date?: string | null;
  notes?: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Procedure {
  id: string;
  user_id: string;
  name: string;
  cpt_code?: string | null;
  procedure_date: string;
  provider_id?: string | null;
  notes?: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Vaccine {
  id: string;
  user_id: string;
  name: string;
  cvx_code?: string | null;
  vaccine_date: string;
  dose_number?: number | null;
  series_doses?: number | null;
  manufacturer?: string | null;
  lot_number?: string | null;
  provider_id?: string | null;
  next_dose_date?: string | null;
  notes?: string | null;
  dependent_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardStatPreference {
  id: string;
  user_id: string;
  dependent_id: string | null;
  widget_type: DashboardWidgetType;
  metric_key: string;
  position: number;
  pinned: boolean;
  visible: boolean;
  created_at: string;
  updated_at: string;
}

// ---------------------------------------------------------------------------
// API error shape
// ---------------------------------------------------------------------------

export interface ApiError {
  error: string;
  message: string;
  status: number;
}
