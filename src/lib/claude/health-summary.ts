import Anthropic from '@anthropic-ai/sdk';
import { reasoningModel } from './model';
import { createMessage } from './call';
import { aggregateVitals, formatAggregatesForPrompt } from '@/lib/metrics/aggregate';
import {
  formatGoalsForPrompt,
  formatRecentTrainingForPrompt,
  type PromptGoal,
  type PromptWorkoutSession,
} from './fitness-context';
import { attachLabProvenance } from './lab-warnings';

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
    /** Visit (draw) date, YYYY-MM-DD — lab findings must be date-framed. */
    visit_date: string;
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
  /** Active goals (fitness domain) — optional; absent reads like today. */
  goals?: PromptGoal[];
  /** Workout sessions in the trailing 14 days — optional. */
  recentWorkouts?: PromptWorkoutSession[];
}

export interface HealthSummaryHighlight {
  type: 'positive' | 'attention' | 'action';
  text: string;
  /** Lab test names the highlight derives from — model-tagged, then
      validated against the prompt's flags (see lab-warnings.ts). */
  labTests?: string[];
  /** Draw date (YYYY-MM-DD), attached server-side from the DB — the card
      renders this rather than trusting the prose. */
  labAsOf?: string;
}

export interface HealthSummary {
  summary: string;
  highlights: HealthSummaryHighlight[];
}

const SYSTEM_PROMPT = `You are a health summary assistant. Given a patient's health data, produce a brief, friendly overview and key highlights.

Return ONLY valid JSON with this exact shape:
{
  "summary": "A 2-3 sentence plain-English overview of the patient's current health picture. Be encouraging but honest about areas needing attention.",
  "highlights": [
    {
      "type": "positive" | "attention" | "action",
      "text": "One short sentence per highlight.",
      "labTests": ["Exact Test Name"]
    }
  ]
}

Rules:
- "positive": Things that look good (normal vitals, stable conditions).
- "attention": Things to be aware of (flagged labs, interactions).
- "action": Suggested next steps (follow up on a flag, schedule a check-up).
- Limit to 3-5 highlights total. Keep each highlight under 20 words.
- Lab results carry draw dates and may be months old. Date-frame every lab-derived statement (e.g., "as of your May 26 draw") — never present an old draw as current.
- Include "labTests" ONLY on highlights derived from flagged lab results, listing the exact test name(s) as given in the data. Omit the field everywhere else.
- If active goals are listed, relate relevant highlights to them (progress or gaps), without inventing data.
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
      'Flagged lab results (with draw dates — date-frame these):\n' +
        input.recentLabFlags
          .map(
            (r) =>
              `- ${r.test_name}: ${r.value} ${r.unit ?? ''} (${r.flag}${r.reference_range_low != null && r.reference_range_high != null ? `, ref: ${r.reference_range_low}-${r.reference_range_high}` : ''}) — drawn ${r.visit_date}`,
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

  // Fitness context (spec §AI integration #1) — both blocks format to ''
  // when there is nothing to say, so the prompt reads like today.
  const goalsBlock = formatGoalsForPrompt(input.goals ?? []);
  if (goalsBlock) parts.push(goalsBlock);
  const trainingBlock = formatRecentTrainingForPrompt(
    input.recentWorkouts ?? [],
    input.goals ?? [],
    now,
  );
  if (trainingBlock) parts.push(trainingBlock);

  return parts.join('\n\n');
}

/**
 * Recover the summary JSON from a model response that may be pure JSON, fenced
 * in a ```json block, or wrapped in a stray caveat sentence (which Opus can add
 * on dense medical snapshots despite the "ONLY JSON" instruction). Returns
 * undefined when no valid object can be recovered. Exported for tests.
 */
export function extractSummaryJson(responseText: string): HealthSummary | undefined {
  let jsonText = responseText.trim();
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }
  const tryParse = (s: string): HealthSummary | undefined => {
    try {
      return JSON.parse(s) as HealthSummary;
    } catch {
      return undefined;
    }
  };
  const direct = tryParse(jsonText);
  if (direct) return direct;
  // Fall back to the outermost {...} span, dropping any surrounding prose.
  const first = jsonText.indexOf('{');
  const last = jsonText.lastIndexOf('}');
  if (first !== -1 && last > first) {
    return tryParse(jsonText.slice(first, last + 1));
  }
  return undefined;
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
    max_tokens: 1536,
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

  const parsed = extractSummaryJson(responseText);
  if (!parsed) {
    console.error(
      'Health summary parse failed. Raw response (first 800 chars):',
      responseText.slice(0, 800),
    );
    throw new Error('Failed to parse health summary response');
  }

  if (typeof parsed.summary !== 'string' || !Array.isArray(parsed.highlights)) {
    throw new Error('Invalid health summary structure');
  }

  // Validate model-tagged lab provenance against the flags actually sent and
  // attach the draw date from the DB — the card renders labAsOf, never prose.
  return {
    ...parsed,
    highlights: attachLabProvenance(
      parsed.highlights,
      input.recentLabFlags.map((f) => ({ testName: f.test_name, visitDate: f.visit_date })),
    ),
  };
}
