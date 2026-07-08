import Anthropic from '@anthropic-ai/sdk';

export interface HealthContext {
  profile_data: string;
  medications_data: string;
  lab_results_data: string;
  vitals_data: string;
  flagged_data: string;
  conditions_data: string;
  recent_notes: string;
  appointments_data: string;
}

const SYSTEM_PROMPT_TEMPLATE = `You are a personal health data assistant. You have access to the user's health data below. Answer their questions by referencing specific data points, trends, and correlations. Be specific with numbers and dates. Flag anything concerning but always note you are not a medical professional.

USER PROFILE:
{profile_data}

CURRENT MEDICATIONS:
{medications_data}

RECENT LAB RESULTS:
{lab_results_data}

RECENT VITALS (last 30 days):
{vitals_data}

FLAGGED VALUES:
{flagged_data}

CONDITIONS:
{conditions_data}

RECENT NOTES/SYMPTOMS:
{recent_notes}

APPOINTMENTS:
{appointments_data}`;

function buildSystemPrompt(context: HealthContext): string {
  let prompt = SYSTEM_PROMPT_TEMPLATE;
  prompt = prompt.replace('{profile_data}', context.profile_data || 'No profile data available.');
  prompt = prompt.replace('{medications_data}', context.medications_data || 'No medication data available.');
  prompt = prompt.replace('{lab_results_data}', context.lab_results_data || 'No lab results available.');
  prompt = prompt.replace('{vitals_data}', context.vitals_data || 'No vitals data available.');
  prompt = prompt.replace('{flagged_data}', context.flagged_data || 'No flagged values.');
  prompt = prompt.replace('{conditions_data}', context.conditions_data || 'No conditions recorded.');
  prompt = prompt.replace('{recent_notes}', context.recent_notes || 'No recent notes.');
  prompt = prompt.replace('{appointments_data}', context.appointments_data || 'No upcoming appointments.');
  return prompt;
}

export async function queryHealthData(
  question: string,
  context: HealthContext
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY is not configured');
  }

  const client = new Anthropic({ apiKey });
  const systemPrompt = buildSystemPrompt(context);

  const message = await client.messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 4096,
    system: systemPrompt,
    messages: [{ role: 'user', content: question }],
  });

  const textBlock = message.content.find((block) => block.type === 'text');
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('No text response from Claude');
  }

  return textBlock.text;
}
