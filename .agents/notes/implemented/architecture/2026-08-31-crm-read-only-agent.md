# Agent Note: Bounded CRM reads in an opt-in Agent preset

Status: implemented

English | [中文](2026-08-31-crm-read-only-agent.zh.md)

## Problem

CRM reporting requires repeatable retrieval through the application Agent. An assistant-generated report outside the application does not establish that capability. General database DSL and Shell access also expose more records and operations than a reporting task needs.

## Decision

The [CRM example](../../../../apps/cli/config/examples/crm/cordis.yml) composes native tools and a business Skill without changing the Agent loop. Deployment configuration owns exact indices, fields, budgets and credential references. The model supplies only logical datasets, dates and dimension filters. A second source projection excludes unexpected record fields; credentials and transport errors never become model-visible data. The deployment still owns non-personal field selection and database read permissions.

The reader rejects incomplete responses and exhausted exact-count budgets. Group truncation, missing identifiers, unknown amount semantics and live-pagination consistency remain visible limitations. The Skill keeps unsupported cohort and category metrics unavailable rather than substituting misleading proxies. The [guide](../../../../docs/user/guide/crm-monthly.md) owns configuration and usage.

## Alternatives considered

**General Elasticsearch MCP or raw DSL.** These permit wider retrieval and require a separate policy layer to enforce the same field and query restrictions. The bounded reader needs no separate server.

**Manual analysis in the development conversation.** This produces a one-off artifact but cannot serve application users or preserve the application's tool execution evidence.

## Consequences

The example is source-only and deliberately narrower than general business intelligence. MongoDB, normalized item analytics, cohort queries and point-in-time consistency require additional explicit capabilities. A fixed weekly Excel exporter can now serialize completed aggregate report sections and evidence-bound recommendations through a deployment-provided artifact tool; it does not accept arbitrary queries, paths, formulas or customer records. Configured HTTP is available for trusted test environments, but does not protect credentials in transit. Unit tests exercise transport limits, projection, canonical tool results and disposal; the keyless CRM session fixture pins logged tool behavior through the shipped headless profile.

## Conversation charts

The opt-in ui-crm plugin renders persisted metadata for `crm_query`, fixed weekly report tools, `crm_analyze` and `crm_drilldown` through keyed presenters. Producers record validated query context and canonical values; chart geometry and selected measures remain Client-only. The reader bounds calendar histograms before requesting Elasticsearch. The Client validates metadata and falls back to text for errors, old results or malformed data. Signed amounts and missing measures stay distinct. Group and semantic drilldown use standard session input actions to prepare a user-reviewed question and leave an existing draft untouched. A separate reporting application would duplicate the session and query evidence, so charts use the keyed tool slot.

## Dynamic chart requests

The Agent supplies a closed chart-type and measure selection; the Client compiles ECharts options from canonical results. Arbitrary option objects, executable formatters and model-authored data arrays are excluded. Modular ECharts replaces owned SVG geometry and supplies tooltips, zoom and chart-mark events. Presentation choices do not alter query filters or values. Proportion views require zero missing-dimension documents as well as complete bucket totals, because multivalued dimensions can conceal missing records behind duplicate membership. Renderer errors leave the data table intact; teardown disconnects DOM observers and disposes the instance. Unit tests execute the SVG renderer and its click path, and session replay pins Agent-selected presentations.

Analytical intent is persisted separately from chart overrides because query mode alone cannot distinguish composition from ranking. The Agent requests the data needed for each monthly-report question; the Client chooses compatible charts and preserves incomplete-data warnings. Ranking operates on returned buckets without changing acquisition, so a count-ranked terms subset is not a global amount ranking. Category lines are rejected because they imply order absent from the source dimension.

The [semantic-analysis decision](../feature/2026-09-01-crm-semantic-analytics.md) owns the closed business catalogs, generic aggregate requests and context-preserving drilldown added above this bounded reader. The legacy `crm_query` surface remains for fixed report workflows.
