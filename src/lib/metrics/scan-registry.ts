import { WEB_SCAN_METRICS } from '@/lib/fidelity/web-scan-contracts';
import { METRICS, type MetricDef } from './registry';

/** Report-only vocabulary. Deliberately never added to the daily vitals/feed registry. */
const reportLabels: Record<(typeof WEB_SCAN_METRICS)[number], string> = {
  lean_mass_left_arm: 'Left arm lean mass',
  lean_mass_right_arm: 'Right arm lean mass',
  lean_mass_left_leg: 'Left leg lean mass',
  lean_mass_right_leg: 'Right leg lean mass',
  lean_mass_trunk: 'Trunk lean mass',
  fat_mass_left_arm: 'Left arm fat mass',
  fat_mass_right_arm: 'Right arm fat mass',
  fat_mass_left_leg: 'Left leg fat mass',
  fat_mass_right_leg: 'Right leg fat mass',
  fat_mass_trunk: 'Trunk fat mass',
  soft_lean_mass: 'Soft lean mass',
  subcutaneous_fat_mass: 'Subcutaneous fat mass',
  visceral_fat_mass: 'Visceral fat mass',
  protein_mass: 'Protein mass',
  mineral_mass: 'Mineral mass',
  bone_mineral_content: 'Bone mineral content',
  body_cell_mass: 'Body cell mass',
  phase_angle: 'Phase angle (source-defined)',
  skeletal_muscle_index: 'Skeletal muscle index (source-defined)',
  ecw_ratio_left_arm: 'Left arm ECW ratio (source-defined)',
  ecw_ratio_right_arm: 'Right arm ECW ratio (source-defined)',
  ecw_ratio_left_leg: 'Left leg ECW ratio (source-defined)',
  ecw_ratio_right_leg: 'Right leg ECW ratio (source-defined)',
  ecw_ratio_trunk: 'Trunk ECW ratio (source-defined)',
};

export function isSourceDefinedScanMetric(key: string): boolean {
  return key === 'phase_angle' || key === 'skeletal_muscle_index' || key.startsWith('ecw_ratio_');
}

export const SCAN_METRICS: readonly MetricDef[] = [
  ...METRICS.filter((metric) => ['body_composition', 'body_measurement'].includes(metric.category)),
  ...WEB_SCAN_METRICS.map(
    (key): MetricDef => ({
      key,
      label: reportLabels[key],
      category: 'body_composition',
      unit:
        key === 'phase_angle'
          ? 'degrees'
          : key === 'skeletal_muscle_index'
            ? 'kg/m²'
            : key.startsWith('ecw_ratio_')
              ? 'fraction'
              : 'lbs',
      valueType: 'number',
      chart: 'stat',
      aggregate: 'latest',
      min: 0,
      ...(key.startsWith('ecw_ratio_') ? { max: 1 } : {}),
      dashboardEligible: false,
    })
  ),
];
const scanMetricsByKey = new Map(SCAN_METRICS.map((metric) => [metric.key, metric]));
export function getScanMetric(key: string): MetricDef | undefined {
  return scanMetricsByKey.get(key);
}

export function scanMetricUnits(key: string): readonly string[] {
  const unit = getScanMetric(key)?.unit;
  if (unit === 'lbs') return ['kg', 'lbs'];
  if (unit === 'in') return ['cm', 'in'];
  if (unit === 'fraction') return ['fraction', '%'];
  if (unit === 'degrees') return ['degrees', '°'];
  if (unit === 'kg/m²') return ['kg/m²', 'kg/m2'];
  if (unit === 'cm²') return ['cm²', 'cm2'];
  if (unit === null)
    return key === 'bmi' ? ['unitless', 'kg/m²', 'kg/m2'] : ['unitless', 'level', 'score'];
  return unit ? [unit] : [];
}
