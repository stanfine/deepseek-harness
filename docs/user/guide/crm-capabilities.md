# CRM capability map

English | [中文](crm-capabilities.zh.md)

The beauty and personal care CRM preset combines governed data access, semantic analytics, standard reports, charts, and inactive MA campaign draft creation. This reference groups the available capabilities by user outcome and links each category to its configuration or implementation owner.

## Entry point and business skills

The [CRM preset](../../../apps/cli/config/examples/crm/presets/crm/preset.yml) appears as **Beauty and Personal Care CRM** in the Web UI. Its [agent composition](../../../apps/cli/config/examples/crm/presets/crm/agent.cordis.yml) mounts the data providers, CRM tools, business instructions, chart presenter, and approval policy without exposing Shell, arbitrary HTTP, or arbitrary database queries.

| Category | Name | Purpose |
| --- | --- | --- |
| Preset | Beauty and Personal Care CRM | Provides the user-facing CRM agent and composes all governed capabilities. |
| Skill | `beauty-crm-monthly` | Defines the monthly-report workflow, metric interpretation, comparisons, drilldowns, evidence rules, and chart selection. |
| Skill | `beauty-crm-weekly` | Defines the Monday-to-Sunday weekly report, aligned comparisons, lifecycle and product sections, recommendations, and Excel export. |

The skill sources are [beauty-crm-monthly](../../../apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md) and [beauty-crm-weekly](../../../apps/cli/config/examples/crm/skills/beauty-crm-weekly/SKILL.md). Skills control how the agent uses tools and explains results; they do not connect to databases or external systems themselves.

## Data providers

The preset maps external systems to narrow service APIs. Deployment configuration owns endpoints, credentials, index names, field mappings, time zones, response budgets, and transport policy.

| Provider | Purpose | Current restriction |
| --- | --- | --- |
| Elasticsearch | Reads configured order, member, order-fact, and order-item datasets for aggregates and bounded redacted previews. | The agent cannot submit arbitrary indices, fields, scripts, or Elasticsearch DSL. |
| CDP | Lists governed audience tags for discovery. | A CDP tag is not required when a configured CRM evidence policy can create an MA-native audience. |
| MA | Lists campaign groups, categories, and content; creates audiences and inactive drafts; reads status and aggregate reach. | Creation cannot approve, start, send, edit, archive, or delete a campaign. |
| LOYALTY | Lists coupon templates and reads configured aggregate coupon results. | It does not return customer-level records. |

The provider implementations are grouped under the [CRM example configuration](../../../apps/cli/config/examples/crm/cordis.yml). HTTP is allowed only when deployment configuration opts into it; production deployments should use HTTPS or a secure tunnel.

## Semantic analytics

The [semantic model](../../../apps/cli/config/examples/crm/semantic-model.ts) gives each business metric and dimension a configured dataset, calculation, format, availability, and limitation. The [analysis planner](../../../apps/cli/config/examples/crm/analysis-planner.ts) accepts only configured metrics, dimensions, time grains, filters, comparisons, sorting, and Top N limits. The [analysis executor](../../../apps/cli/config/examples/crm/semantic-analysis.ts) returns values together with coverage, missing values, truncation, approximation, and unavailable reasons.

The initial configuration includes sales amount, order count, quantity, purchaser count, average transaction value, items per transaction, amount per item, purchase frequency, amount per purchaser, item sales amount, and item quantity. Available dimensions include time, channel, subchannel, store, store type, order type, product series, and SKU where the selected logical dataset supports them.

| Tool | Purpose |
| --- | --- |
| `crm_catalog` | Lists logical datasets, configured semantics, and query limits. |
| `crm_profile` | Checks observed date coverage and missing dates before choosing a report period. |
| `crm_metric_catalog` | Lists business metrics, definitions, availability, and limitations. |
| `crm_dimension_catalog` | Lists business dimensions, filters, and permitted drilldown paths. |
| `crm_analyze` | Calculates a bounded summary, trend, ranking, composition, or comparison. |
| `crm_drilldown` | Adds one governed dimension while preserving the original period, metrics, filters, and selected parent values. |
| `crm_query` | Supports the fixed legacy monthly and weekly workflows with summary, group, trend, distinct-customer, or bounded-record modes. |

One semantic request reads one logical dataset. Cross-system identity resolution, attribution, time alignment, and total reconciliation require deployment-owned mappings or a provider that implements those rules; the agent does not infer joins from similar field names.

## Standard reports and Excel

The weekly report modules resolve canonical periods and calculate fixed sales, lifecycle, product-series, and SKU sections. The monthly skill uses the governed query and semantic tools for monthly summaries, previous-period comparison, daily trends, channel composition, store ranking, and follow-up drilldowns.

| Tool | Purpose |
| --- | --- |
| `crm_report_periods` | Resolves the current week, previous week, prior-year aligned week, and fiscal year-to-date period. |
| `crm_sales_report` | Calculates governed weekly sales and purchaser metrics with aligned comparisons. |
| `crm_lifecycle_report` | Calculates lifecycle cohorts only when the configured history is sufficient. |
| `crm_product_report` | Calculates bounded product-series or SKU rankings and comparisons. |
| `crm_export_weekly_excel` | Generates an authenticated temporary download from the fixed weekly report and recommendations. |

The workbook contains Definition, Sales Overview, Lifecycle, Traffic, Product Series, Product SKU, and Recommendations sheets. The export accepts no arbitrary path, formula, source field, or query DSL, and it contains aggregate results rather than customer details.

## Marketing recommendations and campaign drafts

The [marketing model](../../../apps/cli/config/examples/crm/marketing-model.ts) declares supported opportunities, evidence rules, activation availability, actions, and measurement metrics. The evaluator ranks only opportunities supported by actual aggregate evidence and records limitations and unavailable reasons.

| Tool | Purpose |
| --- | --- |
| `crm_opportunity_catalog` | Lists governed opportunity definitions and activation requirements. |
| `crm_recommend_opportunities` | Produces ranked, evidence-backed recommendations for one period and comparison. |
| `crm_activation_catalog` | Reads live MA groups, categories, content, and CDP tags before planning. |
| `crm_campaign_plan` | Creates a no-write preview containing the governed audience, activation selection, canvas, metrics, and readiness. |
| `crm_campaign_create_draft` | Creates the reviewed MA audience and inactive campaign draft after the fixed confirmation and host approval. |
| `crm_campaign_status` | Reads aggregate campaign lifecycle status for a campaign recorded in the session. |
| `crm_campaign_results` | Reads partial-safe aggregate MA and configured LOYALTY results. |

The governed flow is `recommendation → live activation catalog → plan and audience preview → canvas preview → user review → host approval → inactive draft → status and aggregate results`. The write tool accepts only a plan recorded in the current session and the fixed confirmation `create_inactive_draft`.

The [audience policy](../../../apps/cli/config/examples/crm/audience-policy.ts) converts recorded recommendation evidence into an MA audience. The [canvas builder](../../../apps/cli/config/examples/crm/campaign-canvas.ts) creates a single path from start to audience, delivery, and end. The [MA compiler](../../../apps/cli/config/examples/crm/ma-wire.ts) converts that path to MA audience and X6 flow data. The [draft coordinator](../../../apps/cli/config/examples/crm/campaign-draft-creator.ts) records deterministic progress and permits safe replay after a confirmed result.

## Web presentation

The optional [CRM UI package](../../../packages/client/ui-crm/README.md) validates persisted result metadata before rendering KPI cards, comparisons, charts, tables, drilldown actions, recommendations, plans, and campaign status. Invalid metadata falls back to the raw tool result.

| Presenter | Purpose |
| --- | --- |
| `CrmRow` | Presents fixed query summaries, groups, trends, and source tables. |
| `CrmAnalysisRow` | Presents semantic summaries, trends, rankings, compositions, comparisons, and drilldown prompts. |
| `CrmReportRow` | Presents standard weekly sales, lifecycle, and product sections. |
| `CrmCampaignRow` | Presents recommendations, audience and canvas previews, inactive drafts, status, and aggregate results. |
| `EChart` | Renders the validated chart option with ECharts SVG and keeps the accessible table available. |

Supported views are bar, horizontal bar, line, area, pie, donut, and table. Chart selection follows the analysis intent, metric additivity, category count, and completeness. The client does not execute arbitrary ECharts options, scripts, formatter functions, or external URLs.

## Persistence, safety, and verification

The [CRM campaign event package](../../../packages/examples/crm-campaign/README.md) records draft start, audience creation, draft creation, and bounded failure events. It stores opaque external IDs and deterministic operation keys without storing credentials, provider response bodies, customer records, or audience members.

The feature has focused tests for provider configuration, Elasticsearch queries, semantic planning and calculations, weekly reports, Excel generation, opportunity evaluation, audience policy, campaign planning, canvas compilation, draft replay, UI validation, charts, and the Web preset. The [CRM session snapshot](../../../snapshots/session/crm-catalog/snapshot.yml) checks the shipped prompt and tool schemas without requiring production credentials.

## Known limits

- Configured source fields do not prove order uniqueness, identity consistency, refund treatment, cancellation treatment, currency, or historical completeness.
- Traffic conversion, campaign attribution, incrementality, cost, and ROI stay unavailable until their events and business definitions are governed.
- Product-item rows do not equal orders, purchasers, or unique SKUs.
- Charts communicate returned aggregates but do not repair missing, overlapping, approximate, or truncated data.
- Campaign automation stops at an inactive draft and aggregate readback.

See the [CRM monthly guide](./crm-monthly.md) for startup, report prompts, drilldown examples, Excel export, and campaign-draft usage.
