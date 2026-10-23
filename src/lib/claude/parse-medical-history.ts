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
import { detectDocumentMime } from '@/lib/import/document-file';

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
  source_page: nullableNumber.optional(),
});

const extractedConditionSchema = z.object({
  name: z.string().trim().min(1),
  status: z
    .enum(['active', 'resolved', 'managed', 'monitoring'])
    .nullish()
    .transform((v) => v ?? null),
  diagnosed_date: nullableString,
  notes: nullableString,
  source_page: nullableNumber.optional(),
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
  source_page: nullableNumber.optional(),
});

const extractedProcedureSchema = z.object({
  name: z.string().trim().min(1),
  procedure_date: nullableString,
  notes: nullableString,
  source_page: nullableNumber.optional(),
});

const extractedVaccineSchema = z.object({
  name: z.string().trim().min(1),
  vaccine_date: nullableString,
  dose_number: nullableNumber,
  series_doses: nullableNumber,
  manufacturer: nullableString,
  lot_number: nullableString,
  notes: nullableString,
  source_page: nullableNumber.optional(),
});

const extractedLabResultSchema = z.object({
  test_name: z.string().trim().min(1),
  loinc_code: nullableString.optional(),
  value: z.number(),
  unit: nullableString,
  reference_range_text: nullableString,
  flag: z
    .enum(['normal', 'high', 'low', 'critical'])
    .nullish()
    .transform((v) => v ?? null),
  panel_name: nullableString.optional(),
  reference_range_low: nullableNumber.optional(),
  reference_range_high: nullableNumber.optional(),
  accession_id: nullableString.optional(),
  specimen_id: nullableString.optional(),
  collected_at: nullableString.optional(),
  source_page: nullableNumber.optional(),
  raw_text: nullableString.optional(),
});

const extractedLabVisitSchema = z.object({
  visit_date: nullableString,
  results: z.array(z.unknown()).default([]),
});

export type ExtractedMedication = z.infer<typeof extractedMedicationSchema>;
export type ExtractedCondition = z.infer<typeof extractedConditionSchema>;
export type ExtractedAllergy = z.infer<typeof extractedAllergySchema>;
export type ExtractedProcedure = z.infer<typeof extractedProcedureSchema>;
export type ExtractedVaccine = z.infer<typeof extractedVaccineSchema>;
export type ExtractedLabResult = z.infer<typeof extractedLabResultSchema>;

export interface ExtractedLabVisit {
  visit_date: string | null;
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
          "loinc_code": "LOINC code exactly as printed" or null,
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
- Read ALL pages and extract EVERY entry in each domain. Include optional source_page (1-based page) on entries when known.
- Preserve date precision: YYYY-MM-DD for a full date, YYYY-MM for month/year, YYYY for year only, null for unknown. Never invent a day or month.
- Group lab results by collection/visit date and specimen when printed. Preserve undated results with visit_date:null for review. Skip non-numeric results (e.g. "Negative").
- For labs retain optional panel_name, reference_range_low/high, accession_id, specimen_id, collected_at, source_page (1-based) and raw_text exactly as printed. Never invent specimen identity.
- Include loinc_code only when explicitly printed as a LOINC code. Never infer or look up a code from the test name; use null when absent.
- Each repeated vaccine dose (booster series) is a separate entry.
- Do NOT include the patient's demographics, insurance, or provider contact details.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

function documentBlock(buffer: Buffer, mimeType: string): Anthropic.Messages.ContentBlockParam {
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
function filterValid<Schema extends z.ZodType>(schema: Schema, value: unknown): z.infer<Schema>[] {
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
  mimeType: string
): Promise<ParsedMedicalHistory> {
  mimeType = detectDocumentMime(fileBuffer);
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
