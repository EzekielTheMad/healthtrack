import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { reasoningModel, extractionModel, FALLBACK_MODEL } from './model';

const ENV_KEYS = ['ANTHROPIC_MODEL', 'ANTHROPIC_MODEL_EXTRACTION'] as const;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe('model config', () => {
  it('defaults both task types to the current Sonnet generation', () => {
    expect(reasoningModel()).toBe('claude-sonnet-5');
    expect(extractionModel()).toBe('claude-sonnet-5');
  });

  it('ANTHROPIC_MODEL overrides reasoning only', () => {
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    expect(reasoningModel()).toBe('claude-opus-4-8');
    expect(extractionModel()).toBe('claude-sonnet-5');
  });

  it('ANTHROPIC_MODEL_EXTRACTION overrides extraction only', () => {
    process.env.ANTHROPIC_MODEL_EXTRACTION = 'claude-haiku-4-5';
    expect(reasoningModel()).toBe('claude-sonnet-5');
    expect(extractionModel()).toBe('claude-haiku-4-5');
  });

  it('trims whitespace and treats empty values as unset', () => {
    process.env.ANTHROPIC_MODEL = '  claude-opus-4-8  ';
    process.env.ANTHROPIC_MODEL_EXTRACTION = '   ';
    expect(reasoningModel()).toBe('claude-opus-4-8');
    expect(extractionModel()).toBe('claude-sonnet-5');
  });

  it('env is read at call time, not module load', () => {
    expect(reasoningModel()).toBe('claude-sonnet-5');
    process.env.ANTHROPIC_MODEL = 'claude-opus-4-8';
    expect(reasoningModel()).toBe('claude-opus-4-8');
  });

  it('fallback model is a current known-good id', () => {
    expect(FALLBACK_MODEL).toBe('claude-sonnet-5');
  });
});
