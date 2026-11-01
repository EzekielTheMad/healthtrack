import type { AiConfiguration, AiContent } from '@/lib/ai/types';
import { createMessage } from './call';
import { detectDocumentMime } from '@/lib/import/document-file';
export class TypedLabExtractionError extends Error {}
/** Opt-in only: raw extraction is retained, validated and staged before owner approval. */
const SYSTEM = `Extract laboratory evidence from the provided PDF or image. Return JSON only: {"results":[{"test_name":"printed analyte", "outcome":{"kind":"numeric","value":0,"comparator":"="}, "raw_result":"exact printed result", "source_unit":null,"collection_date":{"precision":"unknown","value":null},"report_date":{"precision":"unknown","value":null},"panel_name":null,"report_id":null,"accession_id":null,"specimen_id":null,"specimen_type":null,"loinc_code":null,"source_page":1,"printed_flags":[],"reference":{"low":null,"high":null,"text":"Not established","unit":null}}],"warnings":[]}.
Use outcome kind numeric only for exact numeric values; censored with an independent <, <=, > or >= and numeric bound for thresholds; text with exact text for qualitative results; canceled with reason for canceled tests. Extract ALL outcomes, including Negative, Not detected, canceled, zero and thresholds. Never skip a result because it is not numeric, and never turn missing/canceled/text into zero.
Keep raw source result, units, reference interval text/bounds/operators and specimen/panel/report identities. printed_flags contains ONLY flags explicitly printed by the laboratory. Never derive a normal/high/low flag from ranges. Leave absent units and metadata null. Do not infer LOINC, specimen identity, fasting or collection conditions.
Dates have precision year/month/day/instant/unknown and the source value. Year is YYYY; month YYYY-MM; day YYYY-MM-DD; instant requires an explicit printed offset. If no offset is known, keep unknown with null value and original_text. Preserve approximate and conflicting dates as source text; do not invent month/day/midnight/timezone. Distinguish collection from report dates, each result's historical comparison date and known panel/specimen. Unclear collection stays unknown, never the report date. source_page is 1-based when known. Do not normalize units or infer additional precision. Return all source uncertainty for human review; no clinical interpretation.`;
export async function parseTypedLabPdf(buffer: Buffer, config: AiConfiguration): Promise<unknown> {
  const mime = detectDocumentMime(buffer);
  const response = await createMessage(config, 'extraction', {
    max_tokens: 8192,
    system: SYSTEM,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: mime === 'application/pdf' ? 'document' : 'image',
            source: { type: 'base64', media_type: mime, data: buffer.toString('base64') },
          } as AiContent,
          {
            type: 'text',
            text: 'Extract every laboratory outcome into the typed evidence format. Preserve source text and uncertainty.',
          },
        ],
      },
    ],
  });
  const text = response.content.find((block) => block.type === 'text');
  if (!text || text.type !== 'text')
    throw new TypedLabExtractionError(
      'The extraction returned no text. The saved source remains available.'
    );
  const raw = text.text.trim(),
    fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  try {
    return JSON.parse(fenced ? fenced[1] : raw);
  } catch {
    throw new TypedLabExtractionError(
      'The extraction was not valid JSON. No clinical record was accepted.'
    );
  }
}
