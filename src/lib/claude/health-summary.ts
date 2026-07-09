import Anthropic from '@anthropic-ai/sdk';
import { reasoningModel } from './model';
import { createMessage } from './call';
import { aggregateVitals, formatAggregatesForPrompt } from '@/lib/metrics/aggregate';

export interface HealthSummaryInput {
  medications: Array<{ name: string; dosage: string | null; frequency: string | null }>;
  conditions: Array<{ name: string }>;
  recentLabFlags: Array<{
    test_name: string;
    value: number;
    unit: string | null;
    flag: string;
    reference_range_low: number | null;
    reference_range_high: number | null;
  }>;
  /** 30-day window of rows — aggregated into per-metric trend lines. */
  vitals: Array<{
    metric_key: string;
    value: number;
    unit: string;
    recorded_at: string;
    /** Ordinal rows carry { label } — used for prompt display. */
    metadata?: Record<string, unknown> | null;
  }>;
  interactionAlerts: Array<{
    alert_text: string;
    severity: string;
  }>;
}

export interface HealthSummary {
  summary: string;
  highlights: Array<{
    type: 'positive' | 'attention' | 'action';
    text: string;
  }>;
}

const SYSTEM_PROMPT = `You are a health summary assistant. Given a patient's health data, produce a brief, friendly overview and key highlights.

Return ONLY valid JSON with this exact shape:
{
  "summary": "A 2-3 sentence plain-English overview of the patient's current health picture. Be encouraging but honest about areas needing attention.",
  "highlights": [
    {
      "type": "positive" | "attention" | "action",
      "text": "One short sentence per highlight."
    }
  ]
}

Rules:
- "positive": Things that look good (normal vitals, stable conditions).
- "attention": Things to be aware of (flagged labs, interactions).
- "action": Suggested next steps (follow up on a flag, schedule a check-up).
- Limit to 3-5 highlights total. Keep each highlight under 20 words.
- Do NOT give medical diagnoses or treatment recommendations.
- Use plain language a patient can understand.
- If there is very little data, say so and encourage them to add more.
- Do NOT include markdown or commentary. Return ONLY the JSON object.`;

/**
 * Build the concise plain-text snapshot sent to the model — keep token usage
 * low. Exported for tests; `now` anchors the vitals aggregation windows and
 * defaults to the current time.
 */
export function buildHealthSnapshot(input: HealthSummaryInput, now?: Date): string {
  const parts: string[] = [];

  if (input.medications.length > 0) {
    parts.push(
      `Active medications (${input.medications.length}): ${input.medications.map((m) => m.name).join(', ')}`,
    );
  } else {
    parts.push('No active medications recorded.');
  }

  if (input.conditions.length > 0) {
    parts.push(
      `Conditions: ${input.conditions.map((c) => c.name).join(', ')}`,
    );
  }

  if (input.recentLabFlags.length > 0) {
    parts.push(
      'Flagged lab results:\n' +
        input.recentLabFlags
          .map(
            (r) =>
              `- ${r.test_name}: ${r.value} ${r.unit ?? ''} (${r.flag}${r.reference_range_low != null && r.reference_range_high != null ? `, ref: ${r.reference_range_low}-${r.reference_range_high}` : ''})`,
          )
          .join('\n'),
    );
  }

  if (input.vitals.length > 0) {
    // Per-metric aggregates (latest + 7d/30d averages + trend) instead of a
    // latest-per-metric dump — the model sees trajectory, not a snapshot.
    const aggregates = aggregateVitals(
      input.vitals.map((v) => ({
        metricKey: v.metric_key,
        value: v.value,
        recordedAt: v.recorded_at,
        metadata: v.metadata,
      })),
      now,
    );
    const block = formatAggregatesForPrompt(aggregates);
    if (block) {
      parts.push(`Device & vital metrics (30-day aggregates):\n${block}`);
    }
  }

  if (input.interactionAlerts.length > 0) {
    parts.push(
      'Active medication alerts:\n' +
        input.interactionAlerts.map((a) => `- [${a.severity}] ${a.alert_text}`).join('\n'),
    );
  }

  return parts.join('\n\n');
}

export async function generateHealthSummary(
  input: HealthSummaryInput,
): Promise<HealthSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });

  const userMessage = buildHealthSnapshot(input);

  const message = await createMessage(client, {
    model: reasoningModel(),
    thinking: { type: 'disabled' },
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here is the patient's current health snapshot:\n\n${userMessage}\n\nGenerate a health summary.`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  const responseText = textBlock?.type === 'text' ? textBlock.text : '';

  if (!responseText) {
    throw new Error('No text response from Claude');
  }

  let jsonText = responseText.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: HealthSummary;
  try {
    parsed = JSON.parse(jsonText) as HealthSummary;
  } catch {
    throw new Error('Failed to parse health summary response');
  }

  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.highlights)) {
    throw new Error('Invalid health summary structure');
  }

  return parsed;
}
