# HealthTrack next-release fidelity — proposal 1

## Current web completion extension — Nov2,2026

The approved **HealthTrack web completion — proposal1** adds all29 previously deferred clinical/scan feedback requirements and the four ordinary-form controls in [WEB-COMPLETION.md](WEB-COMPLETION.md). The final target is a **web-focused2.1.0** release. Earlier HF acceptance, IDs and version-labelled evidence remain historical and unchanged. Android AC-04 keeps its original wording/history but is **deferred and unverified**, outside the web release acceptance denominator. Other external release gates remain open. Implementation is active; this scope capture is not acceptance, publication or deployment.



This is the single canonical goal record for HF-01 through HF-08. It supplements
[v2](V2.md); existing AC requirements, accepted evidence and unfinished v2 gates
remain separate. The earlier HF baseline was source
`9b05c165d8ffe8b2403113abc924909ef299e729`, then the historical fidelity candidate
used **2.1.0-alpha.1**. Those dated identities are not a current deployment feed.

The current local web completion candidate is **2.1.0**. Its implementation and
source checks do not establish browser acceptance, stable publication or a new
deployment, and do not waive the remaining release gates.

## User outcomes

These original HF outcome statements retain their proposal context. The current
web-completion clinical and scan outcomes are defined in [WEB-COMPLETION](WEB-COMPLETION.md);
previous acceptance stays bound to its recorded source and evidence.

The original HF goal was **Import health records and compare body scans**: review qualified
lab results, medication schedules and explicitly reported dose events; preserve their
source and date details; and read distinct body scans faithfully in the app and exports.
The HF acceptance criteria below define this goal. Final browser/export checks and
exact-candidate verification must finish before acceptance.

The historical next goal was **Publish the reviewed health-history update for source
review**. It depends on this goal's accepted local candidate and separate publication
approval. Source push, a new draft pull request and its actual checks are separate
from merge, release publication and deployment. **Finish the v2 release checks and
publication** remains a separate blocked goal under [v2](V2.md); this work does not
waive its provider, phone, consent or release gates.

## Approval and ownership

The bounded proposal was approved on 2026-10-31, confirming owner approval
in app, manual/typed-JSON scan inputs and explicit new clinical grants.
Local implementation, local commits,
synthetic verification and isolated resource-bounded Unraid fictional instances
are authorized. Production data/access/maintenance, provider calls, credentials,
consent, device control and external source/PR/CI/registry/release actions retain
separate gates. Previous provider-test allowances are inactive here.

One product owner retains integration, acceptance and reporting authority.
Private coordination and workspace assignments are maintained outside the
publication tree. Up to two temporary workers
and one later read-only exact-candidate reviewer are authorized; worker output
alone is not integrated acceptance.

| Responsibility | Ownership                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------ |
| Integration    | Shared contracts, schema/migrations, security, API assembly, context, summaries, export and acceptance |
| Clinical       | Clinical service, domain routes, typed intake and clinical UI, in an isolated workspace                |
| Scans          | Scan service, metrics, domain routes and scan UI, in an isolated workspace                             |
| Reviewer       | One read-only exact-candidate review after integration, reused for fixes                               |

Preserve inherited AGENTS.md, v2/upgrade documentation, private dashboard reports,
existing PR16 branch and historical `.claude` worktree. Feature commits belong to
the new branch; unrelated inherited edits are not staged with feature commits.

## Observable acceptance

| ID    | Required behavior                                                                                                                                                                                                                                                            |
| ----- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| HF-01 | Numeric, qualitative, censored and canceled labs retain comparator, raw text/unit, reference bounds/text and printed versus derived flags through preview/save/reopen/API/export. Include Negative, <5, >59, canceled, zero and Not established.                             |
| HF-02 | Included clinical/scans retain explicit date precision, collection/event/report/receipt distinctions, source/document/page evidence, uncertainty and conflicts. No migration invents historical certainty.                                                                   |
| HF-03 | Medication/supplement strength/concentration, amount, route, PRN, variable schedules, prescribed/actual use, date/status and separately reported administration/missed/intentional-skip events persist; absence never implies a missed dose.                                 |
| HF-04 | Supported typed self-scoped API intake stages a preview. Only owner browser approval of exact batch/content/subject/expected revisions commits; stale/changed previews fail, retries/readback/per-item outcomes and audited corrections are durable. No new hard-delete API. |
| HF-05 | Durable scan/source/device/method/known-date/conditions identity preserves same-day repeats and replay idempotency. Seven core metrics coexist with supported existing metrics; missing remains missing.                                                                     |
| HF-06 | Supported bounded history/latest provenance and coherent scan views honor explicit source choice, show device/condition comparison boundaries and label BIA outputs estimates.                                                                                               |
| HF-07 | Relevant UI, typed API, export, doctor summary and app/API context retain qualifiers, medication intent/actual-use separation and authorization. Verify mobile entry/readback and browser bulk review; publish a complete capability matrix and limitations.                 |
| HF-08 | Existing feeds, numeric/day API contracts, permissions, IDs/values/files/keys survive. Exact-candidate synthetic upgrade and compatible old-image restore plus actual UI→API→DB→reload/export and independent integrated review pass.                                        |

## Shared contracts — HF v1

Selected-person preferences persist per account in the current browser tab. Reload
revalidates that person's current access before rendering records; an unavailable
person requires an explicit new choice. A later manual choice updates an existing
browser/native handoff's person parameters. Account/session changes require fresh
validation. No credentials or cached permissions are stored with the preference.

Settings data export includes owned detailed clinical history, scans and correction
audits. An older sign-in offers a visible current-password form with browser autofill.
Confirm authentication, then select **Export as JSON** again from the current account
view. Alternate sign-in clears the old session before returning to login. The server
still requires recent authentication and exports only the account's owned people.

- Wire fields use snake_case; runtime schemas/types live in
  `src/lib/fidelity/contracts.ts`. Strict schemas reject unsupported fields;
  no silent conversion of unsupported source content into accepted facts.
- A date is `{precision: unknown|year|month|day|instant, value, original_text?,
approximate?}`. Unknown has null value. Instants require an explicit offset;
  a separately reported timezone is retained. Date-only/partial values are not
  timestamps. Legacy adapters retain original date text with unknown precision;
  no stored historical values are rewritten.
- Lab outcome is numeric (`=`), censored (independent `<|<=|>|>=` and bound),
  text, or canceled. Original result/unit, optional explicitly sourced normalized
  quantity, printed flags and derived interpretation remain distinct. Censored
  bounds and nonnumeric outcomes never become legacy exact numeric results.
- Provenance has basis, verification, bounded source references/document ID/page
  and notes. Existing protected-file authorization still applies independently;
  a reference does not grant original access. Collection/report/receipt dates
  have different fields; receipt timestamps are server-controlled.
- Structured medication facts and administration events are separate typed
  records. Product strength/concentration and administered amount are separate;
  variable schedules and prescribed/patient-reported use remain independent.
  Events reference an authorized medication; no absent-event adherence inference.
- Typed clinical facts use additive `clinical_records` sidecars. Existing lab,
  medication and saved document-review tables/flows remain intact. Typed reads
  adapt legacy records with explicitly unknown provenance and merge supported
  new records; legacy numeric APIs remain byte-compatible and explicitly omit
  sidecars unless an explicitly corrected record supersedes an old projection.
  New facts are not silently written through legacy day/numeric paths.
  Corrections preserve stable selected IDs and use existing append-only
  `clinical_corrections` with before/after evidence and a reason.
  Explicitly selected legacy corrections/enrichments create an audited typed
  overlay (`legacy_table`, `legacy_id`, `legacy_revision`) without changing old
  stored values. Typed reads suppress the superseded legacy adapter only while
  its expected base revision matches. A later old-editor change exposes a
  conflict and both versions rather than silently hiding the change. Default
  legacy current projections omit superseded rows, including conflicted bases,
  with explicit omitted-count/typed-read coverage headers. Untouched rows retain
  identical contracts. The original bytes remain historical evidence, never a
  falsely current exact value after a qualified/canceled correction. Shared
  context/summary consumers suppress those old current rows and display typed
  corrections/conflicts; exports retain labelled source history. Legacy receipt
  timestamps remain null, never inferred from created_at.
- `write:clinical_intake` is an explicit PAT grant; `write:all`, read-only and
  device tokens do not satisfy it. It stages/reads its own owner's self-subject
  intake only. There is no PAT commit capability. Browser owner intake may target
  owned dependents after authorization. New approval rights do not extend to
  delegates/shares; existing legacy rights remain unchanged.
- Intake is at most 100 typed items, each with stable item_key, action
  add/correct/link/skip and, for selected existing targets, expected_revision.
  Owner review may revise a pending batch; revision changes invalidate the old
  digest. Approval binds owner, subject, batch ID/version and exact reviewed items.
  Recheck ownership, selected record revisions and current matches in one
  transaction; persist unique batch-item outcomes. Repeat requests never repeat
  canonical writes; conflicting replay/content stays reviewable.
- Body scans use `body_scans`, never the legacy vitals upsert identity. Unique
  owner/subject/source/external_id identifies replay; changed content at that
  identity yields a conflict. New external IDs permit same-day repeats. Payload
  retains raw values/units/text plus separately normalized measurements and known
  conditions. Missing context is unknown, not inferred hydration/exercise data.
- Scans support manual entry and typed JSON only. New `write:scans` is explicit
  (also excluded from wildcard grants); reads retain existing vitals authorization.
  Scan values remain source/device coherent; do not assemble a session from
  unrelated latest metrics. Explicit source preferences remain authoritative.
- Mass scan conversion preserves unrounded canonical values and raw source
  evidence; no changes to legacy vitals' quantized kg conversion. Core mass
  outputs accept kg/lbs, ECW fraction accepts fraction/% with explicit conversion,
  visceral area uses cm². Never assume liters equal kilograms. Estimated scan
  circumferences remain distinct from direct tape series. Vendor calorie advice
  never changes nutrition intake/expenditure/adopted targets.
- Seven new registry keys: skeletal_muscle_mass, body_fat_mass, total_body_water,
  intracellular_water, extracellular_water, ecw_ratio, visceral_fat_area.
- Opt-in `format=typed` extends clinical and vital API reads; defaults remain
  compatible. Dedicated `/api/v1/scans` exposes coherent sessions; browser
  `/clinical-intake` and `/scans` provide entry/review/readback. Bounded metadata
  and coverage warnings describe legacy/typed and history/latest limitations.
- Integration owns all shared contracts, migration numbers/journal/schema exports,
  security policy, OpenAPI assembly, context/doctor/PDF/export and reporting.
  Migration `0017_fidelity_contracts` adds only sidecar/intake/scan tables; workers
  do not allocate migrations or alter shared exports. Future migrations require
  serialized allocation here.

## Implementation boundaries and agreed interfaces

Clinical worker owns `src/lib/fidelity/clinical.ts` and its tests, clinical domain
routes/components/pages (labs/medications and new clinical-intake/clinical-records),
typed adapters for clinical reads and controlled extraction/import fidelity.
Expose `listClinicalFacts(actorId, {ownerId, dependentId}, {limit?,kind?}?)`
returning `FidelityRecord[]`, plus staged batch review/revision/approval helpers.
New browser/API owner fences must not replace or loosen old authz policy.

Scan worker owns `src/lib/fidelity/scans.ts` and tests, metric registry/scan unit
normalization, `/scans`, scan components/routes, vitals typed metadata/history/latest
routes and focused tests. Expose `listBodyScans(actorId, {ownerId,dependentId},
{limit?,source?}?)` returning `BodyScan[]`, preserving source/raw evidence.

Workers do not edit shared contracts/schema/journal, OpenAPI, context, doctor/PDF,
exports or dashboard/canonical docs. They do not spawn agents, publish, access
production, call providers, operate devices or create credentials. Root integrates
their local commits incrementally and owns complete-app acceptance.

## Capability matrix and evidence

The existing persisted interaction-check widget is a legacy-regimen surface.
When current/unconfirmed typed medication facts or legacy-overlay conflicts are
present it returns an explicit review-required result before any model call,
rather than produce/cache an incomplete all-clear. Full structured history is
included in app/API context, general queries, health overview and doctor exports.
No adherence or treatment decision is inferred from this coverage limitation.

Backend slices, UI and shared consumers have passed bounded local acceptance.
The dated checkpoint below binds the tested code, actual fictional workflows and
explicit limits. It does not establish production, provider or physical-phone acceptance.

| Domain                     | Storage                   | API read/write                                   | UI entry/review                                              | Import                                                                                                | Chart                                                                                          | Export/summary/context                                                |
| -------------------------- | ------------------------- | ------------------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| Typed labs                 | Additive clinical sidecar | Opt-in typed read / staged owner approval        | Structured form and bulk preview/review                      | Typed JSON; opt-in generic PDF/PNG/JPG lab preview; existing numeric default/history import preserved | Qualified outcomes appear in lists; typed sidecars are not inserted into legacy numeric trends | Qualified text, complete typed JSON, doctor summary and context       |
| Medication/regimens/events | Additive clinical sidecar | Typed read / staged owner approval               | Structured form and bulk review, audit and per-item outcomes | Typed JSON; full-history document extraction not expanded                                             | No adherence inference or new adherence chart                                                  | Prescribed, actual use and events remain distinct                     |
| Core scans                 | Coherent source payload   | Identified create / bounded typed history/latest | Manual and JSON preview/confirm, source-aware comparisons    | Typed JSON; vendor parsers deferred                                                                   | Separate source/device series, explicit missing data and estimate labels                       | Coherent source-labelled values in export, doctor summary and context |

The scan manual form exposes the common measurements, source/report identity,
device/method, known date precision and condition notes. Named timezone, exact
workout timestamp, supplement links and structured document/page references are
available through typed JSON; they do not all have separate manual controls.
Same-day scans are separate records, not inferred tape sessions.

Generic typed lab extraction is opt-in and stages owner review; upload never
writes canonical clinical facts. It is bounded to 10 MB, a single extraction
pass, 100 staged items, 2,000 retained source rows and a 512-KiB extraction reply.
These are not a per-page or complete-history coverage guarantee. Unsupported
rows remain held source evidence rather than disappearing or becoming numeric
facts. Repeated files reopen the saved preview without another extraction call.
Vendor scan PDF/CSV parsing remains deferred.

Typed lab reads support the existing analyte-name filter before their bounded
history limit. They reject `days` with an actionable error rather than silently
ignore it or force partial/unknown collection dates into a precise window.

Legacy numeric lab reads and trends omit typed-only or superseded results and
declare their coverage; they never plot a censored bound as an exact result.
The typed records page, doctor summary, context and complete export carry those
results. Original-document links require their existing separate authorization.

See [fidelity upgrade and recovery](FIDELITY-UPGRADING.md) for the compatible
image/data-pair requirement and the release boundary.

Required fixtures: typed lab edge cases; partial/unknown/offset dates; owner vs
dependent/delegate/share/token fences; exact digest/revision invalidation;
changed content/repeated/reversed import/retry/concurrent approval; event links
and explicit skipped versus absent events; source units/precision; two devices
and same-day repeats; missing versus zero; context/cache revision and subject
isolation; upgrade/idempotent restart/compatible old restore with keys/originals.

Disposable Unraid verification starts with read-only capacity/isolation inventory,
2 CPU/4GiB build and 1CPU/1GiB runtime bounds, no production mounts, fresh fictional
volumes, loopback-only exposure and owned resource/process cleanup. Docker Desktop
repair is excluded. No real provider accuracy is inferred from extraction fixtures.
Finish with an integrated exact commit, one read-only reviewer and fixes, capability
evidence, migration/recovery/release notes and a complete external-action dry run.

### Bounded local acceptance — 2026-11-01

HF-01 through HF-08 pass within the fictional-data and local verification scope
recorded here. Tested product code is `6b01b875c8721f9d334732d17b79502244a2bd98`,
tree `7ca0860f108a13f9cba7e257be8bdc90efc98c39`, version `2.1.0-alpha.1`.
The exact AMD64 image is
`sha256:90848c53f7a62ebca7cb37fb6f7fb435fae2e6576d6e22f3f32d1c3ac0136dc8`.
Documentation-only publication preparation is a separate source identity: every
non-document file must match this tested code, and the final notes/privacy/history
must be reviewed. A documentation commit is not a newly tested binary.

- All 216 test files / 2,023 tests pass with four workers; TypeScript passes;
  lint has zero errors and 15 existing warnings. One existing five-second test
  timed out under the initial default parallel load, then passed in isolation
  and in the full bounded run with its timeout and logic unchanged.
- Actual signed-in browser workflows at 375/390 pixels cover manual and typed
  bulk entry, saved preview, owner acknowledgement/approval, replay, selected
  correction, three explicit medication events, person isolation and reload.
  Final stored evidence contains 11 self clinical facts, one dependent fact,
  four distinct scans and one correction audit. Original qualifiers, partial
  dates, source references, raw units and unrounded normalized values survive.
- The Family form saves an unknown biological sex and preserves a January 1
  birthday. Selected-person reload validates current access before rendering.
  A genuinely missing self profile counts as incomplete setup: the fictional
  record shows 3/6 completed steps; authorization/server failures remain unknown.
- The actual older-session data export presents an autofill-compatible password
  form. Confirmation may remount the page; the next explicit Export action
  downloads from the current account view. The downloaded JSON matches every
  accepted clinical fact, scan payload/measurement and correction audit, with
  no credential fields. Export remains a bounded set of sections: dependent
  demographics are not a separate export section, and original files, fitness,
  nutrition and integration history are excluded.
- Both actual patient-scoped doctor PDFs were rendered: five self pages and
  two dependent pages. All seven pages pass strict text-coordinate bounds and
  visual review, including qualified/canceled/zero results, source details,
  prescribed versus reported use, dose events and separate scan evidence.
  A reproduced page-splitting defect hid a dose event despite extractable text;
  normal-flow history rows fix it. A real-renderer regression and a long-name
  fixture cover this failure, with failed prior artifacts retained as evidence.
- Exact-image synthetic upgrade, idempotent restart and compatible old-image
  restore pass all 11 checks: 56 prior tables, 89 rows, nine populated native
  domain groups and three key/original files are preserved. One independent
  exact-source reviewer found no remaining actionable issue after fixes.

Earlier 40 authenticated API grant/concurrency/isolation checks and 13 persisted
readback checks remain bound to source
`475ae4f6b78f94b19e7fb1117115f1d30d4483d4`; they were not silently relabelled
as new executions. API routes and server-auth code are unchanged; the retained
clinical-service delta is coverage wording. Final browser readback and downloads
are current tested-code evidence. No additional provider calls were made.

This closes the bounded local health-history/scan goal. Real extraction accuracy,
remaining provider acceptance, physical Android groups, Oura consent/delivery,
production sign-in checks, native ARM64 execution for this source and the final
stable release retain their separate v2 gates. Publishing source/PR/CI, merging,
tagging, publishing images and deploying still require their separate approvals.

### Historical local integration checkpoint — 2026-10-31

This subsection preserves the earlier checkpoint. Its pending checks describe
that date; the current bounded local result and limits are recorded above.

The separate local integration branch contains both domain backends and UI.
Initial worker focused proofs passed 32 scan and 30 clinical/repository/route checks;
these are source/synthetic evidence, not full-app acceptance.
Shared consumers connect source-aware scans and typed clinical corrections
to context, doctor PDF inputs, complete owned typed export and guarded overview
caches. Focused context/interaction/summary regressions passed 29 checks, with
two additional cache-generation race/input tests; whole-project types and focused
lint pass. No real provider calls were made.

Superseded legacy rows are absent from current numeric projections. Typed
corrections/conflicting legacy evidence remain visible downstream; changed
records invalidate answer fingerprints and prevent stale in-flight summary saves.
Latest typed doctor labs follow collection-day evidence, not late-import receipt
order. Structured clinical review and source-aware scan UI are integrated.
At that checkpoint, the final document-extraction/reconciliation tail was being checked. Actual
UI→API→database→reload/export, PDF rendering, exact
candidate upgrade/old-image restore, full suite/build and one independent reviewer
remained pending. Production and existing v2 acceptance gates remained unchanged.

## Scope after web completion extension

WC1 includes the previously deferred encounters/historical height, diagnostic
sleep/PAP reports, screenings, conditions/procedures/allergy review/genetics and
regional/specialized/vendor scan evidence in [WEB-COMPLETION](WEB-COMPLETION.md).
Vendor PDF/CSV/full-history parsers, expanded attachment management, automatic
clinical interpretation/scoring, treatment recommendations, adherence reminders,
vendor-driven nutrition/training targets and Hevy duplication remain deferred.
Minimal source references and existing protected originals are reused. Unsupported
content must be rejected/held with an explanation, never silently discarded.

## Feedback disposition ledger

The source attachment is product input, not authority for all 85 entries. Stable
FB numbers below follow its original order. The original HF scope and approved WC1 extension control each
included/reused/deferred disposition; source details and real clinical records
must not enter fixtures or publication.

Source SHA-256: `463b86c47ebd5ae99f3cf7d675efec43b591a3aef0f8bf24d4d2c0dfeb5f5461`.

| Input  | Feedback item                                                                                                                  | Disposition      | Trace / limit                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------ | ---------------- | ---------------------------------------------------------------------------- |
| FB-001 | Support numeric, text/qualitative, censored, and canceled results explicitly                                                   | included         | HF-01/HF-02                                                                  |
| FB-002 | Store comparison operators independently of numeric values                                                                     | included         | HF-01/HF-02                                                                  |
| FB-003 | Preserve original result text, units, and any normalized representation                                                        | included         | HF-01/HF-02                                                                  |
| FB-004 | Store reference intervals, including bounds/operators or textual ranges                                                        | included         | HF-01/HF-02                                                                  |
| FB-005 | Separate printed laboratory flags from derived range interpretation                                                            | included         | HF-01/HF-02                                                                  |
| FB-006 | Separate specimen collection time, report time, and import time                                                                | included         | HF-01/HF-02                                                                  |
| FB-007 | Group results by specimen, panel, and source report                                                                            | included         | HF-01/HF-02                                                                  |
| FB-008 | Allow optional collection context such as fasting status and linked medication-dose events                                     | included         | HF-01/HF-02                                                                  |
| FB-009 | Represent product strength/concentration separately from administered amount                                                   | included         | HF-03                                                                        |
| FB-010 | Support route, PRN instructions, and full prescription directions                                                              | included         | HF-03                                                                        |
| FB-011 | Support split and variable schedules with multiple weekly doses                                                                | included         | HF-03                                                                        |
| FB-012 | Separate prescribed instructions from patient-reported actual use                                                              | included         | HF-03                                                                        |
| FB-013 | Support dated administration, missed-dose, and intentionally skipped-dose events                                               | included         | HF-03                                                                        |
| FB-014 | Support supplement history with dose, start/stop dates, and approximate-date precision                                         | included         | HF-03                                                                        |
| FB-015 | Distinguish active, historical, discontinued, and unconfirmed medication status                                                | included         | HF-03                                                                        |
| FB-016 | Represent date precision explicitly: year, month, day, or exact timestamp                                                      | included         | HF-02/HF-04                                                                  |
| FB-017 | Keep clinical event, signature, report, and ingestion dates distinct where applicable                                          | included         | HF-02/HF-04                                                                  |
| FB-018 | Attach source document identity and page-level evidence references                                                             | included         | HF-02/HF-04                                                                  |
| FB-019 | Track whether a value is source-reported, derived, or patient-reported                                                         | included         | HF-02/HF-04                                                                  |
| FB-020 | Preserve unresolved conflicts and verification status                                                                          | included         | HF-02/HF-04                                                                  |
| FB-021 | Provide previewable, idempotent clinical writes with exact readback                                                            | included         | HF-02/HF-04                                                                  |
| FB-022 | Publish typed clinical read/write schemas and validation rules                                                                 | included         | HF-02/HF-04                                                                  |
| FB-023 | Return per-item import outcomes and retain source identity                                                                     | included         | HF-02/HF-04                                                                  |
| FB-024 | Add generic encounter heart rate, separate from `resting_hr`                                                                   | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-025 | Add historical height measurements, separate from profile height                                                               | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-026 | Tag measurement context such as office spot, home spot, or overnight aggregate                                                 | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-027 | Group observations by encounter or measurement session                                                                         | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-028 | Retain multiple legitimate same-day observations without overwriting                                                           | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-029 | Add diagnostic sleep-study records distinct from daily PAP metrics                                                             | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-030 | Capture study type, test date, and separately labeled AHI definitions                                                          | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-031 | Capture study-level oxygen statistics and time below labeled thresholds                                                        | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-032 | Add PAP summary-report windows with start/end dates                                                                            | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-033 | Preserve usage numerator, denominator, and threshold definition                                                                | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-034 | Record statistic type and averaging denominator when supplied                                                                  | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-035 | Support overlapping reports without double-counting their contents                                                             | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-036 | Add instrument-specific screening records with name/version and administration date                                            | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-037 | Support total scores, optional item responses, and functional-impact responses separately                                      | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-038 | Allow qualitative screening results without a numeric score or complete form                                                   | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-039 | Distinguish repeat administrations from copied screening history                                                               | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-040 | Separate ordered, planned, canceled/deferred, and completed procedures                                                         | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-041 | Preserve procedure event dates and coding systems independently                                                                | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-042 | Represent condition certainty, activity, and temporal scope separately                                                         | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-043 | Distinguish unknown allergy status from verified no-known-allergy status                                                       | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-044 | Treat qualitative genetic results and counseling as suitable report/history records                                            | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-045 | `skeletal_muscle_mass` — mass                                                                                                  | included         | HF-05                                                                        |
| FB-046 | `body_fat_mass` — mass                                                                                                         | included         | HF-05                                                                        |
| FB-047 | `total_body_water` — mass                                                                                                      | included         | HF-05                                                                        |
| FB-048 | `intracellular_water` — mass                                                                                                   | included         | HF-05                                                                        |
| FB-049 | `extracellular_water` — mass                                                                                                   | included         | HF-05                                                                        |
| FB-050 | `ecw_ratio` — dimensionless fraction                                                                                           | included         | HF-05                                                                        |
| FB-051 | `visceral_fat_area` — cm²                                                                                                      | included         | HF-05                                                                        |
| FB-052 | Lean mass for left/right arms, left/right legs, and trunk                                                                      | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-053 | Fat mass for left/right arms, left/right legs, and trunk                                                                       | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-054 | Keep `fat_free_mass` distinct from skeletal muscle and soft lean mass                                                          | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-055 | Clarify the definition of `muscle_mass_pct` in documentation and UI                                                            | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-056 | Label the existing `visceral_fat` value as a source/device-specific level or score                                             | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-057 | Keep existing weight, BMI, fat percentage, water percentage, BMR, and circumference metrics                                    | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-058 | Identify scan-estimated circumferences separately from direct tape readings                                                    | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-059 | Preserve source-reported values alongside derived calculations and rounding differences                                        | reused/clarified | HF-05/HF-06; preserve existing metric meanings                               |
| FB-060 | Assign a shared scan ID to all values from one report                                                                          | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-061 | Preserve device manufacturer/model and measurement method                                                                      | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-062 | Preserve exact measurement time/timezone when known                                                                            | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-063 | Record pre-workout, post-workout, or unknown status with optional workout timing                                               | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-064 | Allow optional fasted/fed status and collection-condition notes                                                                | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-065 | Link supplement exposure from its own history instead of duplicating it per scan                                               | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-066 | Expose provenance metadata in standard history and latest-value responses                                                      | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-067 | Make charts and rollups source-aware, with an explicit source selection policy                                                 | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-068 | Display BIA outputs as estimates and flag noncomparable conditions                                                             | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-069 | Keep muscle and water compartments visibly overlapping in explanations                                                         | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-070 | Keep vendor calorie recommendations separate from intake, expenditure observations, and adopted targets                        | included         | HF-02/HF-03/HF-05/HF-06; no new nutrition targets                            |
| FB-071 | Add soft lean mass when a source actually reports it                                                                           | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-072 | Consider subcutaneous-fat mass and visceral-fat mass as separate optional metrics                                              | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-073 | Preserve estimated protein mass, mineral mass, bone mineral content, and body cell mass as explicitly labeled optional outputs | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-074 | Consider phase angle, skeletal muscle index, and regional ECW ratios when populated                                            | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-075 | Archive proprietary scores, body-age outputs, reference bands, and vendor recommendations with their source identity           | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-076 | Provide protected original-report attachments or durable source references                                                     | reused/bounded   | HF-02; durable references/existing protected originals only                  |
| FB-077 | Derive ratios where valid inputs exist, while preserving reported-only ratios as source evidence                               | included/WC1 | Approved web completion proposal1; docs/WEB-COMPLETION.md; implementation/acceptance in progress |
| FB-078 | Provide a release capability matrix: storage, API read/write, UI entry, import, chart, and export                              | included         | HF-07/HF-08                                                                  |
| FB-079 | Preserve old records, adapters, and API behavior during migration                                                              | included         | HF-07/HF-08                                                                  |
| FB-080 | Normalize units in one server-side layer and preserve source units in provenance                                               | included         | HF-07/HF-08                                                                  |
| FB-081 | Test missing, unknown, canceled, zero, and not-applicable states separately                                                    | included         | HF-07/HF-08                                                                  |
| FB-082 | Verify representative imports through exact readback and export                                                                | included         | HF-07/HF-08                                                                  |
| FB-083 | Exercise clinical edge cases from the reconciliation in tests                                                                  | included/WC1 | Existing HF fixtures retained; WC1 adds encounters, studies, PAP windows, screenings and clinical-history edges; acceptance pending |
| FB-084 | Exercise multi-device and same-day repeat scans in tests                                                                       | included         | HF-07/HF-08                                                                  |
| FB-085 | Keep detailed clinical source material private in fixtures and feedback workflows                                              | included         | HF-07/HF-08                                                                  |
