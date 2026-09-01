# Agent Note: Closed CRM semantic analysis and drilldown

Status: implemented

English | [中文](2026-09-01-crm-semantic-analytics.zh.md)

## Problem

The fixed CRM reports answer known weekly and monthly questions, but a user also needs metrics, comparisons, rankings, compositions and follow-up drilldowns that cannot be enumerated as one tool per question. Exposing Elasticsearch fields, query DSL, formulas or chart options would let model arguments bypass business definitions, privacy review and acquisition limits. The configured data also spans logical datasets whose matching names do not prove safe joins or consistent customer identity.

## Decision

Source sums publish a `missing` companion and become unavailable when matching documents omit the configured field; ratios propagate that state. Both comparison modes require observed history at the configured-time-zone comparison start. Date filters compile to local-day half-open ranges, every date grouping is budgeted before access, and trends preserve chronological buckets without Top-N slicing. Persisted columns carry closed metric additivity and dimension composition semantics, so donuts require an additive metric and mutually exclusive categories. The final retained `{ content, meta }` projection counts escaped tool text, metadata and outer field names against one 1 MiB UTF-8 publication budget. Missing sum companions reject the response. Missing metric coverage is reported as `missingMetricValues`, an additive metric-value count that may exceed source document counts. Omitted dimension composition becomes `unknown`; only explicit `mutually_exclusive` permits a donut. Date drilldown parents retain their histogram grain and map by relative bucket position into comparison windows.

The CRM preset exposes immutable metric and dimension catalogs plus `crm_analyze` and `crm_drilldown`. Deployment configuration maps stable business ids to one logical dataset and its allowlisted source fields. The planner accepts only catalog ids, closed equality filters, bounded dates, supported time grains, a comparison kind, a sort metric and Top N. It expands configured ratio dependencies and rejects cross-dataset analysis before network access. The Elasticsearch executor owns aggregation JSON, exact bounded distinct pagination, response validation, comparison alignment and completeness warnings.

The initial flexible order metrics use the bounded order-document dataset because it owns the channel, subchannel, store, store-type and order-type dimensions needed for interactive drilldown. Their descriptions retain source-document semantics: an order count is a matching document count until the deployment owner confirms uniqueness, and sales amount does not imply net revenue or a currency. Fixed weekly reports continue to use dedicated additive fact and line-item sources. A request never combines their values as if they came from one governed table.

Successful tools persist a versioned semantic request and result in session metadata. The Client validates the complete wrapper, including columns, rows, comparison values, coverage, completeness, warnings and permitted drilldown dimensions. It derives KPI, trend, ranking, comparison, composition or table presentation deterministically. A proportion view requires complete, nonnegative additive data. Neither the model nor persisted data supplies executable ECharts options. Selecting a row prepares a localized draft that preserves the validated analysis context; the user submits that draft before the Agent can call `crm_drilldown`.

This note owns flexible semantic analysis. The [bounded read decision](../architecture/2026-08-31-crm-read-only-agent.md) continues to own the opt-in preset, credentials and legacy fixed query surface. The [weekly report decision](2026-09-01-crm-weekly-report.md) continues to own dedicated weekly facts, source coverage and evidence-bound recommendations.

## Alternatives considered

**Let the model write Elasticsearch DSL or ECharts options.** This makes unfamiliar questions easy to prototype, but source fields, scripts, result size and executable presentation escape the reviewed business surface.

**Join every configured source at query time.** Field-name equality does not establish customer identity, metric equivalence, attribution or time alignment. A future provider may implement a governed joined dataset behind the same semantic request, but the first implementation fails cross-dataset selections explicitly.

**Add more fixed report tools.** Fixed tools remain appropriate for regulated templates and stable report definitions. Extending that pattern to every ad hoc ranking or drilldown duplicates schemas and UI handling without creating a reusable business vocabulary.

**Let the model compute ratios and comparisons.** Prompt arithmetic cannot reliably preserve zero-denominator, missing-bucket and unavailable-comparison reasons. The executor computes configured ratios and changes and persists null reasons beside each value.

## Consequences

Users can ask for supported business concepts without knowing source fields and can continue from a chart selection into one bounded next dimension. Persisted metadata reproduces the same chart and warning state after history reload. Catalog entries keep unsupported repeat purchase, lifecycle, traffic, attribution, target and cost metrics visible with concrete limitations instead of returning zero.

The catalog is deployment work: source owners must confirm document uniqueness, amount meaning, identity, history and filter rules. Configuration rejects a dimension whose logical dataset has no available metric, so every advertised dimension participates in at least one valid request. Derived metric columns repeat the material limitations of their dependencies because consumers may persist or display a selected column without its source metrics. One request cannot reconcile values across CRM, commerce, campaign, traffic and cost systems. Terms aggregation truncation, missing dimensions, live-index reads and unavailable comparison history remain visible. Unit tests own validation, planning, compilation and Client rendering; the Web composition test owns actual preset registration and drilldown metadata; the `crm-catalog` keyless snapshot owns model-visible instructions, schemas, semantic comparison results and persisted drilldown metadata. A real browser check owns rendered interaction when the Browser runtime is available.
