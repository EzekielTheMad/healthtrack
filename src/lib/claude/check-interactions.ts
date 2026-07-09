// Phase 4: Medication interaction checking via Claude API

import Anthropic from '@anthropic-ai/sdk';
import { ANTHROPIC_MODEL } from './model';
import type { Medication } from '@/lib/types';

export interface InteractionCheckResult {
  has_interactions: boolean;
  alerts: Array<{
    medication_names: string[];
    alert_text: string;
    severity: 'info' | 'warning' | 'critical';
  }>;
}

const SYSTEM_PROMPT = `You are a pharmacology expert assistant. You will receive a list of medications a patient is currently taking. Analyze them for:

1. **Drug-drug interactions** — known interactions between any pair (or group) of the listed medications.
2. **Contraindications** — situations where one medication may be harmful given the presence of another.
3. **Duplicate therapies** — two or more medications from the same drug class that may indicate unintentional duplication.

Return ONLY valid JSON with this exact shape:
{
  "has_interactions": true | false,
  "alerts": [
    {
      "medication_names": ["MedA", "MedB"],
      "alert_text": "Clear, concise description of the interaction or concern.",
      "severity": "info" | "warning" | "critical"
    }
  ]
}

Severity guidelines:
- "critical": Life-threatening interactions, severe contraindications, or dangerous combinations that require immediate medical attention.
- "warning": Clinically significant interactions that a healthcare provider should review, dose adjustments may be needed, or moderate risk of adverse effects.
- "info": Minor interactions, duplicate therapy notifications, or low-risk concerns worth noting.

Rules:
- Only report well-established, clinically recognized interactions.
- Do NOT invent or speculate about interactions that are not well-documented.
- Each alert_text should be 1-2 sentences, written for a patient audience.
- medication_names must contain the exact medication names as provided in the input.
- If there are no interactions, return { "has_interactions": false, "alerts": [] }.
- Do NOT include commentary or markdown. Return ONLY the JSON object.`;

export async function checkMedicationInteractions(
  medications: Medication[],
): Promise<InteractionCheckResult> {
  // No interactions possible with 0 or 1 medications
  if (medications.length <= 1) {
    return { has_interactions: false, alerts: [] };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });

  // Build a clear medication list for the model
  const medicationListText = medications
    .map((med, i) => {
      const parts = [`${i + 1}. ${med.name}`];
      if (med.dosage) parts.push(`— Dosage: ${med.dosage}`);
      if (med.frequency) parts.push(`— Frequency: ${med.frequency}`);
      if (med.category) parts.push(`— Category: ${med.category}`);
      return parts.join(' ');
    })
    .join('\n');

  const message = await client.messages.create({
    model: ANTHROPIC_MODEL,
    thinking: { type: 'disabled' },
    max_tokens: 2048,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: 'user',
        content: `Here are the patient's current medications:\n\n${medicationListText}\n\nAnalyze these medications for interactions, contraindications, and duplicate therapies.`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === 'text');
  const responseText = textBlock?.type === 'text' ? textBlock.text : '';

  if (!responseText) {
    throw new Error('No text response from Claude');
  }

  let jsonText = responseText.trim();

  // Strip markdown code fences if present
  const fenceMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonText = fenceMatch[1].trim();
  }

  let parsed: InteractionCheckResult;
  try {
    parsed = JSON.parse(jsonText) as InteractionCheckResult;
  } catch {
    throw new Error('Failed to parse Claude response as JSON');
  }

  // Validate structure
  if (typeof parsed.has_interactions !== 'boolean' || !Array.isArray(parsed.alerts)) {
    throw new Error('Invalid response structure from Claude');
  }

  // Validate each alert
  parsed.alerts = parsed.alerts.filter(
    (a) =>
      Array.isArray(a.medication_names) &&
      a.medication_names.length > 0 &&
      typeof a.alert_text === 'string' &&
      a.alert_text.length > 0 &&
      ['info', 'warning', 'critical'].includes(a.severity),
  );

  // Reconcile has_interactions with the filtered alerts
  parsed.has_interactions = parsed.alerts.length > 0;

  return parsed;
}
