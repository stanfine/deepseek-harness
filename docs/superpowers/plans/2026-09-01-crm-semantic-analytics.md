# CRM Semantic Analytics Implementation Plan

English | [中文](2026-09-01-crm-semantic-analytics.zh.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a closed semantic metric layer, flexible aggregate analysis, dynamic CRM charts, and bounded follow-up drilldowns to the existing opt-in CRM preset.

**Architecture:** `semantic-model.ts` validates deployment-owned business concepts, `analysis-planner.ts` resolves closed requests into one-dataset plans, and `semantic-analysis.ts` compiles those plans into bounded Elasticsearch aggregations and versioned results. `crm-tools.ts` registers catalog, analysis, and drilldown Consumers; `ui-crm` validates persisted results and deterministically selects ECharts views.

**Tech Stack:** TypeScript, Cordis, Schemastery, Elasticsearch aggregation JSON, React, ECharts, Vitest, Loader/Web composition tests, keyless session snapshots.

**Spec:** [docs/superpowers/specs/2026-09-01-crm-semantic-analytics-design.md](../specs/2026-09-01-crm-semantic-analytics-design.md)

## Global Constraints

- The model never receives index names, physical fields, scripts, formulas, paths, credentials, raw Elasticsearch requests, or arbitrary ECharts options.
- One analysis executes against exactly one configured logical dataset; incompatible metric and dimension selections fail before network access.
- Model-visible schemas, instructions, and representative output update the `crm-catalog` keyless snapshot.
- Product-visible behavior includes a Loader/Web composition test and a browser verification through the actual CRM preset.
- Every new registration is a Cordis effect with observed disposal, and all serialized results remain within existing response and bucket budgets.
- New and revised durable prose is bilingual and re-recorded; the non-trivial change includes an implemented Agent Note.

---

### Task 1: Semantic catalog and configuration validation

**Files:**
- Create: `apps/cli/config/examples/crm/semantic-model.ts`
- Create: `apps/cli/tests/crm-semantic-model.spec.ts`
- Modify: `apps/cli/config/examples/crm/crm-tools.ts`
- Modify: `apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**Interfaces:**
- Produces: `MetricDefinition`, `DimensionDefinition`, `SemanticConfig`, `ResolvedSemanticModel`, and `resolveSemanticModel(config, datasets): ResolvedSemanticModel`.
- Produces: `ResolvedSemanticModel.metricCatalog(): JsonValue` and `dimensionCatalog(): JsonValue` without physical source fields.
- Consumes: logical `Dataset` mappings from `elasticsearch.ts`.

- [ ] **Step 1: Write catalog validation tests.** Cover duplicate ids, unknown datasets and configured field keys, missing dependencies, ratio cycles, incompatible dependency datasets, invalid limits, unavailable definitions with concrete limitations, and a valid initial catalog.
- [ ] **Step 2: Run `pnpm vitest run apps/cli/tests/crm-semantic-model.spec.ts` and confirm the missing module fails.**
- [ ] **Step 3: Implement discriminated source metrics (`sum`, `count`, `distinct_count`) and derived ratios, dimension definitions, topological dependency validation, immutable lookup maps, and model-safe catalog projection.**
- [ ] **Step 4: Add explicit semantic configuration to `Config`, `CrmConfig`, and the CRM preset.** Register sales amount, order count, quantity, purchaser count, ATV, items per order, amount per item, frequency, amount per purchaser, and the configured date/category dimensions from the design.
- [ ] **Step 5: Run the focused test and `pnpm run typecheck`; commit `feat(crm): define semantic metric catalog`.**

### Task 2: Closed analysis planner

**Files:**
- Create: `apps/cli/config/examples/crm/analysis-planner.ts`
- Create: `apps/cli/tests/crm-analysis-planner.spec.ts`
- Modify: `apps/cli/config/examples/crm/report-periods.ts`

**Interfaces:**
- Produces: `AnalysisRequest`, `DrilldownRequest`, `Comparison`, `TimeGrain`, `ResolvedAnalysisPlan`, and `resolveAnalysisPlan(model, request, budgets): ResolvedAnalysisPlan`.
- `ResolvedAnalysisPlan` contains one dataset, normalized dates, source measures, derived metric order, dimensions, allowlisted filters, comparison windows, sort, limit, and intent.
- Consumes: `ResolvedSemanticModel` from Task 1.

- [ ] **Step 1: Write failing planner tests.** Cover valid summary, trend, ranking, composition, two dimensions, equality and inclusion filters, previous-period and 364-day prior-year windows, derived dependency expansion, stable deduplication, and drilldown parent filters.
- [ ] **Step 2: Add rejection tests.** Cover unknown ids, zero or over-limit metrics, excessive dimensions or filters, cross-dataset selection, unsupported time grain, invalid calendar dates, excessive range, invalid sort metric, and drilldown dimension reuse.
- [ ] **Step 3: Run `pnpm vitest run apps/cli/tests/crm-analysis-planner.spec.ts` and confirm failure.**
- [ ] **Step 4: Implement pure normalization and validation.** Reuse time-zone-safe date helpers; never parse source fields or build Elasticsearch JSON in this module.
- [ ] **Step 5: Run the planner and report-period tests; commit `feat(crm): resolve semantic analysis plans`.**

### Task 3: Bounded Elasticsearch semantic executor

**Files:**
- Create: `apps/cli/config/examples/crm/semantic-analysis.ts`
- Create: `apps/cli/tests/crm-semantic-analysis.spec.ts`
- Modify: `apps/cli/config/examples/crm/elasticsearch.ts`

**Interfaces:**
- Produces: `SemanticAnalysisResultV1`, `AnalysisRow`, `MetricValue`, `AnalysisCompleteness`, and `executeSemanticAnalysis(reader, model, plan, signal): Promise<SemanticAnalysisResultV1>`.
- Adds an internal reader operation that executes compiler-owned aggregation JSON against one configured dataset without exposing index or field selection to model arguments.
- Consumes: `ResolvedAnalysisPlan` and `ResolvedSemanticModel`.

- [ ] **Step 1: Build a fixture HTTP server and write failing request-shape tests.** Assert exact date filters, configured fields, terms/date-histogram nesting, comparison filters, stable bucket order, `size: 0`, no scripts, and no credentials in output.
- [ ] **Step 2: Write result tests.** Cover summaries, derived ratios, zero denominators, grouped comparison rows, missing buckets, terms truncation and error bounds, unavailable prior-year coverage, sort and Top N, and complete serialized-size enforcement.
- [ ] **Step 3: Run `pnpm vitest run apps/cli/tests/crm-semantic-analysis.spec.ts` and confirm failure.**
- [ ] **Step 4: Implement the executor and strict Elasticsearch response parser.** Share the existing reader transport, deadline, response-byte, shard-completeness, exact-total, credential, and cancellation behavior.
- [ ] **Step 5: Run semantic executor and existing Elasticsearch tests; commit `feat(crm): execute bounded semantic analysis`.**

### Task 4: Catalog, analysis, and drilldown tools

**Files:**
- Modify: `apps/cli/config/examples/crm/crm-tools.ts`
- Modify: `apps/cli/tests/crm-elasticsearch.spec.ts`
- Modify: `apps/web/tests/crm-preset.e2e.ts`
- Modify: `apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md`
- Modify: `apps/cli/config/examples/crm/skills/beauty-crm-weekly/SKILL.md`
- Modify: `apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**Interfaces:**
- Produces model tools `crm_metric_catalog`, `crm_dimension_catalog`, `crm_analyze`, and `crm_drilldown`.
- Persists presentation metadata as `{ crmAnalysis: { version: 1, request, data } }` for `crm_analyze` and `crm_drilldown`.
- Consumes the catalog, planner, executor, and existing scoped tool runtime.

- [ ] **Step 1: Extend the actual tool-runtime test with closed schemas and catalog results.** Assert forbidden names (`index`, `field`, `script`, `formula`, `dsl`, `path`) do not occur in the new schemas or results.
- [ ] **Step 2: Add execution tests for a valid analysis, a valid drilldown, cross-dataset rejection before fixture requests, serialized metadata, and disposal of all four tools.**
- [ ] **Step 3: Implement tool registrations and presentation metadata.** Keep argument schemas bounded and descriptions written from the model's business perspective.
- [ ] **Step 4: Update CRM persona and skills.** Fixed weekly and monthly reports remain preferred for those exact requests; ad hoc questions inspect catalogs and then use semantic analysis. Require evidence and coverage disclosure in suggestions.
- [ ] **Step 5: Extend the Loader/Web composition test to observe registration, catalog execution, analysis metadata, and absence of coding tools.**
- [ ] **Step 6: Run the focused CLI and Web tests; commit `feat(crm): expose flexible semantic analysis tools`.**

### Task 5: Persisted result validation and dynamic ECharts selection

**Files:**
- Create: `packages/client/ui-crm/src/client/analysis-model.ts`
- Create: `packages/client/ui-crm/src/client/analysis-chart-options.ts`
- Create: `packages/client/ui-crm/tests/crm-analysis-model.client.spec.ts`
- Create: `packages/client/ui-crm/tests/crm-analysis-chart-options.client.spec.ts`
- Modify: `packages/client/ui-crm/src/client/locales.ts`

**Interfaces:**
- Produces: `readAnalysis(meta): AnalysisReport | null`, validating version, request, columns, rows, metric values, completeness, warnings, and drilldown dimensions.
- Produces: `selectAnalysisView(report): AnalysisView` and `analysisChartOption(report, view, labels): EChartsOption`.
- Consumes only persisted JSON metadata; no Cordis context, source fields, or model-generated chart options.

- [ ] **Step 1: Write result validator tests.** Accept representative summary, trend, ranking, composition, and two-metric results; reject non-finite values, mismatched columns, duplicate ids, unknown row keys, unsafe drilldowns, oversized result arrays, and malformed completeness.
- [ ] **Step 2: Write deterministic view tests.** Cover KPI summary, line trend, horizontal ranking, bar comparison, complete donut composition, incomplete-composition bar fallback, compatible bar-line combination, dense table fallback, and null-value handling.
- [ ] **Step 3: Run the two new Client tests and confirm missing modules fail.**
- [ ] **Step 4: Implement the validator and chart selector with localized labels and no business-metric recomputation.**
- [ ] **Step 5: Run Client tests and typecheck; commit `feat(crm): validate flexible analysis charts`.**

### Task 6: Analysis card and interactive drilldown

**Files:**
- Create: `packages/client/ui-crm/src/client/CrmAnalysisRow.tsx`
- Modify: `packages/client/ui-crm/src/client/CrmRow.module.css`
- Modify: `packages/client/ui-crm/src/client/index.ts`
- Modify: `packages/client/ui-crm/src/client/locales.ts`
- Create: `packages/client/ui-crm/tests/crm-analysis-row.client.spec.tsx`
- Modify: `packages/client/ui-crm/tests/plugin.client.spec.ts`
- Modify: `packages/client/ui-crm/README.md`
- Modify: `packages/client/ui-crm/README.zh.md`
- Modify: `packages/client/ui-crm/README.i18n.yaml`

**Interfaces:**
- Produces a keyed tool presenter for `crm_analyze` and `crm_drilldown`.
- Uses `inputActions.setDraft()` to prepare a localized follow-up that preserves dates, metrics, filters, parent values, and the selected next dimension; the model calls `crm_drilldown` on submission.
- Consumes `readAnalysis`, `selectAnalysisView`, `analysisChartOption`, `EChart`, and existing localized slot props.

- [ ] **Step 1: Write UI tests for KPI, chart, table fallback, warnings, comparison context, and rejected metadata fallback.**
- [ ] **Step 2: Add drilldown interaction tests.** Click one category and assert the draft names the selected dimension value, next dimension, metrics, and date window without physical fields.
- [ ] **Step 3: Implement the card, accessible chart/table labels, localized copy, and reversible slot registrations.**
- [ ] **Step 4: Update the package README pair for result validation, chart rules, model-visible effects, and deferred multi-source joins; re-record the pair.**
- [ ] **Step 5: Run all `ui-crm` tests and client catalog generation/check; commit `feat(crm): render and drill into semantic analyses`.**

### Task 7: Real composition, snapshots, documentation, and browser verification

**Files:**
- Modify: `snapshots/session/crm-catalog/**`
- Modify: `snapshots/session/headless.snapshot.ts`
- Modify: `docs/user/guide/crm-monthly.md`
- Modify: `docs/user/guide/crm-monthly.zh.md`
- Modify: `docs/user/guide/crm-monthly.i18n.yaml`
- Create: `.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.md`
- Create: `.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.zh.md`
- Create: `.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.i18n.yaml`
- Modify: `apps/web/tests/crm-preset.e2e.ts`

**Interfaces:**
- Pins model-visible schemas, persona, skills, persisted analysis metadata, actual CRM preset composition, and user-visible chart/drilldown behavior.
- Documents supported business concepts, query examples, coverage failures, governance limits, and later provider requirements.

- [ ] **Step 1: Extend `crm-catalog` snapshot assertions and refresh only its expected system prompt and tool-schema artifacts.** Verify the four new tools and absence of forbidden physical/DSL arguments.
- [ ] **Step 2: Add the implemented Agent Note pair.** Record the closed semantic request rationale, one-dataset first implementation, deterministic client charting, alternatives, consequences, risks, and verification ownership; re-record the pair.
- [ ] **Step 3: Update the CRM guide pair with flexible examples, supported concepts, drilldown flow, unavailable metrics, and the multi-source governance distinction; re-record the pair.**
- [ ] **Step 4: Run a real local browser scenario through the CRM preset.** Ask for monthly channel sales amount, orders, and ATV with previous-period comparison; verify a chart, warning disclosure, persisted replay, a channel selection, and a subsequent store drilldown. Do not expose credentials in screenshots or logs.
- [ ] **Step 5: Run focused verification:** `pnpm vitest run apps/cli/tests/crm-semantic-model.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-elasticsearch.spec.ts packages/client/ui-crm/tests/*.spec.ts packages/client/ui-crm/tests/*.spec.tsx`; `pnpm vitest run apps/web/tests/crm-preset.e2e.ts`; `pnpm run test:snapshot -- -t crm-catalog`; `pnpm run build`; `pnpm run doc-sync`; `git diff --check`.
- [ ] **Step 6: Apply the repository pre-push workflow to the actual changed surface and report only commands run; commit `feat(crm): add semantic analytics and drilldown`.**
