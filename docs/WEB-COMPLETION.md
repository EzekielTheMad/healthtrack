# HealthTrack web completion — approved proposal1

Approved Nov2,2026. This extends NEXT-RELEASE's existing85-item feedback matrix;
it preserves accepted HF, source-review and private-deployment evidence. The
finish line is a **web-focused2.1.0** candidate and separately approved verified
publication/deployment. Earlier unshipped2.0.0 is superseded as the final target;
dated evidence retains its original version/source. Android AC-04/all seven
groups remain explicitly deferred/unverified, never satisfied by web checks.

## Included outcomes

- Clinical FB-024–044 inclusive: encounters/historical height/context/grouping/
  same-day repeats; diagnostic sleep studies and PAP report windows; instrument-
  specific screening results/history; procedure status/events/codes; independent
  condition certainty/activity/temporal scope; recorded allergy-review status;
  qualitative genetic results/counseling/history.
- Scans FB-052/053/071–075/077: five-region lean/fat mass (ten values), source-
  reported soft lean/subcutaneous+visceral fat/protein/mineral/BMC/body-cell mass,
  phase angle/SMI/regionalECW ratios, proprietary scores/body-age/reference bands/
  recommendations, and valid coherent reported-versus-derived ratios.
- Ordinary controls for existing timezone/workout timestamp/supplement links/
  protected document+page source references. Every85 feedback disposition stays
  explicit; FB-076 is durable references/existing originals, FB-083 now includes
  the newly approved clinical edge cases.

Existing lab PDF/image ingestion is preserved. Vendor-specific PDF/CSV/full-
history autoextraction, expanded attachments, automatic clinical interpretation/
scoring/treatment/adherence/training/nutrition targets and Hevy duplication stay
excluded. No native app/public APK release or physical-phone work in this program.

## Shared contracts — WC1

1. Extend the existing clinical_fact union and durable clinical_records/intake
   pipeline. New kinds: encounter,sleep_study,pap_report,screening,condition,
   procedure,allergy_review,genetic_report. Keep lab/medication/event payloads and
   legacy APIs compatible. The migration preserves existing rowids/values/keys/
   references while widening clinical_records checks; no date-certainty backfill.
2. Reuse conditions/procedures/allergies pages/forms. Adapt existing rows with
   legacy_unknown provenance and optional typed corrections via selected target/
   expected revision. Do not invent completed procedures/confirmed diagnoses or
   verified negative allergy review from legacy dates/status/empty lists. Rich
   additions appear on those existing surfaces; no parallel miniature EMR.
3. Encounter records group explicit observation keys under a source visit/date,
   not date-only upserts. Heart rate is not resting_hr; historical height never
   edits profile height. Same-day repeats remain distinct. Context is explicit.
4. Study indices retain printed labels/definitions. PAP start/end windows and
   statistics/denominator/threshold metadata remain reports, never fabricated
   daily PAP rows or overlapping-window sums. Missing numerator/denominator and
   genuine zero remain distinct; no automatic adherence interpretation.
5. Screening instrument/name/version/date, reported total, optional item answers,
   functional responses, qualitative/partial status and administration versus
   copied history are independent. Never auto-score or diagnose. Genetic findings
   and counseling are qualitative source/history records without interpretation.
6. Date/provenance schemas are shared client-safe exports. Preserve unknown/year/
   month/day/offset-instant and original text. Receipt timestamps are server-
   controlled. Protected document, copied-record and supplement references must
   resolve to the exact authorized person; a reference grants no file access.
7. Source-reported scan measurements remain separate from readonly derived
   measurements. Report-only specialized metric keys live in a scan registry
   extending legacy known keys, not in the generic vitals receiver, so old feed
   grants gain no metrics. Regional lean is never skeletal muscle. No SMI
   derivation from regional lean. Only same-scan compatible mass ratios may be
   derived (ECW/TBW, fat/weight, water/weight), with positive valid denominators;
   reported ratios/conflicts remain intact. Vendor results stay source/device/
   method/definition-bound and never set nutrition or training targets.
8. New PAT opt-ins write:clinical_reports and write:scan_reports are additional
   to the existing intake/scan grants for new kinds/report fields. Historical
   write:all/clinical_intake/scans tokens gain no new mutation rights. Clinical
   PAT writes still only stage exact owner previews; canonical commit remains
   browser-owner-only. Existing read scopes/authorization sections remain exact:
   labs,medications,vitals,conditions,procedures,allergies as applicable.
9. UI/API/storage/reload/history/export/doctor/context must agree on new facts,
   qualifiers and coverage. Charts admit comparable numeric observations with
   real date/source/context/definition; qualitative/uncertain/report-window data
   stays labelled history. No new daily-series inference or silent old-record
   replacement. Corrections remain revision-checked/idempotent and audited.

## Verification and release boundary

Verify manual and typed-JSON preview, owner approval, saved reload/history,
corrections/conflicts/retries, exact-person/API authorization, exports, doctor
PDFs and app/API context using disposable fictional records. Exercise narrow
mobile widths, invalid/partial dates, missing versus zero, copied screenings,
legitimate same-day repeats and incompatible scan sources/protocols. Charts must
show gaps for incompatible evidence and never invent daily PAP observations.

The release candidate needs repository lint/tests/types/production build,
independent review, fresh isolated upgrade/restart and compatible old-image/data
restore, plus actual runtime evidence for each advertised architecture. Historical
checks remain tied to their original source. Separate provider/consent/readiness
and publication/deployment gates remain open until their actual evidence exists.
Do not interpret this document, a passing build or a version label as release
acceptance. Android remains deferred/unverified outside the web release.
