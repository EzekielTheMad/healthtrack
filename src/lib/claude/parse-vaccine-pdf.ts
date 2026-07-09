import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from './model';

export interface ParsedVaccineRecord {
  name: string;
  vaccine_date: string | null;
  dose_number: number | null;
  series_doses: number | null;
  manufacturer: string | null;
  lot_number: string | null;
  notes: string | null;
}

export interface ParsedVaccinePdfResult {
  vaccines: ParsedVaccineRecord[];
}

const SYSTEM_PROMPT = `You are a medical vaccine record parser. You will receive a vaccine record document (PDF or image). Extract all vaccine entries into structured JSON.

Return ONLY valid JSON with this exact shape:
{
  "vaccines": [
    {
      "name": "Vaccine name (e.g. Pfizer-BioNTech COVID-19, Influenza, Tdap)",
      "vaccine_date": "YYYY-MM-DD" or null if not found,
      "dose_number": dose number as integer or null,
      "series_doses": total doses in series as integer or null,
      "manufacturer": "Manufacturer name" or null,
      "lot_number": "Lot number" or null,
      "notes": "Any additional notes (e.g. site of injection, reaction)" or null
    }
  ]
}

Rules:
- Extract ALL vaccine entries from ALL pages.
- Use the most specific vaccine name available (e.g. "Pfizer-BioNTech COVID-19" not just "COVID-19").
- Dates must be in YYYY-MM-DD format. If only month/year is given, use the 1st of the month.
- If the same vaccine appears multiple times (booster series), each should be a separate entry.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

export async function parseVaccinePdf(
  pdfBuffer: Buffer,
): Promise<ParsedVaccinePdfResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });
  const base64Content = pdfBuffer.toString('base64');

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    thinking: { type: 'disabled' },
    max_tokens: 4096,
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
            text: 'Extract all vaccine records from this document into the specified JSON format.',
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

  let parsed: ParsedVaccinePdfResult;
  try {
    parsed = JSON.parse(jsonText) as ParsedVaccinePdfResult;
  } catch {
    throw new Error('Failed to parse Claude response as JSON');
  }

  if (!Array.isArray(parsed.vaccines)) {
    throw new Error('Invalid response structure: missing vaccines array');
  }

  // Filter to valid entries
  parsed.vaccines = parsed.vaccines.filter(
    (v) => typeof v.name === 'string' && v.name.length > 0,
  );

  return parsed;
}
