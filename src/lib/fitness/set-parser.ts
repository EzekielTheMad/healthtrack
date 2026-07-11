// ---------------------------------------------------------------------------
// Notion-style shorthand set-string parser.
//
// The owner's gym log encodes sets as free text ("330x12 / 330x12 / 330x8",
// "50/arm x12", "75s / 75s", "130x10 x3"). This module turns those strings
// into the typed set array stored on exercise_entries
// (`{weight?, reps?, seconds?, perSide?, warmup?}`) and back again for
// display. parseSets NEVER throws: anything unrecognizable is returned in
// `unparsed` so callers (API + importer) can keep the raw string as ground
// truth and surface parse gaps instead of dropping data.
//
// Grammar (one token per set, tokens separated by whitespace-delimited "/"):
//   330x12            weight x reps (decimals ok: 47.5x15)
//   200x12 warmup     trailing warmup flag
//   50/arm x12        per-side load (arm/side/leg/hand) -> perSide: true
//   75s | 75 sec      time-based set (seconds)
//   130x10 x3         trailing multiplier -> expands to 3 identical sets
//   460x10x3          compact weight x reps x sets shorthand
// ---------------------------------------------------------------------------

export interface ParsedSet {
  weight?: number;
  reps?: number;
  seconds?: number;
  perSide?: boolean;
  warmup?: boolean;
}

export interface ParseSetsResult {
  sets: ParsedSet[];
  unparsed: string[];
}

/** Sanity ceiling for multiplier expansion ("x3"); beyond this the token is
 *  almost certainly garbage and lands in `unparsed` instead of exploding. */
const MAX_MULTIPLIER = 20;

const WEIGHT = String.raw`\d+(?:\.\d+)?`;

/** weight x reps: `330x12`, `47.5x15`, `130 x 12` */
const WEIGHT_REPS_RE = new RegExp(String.raw`^(${WEIGHT})\s*x\s*(\d+)$`, 'i');
/** compact weight x reps x sets: `460x10x3` */
const WEIGHT_REPS_SETS_RE = new RegExp(
  String.raw`^(${WEIGHT})\s*x\s*(\d+)\s*x\s*(\d+)$`,
  'i',
);
/** per-side load: `50/arm x12`, `35/side x10` */
const PER_SIDE_RE = new RegExp(
  String.raw`^(${WEIGHT})/(?:arm|side|leg|hand)\s*x\s*(\d+)$`,
  'i',
);
/** time-based: `75s`, `75 sec`, `90 secs`, `60 seconds` */
const SECONDS_RE = new RegExp(
  String.raw`^(${WEIGHT})\s*(?:s|sec|secs|seconds)\.?$`,
  'i',
);
/** trailing warmup flag: `200x12 warmup` */
const WARMUP_RE = /\s+warm-?up$/i;
/** trailing set multiplier: `130x10 x3`, `75s x3` (greedy base) */
const MULTIPLIER_RE = /^(.+)\s+x\s*(\d+)$/i;

/** One token (between "/" separators) -> a single set, or null. */
function matchBase(token: string): ParsedSet | null {
  let m = WEIGHT_REPS_RE.exec(token);
  if (m) return { weight: Number(m[1]), reps: Number(m[2]) };
  m = PER_SIDE_RE.exec(token);
  if (m) return { weight: Number(m[1]), reps: Number(m[2]), perSide: true };
  m = SECONDS_RE.exec(token);
  if (m) return { seconds: Number(m[1]) };
  return null;
}

/** One token -> its expanded sets, or null if unrecognizable. */
function parseToken(token: string): ParsedSet[] | null {
  let rest = token;
  let warmup = false;
  if (WARMUP_RE.test(rest)) {
    warmup = true;
    rest = rest.replace(WARMUP_RE, '');
  }

  const flag = (s: ParsedSet): ParsedSet => (warmup ? { ...s, warmup: true } : s);

  // Whole-token match first, so `50/arm x12` reads as per-side reps, never
  // as a bare "50/arm" times 12.
  const whole = matchBase(rest);
  if (whole) return [flag(whole)];

  // Compact weight x reps x sets (`460x10x3`).
  const compact = WEIGHT_REPS_SETS_RE.exec(rest);
  if (compact) {
    const n = Number(compact[3]);
    if (n < 1 || n > MAX_MULTIPLIER) return null;
    const set = flag({ weight: Number(compact[1]), reps: Number(compact[2]) });
    return Array.from({ length: n }, () => ({ ...set }));
  }

  // Trailing multiplier (`130x10 x3`, `75s x3`): base must itself be a
  // complete set for the suffix to read as a set count.
  const mult = MULTIPLIER_RE.exec(rest);
  if (mult) {
    const base = matchBase(mult[1].trim());
    const n = Number(mult[2]);
    if (base && n >= 1 && n <= MAX_MULTIPLIER) {
      const set = flag(base);
      return Array.from({ length: n }, () => ({ ...set }));
    }
  }

  return null;
}

/**
 * Parse a shorthand set string into typed sets. Never throws — tokens that
 * don't match the grammar are returned verbatim in `unparsed`.
 */
export function parseSets(raw: string): ParseSetsResult {
  const sets: ParsedSet[] = [];
  const unparsed: string[] = [];
  const trimmed = (raw ?? '').trim();
  if (trimmed === '') return { sets, unparsed };

  // Separator is a whitespace-delimited "/" — the "/" inside `50/arm` has no
  // surrounding spaces and stays within its token.
  for (const token of trimmed.split(/\s+\/\s+/)) {
    const t = token.trim();
    if (t === '') continue;
    const parsed = parseToken(t);
    if (parsed) sets.push(...parsed);
    else unparsed.push(t);
  }
  return { sets, unparsed };
}

/** One set -> canonical display token. Per-side sets render as `/side`
 *  (source strings may say `/arm`; the unit word isn't stored). */
function formatSet(s: ParsedSet): string {
  let core: string;
  if (s.seconds !== undefined) {
    core = `${s.seconds}s`;
  } else if (s.weight !== undefined && s.reps !== undefined) {
    core = s.perSide ? `${s.weight}/side x${s.reps}` : `${s.weight}x${s.reps}`;
  } else if (s.weight !== undefined) {
    core = `${s.weight}`;
  } else if (s.reps !== undefined) {
    core = `x${s.reps}`;
  } else {
    core = '';
  }
  return s.warmup ? `${core} warmup` : core;
}

/**
 * Inverse of parseSets for display: `[{weight:330,reps:12}, …]` ->
 * `"330x12 / 330x12"`. Multiplier shorthand is not re-compressed — expanded
 * sets render one token each. parseSets(formatSets(sets)) round-trips.
 */
export function formatSets(sets: ParsedSet[]): string {
  return sets.map(formatSet).join(' / ');
}
