'use client';

import { useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { profileSchema, type ProfileFormValues } from '@/lib/validations';
import { apiFetch } from '@/lib/api/client';
import type { UnitSystem } from '@/lib/units';
import { heightToInches, weightToLbs } from '@/lib/units';

interface ProfileStepProps {
  onNext: () => void;
  onBack: () => void;
}

export function ProfileStep({ onNext }: ProfileStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [heightFeet, setHeightFeet] = useState(0);
  const [heightIn, setHeightIn] = useState(0);
  const [heightCm, setHeightCm] = useState(0);
  const [weightDisplay, setWeightDisplay] = useState(0);

  const {
    register,
    handleSubmit,
    setValue,
    control,
    formState: { errors },
  } = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: {
      display_name: '',
      date_of_birth: '',
      biological_sex: undefined,
      unit_system: 'imperial',
      height_inches: 0,
      weight_lbs: 0,
    },
  });

  const unitSystem = useWatch({ control, name: 'unit_system' }) as UnitSystem ?? 'imperial';

  const updateTotalInches = (feet: number, inches: number) => {
    const totalInches = (feet || 0) * 12 + (inches || 0);
    setValue('height_inches', totalInches, { shouldValidate: true });
  };

  const onSubmit = async (data: ProfileFormValues) => {
    setSubmitting(true);
    setError(null);
    try {
      // Convert to DB units (imperial)
      const finalHeightInches = unitSystem === 'metric'
        ? heightToInches(heightCm, 'metric')
        : (heightFeet * 12 + heightIn);
      const finalWeightLbs = weightToLbs(weightDisplay, unitSystem);

      await apiFetch('/api/profile', {
        method: 'PUT',
        body: JSON.stringify({
          display_name: data.display_name,
          date_of_birth: data.date_of_birth,
          biological_sex: data.biological_sex,
          unit_system: data.unit_system,
          height_inches: finalHeightInches,
          weight_lbs: finalWeightLbs,
        }),
      });

      onNext();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'An unexpected error occurred. Please try again.',
      );
    } finally {
      setSubmitting(false);
    }
  };

  const inputClasses =
    'w-full rounded-lg px-3 py-2.5 text-sm outline-none transition-colors focus:ring-2 focus:ring-accent-green/40';
  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    borderWidth: 1,
    borderColor: 'var(--border-card)',
    color: 'var(--color-text-primary)',
  };
  const labelStyle = { color: 'var(--color-text-primary)' };
  const errorStyle = { color: 'var(--color-terracotta)' };

  return (
    <div className="flex flex-col items-center">
      <h2 className="text-2xl font-bold mb-2" style={{ color: 'var(--color-text-primary)' }}>
        Your Profile
      </h2>
      <p className="text-sm mb-8 text-center" style={{ color: 'var(--color-text-muted)' }}>
        Tell us about yourself to personalize your experience.
      </p>

      <form onSubmit={handleSubmit(onSubmit)} className="w-full space-y-5" noValidate>
        {/* Display name */}
        <div>
          <label htmlFor="display_name" className="block text-sm font-medium mb-1.5" style={labelStyle}>
            Display Name
          </label>
          <input
            id="display_name"
            type="text"
            autoComplete="name"
            className={inputClasses}
            style={inputStyle}
            {...register('display_name')}
          />
          {errors.display_name && (
            <p className="text-xs mt-1" style={errorStyle} role="alert">
              {errors.display_name.message}
            </p>
          )}
        </div>

        {/* Date of birth */}
        <div>
          <label htmlFor="date_of_birth" className="block text-sm font-medium mb-1.5" style={labelStyle}>
            Date of Birth
          </label>
          <input
            id="date_of_birth"
            type="date"
            className={inputClasses}
            style={inputStyle}
            {...register('date_of_birth')}
          />
          {errors.date_of_birth && (
            <p className="text-xs mt-1" style={errorStyle} role="alert">
              {errors.date_of_birth.message}
            </p>
          )}
        </div>

        {/* Biological sex */}
        <fieldset>
          <legend className="block text-sm font-medium mb-2" style={labelStyle}>
            Biological Sex
          </legend>
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="male"
                className="accent-accent-green"
                {...register('biological_sex')}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Male</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="female"
                className="accent-accent-green"
                {...register('biological_sex')}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Female</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="radio"
                value="prefer_not_to_say"
                className="accent-accent-green"
                {...register('biological_sex')}
              />
              <span className="text-sm" style={{ color: 'var(--color-text-primary)' }}>Prefer not to say</span>
            </label>
          </div>
          {errors.biological_sex && (
            <p className="text-xs mt-1" style={errorStyle} role="alert">
              {errors.biological_sex.message}
            </p>
          )}
        </fieldset>

        {/* Unit system toggle */}
        <div>
          <span className="block text-sm font-medium mb-2" style={labelStyle}>
            Unit System
          </span>
          <div className="inline-flex rounded-lg overflow-hidden border" style={{ borderColor: 'var(--border-card)' }}>
            <button
              type="button"
              onClick={() => setValue('unit_system', 'imperial')}
              className="px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: unitSystem === 'imperial' ? 'var(--color-sage)' : 'var(--bg-primary)',
                color: unitSystem === 'imperial' ? 'white' : 'var(--color-text-muted)',
              }}
            >
              Imperial
            </button>
            <button
              type="button"
              onClick={() => setValue('unit_system', 'metric')}
              className="px-4 py-2 text-sm font-medium transition-colors cursor-pointer"
              style={{
                backgroundColor: unitSystem === 'metric' ? 'var(--color-sage)' : 'var(--bg-primary)',
                color: unitSystem === 'metric' ? 'white' : 'var(--color-text-muted)',
              }}
            >
              Metric
            </button>
          </div>
        </div>

        {/* Height */}
        <div>
          <span className="block text-sm font-medium mb-1.5" style={labelStyle}>
            Height
          </span>
          {unitSystem === 'imperial' ? (
            <div className="flex gap-3">
              <div className="flex-1">
                <label htmlFor="height_feet" className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                  Feet
                </label>
                <input
                  id="height_feet"
                  type="number"
                  min={0}
                  max={8}
                  className={inputClasses}
                  style={inputStyle}
                  value={heightFeet}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHeightFeet(val);
                    updateTotalInches(val, heightIn);
                  }}
                />
              </div>
              <div className="flex-1">
                <label htmlFor="height_in" className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                  Inches
                </label>
                <input
                  id="height_in"
                  type="number"
                  min={0}
                  max={11}
                  className={inputClasses}
                  style={inputStyle}
                  value={heightIn}
                  onChange={(e) => {
                    const val = Number(e.target.value);
                    setHeightIn(val);
                    updateTotalInches(heightFeet, val);
                  }}
                />
              </div>
            </div>
          ) : (
            <div>
              <label htmlFor="height_cm" className="block text-xs mb-1" style={{ color: 'var(--color-text-muted)' }}>
                Centimeters
              </label>
              <input
                id="height_cm"
                type="number"
                min={0}
                max={275}
                className={inputClasses}
                style={inputStyle}
                value={heightCm}
                onChange={(e) => setHeightCm(Number(e.target.value))}
                placeholder="e.g. 178"
              />
            </div>
          )}
          <input type="hidden" {...register('height_inches', { valueAsNumber: true })} />
          {errors.height_inches && (
            <p className="text-xs mt-1" style={errorStyle} role="alert">
              {errors.height_inches.message}
            </p>
          )}
        </div>

        {/* Weight */}
        <div>
          <label htmlFor="weight_input" className="block text-sm font-medium mb-1.5" style={labelStyle}>
            Weight ({unitSystem === 'metric' ? 'kg' : 'lbs'})
          </label>
          <input
            id="weight_input"
            type="number"
            min={0}
            step="0.1"
            className={inputClasses}
            style={inputStyle}
            value={weightDisplay}
            onChange={(e) => setWeightDisplay(Number(e.target.value))}
            placeholder={unitSystem === 'metric' ? 'e.g. 75' : 'e.g. 165'}
          />
          {errors.weight_lbs && (
            <p className="text-xs mt-1" style={errorStyle} role="alert">
              {errors.weight_lbs.message}
            </p>
          )}
        </div>

        {/* Privacy note */}
        <div
          className="rounded-lg p-4 text-xs leading-relaxed"
          style={{ backgroundColor: 'var(--bg-card)', color: 'var(--color-text-muted)', borderWidth: 1, borderColor: 'var(--border-card)' }}
        >
          This information helps personalize your health reference ranges. It&apos;s stored securely and never shared.
        </div>

        {/* Error */}
        {error && (
          <p className="text-sm text-center" style={errorStyle} role="alert">
            {error}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={submitting}
          className="w-full py-3 rounded-lg font-medium text-sm transition-colors hover:opacity-90 disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, var(--color-terracotta), var(--color-terracotta-light))', color: 'white', boxShadow: '0 4px 14px rgba(224, 122, 95, 0.3)' }}
        >
          {submitting ? 'Saving...' : 'Save & Continue'}
        </button>
      </form>
    </div>
  );
}
