/**
 * Universal medical-history document extraction.
 *
 * One Claude call (extraction model — mechanical transcription, same tier as
 * lab/vaccine parsing) turns a doctor-provided medical-history PDF or image
 * into zod-validated structured JSON covering six domains: medications,
 * conditions, allergies, procedures, vaccines, and lab visits. Field names are
 * snake_case to match the API wire format; each domain's fields are derived
 * from the corresponding repo's create-input schema.
 */
import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { extractionModel } from './model';
import { createMessage } from './call';

// Model output is untrusted: normalize absent/undefined optionals to null so
// consumers (review UI, import route) get a stable shape.
const nullableString = z
  .string()
  .nullish()
  .transform((v) => v ?? null);
const nullableNumber = z
  .number()
  .nullish()
  .transform((v) => v ?? null);
const nullableBoolean = z
  .boolean()
  .nullish()
  .transform((v) => v ?? null);

const extractedMedicationSchema = z.object({
  name: z.string().trim().min(1),
  dosage: nullableString,
  frequency: nullableString,
  start_date: nullableString,
  end_date: nullableString,
  active: nullableBoolean,
  notes: nullableString,
});

const extractedConditionSchema = z.object({
  name: z.string().trim().min(1),
  status: z
    .enum(['active', 'resolved', 'managed', 'monitoring'])
    .nullish()
    .transform((v) => v ?? null),
  diagnosed_date: nullableString,
  notes: nullableString,
});

const extractedAllergySchema = z.object({
  name: z.string().trim().min(1),
  severity: z
    .enum(['mild', 'moderate', 'severe', 'life_threatening'])
    .nullish()
    .transform((v) => v ?? null),
  reaction: nullableString,
  diagnosed_date: nullableString,
  notes: nullableString,
});

const extractedProcedureSchema = z.object({
  name: z.string().trim().min(1),
  procedure_date: nullableString,
  notes: nullableString,
});

const extractedVaccineSchema = z.object({
  name: z.string().trim().min(1),
  vaccine_date: nullableString,
  dose_number: nullableNumber,
  series_doses: nullableNumber,
  manufacturer: nullableString,
  lot_number: nullableString,
  notes: nullableString,
});

const extractedLabResultSchema = z.object({
  test_name: z.string().trim().min(1),
  value: z.number(),
  unit: nullableString,
  reference_range_text: nullableString,
  flag: z
    .enum(['normal', 'high', 'low', 'critical'])
    .nullish()
    .transform((v) => v ?? null),
});

const extractedLabVisitSchema = z.object({
  visit_date: z.string().trim().min(1),
  results: z.array(z.unknown()).default([]),
});

export type ExtractedMedication = z.infer<typeof extractedMedicationSchema>;
export type ExtractedCondition = z.infer<typeof extractedConditionSchema>;
export type ExtractedAllergy = z.infer<typeof extractedAllergySchema>;
export type ExtractedProcedure = z.infer<typeof extractedProcedureSchema>;
export type ExtractedVaccine = z.infer<typeof extractedVaccineSchema>;
export type ExtractedLabResult = z.infer<typeof extractedLabResultSchema>;

export interface ExtractedLabVisit {
  visit_date: string;
  results: ExtractedLabResult[];
}

export interface ParsedMedicalHistory {
  medications: ExtractedMedication[];
  conditions: ExtractedCondition[];
  allergies: ExtractedAllergy[];
  procedures: ExtractedProcedure[];
  vaccines: ExtractedVaccine[];
  lab_visits: ExtractedLabVisit[];
}

const SYSTEM_PROMPT = `You are a medical-history document parser. You will receive a complete medical history document (PDF or image) from a healthcare provider. Extract the patient's health record into structured JSON.

Return ONLY valid JSON with this exact shape (every top-level array is required; use [] when the document has no data for that domain):
{
  "medications": [
    {
      "name": "Medication name as printed",
      "dosage": "e.g. 10mg" or null,
      "frequency": "e.g. once daily" or null,
      "start_date": "YYYY-MM-DD" or null,
      "end_date": "YYYY-MM-DD" or null,
      "active": true if listed as current/active, false if listed as discontinued/past, null if unclear,
      "notes": "other printed details" or null
    }
  ],
  "conditions": [
    {
      "name": "Condition / diagnosis name",
      "status": "active" | "resolved" | "managed" | "monitoring" or null if not stated,
      "diagnosed_date": "YYYY-MM-DD" or null,
      "notes": "other printed details" or null
    }
  ],
  "allergies": [
    {
      "name": "Allergen (e.g. Penicillin, Peanuts)",
      "severity": "mild" | "moderate" | "severe" | "life_threatening" or null if not stated,
      "reaction": "documented reaction (e.g. hives, anaphylaxis)" or null,
      "diagnosed_date": "YYYY-MM-DD" or null,
      "notes": "other printed details" or null
    }
  ],
  "procedures": [
    {
      "name": "Procedure / surgery name",
      "procedure_date": "YYYY-MM-DD" or null,
      "notes": "other printed details" or null
    }
  ],
  "vaccines": [
    {
      "name": "Vaccine name (most specific available, e.g. Pfizer-BioNTech COVID-19)",
      "vaccine_date": "YYYY-MM-DD" or null,
      "dose_number": integer or null,
      "series_doses": integer or null,
      "manufacturer": "Manufacturer" or null,
      "lot_number": "Lot number" or null,
      "notes": "other printed details" or null
    }
  ],
  "lab_visits": [
    {
      "visit_date": "YYYY-MM-DD",
      "results": [
        {
          "test_name": "Test name (e.g. Hemoglobin)",
          "value": numeric value (number, not string),
          "unit": "unit string (e.g. g/dL)" or null,
          "reference_range_text": "range as printed (e.g. 4.5-11.0)" or null,
          "flag": "normal" | "high" | "low" | "critical" or null
        }
      ]
    }
  ]
}

Rules:
- Extract ONLY information explicitly present in the document. Never infer, guess, or fabricate values. When a field is not stated, use null.
- Read ALL pages and extract EVERY entry in each domain.
- All dates must be ISO YYYY-MM-DD. If only month/year is given, use the 1st of the month. If only a year is given, use January 1st of that year. If no date is given, use null.
- Group lab results by collection/visit date — one lab_visits entry per distinct date. Skip lab results with no date, and skip non-numeric results (e.g. "Negative").
- Each repeated vaccine dose (booster series) is a separate entry.
- Do NOT include the patient's demographics, insurance, or provider contact details.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

function documentBlock(
  buffer: Buffer,
  mimeType: string,
): Anthropic.Messages.ContentBlockParam {
  const data = buffer.toString('base64');
  if (mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
    return {
      type: 'image',
      source: {
        type: 'base64',
        media_type: mimeType === 'image/png' ? 'image/png' : 'image/jpeg',
        data,
      },
    };
  }
  return {
    type: 'document',
    source: { type: 'base64', media_type: 'application/pdf', data },
  };
}

/** Keep the valid entries of an untrusted array, dropping malformed ones. */
function filterValid<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
): z.infer<Schema>[] {
  if (!Array.isArray(value)) return [];
  const valid: z.infer<Schema>[] = [];
  for (const entry of value) {
    const result = schema.safeParse(entry);
    if (result.success) valid.push(result.data);
  }
  return valid;
}

export async function parseMedicalHistory(
  fileBuffer: Buffer,
  mimeType: string,
): Promise<ParsedMedicalHistory> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });

  const message = await createMessage(client, {
    model: extractionModel(),
    thinking: { type: 'disabled' },
    max_tokens: 16384,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          documentBlock(fileBuffer, mimeType),
          {
            type: 'text',
            text: 'Extract this complete medical history into the specified JSON format.',
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  let jsonText = textBlock.text.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let raw: unknown;
  try {
    raw = JSON.parse(jsonText);
  } catch {
    throw new Error('Failed to parse Claude response as JSON');
  }

  if (typeof raw !== 'object' || raw === null) {
    throw new Error('Invalid response structure: expected a JSON object');
  }
  const record = raw as Record<string, unknown>;

  // Validate domain by domain, dropping malformed entries instead of failing
  // the whole extraction (parity with the lab/vaccine parsers' filtering).
  return {
    medications: filterValid(extractedMedicationSchema, record.medications),
    conditions: filterValid(extractedConditionSchema, record.conditions),
    allergies: filterValid(extractedAllergySchema, record.allergies),
    procedures: filterValid(extractedProcedureSchema, record.procedures),
    vaccines: filterValid(extractedVaccineSchema, record.vaccines),
    lab_visits: filterValid(extractedLabVisitSchema, record.lab_visits)
      .map((visit) => ({
        visit_date: visit.visit_date,
        results: filterValid(extractedLabResultSchema, visit.results),
      }))
      .filter((visit) => visit.results.length > 0),
  };
}
