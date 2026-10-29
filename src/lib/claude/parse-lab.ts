import type { AiConfiguration, AiContent } from '@/lib/ai/types';
import { createMessage } from './call';
import { detectDocumentMime } from '@/lib/import/document-file';

export interface ParsedLabResultItem {
  /** Collection date for this specific result, preserved when a PDF has several draws. */
  visit_date?: string | null;
  panel_name: string | null;
  test_name: string;
  /** Printed LOINC only; never derived from a test name. */
  loinc_code?: string | null;
  value: number;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
  reference_range_text: string | null;
  flag: 'normal' | 'high' | 'low' | 'critical' | null;
  confidence: 'high' | 'medium' | 'low';
  accession_id?: string | null;
  specimen_id?: string | null;
  collected_at?: string | null;
  source_page?: number | null;
  raw_text?: string | null;
}

export interface ParsedLabResult {
  visit_date: string | null;
  provider_name: string | null;
  results: ParsedLabResultItem[];
  import_batch_id?: string;
  multiple_collection_dates?: boolean;
  warnings?: string[];
}

const SYSTEM_PROMPT = `You are a medical lab report parser. You will receive a lab report document (PDF or image). Extract all lab test results into structured JSON.

Return ONLY valid JSON with this exact shape:
{
  "visit_date": "YYYY-MM-DD" or null if not found,
  "provider_name": "Name of lab/provider" or null if not found,
  "multiple_collection_dates": true if more than one collection/draw date appears, otherwise false,
  "results": [
    {
      "visit_date": "Collection date for this result, preserving partial dates, or null if unclear",
      "panel_name": "Panel name (e.g. Complete Blood Count)" or null,
      "test_name": "Test name (e.g. Hemoglobin)",
      "loinc_code": "LOINC code exactly as printed" or null,
      "value": numeric value (number, not string),
      "unit": "unit string (e.g. g/dL)" — if you cannot determine the unit, use "unknown",
      "reference_range_low": numeric low end or null,
      "reference_range_high": numeric high end or null,
      "reference_range_text": "original range text as printed" or null,
      "flag": "normal" | "high" | "low" | "critical" | null,
      "confidence": "high" | "medium" | "low"
    }
  ]
}

Rules:
- Extract ALL test results from ALL pages.
- Keep each result's own collection date in results[].visit_date. Historical comparison columns are separate results with their own dates; never assign all draws to the report's first date. Report-level visit_date may be used only if one unambiguous collection date applies to the entire report. When several dates appear or ownership is unclear, set multiple_collection_dates:true and leave ambiguous result dates null.
- "value" must be a number. If the result is non-numeric (e.g. "Negative", "Reactive"), skip that result. For numeric thresholds retain the exact printed text in raw_text for review.
- Preserve partial dates as YYYY or YYYY-MM; use null when unknown. Never invent a day or month.
- Include optional accession_id, specimen_id, collected_at, source_page (1-based), and raw_text when printed. Never infer specimen identity from date, name or value.
- Include loinc_code only when explicitly printed as a LOINC code. Never infer or look up a code from the test name; use null when absent.
- Set "flag" based on comparison with reference range when available. Use "critical" only when the report explicitly marks it as critical or the value is drastically outside the range.
- Set "confidence" to "high" when the value, unit, and range are clearly readable; "medium" when partially unclear; "low" when you had to guess or the text was very unclear.
- If a reference range is given as text like "4.5-11.0", parse it into reference_range_low and reference_range_high.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

export async function parseLabPdf(
  pdfBuffer: Buffer,
  config: AiConfiguration
): Promise<ParsedLabResult> {
  const mimeType = detectDocumentMime(pdfBuffer);

  const base64Content = pdfBuffer.toString('base64');

  const message = await createMessage(config, 'extraction', {
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: mimeType === 'application/pdf' ? 'document' : 'image',
            source: {
              type: 'base64',
              media_type:
                mimeType === 'image/png'
                  ? 'image/png'
                  : mimeType === 'application/pdf'
                    ? 'application/pdf'
                    : 'image/jpeg',
              data: base64Content,
            },
          } as AiContent,
          {
            type: 'text',
            text: 'Extract all lab results from this document into the specified JSON format.',
          },
        ],
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from AI');
  }

  let jsonText = textBlock.text.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: ParsedLabResult;
  try {
    parsed = JSON.parse(jsonText) as ParsedLabResult;
  } catch {
    throw new Error('Failed to parse AI response as JSON');
  }

  // Validate structure
  if (!Array.isArray(parsed.results)) {
    throw new Error('Invalid response structure: missing results array');
  }

  // Ensure each result has required fields
  parsed.results = parsed.results.filter((r) => {
    return (
      typeof r.test_name === 'string' &&
      r.test_name.length > 0 &&
      typeof r.value === 'number' &&
      Number.isFinite(r.value) &&
      typeof r.unit === 'string'
    );
  });
  const dates = new Set(
    parsed.results
      .map((result) => result.visit_date)
      .filter((date) => typeof date === 'string' && date !== '')
  );
  if (parsed.visit_date) dates.add(parsed.visit_date);
  if (dates.size > 1 || parsed.multiple_collection_dates) {
    parsed.multiple_collection_dates = true;
    parsed.warnings = [
      ...(parsed.warnings ?? []),
      'This report contains multiple or ambiguous collection dates. Review each result date; undated results remain staged.',
    ];
  }

  return parsed;
}
