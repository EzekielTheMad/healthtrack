import Anthropic from '@anthropic-ai/sdk';
import { reasoningModel } from './model';
import { createMessage } from './call';

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
  vitals: Array<{
    metric_key: string;
    value: number;
    unit: string;
    recorded_at: string;
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

export async function generateHealthSummary(
  input: HealthSummaryInput,
): Promise<HealthSummary> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });

  // Build a concise snapshot — keep token usage low
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
    // Just send the most recent value per metric
    const latestByMetric = new Map<string, (typeof input.vitals)[number]>();
    for (const v of input.vitals) {
      const existing = latestByMetric.get(v.metric_key);
      if (!existing || new Date(v.recorded_at) > new Date(existing.recorded_at)) {
        latestByMetric.set(v.metric_key, v);
      }
    }
    parts.push(
      'Latest vitals:\n' +
        [...latestByMetric.values()]
          .map((v) => `- ${v.metric_key}: ${v.value} ${v.unit}`)
          .join('\n'),
    );
  }

  if (input.interactionAlerts.length > 0) {
    parts.push(
      'Active medication alerts:\n' +
        input.interactionAlerts.map((a) => `- [${a.severity}] ${a.alert_text}`).join('\n'),
    );
  }

  const userMessage = parts.join('\n\n');

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
