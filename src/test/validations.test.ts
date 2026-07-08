import { describe, it, expect } from 'vitest';
import {
  profileSchema,
  medicationSchema,
  conditionSchema,
  noteSchema,
  providerSchema,
} from '@/lib/validations';

describe('profileSchema', () => {
  it('accepts valid profile data', () => {
    const result = profileSchema.safeParse({
      display_name: 'John Doe',
      date_of_birth: '1990-01-15',
      biological_sex: 'male',
      unit_system: 'imperial',
      height_inches: 70,
      weight_lbs: 180,
    });
    expect(result.success).toBe(true);
  });

  it('rejects height over 108 inches', () => {
    const result = profileSchema.safeParse({
      display_name: 'Test',
      biological_sex: 'male',
      height_inches: 120,
    });
    expect(result.success).toBe(false);
  });

  it('rejects weight over 1500 lbs', () => {
    const result = profileSchema.safeParse({
      display_name: 'Test',
      biological_sex: 'male',
      weight_lbs: 2000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid biological sex', () => {
    const result = profileSchema.safeParse({
      display_name: 'Test',
      biological_sex: 'other',
    });
    expect(result.success).toBe(false);
  });
});

describe('medicationSchema', () => {
  it('accepts valid medication', () => {
    const result = medicationSchema.safeParse({
      name: 'Lisinopril',
      dosage: '10mg',
      frequency: 'once_daily',
      start_date: '2024-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('requires name', () => {
    const result = medicationSchema.safeParse({
      frequency: 'once_daily',
      start_date: '2024-01-01',
    });
    expect(result.success).toBe(false);
  });

  it('rejects name over 200 chars', () => {
    const result = medicationSchema.safeParse({
      name: 'A'.repeat(201),
      frequency: 'once_daily',
      start_date: '2024-01-01',
    });
    expect(result.success).toBe(false);
  });
});

describe('conditionSchema', () => {
  it('accepts valid condition', () => {
    const result = conditionSchema.safeParse({
      name: 'Hypertension',
      status: 'active',
      diagnosed_date: '2024-01-01',
    });
    expect(result.success).toBe(true);
  });

  it('rejects invalid status', () => {
    const result = conditionSchema.safeParse({
      name: 'Test',
      status: 'unknown',
    });
    expect(result.success).toBe(false);
  });
});

describe('noteSchema', () => {
  it('accepts valid note', () => {
    const result = noteSchema.safeParse({
      content: 'Feeling dizzy after lunch',
      note_type: 'symptom',
      severity: 3,
    });
    expect(result.success).toBe(true);
  });

  it('rejects severity out of range', () => {
    const result = noteSchema.safeParse({
      content: 'Test',
      note_type: 'symptom',
      severity: 6,
    });
    expect(result.success).toBe(false);
  });

  it('rejects content over 5000 chars', () => {
    const result = noteSchema.safeParse({
      content: 'A'.repeat(5001),
      note_type: 'general',
    });
    expect(result.success).toBe(false);
  });
});

describe('providerSchema', () => {
  it('accepts valid provider', () => {
    const result = providerSchema.safeParse({
      name: 'Dr. Smith',
      provider_type: 'pcp',
    });
    expect(result.success).toBe(true);
  });

  it('requires name', () => {
    const result = providerSchema.safeParse({
      provider_type: 'pcp',
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid provider type', () => {
    const result = providerSchema.safeParse({
      name: 'Dr. Smith',
      provider_type: 'invalid',
    });
    expect(result.success).toBe(false);
  });
});
