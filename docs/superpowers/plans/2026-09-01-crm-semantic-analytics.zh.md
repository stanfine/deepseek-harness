# CRM 语义分析实施计划

[English](2026-09-01-crm-semantic-analytics.md) | 中文

> **面向 agent worker：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，按任务实施本计划。步骤使用 checkbox（`- [ ]`）跟踪。

**目标：** 为现有可选 CRM 预设增加封闭语义指标层、灵活聚合分析、动态 CRM 图表和有界后续下钻。

**架构：** `semantic-model.ts` 校验部署方拥有的业务概念，`analysis-planner.ts` 将封闭请求解析为单数据集 plan，`semantic-analysis.ts` 将 plan 编译为有界 Elasticsearch 聚合和版本化结果。`crm-tools.ts` 注册目录、分析和下钻 Consumer；`ui-crm` 校验持久化结果并确定性选择 ECharts 展示。

**技术栈：** TypeScript、Cordis、Schemastery、Elasticsearch aggregation JSON、React、ECharts、Vitest、Loader/Web composition 测试、无密钥会话快照。

**规格：** [docs/superpowers/specs/2026-09-01-crm-semantic-analytics-design.zh.md](../specs/2026-09-01-crm-semantic-analytics-design.zh.md)

## 全局约束

- 模型永远不能接收索引名、物理字段、脚本、公式、路径、凭据、原始 Elasticsearch 请求或任意 ECharts options。
- 每次分析只能针对一个已配置逻辑数据集执行；不兼容的指标与维度组合在网络访问前失败。
- 模型可见 schema、指令和代表性输出必须更新 `crm-catalog` 无密钥快照。
- 产品可见行为必须包含 Loader/Web composition 测试和真实 CRM 预设的浏览器验证。
- 所有新注册都是可释放的 Cordis effect，完整序列化结果继续受现有响应和桶预算限制。
- 新增和修改的持久文档使用双语并重新记录；非平凡变更包含 implemented Agent Note。

---

### 任务 1：语义目录与配置校验

**文件：**
- 新建：`apps/cli/config/examples/crm/semantic-model.ts`
- 新建：`apps/cli/tests/crm-semantic-model.spec.ts`
- 修改：`apps/cli/config/examples/crm/crm-tools.ts`
- 修改：`apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**接口：**
- 产出：`MetricDefinition`、`DimensionDefinition`、`SemanticConfig`、`ResolvedSemanticModel` 和 `resolveSemanticModel(config, datasets): ResolvedSemanticModel`。
- 产出：不含物理来源字段的 `ResolvedSemanticModel.metricCatalog(): JsonValue` 与 `dimensionCatalog(): JsonValue`。
- 消费：`elasticsearch.ts` 的逻辑 `Dataset` 映射。

- [ ] **步骤 1：编写目录校验测试。** 覆盖重复 id、未知数据集和字段 key、缺失依赖、比率循环、不兼容依赖数据集、非法限制、带具体限制的不可用定义和有效初始目录。
- [ ] **步骤 2：运行 `pnpm vitest run apps/cli/tests/crm-semantic-model.spec.ts` 并确认模块缺失导致失败。**
- [ ] **步骤 3：实现带判别字段的来源指标（`sum`、`count`、`distinct_count`）、派生比率、维度定义、拓扑依赖校验、不可变查找表和面向模型的安全目录投影。**
- [ ] **步骤 4：向 `Config`、`CrmConfig` 和 CRM 预设增加显式语义配置。** 注册规格中的销售金额、订单数、件数、购买人数、ATV、件单数、件单价、购买频次、人均金额以及已配置日期和分类维度。
- [ ] **步骤 5：运行聚焦测试和 `pnpm run typecheck`；提交 `feat(crm): define semantic metric catalog`。**

### 任务 2：封闭分析 planner

**文件：**
- 新建：`apps/cli/config/examples/crm/analysis-planner.ts`
- 新建：`apps/cli/tests/crm-analysis-planner.spec.ts`
- 修改：`apps/cli/config/examples/crm/report-periods.ts`

**接口：**
- 产出：`AnalysisRequest`、`DrilldownRequest`、`Comparison`、`TimeGrain`、`ResolvedAnalysisPlan` 和 `resolveAnalysisPlan(model, request, budgets): ResolvedAnalysisPlan`。
- `ResolvedAnalysisPlan` 包含一个数据集、规范化日期、来源度量、派生指标顺序、维度、白名单筛选、对比窗口、排序、limit 和 intent。
- 消费：任务 1 的 `ResolvedSemanticModel`。

- [ ] **步骤 1：编写失败的 planner 测试。** 覆盖有效汇总、趋势、排行、构成、两个维度、等值和集合筛选、上期与 364 天去年同期、派生依赖展开、稳定去重和下钻父级筛选。
- [ ] **步骤 2：增加拒绝测试。** 覆盖未知 id、零个或过多指标、过多维度或筛选、跨数据集选择、不支持粒度、非法日期、过长范围、非法排序指标和下钻维度复用。
- [ ] **步骤 3：运行 `pnpm vitest run apps/cli/tests/crm-analysis-planner.spec.ts` 并确认失败。**
- [ ] **步骤 4：实现纯规范化与校验。** 复用时区安全日期 helper；本模块不解析来源字段，也不构建 Elasticsearch JSON。
- [ ] **步骤 5：运行 planner 和报告周期测试；提交 `feat(crm): resolve semantic analysis plans`。**

### 任务 3：有界 Elasticsearch 语义执行器

**文件：**
- 新建：`apps/cli/config/examples/crm/semantic-analysis.ts`
- 新建：`apps/cli/tests/crm-semantic-analysis.spec.ts`
- 修改：`apps/cli/config/examples/crm/elasticsearch.ts`

**接口：**
- 产出：`SemanticAnalysisResultV1`、`AnalysisRow`、`MetricValue`、`AnalysisCompleteness` 和 `executeSemanticAnalysis(reader, model, plan, signal): Promise<SemanticAnalysisResultV1>`。
- 增加内部 reader 操作，针对一个配置数据集执行 compiler 拥有的 aggregation JSON，不向模型参数开放索引或字段选择。
- 消费：`ResolvedAnalysisPlan` 和 `ResolvedSemanticModel`。

- [ ] **步骤 1：搭建 fixture HTTP server 并编写失败的请求结构测试。** 断言精确日期筛选、配置字段、嵌套 terms/date histogram、对比筛选、稳定桶顺序、`size: 0`、无脚本，且输出中无凭据。
- [ ] **步骤 2：编写结果测试。** 覆盖汇总、派生比率、零分母、分组对比行、缺失桶、terms 截断和误差上限、去年同期覆盖不足、排序与 Top N、完整序列化大小限制。
- [ ] **步骤 3：运行 `pnpm vitest run apps/cli/tests/crm-semantic-analysis.spec.ts` 并确认失败。**
- [ ] **步骤 4：实现执行器和严格 Elasticsearch 响应解析。** 复用现有 reader transport、deadline、响应字节、分片完整性、精确总数、凭据和取消行为。
- [ ] **步骤 5：运行语义执行器和现有 Elasticsearch 测试；提交 `feat(crm): execute bounded semantic analysis`。**

### 任务 4：目录、分析与下钻工具

**文件：**
- 修改：`apps/cli/config/examples/crm/crm-tools.ts`
- 修改：`apps/cli/tests/crm-elasticsearch.spec.ts`
- 修改：`apps/web/tests/crm-preset.e2e.ts`
- 修改：`apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md`
- 修改：`apps/cli/config/examples/crm/skills/beauty-crm-weekly/SKILL.md`
- 修改：`apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**接口：**
- 产出模型工具 `crm_metric_catalog`、`crm_dimension_catalog`、`crm_analyze` 和 `crm_drilldown`。
- 为 `crm_analyze` 和 `crm_drilldown` 持久化 `{ crmAnalysis: { version: 1, request, data } }` 展示元数据。
- 消费目录、planner、执行器和现有 scoped tool runtime。

- [ ] **步骤 1：使用封闭 schema 和目录结果扩展真实 tool-runtime 测试。** 断言禁止名称（`index`、`field`、`script`、`formula`、`dsl`、`path`）不出现在新 schema 或结果中。
- [ ] **步骤 2：增加有效分析、有效下钻、fixture 请求前拒绝跨数据集、序列化元数据和四个工具全部释放的执行测试。**
- [ ] **步骤 3：实现工具注册和展示元数据。** 参数 schema 必须有界，描述从模型的业务视角编写。
- [ ] **步骤 4：更新 CRM persona 和 Skills。** 精确周报和月报请求仍优先使用固定报表；临时问题先检查目录再使用语义分析。建议必须包含证据和覆盖披露。
- [ ] **步骤 5：扩展 Loader/Web composition 测试，观察注册、目录执行、分析元数据和不存在 coding 工具。**
- [ ] **步骤 6：运行聚焦 CLI 和 Web 测试；提交 `feat(crm): expose flexible semantic analysis tools`。**

### 任务 5：持久化结果校验与动态 ECharts 选择

**文件：**
- 新建：`packages/client/ui-crm/src/client/analysis-model.ts`
- 新建：`packages/client/ui-crm/src/client/analysis-chart-options.ts`
- 新建：`packages/client/ui-crm/tests/crm-analysis-model.client.spec.ts`
- 新建：`packages/client/ui-crm/tests/crm-analysis-chart-options.client.spec.ts`
- 修改：`packages/client/ui-crm/src/client/locales.ts`

**接口：**
- 产出：`readAnalysis(meta): AnalysisReport | null`，校验版本、请求、列、结果行、指标值、完整性、警告和下钻维度。
- 产出：`selectAnalysisView(report): AnalysisView` 和 `analysisChartOption(report, view, labels): EChartsOption`。
- 只消费持久化 JSON 元数据；不使用 Cordis context、来源字段或模型生成的 chart options。

- [ ] **步骤 1：编写结果 validator 测试。** 接受代表性汇总、趋势、排行、构成和双指标结果；拒绝非有限值、不匹配列、重复 id、未知行 key、不安全下钻、过大结果数组和非法完整性。
- [ ] **步骤 2：编写确定性视图测试。** 覆盖 KPI 汇总、折线趋势、横向排行、柱状比较、完整环形构成、不完整构成回退柱状图、兼容柱线组合、高密度表格回退和 null 值处理。
- [ ] **步骤 3：运行两个新 Client 测试并确认模块缺失导致失败。**
- [ ] **步骤 4：实现 validator 和图表选择器，使用本地化标签且不重新计算业务指标。**
- [ ] **步骤 5：运行 Client 测试和 typecheck；提交 `feat(crm): validate flexible analysis charts`。**

### 任务 6：分析卡片与交互式下钻

**文件：**
- 新建：`packages/client/ui-crm/src/client/CrmAnalysisRow.tsx`
- 修改：`packages/client/ui-crm/src/client/CrmRow.module.css`
- 修改：`packages/client/ui-crm/src/client/index.ts`
- 修改：`packages/client/ui-crm/src/client/locales.ts`
- 新建：`packages/client/ui-crm/tests/crm-analysis-row.client.spec.tsx`
- 修改：`packages/client/ui-crm/tests/plugin.client.spec.ts`
- 修改：`packages/client/ui-crm/README.md`
- 修改：`packages/client/ui-crm/README.zh.md`
- 修改：`packages/client/ui-crm/README.i18n.yaml`

**接口：**
- 为 `crm_analyze` 和 `crm_drilldown` 产出 keyed tool presenter。
- 使用 `inputActions.setDraft()` 准备本地化 follow-up，保留日期、指标、筛选、父级值和选中的下一维度；提交后由模型调用 `crm_drilldown`。
- 消费 `readAnalysis`、`selectAnalysisView`、`analysisChartOption`、`EChart` 和现有本地化 slot props。

- [ ] **步骤 1：编写 KPI、图表、表格回退、警告、对比上下文和非法元数据回退 UI 测试。**
- [ ] **步骤 2：增加下钻交互测试。** 点击一个分类，断言 draft 包含选中维度值、下一维度、指标和日期窗口，且不包含物理字段。
- [ ] **步骤 3：实现卡片、无障碍图表/表格标签、本地化文案和可释放 slot 注册。**
- [ ] **步骤 4：更新 package README 双语，说明结果校验、图表规则、模型可见影响和延期的多来源关联；重新记录双语 pair。**
- [ ] **步骤 5：运行全部 `ui-crm` 测试及客户端目录生成/检查；提交 `feat(crm): render and drill into semantic analyses`。**

### 任务 7：真实 composition、快照、文档和浏览器验证

**文件：**
- 修改：`snapshots/session/crm-catalog/**`
- 修改：`snapshots/session/headless.snapshot.ts`
- 修改：`docs/user/guide/crm-monthly.md`
- 修改：`docs/user/guide/crm-monthly.zh.md`
- 修改：`docs/user/guide/crm-monthly.i18n.yaml`
- 新建：`.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.md`
- 新建：`.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.zh.md`
- 新建：`.agents/notes/implemented/feature/2026-09-01-crm-semantic-analytics.i18n.yaml`
- 修改：`apps/web/tests/crm-preset.e2e.ts`

**接口：**
- 固定模型可见 schema、persona、Skills、持久化分析元数据、真实 CRM 预设 composition 和用户可见图表/下钻行为。
- 说明支持的业务概念、查询示例、覆盖失败、治理限制和后续 provider 要求。

- [ ] **步骤 1：扩展 `crm-catalog` 快照断言，仅刷新其预期系统提示和工具 schema artifact。** 验证四个新工具以及不存在禁止的物理/DSL 参数。
- [ ] **步骤 2：增加 implemented Agent Note 双语。** 记录封闭语义请求理由、单数据集首期实现、确定性客户端图表、替代方案、后果、风险和验证归属；重新记录 pair。
- [ ] **步骤 3：使用灵活示例、支持概念、下钻流程、不可用指标和多来源治理区别更新 CRM 指南双语；重新记录 pair。**
- [ ] **步骤 4：通过 CRM 预设运行真实本地浏览器场景。** 请求月度渠道销售额、订单数和 ATV 并与上期比较；验证图表、警告披露、持久化重放、渠道选择和后续门店下钻。截图和日志不得暴露凭据。
- [ ] **步骤 5：运行聚焦验证：** `pnpm vitest run apps/cli/tests/crm-semantic-model.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-elasticsearch.spec.ts packages/client/ui-crm/tests/*.spec.ts packages/client/ui-crm/tests/*.spec.tsx`；`pnpm vitest run apps/web/tests/crm-preset.e2e.ts`；`pnpm run test:snapshot -- -t crm-catalog`；`pnpm run build`；`pnpm run doc-sync`；`git diff --check`。
- [ ] **步骤 6：对实际变更范围执行仓库 pre-push workflow，并只报告运行过的命令；提交 `feat(crm): add semantic analytics and drilldown`。**
