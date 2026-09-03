# CRM monthly reports

English | [中文](crm-monthly.zh.md)

This source-checkout tutorial starts a read-only beauty and personal-care CRM Agent in the Web profile. The Agent uses native tools to query Elasticsearch, writes its report in the conversation, and accepts channel or store drilldown requests. The opt-in Web plugin displays query results as metric cards, group bar charts and time-series line charts; a standard weekly report can also produce an expiring Excel download. MongoDB, scheduling and a separate dashboard page are outside this example.

## Start the CRM Agent

1. Complete the repository setup in [Development](../../development.md) and configure a DeepSeek model in the application. Run the following commands from the repository root in zsh. The shipped preset reads four indices: `mkt_catering_loyalty_behavior_consumer_order`, `mkt_catering_loyalty_customer`, `mkt_catering_loyalty_behavior_consumer_order_fact`, and `mkt_catering_loyalty_behavior_consumer_order_item_wide`. Give the Elasticsearch account only index metadata and document-search access for those four names; it does not need write, delete, cluster-administration, script-management, or wildcard access. The plugin is not a substitute for database permissions.

```sh
export DSH_CRM_ES_URL='http://your-elasticsearch-host:9200'
export DSH_CRM_ALLOW_HTTP=true
export DSH_CRM_ES_USERNAME='your-read-only-user'
read -rs 'DSH_CRM_ES_PASSWORD?Elasticsearch password: '
export DSH_CRM_ES_PASSWORD
export DSH_CRM_ARTIFACT_TOOL_MODULE='file:///absolute/path/to/artifact_tool.mjs'
export DSH_CRM_EXPORT_ROOT='/private/runtime/path/crm-exports'
export DSH_CRM_MA_URL='http://your-ma-host:17501'
export DSH_CRM_MA_ALLOW_HTTP=true
export DSH_CRM_MA_ALLOW_UNAUTHENTICATED=true
export DSH_CRM_LOYALTY_URL='http://your-loyalty-host:15000'
export DSH_CRM_LOYALTY_ALLOW_HTTP=true
export DSH_CRM_LOYALTY_ALLOW_UNAUTHENTICATED=true
export DSH_CRM_MA_DELIVERY_TEMPLATE_ID='deployment-approved-template'
export DSH_CRM_MA_DELIVERY_CAPABILITY_ID='deployment-approved-capability'
pnpm dsh web --patch apps/cli/config/examples/crm/cordis.yml
```

HTTP Basic authentication does not encrypt credentials or records. Use this option only on a trusted test network; use HTTPS or a secure tunnel for production. Never paste the password into the Agent conversation, a tracked file, or a command-line argument. Changing a credential requires restarting the application.

## Create a governed marketing draft

Ask: `分析 2025 年 3 月相对上月的营销机会，先给建议，不要创建活动。` The Agent evaluates governed opportunities from aggregate CRM evidence and returns up to three ranked suggestions. Ask it to prepare a campaign plan for one recommendation. The plan contains an aggregate audience estimate, configured action, validation metrics, limitations, and readiness reasons; it performs no write.

After reviewing the plan, explicitly ask to create its inactive draft. The write tool accepts only the recorded `planId` and fixed `create_inactive_draft` token, then triggers host approval. Audience conditions, exclusions, MA nodes, connectors, templates, capabilities, and provider bodies come from deployment configuration. Approval creates only one audience and one `DRAFT` or `INACTIVE` campaign. The workflow cannot approve, start, send, issue coupons, edit, or delete. Session events and a deterministic business key make retries replay-safe or require manual reconciliation after an ambiguous result.

Use the plan id with `crm_campaign_status`, or with `crm_campaign_results` and a date range. Results resolve the campaign id from the current session and expose aggregate MA and configured LOYALTY values plus availability reasons. They never join customer records. CRM conversion stays unavailable until deployment owns a campaign-to-order attribution rule; incrementality stays unavailable without a governed holdout comparison.

2. Create a new conversation with the **美妆个护 CRM** preset. The overlay replaces the discoverable preset roots; old conversations referencing other presets are not migrated. Use a separate DSH home or deployment when existing coding conversations must remain available. The application retains its existing model settings and other profile configuration.

3. Enter a business request, for example:

```text
先核实数据时间覆盖，再生成 2025 年 3 月的美妆个护 CRM 月报。
比较上月，分析购买客户、原始订单金额、注册会员、渠道和门店表现。
数据不完整或口径不确定时必须说明；不要编造复购率或净销售额。
```

For a standard weekly report modeled on the REMY workbook, ask: `生成包含 2025-04-30 的美妆个护 CRM 周报，并给出有证据的建议。` The Agent resolves a Monday-to-Sunday window and calls fixed sales, lifecycle, product-series and SKU report tools. The Web client renders weekly KPI cards and ECharts comparisons from persisted tool metadata. The current source has no traffic event chain, so UV and conversion remain unavailable; lifecycle and prior-year comparisons refuse periods outside observed coverage. Source order facts do not yet prove the workbook's refund, cancellation, currency, amount-under-50 or same-member same-day rules. The preset also leaves repeat purchasers unavailable and does not declare lifecycle history complete; a deployment owner must confirm those definitions before enabling them.

To export the result, ask: `把这份周报和建议导出为 Excel。` After the standard report reads complete, the Agent calls the fixed `crm_export_weekly_excel` tool. Its workbook contains Definition, Sales Overview, Lifecycle, Traffic, Product Series, Product SKU and Recommendations sheets. The tool accepts no arbitrary paths, formulas, fields or query DSL. Downloads use random identifiers, a file-count limit and an expiry; workbooks contain aggregates, definitions and evidence-bound recommendations, never customer records. `DSH_CRM_ARTIFACT_TOOL_MODULE` names the deployment-provided artifact-tool ESM module and `DSH_CRM_EXPORT_ROOT` names a private runtime-writable directory. Missing or incompatible module configuration fails when export is requested.

For follow-up drilldown, ask: `保持相同月份，查看 pos 渠道的门店贡献，并展示有限条脱敏明细。` Tool calls and their results use the existing session log and CRM chart cards. The preset adds no Shell, arbitrary HTTP, filesystem editor, or general database query tool.

## Ask flexible business questions

For an analysis outside the fixed weekly or monthly layout, ask with business metric and dimension names. For example: `比较 2025 年 4 月与上月的渠道销售额、订单数和客单价，按销售额排序；选择 pos 后继续下钻门店。` The Agent first inspects `crm_metric_catalog` and `crm_dimension_catalog`, then calls `crm_analyze`. Selecting a returned channel prepares a reviewed follow-up; submitting it lets the Agent call `crm_drilldown` with the same dates, metrics, comparison, filters and selected parent value.

The initial catalog includes sales amount, order count, quantity, purchaser count, average transaction value, items per order, amount per item, purchase frequency and amount per purchaser. It supports day, week, month, channel, subchannel, store, store type and order type on the order-document source. Each exposed dimension therefore has at least one available metric from the same logical dataset. Province, product series and SKU remain available to fixed weekly tools but are deferred from flexible analysis until their fact and line-item datasets have configured semantic metrics. The result records current and comparison values, unavailable reasons, coverage, omitted groups, count errors and permitted next dimensions. Missing metric coverage is a metric-value count rather than a unique-document count and can therefore exceed the number of source documents. Dimensions without an explicit composition declaration remain unknown and cannot produce a donut. The Client validates this persisted result and selects KPI, line, horizontal-bar, comparison-bar, donut or table views deterministically. The model cannot supply source fields, Elasticsearch DSL, formulas or ECharts options.

An unavailable catalog entry is a governed refusal, not a zero. Repeat purchase, lifecycle, traffic conversion, campaign attribution, targets and costs remain unavailable until deployment configuration declares both their business definition and adequate source coverage. A warning about missing dimensions, Top N truncation, approximate counts or missing comparison history stays visible in the chart card and must also appear in the narrative recommendation.

One semantic request reads one logical dataset. The current source can answer channel and store questions from bounded order documents and can answer fixed weekly additive facts from their dedicated source, but it does not join those datasets inside one semantic request. Data that is distributed across CRM, commerce, traffic, campaign or cost systems can still support separate source-backed sections without a warehouse. Cross-system customer identity, attribution, shared metric definitions, time alignment and reconciled totals require governed mappings or a provider that implements those rules; the Agent must not infer a join from matching field names.

## Configure data and limits

The [preset composition](../../../apps/cli/config/examples/crm/presets/crm/agent.cordis.yml) maps `orders` to `mkt_catering_loyalty_behavior_consumer_order` and `members` to `mkt_catering_loyalty_customer`. Dates use an explicit UTC offset; the end date is exclusive. The [business Skill](../../../apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md) owns metric definitions and reporting rules.

Only deployment configuration can change indices, date/amount/customer fields, dimensions, preview leaf fields, time zone, and acquisition budgets. Do not configure personal fields as preview leaves or grouping dimensions. Array previews preserve item associations but do not validate that fields are non-personal. Credential fields name environment variables; `crm_catalog` excludes the endpoint and credentials.

`crm_profile` returns document count, date extent and missing-date count. `crm_query` supports summary statistics, bounded top groups, bounded recent previews, daily or monthly date histograms, and paginated exact distinct identifiers. Source errors, partial shards, inexact total hits, excess response bytes and exhausted exact-count budgets fail explicitly. Distinct pages share a deadline and read a live index, not a point-in-time snapshot; use a stable reporting copy for auditable results during concurrent writes. Top groups disclose omitted counts and count-error bounds, and exclude missing dimension values.

These source mappings do not establish unique orders, complete history, matching customer identities, currency, refunds, or valid business data. Ordinary object-array items cannot support correct category sales by grouping whole-order amounts. The Agent marks unsupported metrics as unavailable rather than inventing them. The example is source-only and is not included in the published CLI package.

## Use conversation charts

Ask the CRM Agent to include daily trends and channel or store comparisons. Successful new queries render charts directly in their conversation tool cards; amount and document-count measures can be switched. Group drilldown prepares a question with the same dates and filters; review and send it in the composer. An existing draft is never overwritten. Unsupported, failed and older results without chart metadata remain textual; ask the Agent to query again. Amount labels retain source semantics and do not imply a currency or net revenue. Charts retain truncation warnings and provide a data table and raw output.

## Choose charts dynamically

Ask for a view directly, for example: `用横向条形图展示渠道金额排行，日趋势用面积图。` The Agent passes `chartType` and `metric` with `crm_query`; the application maps those choices to ECharts over the returned values. Each group or trend card also offers chart-type and measure selectors, text tooltips and zoom sliders. Chart clicks prepare the same reviewed drilldown as table buttons. Changing the view does not query Elasticsearch again; changing dates or filters does. Pies and donuts are unavailable when groups are incomplete, overlap, include missing dimensions or measures, or contain negative or non-additive values. Local view changes reset on card remount; Agent-requested views survive history reload. The example supports seven display choices, not the entire ECharts catalog or arbitrary JavaScript options.

A monthly report requests daily trends, channel composition and store ranking without requiring chart names in the prompt. Ask for the analytical question, such as `分析渠道占比和门店金额排行，并解释每日走势`. The Agent records an `intent` with each group or trend query. Composition uses a donut when the data supports proportions; otherwise the card explains its fallback. Rankings sort only the returned groups, not all stores when the source query is truncated. One time point is shown as a table. Start a new CRM conversation after updating the preset and Skill so older instructions do not remain in the conversation.
