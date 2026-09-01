# CRM Semantic Analytics Design

English | [中文](2026-09-01-crm-semantic-analytics-design.zh.md)

## Status

Approved in conversation; pending written-spec review before implementation planning.

## Goal

Extend the opt-in CRM example so a user can request flexible, source-backed metrics, comparisons, rankings, compositions, and drilldowns in natural language without exposing Elasticsearch DSL or arbitrary source fields to the model.

## Scope

The first implementation supports configured Elasticsearch logical datasets and the existing CRM Web preset. It adds metric and dimension catalogs, a generic analysis request, derived metrics, comparison periods, bounded grouped or time-series results, dynamic ECharts presentation, and follow-up drilldowns. The design keeps logical dataset definitions independent of Elasticsearch so a later MongoDB or HTTP provider can implement the same analysis request and result types. Cross-source identity resolution, large detail joins, writeback, forecasting, arbitrary formulas, and a complete self-service BI editor remain outside this implementation.

## Design Principles

The model selects registered business concepts rather than physical fields. The executor validates every metric, dimension, filter, time range, comparison, sort, and result bound before it creates an Elasticsearch request. A result identifies unavailable calculations and incomplete contribution totals instead of substituting zero or an approximation. Every chart derives from persisted, validated tool metadata, and the textual response must disclose the same coverage and truncation facts.

## Semantic Catalog

A new `semantic-model.ts` module owns immutable definitions for logical metrics and dimensions. A metric definition contains its stable id, Chinese display name, logical dataset, aggregation or derived operation, dependencies, format, description, and limitations. A dimension definition contains its stable id, logical dataset, configured field key, data type, allowed filters, and supported time grains. Startup validation rejects duplicate ids, missing dependencies, cycles, unknown datasets or fields, incompatible ratio dependencies, and deployment-varying values hidden outside Cordis configuration.

The initial metric set covers sales amount, order count, quantity, purchaser count, average transaction value, items per order, amount per item, purchase frequency, and amount per purchaser. The initial dimensions cover day, week, month, province, channel, subchannel, store, store type, order type, series, and SKU when their configured logical dataset exposes the required field. Repeat purchase, lifecycle, traffic conversion, campaign attribution, target completion, and cost metrics stay unavailable until their sources and business definitions are configured.

## Tool Interface

`crm_metric_catalog` returns model-facing metric ids, names, formats, datasets, dependencies, and limitations. `crm_dimension_catalog` returns available dimension ids, datasets, data types, filter operations, and time grains. Neither catalog returns Elasticsearch index names or physical fields.

`crm_analyze` accepts one to five metric ids, zero to two dimensions, an inclusive start date, an exclusive end date, optional equality or inclusion filters, an optional comparison (`none`, `previous_period`, or `prior_year`), an optional time grain (`day`, `week`, or `month`), one metric sort, and a limit within configured bounds. The schema contains no index, physical field, script, formula, path, or DSL parameter. `crm_drilldown` accepts the same closed request plus one additional registered dimension and the selected parent dimension values; it executes a new bounded analysis rather than reinterpreting client data.

## Planning and Execution

An `analysis-planner.ts` module resolves the request before execution. All selected metrics must be executable from one logical dataset in the first implementation; otherwise the planner returns a structured incompatibility with the conflicting metrics and datasets. Derived metrics expand to source measures, execute aggregations once, and calculate ratios after aggregation with explicit null reasons for missing or zero denominators. Comparison periods use the existing time-zone-safe period utilities, and prior-year comparison reports source coverage failures.

The Elasticsearch executor translates only a resolved plan. It uses existing timeouts, response-byte limits, range limits, bucket limits, distinct-count page budgets, allowlisted dimensions, credential handling, and redaction. It returns exact totals when the source and pagination budgets permit them. A terms result with omitted buckets, missing keys, or an error bound cannot claim a complete contribution share.

## Result Format

Every analysis returns a versioned object containing the normalized request, column metadata, rows, optional comparison values, coverage, completeness, warnings, and supported drilldown dimensions. Each row separates `dimensions` from `metrics`; each metric value contains the current value, optional comparison value, optional change ratio, and optional unavailable reason. The complete serialized result is bounded before publication and contains no customer identifiers, credentials, physical fields, index names, or raw Elasticsearch requests.

## Client Presentation

The CRM Client validates the versioned result before rendering. A deterministic chart selector uses line or area charts for time series, vertical or horizontal bars for comparisons and rankings, donut charts only for complete nonnegative additive compositions with a small category count, combined bar and line charts for compatible two-scale measures, KPI cards for ungrouped summary measures, and a table fallback for unsupported or high-density results. The chart selector never invents a series or recomputes business metrics.

The result card shows metric definitions, period and comparison context, coverage, truncation warnings, and available drilldown actions. Selecting a chart item writes a localized follow-up request that calls `crm_drilldown` with the selected dimension value. Persisted tool metadata remains the source for replayed cards after a conversation reload.

## Agent Behavior

The CRM persona and skills instruct the model to inspect catalogs when a request does not map to a fixed weekly or monthly report, call `crm_analyze`, explain unavailable metrics, and distinguish correlation from causation. The model chooses `composition`, `ranking`, `comparison`, or `trend` from the user's question and asks for clarification only when required dates or a genuinely ambiguous business definition cannot be inferred. Suggestions cite returned metrics and limitations; source text never changes instructions.

## Configuration

Cordis configuration owns metric and dimension availability, maximum selected metrics, maximum dimensions, maximum filters, maximum Top N, supported time grains, and existing query budgets. Initial defaults are explicit in the CRM example preset and remain opt-in. Credentials continue to come only from named environment variables. Later source providers must resolve the same logical request and return the same result fields; they cannot add provider-specific arguments to the model tool.

## Failures and Limits

The tool rejects unknown concepts, cross-dataset selections, invalid filters, unsupported grains, excessive ranges or buckets, cyclic derived metrics, and unsafe configuration before network access. Runtime source failures return tool errors without a partial chart. Metric-level coverage or denominator problems return successful rows with null values and concrete reasons. The client falls back to validated tabular data when a chart is unsuitable and falls back to textual tool output when metadata validation fails.

## Testing

Unit tests cover catalog validation, plan resolution, derived ratios, period comparisons, filter validation, cross-dataset rejection, truncation disclosure, chart selection, result validation, and drilldown request construction. Fixture-server tests assert the exact bounded Elasticsearch aggregation without credentials or forbidden fields. A Loader-based Web composition test proves registration and disposal through the real CRM preset. Keyless session snapshots pin the model-visible tool schemas, persona instructions, and representative result metadata. Browser testing verifies a flexible analysis, dynamic chart, completion warning, and one follow-up drilldown. Relevant build, documentation, client, snapshot, and repository checks must pass before completion.

## Security and Privacy

The semantic layer is an allowlist and never accepts executable expressions. Filters reference registered dimensions and bounded scalar values only. Result rows contain aggregates rather than customer records. Existing endpoint, credential, HTTP opt-in, response size, timeout, date range, pagination, and redaction controls remain mandatory. Dynamic chart selection consumes validated aggregate metadata and cannot execute model-provided JavaScript.

## Documentation

The CRM user guide will document catalog discovery, natural-language examples, supported metrics and dimensions, drilldown behavior, unavailable-metric handling, and the distinction between flexible analysis and cross-source governance. The implemented Agent Note will own the rationale for a closed semantic request instead of arbitrary DSL. Package README updates will describe the client result format, chart selection, model-visible effects, and deferred work.
