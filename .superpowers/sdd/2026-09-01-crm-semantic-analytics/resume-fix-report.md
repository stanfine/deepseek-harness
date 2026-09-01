# CRM semantic analytics resumed fix report

## Scope

This resumed audit addressed the six Important findings from the final branch review. No files under `outputs/` were changed or staged.

## Red and green evidence

1. A focused executor test first showed that a response without `mN_missing` published an exact sum. The executor now requires every compiled sum companion and rejects absent top-level, grouped, nested, comparison, and fully missing structures. The shared fixture now emits the real `mN_missing` field instead of the ineffective `mN_coverage` field.
2. Completeness now publishes `missingMetricValues`. It counts unavailable metric values across metric and group occurrences and explicitly does not claim unique documents. A grouped fixture proves the value can exceed the current source record count without mislabeling it.
3. Drilldown parent filters are marked as window-relative in the resolved plan. Date parents retain the selected day/week/month grain; the executor maps bucket positions into current and comparison windows and emits configured-time-zone half-open ranges. Ordinary request date filters remain local-day ranges and non-date filters retain their values.
4. A 31-row trend initially failed Client validation against the Top-N `limit`. The Client now applies Top N only to non-trend intents and still enforces the absolute row ceiling.
5. Omitted dimension composition now resolves to `unknown`. Only explicit `mutually_exclusive` enables a donut; tests cover the conservative catalog projection and chart fallback.
6. The tool owner measures the actual retained `{ content, meta }` serialization, including escaped text and outer field names. Exact-boundary, one-byte-over, and multibyte tests cover the Host projection. The Client reconstructs and checks the same retained projection from persisted metadata.

## Verification

- `pnpm exec vitest run apps/cli/tests/crm-semantic-model.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-tools.spec.ts packages/client/ui-crm/tests` — 131 passed.
- `pnpm run test:snapshot -- -t crm-catalog` — 111 passed, 2 skipped.
- `pnpm run typecheck` — passed.
- `pnpm run build` — passed.
- `pnpm run doc-sync` — 32 passed.
- Targeted `oxlint`, `git diff --check`, and bilingual pairing checks — passed.

## Residual limits

The count represented by `missingMetricValues` is intentionally additive across metric and group occurrences. It is suitable for completeness disclosure, not unique-document reporting. Comparison date drilldowns map by relative calendar bucket position; this preserves partial week/month histogram semantics but does not claim civil-date identity between periods.
