import Anthropic from '@anthropic-ai/sdk';
import { extractionModel } from './model';
import { createMessage } from './call';

export interface ParsedLabResultItem {
  panel_name: string | null;
  test_name: string;
  value: number;
  unit: string;
  reference_range_low: number | null;
  reference_range_high: number | null;
  reference_range_text: string | null;
  flag: 'normal' | 'high' | 'low' | 'critical' | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface ParsedLabResult {
  visit_date: string | null;
  provider_name: string | null;
  results: ParsedLabResultItem[];
}

const SYSTEM_PROMPT = `You are a medical lab report parser. You will receive a lab report document (PDF or image). Extract all lab test results into structured JSON.

Return ONLY valid JSON with this exact shape:
{
  "visit_date": "YYYY-MM-DD" or null if not found,
  "provider_name": "Name of lab/provider" or null if not found,
  "results": [
    {
      "panel_name": "Panel name (e.g. Complete Blood Count)" or null,
      "test_name": "Test name (e.g. Hemoglobin)",
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
- "value" must be a number. If the result is non-numeric (e.g. "Negative", "Reactive"), skip that result.
- Set "flag" based on comparison with reference range when available. Use "critical" only when the report explicitly marks it as critical or the value is drastically outside the range.
- Set "confidence" to "high" when the value, unit, and range are clearly readable; "medium" when partially unclear; "low" when you had to guess or the text was very unclear.
- If a reference range is given as text like "4.5-11.0", parse it into reference_range_low and reference_range_high.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

export async function parseLabPdf(pdfBuffer: Buffer): Promise<ParsedLabResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });

  const base64Content = pdfBuffer.toString('base64');

  const message = await createMessage(client, {
    model: extractionModel(),
    thinking: { type: 'disabled' },
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: {
              type: 'base64',
              media_type: 'application/pdf',
              data: base64Content,
            },
          },
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
    throw new Error('No text response from Claude');
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
    throw new Error('Failed to parse Claude response as JSON');
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
      typeof r.unit === 'string'
    );
  });

  return parsed;
}
