import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared enum values (keep in sync with types.ts union types)
// ---------------------------------------------------------------------------

const medicationFrequencies = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "four_times_daily",
  "every_other_day",
  "weekly",
  "biweekly",
  "monthly",
  "as_needed",
  "other",
] as const;

const conditionStatuses = [
  "active",
  "resolved",
  "managed",
  "monitoring",
] as const;

const noteTypes = ["symptom", "observation", "general"] as const;

const dependentRelationships = [
  "child",
  "spouse",
  "parent",
  "sibling",
  "other",
] as const;

const providerTypes = [
  "pcp",
  "specialist",
  "lab",
  "imaging",
  "urgent_care",
  "hospital",
  "pharmacy",
  "therapist",
  "dentist",
  "other",
] as const;

export const allergySeverities = [
  "mild",
  "moderate",
  "severe",
  "life_threatening",
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dateNotFuture(label: string) {
  return z.string().refine(
    (val) => {
      const d = new Date(val);
      return !isNaN(d.getTime()) && d <= new Date();
    },
    { message: `${label} cannot be in the future` },
  );
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const profileSchema = z.object({
  display_name: z
    .string()
    .trim()
    .min(1, "Display name is required")
    .max(200, "Display name must be at most 200 characters"),
  date_of_birth: z.string().refine((val) => !isNaN(new Date(val).getTime()), {
    message: "Invalid date",
  }),
  biological_sex: z.enum(["male", "female", "prefer_not_to_say"]),
  unit_system: z.enum(["imperial", "metric"]),
  height_inches: z
    .number()
    .int("Height must be a whole number")
    .min(0, "Height must be at least 0")
    .max(108, "Height must be at most 108 inches"),
  weight_lbs: z
    .number()
    .min(0, "Weight must be at least 0")
    .max(1500, "Weight must be at most 1500 lbs"),
});

export const medicationSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Medication name is required")
      .max(200, "Medication name must be at most 200 characters"),
    dosage: z
      .string()
      .max(100, "Dosage must be at most 100 characters")
      .optional(),
    frequency: z.enum(medicationFrequencies),
    rxcui: z.string().optional(),
    start_date: dateNotFuture("Start date"),
    end_date: z.string().optional(),
  })
  .refine(
    (data) => {
      if (!data.end_date) return true;
      return new Date(data.end_date) >= new Date(data.start_date);
    },
    { message: "End date must be on or after start date", path: ["end_date"] },
  );

export const conditionSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Condition name is required")
    .max(200, "Condition name must be at most 200 characters"),
  status: z.enum(conditionStatuses),
  icd10_code: z.string().optional(),
  diagnosed_date: dateNotFuture("Diagnosed date"),
});

export const appointmentSchema = z.object({
  provider_id: z.string().uuid("A valid provider is required"),
  appointment_date: z
    .string()
    .refine((val) => !isNaN(new Date(val).getTime()), {
      message: "Invalid date",
    }),
  reason: z
    .string()
    .max(500, "Reason must be at most 500 characters")
    .optional(),
});

export const noteSchema = z.object({
  content: z
    .string()
    .trim()
    .min(1, "Note content is required")
    .max(5000, "Note must be at most 5000 characters"),
  note_type: z.enum(noteTypes),
  severity: z.number().int().min(1).max(5).optional(),
});

export const labResultSchema = z
  .object({
    test_name: z.string().trim().min(1, "Test name is required"),
    value: z.number().positive("Value must be a positive number"),
    unit: z.string().trim().min(1, "Unit is required"),
    loinc_code: z.string().optional(),
    reference_range_low: z.number().optional(),
    reference_range_high: z.number().optional(),
  })
  .refine(
    (data) => {
      if (
        data.reference_range_low !== undefined &&
        data.reference_range_high !== undefined
      ) {
        return data.reference_range_low < data.reference_range_high;
      }
      return true;
    },
    {
      message: "Reference range low must be less than high",
      path: ["reference_range_low"],
    },
  );

export const providerSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Provider name is required")
    .max(200, "Provider name must be at most 200 characters"),
  provider_type: z.enum(providerTypes),
  specialty_taxonomy: z.string().optional(),
});

export const dependentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name is required")
    .max(100, "Name must be at most 100 characters"),
  date_of_birth: z.string().min(1, "Date of birth is required").refine(
    (val) => {
      const d = new Date(val);
      return !isNaN(d.getTime()) && d <= new Date();
    },
    { message: "Date cannot be in the future" },
  ),
  biological_sex: z.enum(["male", "female"]).optional(),
  relationship: z.enum(dependentRelationships),
  transition_age: z.number().int().min(13).max(25),
});

export const allergySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Allergy name is required")
    .max(200, "Allergy name must be at most 200 characters"),
  severity: z.enum(allergySeverities),
  rxcui: z.string().optional(),
  reaction: z
    .string()
    .max(500, "Reaction must be at most 500 characters")
    .optional(),
  diagnosed_date: dateNotFuture("Diagnosed date").optional(),
  notes: z
    .string()
    .max(2000, "Notes must be at most 2000 characters")
    .optional(),
});

export const procedureSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Procedure name is required")
    .max(200, "Procedure name must be at most 200 characters"),
  cpt_code: z.string().optional(),
  procedure_date: dateNotFuture("Procedure date"),
  provider_id: z.string().optional(),
  notes: z
    .string()
    .max(2000, "Notes must be at most 2000 characters")
    .optional(),
});

export const vaccineSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, "Vaccine name is required")
      .max(200, "Vaccine name must be at most 200 characters"),
    cvx_code: z.string().optional(),
    vaccine_date: dateNotFuture("Vaccine date"),
    dose_number: z.string().optional(),
    series_doses: z.string().optional(),
    manufacturer: z
      .string()
      .max(200, "Manufacturer must be at most 200 characters")
      .optional(),
    lot_number: z
      .string()
      .max(100, "Lot number must be at most 100 characters")
      .optional(),
    provider_id: z.string().optional(),
    next_dose_date: z.string().optional(),
    notes: z
      .string()
      .max(2000, "Notes must be at most 2000 characters")
      .optional(),
  });

export const delegateInviteSchema = z.object({
  delegate_email: z.string().email('Valid email required'),
  permission_level: z.enum(['read_only', 'read_write', 'admin']),
  expires_at: z.string().optional(),
});

export const SHAREABLE_SECTIONS = [
  "medications",
  "conditions",
  "vitals",
  "labs",
  "allergies",
  "procedures",
  "vaccines",
  "providers",
  "appointments",
  "notes",
] as const;

export type ShareableSection = (typeof SHAREABLE_SECTIONS)[number];

export const shareSchema = z.object({
  shared_with_email: z.string().email("Valid email required"),
  access_level: z.enum(["read", "read_write"]),
  shared_sections: z
    .array(z.enum(SHAREABLE_SECTIONS))
    .min(1, "Select at least one section"),
  expires_at: z
    .string()
    .refine((v) => !isNaN(new Date(v).getTime()), {
      message: "Invalid expiration date",
    })
    .optional(),
});

// ---------------------------------------------------------------------------
// Inferred types for form values
// ---------------------------------------------------------------------------

export type ProfileFormValues = z.infer<typeof profileSchema>;
export type MedicationFormValues = z.infer<typeof medicationSchema>;
export type ConditionFormValues = z.infer<typeof conditionSchema>;
export type AppointmentFormValues = z.infer<typeof appointmentSchema>;
export type NoteFormValues = z.infer<typeof noteSchema>;
export type LabResultFormValues = z.infer<typeof labResultSchema>;
export type ProviderFormValues = z.infer<typeof providerSchema>;
export type DependentFormValues = z.infer<typeof dependentSchema>;
export type ShareFormValues = z.infer<typeof shareSchema>;
export type DelegateInviteFormValues = z.infer<typeof delegateInviteSchema>;
export type AllergyFormValues = z.infer<typeof allergySchema>;
export type ProcedureFormValues = z.infer<typeof procedureSchema>;
export type VaccineFormValues = z.infer<typeof vaccineSchema>;
