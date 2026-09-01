# Agent Note: Source-backed CRM weekly report

Status: proposed

English | [中文](2026-09-01-crm-weekly-report.zh.md)

## Problem

The CRM example can query bounded order and member aggregates and render one result per tool call, but it cannot produce the business sections in the supplied REMY report template. A weekly report needs comparable periods, additive sales measures, customer lifecycle cohorts, product contribution, source availability, and recommendations tied to query evidence. The current source also contains future-dated records and incomplete derived indices, so the Agent cannot treat the latest date or an empty metric as trustworthy.

## Proposal

The CRM preset gains a weekly-report capability built from fixed Elasticsearch indices and allowlisted fields. Data stays in each source index. The model selects a report week and invokes domain tools; it never supplies an index name, field name, query DSL, script, customer identifier, or arithmetic expression.

The report week is Monday 00:00 through the following Monday 00:00 in the configured UTC offset. The previous comparison is the preceding seven days. The prior-year comparison shifts both endpoints back 364 days so weekdays stay aligned. Fiscal year-to-date starts on the deployment-configured fiscal-year month and ends at the report-week exclusive end. A range whose end is later than the current date is marked incomplete rather than presented as a completed week.

### Data roles

Configuration maps logical roles to exact indices and fields. `orders` owns document-level exploratory queries. `orderFacts` owns additive order amount, order count, item quantity and customer-day facts. `orderItems` owns line-item amount, quantity, series and SKU. `members` owns registrations. `repurchases` owns observed repeat-purchase events. Each role declares its amount meaning, time field, identity field, dimensions, source filters, and public coverage requirements. Missing roles remain visible as unavailable report sections.

The reader validates every role, field path, date window, bucket budget, response budget and credential reference at load. It applies deployment-owned filters such as minimum order amount before aggregation. It rejects partial shards, timeouts, redirects, inexact totals and exhausted exact-count pagination. Results disclose missing values, omitted buckets, source coverage and whether a measure is exact.

### Weekly report tools

`crm_report_periods` accepts one inclusive date inside the requested week and returns the canonical current, previous, prior-year and fiscal-year-to-date windows. This centralizes period arithmetic and prevents the model from choosing mismatched weekday ranges.

`crm_sales_report` returns one row for each available comparison window with source amount, order count, purchasing customers, repeat purchasers, item quantity, amount per order, items per order, amount per item, purchase frequency and amount per purchaser. A ratio is null with a reason when its denominator is zero or an input is unavailable. Customer counts use bounded composite pagination and never return identifiers.

`crm_lifecycle_report` returns new purchasers, existing-new base and active count, retained base and active count, winback base and active count, and the corresponding rates only when source coverage contains every required historical window. The implementation classifies customers inside bounded Elasticsearch composite pages and emits counts only. It fails the whole metric rather than returning a partial count when pagination or time budgets are exhausted. Registration counts remain separate from first-purchase cohorts.

`crm_product_report` groups the configured line-item source by series or SKU and returns bounded amount, quantity and line-document contribution. It discloses omitted groups and missing product keys. It does not call a line-document count an order count, does not infer UV, and does not use the empty nested `items` field from the document-level order index.

`crm_traffic_report` is not registered until a configured source supplies visits and stable channel keys. The weekly report declares UV, registration conversion, purchase conversion and advertising attribution unavailable when that role is absent. It never derives visits from orders or registrations.

### Presentation and recommendations

The Client renders comparison results as a source-backed KPI table with current, previous, prior-year and fiscal-year-to-date columns. It renders weekly trends as lines, complete composition as donuts, and rankings as horizontal bars. It retains the source table, coverage warnings and null reasons. The Client validates persisted metadata and does not accept model-authored ECharts options or values.

The business Skill generates sections for data coverage, executive observations, sales, lifecycle, channel, product, unavailable template metrics, recommendations and metric definitions. Every recommendation contains an observation, evidence references, a labeled hypothesis, an action, a validation metric and a limitation. Missing traffic or cohort evidence cannot support a budget, attribution or customer-targeting recommendation. The Agent does not emit customer-level lists or trigger marketing actions.

### Source findings that constrain the example

The configured cluster exposes dedicated order-fact, order-item-wide, repurchase and customer-order-daily indices. The order-item-wide mapping provides line-level series, SKU, amount and quantity. Its observed coverage ends in May 2025, and the member `firstBuyDate` field has no values. The document-level order source spans future dates through 2029. The report therefore profiles coverage before selecting periods and states that the example data may be historical or synthetic. These observations configure the example; they are not assumptions built into the reusable reader.

## Alternatives considered

**General Elasticsearch or federated-query tool.** A general tool would reduce implementation per metric but would let model arguments choose fields, joins or DSL that bypass report semantics and privacy review. The proposed tools keep acquisition and arithmetic closed.

**Unified warehouse before reporting.** A governed warehouse can simplify customer identity, attribution and historical snapshots, but it delays useful source-backed reporting and exceeds the requested first stage. The configured roles allow a later provider to use governed tables without changing the model-facing report concepts.

**Prompt-only report generation.** Prompt instructions cannot make missing traffic, historical coverage or item data valid. They also cannot guarantee period alignment or exact customer counts. The proposal encodes these requirements in tool behavior and returns unavailable reasons to the Skill.

## Acceptance criteria

- A user can request a Monday-to-Sunday CRM week without naming query modes, and the Agent uses canonical current, previous, prior-year and fiscal-year-to-date windows.
- Sales output computes only from configured additive fields, returns null ratios for zero or missing denominators, and distinguishes documents, orders, line documents and customers.
- Lifecycle output returns exact bounded counts without identifiers or explicitly refuses metrics whose history or pagination is incomplete.
- Product output uses the line-item-wide role and discloses omitted or missing groups; absent traffic remains unavailable.
- The conversation contains source-backed tables and suitable charts plus recommendations whose evidence and limitations are inspectable.
- Unit tests cover period boundaries, aggregation request compilation, ratio failures, pagination exhaustion, coverage refusal, product truncation, metadata validation and recommendation instructions. Real-API tests inspect aggregates only, and the keyless session snapshot records the model-visible workflow.

## Risks

Customer identifiers may differ across source roles, and a successful query does not prove cross-index identity consistency. Live composite pagination does not provide a point-in-time snapshot. Source amount and order fields may not match the template's GMV and transaction definitions until the deployment owner validates them. Top-product groups may omit a long tail. Future-dated or incomplete source coverage can make a requested week unusable. The report exposes these conditions instead of substituting zero, extrapolating, or inventing a recommendation.
