# CRM Weekly Report Implementation Plan

English | [中文](2026-09-01-crm-weekly-report.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a source-backed CRM weekly report that covers comparable sales, lifecycle availability, product contribution, unavailable traffic metrics, and evidence-bound recommendations.

**Architecture:** The opt-in CRM preset keeps fixed Elasticsearch indices and credentials outside model arguments. Pure period functions define comparison windows; a weekly reader compiles bounded aggregations; native tools persist closed presentation metadata; the CRM Client renders tables and charts from that metadata. The business Skill assembles the final conversation report and labels missing evidence.

**Tech Stack:** TypeScript ESM, Cordis, Elasticsearch 7 JSON requests, Schemastery, React, Apache ECharts, Vitest, recorded-session snapshots.

**Spec:** [.agents/notes/proposed/feature/2026-09-01-crm-weekly-report.md](../../../.agents/notes/proposed/feature/2026-09-01-crm-weekly-report.md)

## Global Constraints

- Launch remains `dsh web --patch apps/cli/config/examples/crm/cordis.yml`; do not add a bin, standalone server, raw database tool, or model-supplied DSL.
- Model inputs never accept indices, fields, customer identifiers, scripts, arithmetic expressions, or ECharts option objects.
- Results never expose credentials, identifiers, personal fields, endpoints, or upstream error bodies.
- Missing, partial, uncovered, or zero-denominator inputs produce reasons or null ratios, never inferred zeroes.
- Client copy remains locale-owned; registrations and observers remain disposable.
- Product-user and model-visible changes update focused tests, Web composition, and keyless session replay.

---

### Task 1: Canonical weekly periods

**Files:** Create `apps/cli/config/examples/crm/report-periods.ts`; test `apps/cli/tests/crm-report-periods.spec.ts`.

**Produces:** `resolveReportPeriods(date, timeZone, fiscalYearStartMonth, today): ReportPeriods` with current, previous, prior-year, and fiscal-YTD windows.

- [ ] Write this failing test before production code:

```ts
expect(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-10')).toMatchObject({
  current: { start: '2025-05-05', end: '2025-05-12', complete: false },
  previous: { start: '2025-04-28', end: '2025-05-05', complete: true },
  priorYear: { start: '2024-05-06', end: '2024-05-13' },
  fiscalYtd: { start: '2025-04-01', end: '2025-05-12' },
})
expect(() => resolveReportPeriods('2025-02-30', '+08:00', 4, '2025-05-10')).toThrow(/date/)
```

- [ ] Run `node_modules/.bin/vitest run apps/cli/tests/crm-report-periods.spec.ts`; confirm the missing module causes failure.
- [ ] Implement ISO validation, Monday alignment, seven-day shifts, the 364-day prior-year shift, fiscal-year selection, and completeness without locale-dependent parsing.
- [ ] Run the focused test and commit `feat(crm): define weekly report periods`.

### Task 2: Sales configuration and bounded aggregation

**Files:** Create `apps/cli/config/examples/crm/weekly-report.ts`; modify `crm-tools.ts` and `presets/crm/agent.cordis.yml`; test `apps/cli/tests/crm-weekly-report.spec.ts`.

**Produces:** `WeeklyReportConfig`, `WeeklyReportReader`, and `sales(periods, signal): Promise<SalesReport>`.

- [ ] Write a failing fixture-server test that expects current amount `1200`, orders `4`, purchasers `3`, repeat purchasers `1`, quantity `6`, amount/order `300`, items/order `1.5`, amount/item `200`, frequency `4/3`, and amount/purchaser `400`.
- [ ] Assert serialized output excludes fixture customer keys, the password, endpoint, and `_search`; run the test and confirm `WeeklyReportReader` is missing.
- [ ] Add strict roles for `orderFacts`, `orderItems`, `members`, and optional `traffic`, plus `fiscalYearStartMonth` and `minimumOrderAmount`; validate exact indices and required fields at load.
- [ ] Implement additive sums and bounded composite customer pagination per window. Count repeat purchasers only when the configured order-count sum exceeds one.
- [ ] Implement `safeRatio` so absent or zero denominators return `{ value: null, reason }`; prove it with a failing-then-passing test.
- [ ] Profile each role and omit uncovered comparison windows with observed and required coverage instead of querying them.
- [ ] Run the new suite and `crm-elasticsearch.spec.ts`; commit `feat(crm): aggregate weekly sales metrics`.

### Task 3: Exact lifecycle cohorts

**Files:** Modify `weekly-report.ts`; extend `crm-weekly-report.spec.ts`.

**Produces:** `lifecycle(periods, signal): Promise<LifecycleReport>` with new purchasers, existing-new, retained, and winback counts.

- [ ] Write a failing two-page composite fixture expecting `newPurchasers: 1`, existing-new `base: 2, active: 1`, retained `base: 2, active: 1`, and winback `base: 1, active: 1`.
- [ ] Implement one shared-deadline traversal with first-purchase `min` and fixed current, prior-fiscal, and earlier-history filters. Classify buckets locally and never retain or return their keys.
- [ ] Add a failing test where source coverage starts after the required prior-fiscal date; return `available: false` with required and observed coverage.
- [ ] Add a failing pagination-exhaustion test; reject the metric rather than returning a partial count.
- [ ] Run the weekly suite and commit `feat(crm): add bounded lifecycle cohorts`.

### Task 4: Product contribution

**Files:** Modify `weekly-report.ts`; extend `crm-weekly-report.spec.ts`.

**Produces:** `products(periods, groupBy: 'series' | 'sku', signal): Promise<ProductReport>` from the line-item-wide role.

- [ ] Write a failing test for current, previous, and prior-year amount and quantity per returned group, with no line or customer identifier.
- [ ] Compile terms ordered by the current amount sub-aggregation, fixed comparison filters, and a missing-key aggregation.
- [ ] Parse omitted count, count-error upper bound, and missing keys; mark incomplete composition when any is nonzero.
- [ ] Prove output names `lineDocumentCount`, never `orders` or `UV`, and preserves signed source amounts.
- [ ] Run the weekly suite and commit `feat(crm): report product contribution`.

### Task 5: Native report tools

**Files:** Modify `crm-tools.ts`, `crm-elasticsearch.spec.ts`, and `apps/web/tests/crm-preset.e2e.ts`.

**Produces:** `crm_report_periods`, `crm_sales_report`, `crm_lifecycle_report`, `crm_product_report`, and metadata `{ crmReport: { version: 1, kind, request, data } }`.

- [ ] Add failing runtime tests for all tools and prove closed schemas reject index, field, DSL, customer ID, and unsupported grouping arguments.
- [ ] Register tools through `ctx.effect`, retain canonical JSON model output, and persist metadata without exposing transport configuration.
- [ ] Extend Web composition to assert the report tools exist while Shell, editor, arbitrary HTTP, and general database tools remain absent.
- [ ] Run focused CLI and Web tests; commit `feat(crm): expose bounded weekly report tools`.

### Task 6: CRM weekly presentation

**Files:** Create `report-model.ts`, `ReportRow.tsx`, `report-options.ts`, and their Client tests under `packages/client/ui-crm/`; modify `index.ts`, `locales.ts`, and `CrmRow.module.css`.

**Produces:** Closed `readReport(meta)` validation and keyed rows for weekly tools.

- [ ] Write failing validation tests for valid reports and malformed numbers, mismatched periods, unknown versions, customer identifiers, and unsupported kinds.
- [ ] Implement validation that retains null reasons, exactness, coverage, and truncation and rejects every field used by rendering unless validated.
- [ ] Write failing React tests for a four-column KPI table, unavailable lifecycle panel, sorted product bars, warnings, source tables, raw details, and absence of customer identifier text.
- [ ] Implement locale-owned comparison tables, ECharts product bars, accessible source tables, and raw-result disclosure; reuse `EChart` cleanup.
- [ ] Register all report tool keys reversibly and test disposal.
- [ ] Run all `ui-crm` tests, Client typecheck/build, and Client UI i18n verification; commit `feat(crm): render weekly report evidence`.

### Task 7: Agent workflow, snapshots, docs, and acceptance

**Files:** Rename the Skill to `beauty-crm-reporting`; modify the CRM preset, snapshot fixture, real-ES test, user guide, package README, and the proposed Agent Note pair.

**Produces:** A weekly conversation report with evidence-bound recommendations while retaining explicit arbitrary-window monthly reporting.

- [ ] Change the recorded-session fixture first to request a week, call period/sales/lifecycle/product tools, report unavailable traffic, and produce a recommendation containing observation, evidence, hypothesis, action, validation, and limitation.
- [ ] Run replay without refresh and confirm the current Skill fails the new expected workflow.
- [ ] Rename and update the Skill and persona so weekly requests use canonical periods, query available sections, and never replace missing traffic with proxies.
- [ ] Refresh the snapshot, inspect all tool errors and metadata, then replay without refresh.
- [ ] Extend the opt-in real-ES test to profile configured roles and execute aggregates only; do not fetch customer IDs or raw personal records.
- [ ] Update English and Chinese docs, pairing records, and move the Agent Note pair to `implemented/feature` with present-tense decisions.
- [ ] Run focused CLI, Web, Client, snapshot, typecheck, lint, JSDoc, i18n, docs, and `git diff --check` commands.
- [ ] Restart CRM Web, verify port 3080 and authenticated boot, and use a new CRM conversation for manual acceptance.
- [ ] Request code review, fix verified P1/P2 findings with regression tests, rerun affected checks, and commit `feat(crm): deliver source-backed weekly reports`.
