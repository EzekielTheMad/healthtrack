# Body measurements

Circumference readings — waist, chest, biceps, thighs and the rest — live in
the same vitals system as every other metric. They are **not** daily vitals,
though, and HealthTrack treats them differently on purpose: you take them
occasionally, with a tape or a scan, so everything below is built around
sparse, point-in-time readings rather than a daily average.

For the ingestion contract (metric keys, units, idempotency), see
[API.md](API.md#body-measurements-circumferences).

## Where they appear

| Surface | What it shows |
| --- | --- |
| **Vitals → Measurements** (`/vitals?view=measurements`) | The main view: latest readings, change since the previous reading, trend charts, and a range report. |
| **Vitals → All metrics** | Each measurement as a generic metric card alongside every other vital. |
| **Fitness → Weekly**, Body card | A compact summary — the measurement date, a few readings, and a link into the Measurements view. |
| **Health Overview** (AI) | Latest and previous readings with dates, only when AI is configured. The deterministic report above never depends on AI. |

The Vitals view selector is linkable: `/vitals?view=measurements` opens
Measurements directly and survives a refresh. An unrecognized `view` value
falls back to Focus.

## How comparisons work

### Change is against the previous reading, not a 7-day average

Daily vitals compare today against the trailing seven days. That would be
meaningless here — a tape session every few weeks has no 7-day window to
average. Each measurement is compared with **the immediately previous reading
of that same measurement**, and the card shows that reading's date:

```
Waist   38.1 in   −0.5 in since Jul 6
```

Because each metric is compared with its own history, two measurements shown
side by side can be measured against different dates. That is expected when
you do not measure everything every time.

### Baseline

A measurement with only one reading has nothing to compare against. It is
labeled **Baseline** rather than shown as a change of zero. The report table
does the same, and the whole latest-measurements card says so when no
measurement has a second reading yet.

### Unchanged vs. a misleading `+0.0`

Measurements display to one decimal. A change smaller than half of that step
(0.05 in) would render as `+0.0`, which overstates what a tape measure can
tell you, so it is reported as **No change** instead. The stored value is
untouched — display precision is applied at render time only, never on the
way into the database.

### Changes are neutral

A waist that grew and a bicep that grew are not automatically bad and good
news. HealthTrack does not color measurement changes red or green, and the
report never calls a change an improvement or a regression.

The one exception is an explicit goal. If you set an active goal for a
measurement (increase, decrease or maintain), that goal supplies the
direction, and the change is toned against it — the same goal-direction
mechanism the rest of the app uses. Without a goal, the change stays neutral.

## Independent left and right series

Unsided (`waist`, `bicep`), `left_*` and `right_*` are **separate series**
throughout. HealthTrack never copies one side to the other, never averages
them into an unsided value, and never invents an unsided reading from a
left/right pair. If you only measured your left bicep, only the left bicep is
shown.

Bilateral values render side by side for easy comparison, but each keeps its
own history, its own previous reading and its own chart line. A left/right
difference is not interpreted medically anywhere in the app, including in AI
output.

## Missing values

An unmeasured metric is **unknown, not zero**. Missing readings are omitted
entirely rather than rendered as a wall of dashes, and a whole group (Core,
Arms, Legs) disappears when nothing in it has been measured.

## Trends

The Measurements view charts any combination of measurements over 3 months,
6 months, 1 year or all time. Presets (Core, Upper body, Arms, Legs) only
**select** series — no preset derives, combines or averages anything, and left
and right always stay separate lines.

Two behaviors keep sparse data honest:

- The latest measurement is never hidden by the range you picked. The
  latest-measurements card always reads your full history; the range applies
  to the chart and the report.
- Consecutive readings more than 120 days apart are not joined by a line
  segment. A straight run across four months of silence would look like
  measured progress that was never taken.

A single reading renders as a single point rather than an empty chart.

## Report

The report is derived from your canonical vitals every time you open it —
nothing is stored, and no ratios (waist-to-hip and friends) are persisted.
For each measurement with data in the selected range it gives the first
reading and its date, the latest reading and its date, the absolute change,
and how many readings there were.

It does not annualize, extrapolate, or project. A change spans whatever time
separates those two readings, which the view says plainly. Measurements with
a single in-range reading report Baseline. The report is fully deterministic
and works with AI disabled.

## Sources

HealthTrack is provider-neutral. Any integration, script or manual entry that
writes the canonical metric keys appears here, and the free-form `source` on
each reading is rendered as-is — as an "As of" source badge on the latest
session and in chart tooltips. There is no allowlist of approved devices and
no vendor-specific behavior in the registry, the API or these views.

Readings from different sources on different dates coexist without special
handling; each value carries the date and source it actually came from.
