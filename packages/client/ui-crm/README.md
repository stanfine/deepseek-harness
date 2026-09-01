---
description: "Opt-in conversation charts for bounded CRM queries."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-crm

English | [中文](README.zh.md)

## Summary

This Web plugin renders bounded CRM queries, standard reports, and flexible semantic analyses as metric cards, accessible tables, and interactive Apache ECharts views. Mount it through the [CRM example overlay](../../../apps/cli/config/examples/crm/cordis.yml); it is absent from shipped default compositions. The [CRM guide](../../../docs/user/guide/crm-monthly.md) owns application setup and metric semantics.

Automatic selection uses the persisted `intent`: composition uses a donut only for complete additive groups, ranking sorts returned buckets by the selected measure into horizontal bars, and time series use lines. Unordered categories cannot use lines or areas; fewer than two time buckets use a table. Group and trend totals appear as compact context instead of repeated KPI cards. Ranking does not recover groups omitted by the source terms query.

Flexible semantic results use a separate persisted `meta.crmAnalysis` version. The Client accepts only matching request and result metadata with declared metric and dimension ids, finite or null metric values, bounded rows and warnings, coherent comparison windows and completeness facts, and allowlisted drilldown ids. The complete persisted wrapper is limited to the shipped 1 MiB result budget, and returned rows cannot exceed the normalized request limit. It rejects unknown row keys, duplicate columns, invalid dates and unexpected persisted fields before presentation. Chart selection reads these validated values without recalculating business metrics: summaries use KPI cards, trends use lines, rankings use horizontal bars, comparisons use bars, complete nonnegative compositions of at most eight categories use donuts, and compatible two-metric results use bar-line charts. Comparison trends and compositions retain both periods as paired lines or bars. Dense, multi-dimensional or incompatible results retain a table fallback, and nulls remain chart gaps.

## Table of Contents

- [Presentation](#presentation)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

Standard weekly-report tool results use separate `meta.crmReport` validation and keyed views. Sales shows KPI cards plus amount, order and purchaser comparisons; lifecycle shows cohort bases and active counts; product series and SKU use horizontal comparison bars. Coverage refusals and incomplete groups remain visible instead of producing zero-filled charts.

## Presentation

The keyed `tool.call.toolview` contribution validates persisted version-1 `meta.crm` containing query context and canonical result data. Summary and customer results display measures; group and trend results display charts and exact-value tables. The model may request `chartType` and `metric`; users can switch columns, horizontal bars, lines, areas, pies, donuts or a table without querying again. Automatic selection uses calendar lines or category comparisons. Document count, source amount and average document amount remain separate measures. Negative amounts remain signed; absent amounts remain absent. Source semantics, date range, filters and truncation disclosures remain visible. Pie and donut views require additive nonnegative values, no missing measures or dimensions, exact untruncated groups, and bucket document counts summing to the source total. Otherwise the card discloses a comparison fallback.

The `crm_analyze` and `crm_drilldown` keyed presenters apply the `meta.crmAnalysis` validator before rendering. They show summary rows as KPI cards and grouped rows as the deterministic chart selected from the validated intent, columns, completeness, and comparison metadata. Every chart has a named source table containing current, comparison, change, null, and partial values; warnings and both date windows remain adjacent to the evidence. Rejected metadata keeps the generic raw result. On narrow screens, KPI cards collapse to one column, charts shorten, and tables scroll without hiding their labels.

Chart-mark clicks and table buttons prepare a JSON-scoped follow-up through standard session input actions. It never submits a message and refuses to overwrite an existing draft. Locale dictionaries and the slot contribution leave with the plugin fiber. The plugin owns no data acquisition, credentials or model tools. ECharts is bundled only with this opt-in plugin using its modular imports and SVG renderer. Each visible card owns one disposable instance and observes its container size. Tooltips render text, with slider zoom for cartesian charts; all values remain in the accessible table. Model requests persist with the result; local chart switches and zoom reset when a card remounts. Rendering failures retain the table. No arbitrary ECharts options, formatter scripts or external URLs are accepted.

## Model Experience

### CRM presentation

#### What the model sees

The model sees the original CRM tool result. A semantic drilldown click prepares a localized draft containing only dates, metric ids, business filters, parent dimension values, the selected value, and the next business dimension. The click does not submit it; the model sees the draft only after the user reviews and sends it. Physical fields, index names, query DSL, chart geometry, and chart selection stay out of the draft.

#### Token effect

Drawing and switching charts add no model tokens. Sending a drilldown question adds ordinary user text and subsequent tool results.

#### KV Cache effect

Chart interaction does not change request history. A sent follow-up appends to the existing prefix.


## Known Limitations and Deferred Work

- Failed, unsupported and old results without valid chart metadata remain textual; result-only history without a paired call uses the generic tool view. Query again for charts.
- Charts do not establish currency, unique orders, historical completeness or exact group contribution. Their source warnings remain authoritative.
- This package does not provide every ECharts type, a separate dashboard, cross-call report assembly, or Client-side joins. Flexible analyses currently describe one logical dataset per result; joining CRM data across source systems is deferred until a provider owns governed identities, time semantics, and metric reconciliation. New chart families need matching validated data and a renderer mapping.

### Dev Note

<details>
<summary>Working context for maintainers</summary>

None.

</details>
