# CRM 营销建议实施计划
[English](2026-09-02-crm-marketing-recommendations.md) | 中文
> **面向 Agent 工作者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务逐项实施本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 增加以建议为先的 CRM 工作流，从聚合语义证据评估已配置的营销机会，并生成带聚合人群预览的活动方案草稿。

**架构：** 封闭营销模型根据现有语义目录验证机会定义。确定性评估器执行固定语义请求，为不超过 3 个候选项评分并持久化证据；活动规划器从当前会话解析一个不透明的建议 id，并创建仅限草稿的方案。客户端验证器和展示转换器渲染可回放的卡片，其按钮只准备本地化输入草稿。

**技术栈：** TypeScript、Cordis 配置、Schemastery、现有 CRM 语义规划器和 Elasticsearch 执行器、DSH 会话事件、React、ECharts 卡片原语、Vitest、无密钥会话快照。

**规范：** `docs/superpowers/specs/2026-09-02-crm-marketing-recommendations-design.md`

## 全局约束

- 首次实现绝不导出客户记录、发布活动、写入营销平台、安排投放或添加写入凭据。
- 模型可见的 schema 只包含已配置的业务 id 和有界标量值；不得包含索引、字段、公式、脚本、DSL、路径、端点、任意规则或任意活动类型。
- 建议和活动方案结果只包含聚合值和逻辑 id；不得包含客户 id、姓名、电话号码、电子邮件地址、文档预览或叶记录。
- 确定性代码负责候选资格、分数、顺序、已配置标题和操作模板。模型文案可以概述已持久化字段，但不得写入建议对象。
- 每个模型可见值都必须记录并可回放。活动方案从当前会话解析其建议 id，并拒绝跨会话或缺失的 id。
- 客户端代码将已持久化元数据视为不可信 JSON，执行完整的保留大小和项目数量限制，验证失败时回退到文本。
- 产品文案使用类型化 locale 字典。英文和中文文档配对必须一起更新并重新记录。

---

### 任务 1：封闭营销模型和机会目录

**文件：**
- Create：`apps/cli/config/examples/crm/marketing-model.ts`
- Create：`apps/cli/tests/crm-marketing-model.spec.ts`
- Modify：`apps/cli/config/examples/crm/crm-tools.ts`
- Modify：`apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`

**接口：**
- 消费：来自 `SemanticModel`（定义于 `semantic-model.ts`），以及已配置的指标和维度 id。
- 产出：`resolveMarketingModel(config, semanticModel): MarketingModel`、`MarketingModel.opportunityCatalog()`、`MarketingModel.resolveOpportunity(id)`，以及不可变的 `OpportunityDefinition` 值。

- [ ] **步骤 1：编写失败的配置测试。** 添加接受 6 个已配置 id 的 fixture（测试前置数据），并拒绝重复 id、未知指标或维度、跨数据集依赖、不支持的比较、未知人群条件、超出范围的阈值、空规则，以及缺少必需的最近购买、同意状态、消费额或身份概念的可执行成员机会。

```text
expect(() => resolveMarketingModel({ opportunities: [valid, { ...valid }] }, semanticModel)).toThrow(/Duplicate opportunity id/)
expect(resolveMarketingModel(config, semanticModel).opportunityCatalog().find(item => item.id === 'reactivation'))
  .toMatchObject({ available: false, unavailableReason: expect.stringContaining('recency') })
```

- [ ] **步骤 2：运行模型测试并确认 RED。** 运行 `pnpm exec vitest run apps/cli/tests/crm-marketing-model.spec.ts`；预期失败，因为 `marketing-model.ts` 和配置区段尚不存在。

- [ ] **步骤 3：实现不可变的封闭模型。** 定义 `decline`、`growth`、`above_average` 和 `below_average` 等带判别的规则类型；要求每种类型使用精确键；验证有限且有界的阈值和单数据集依赖；将不支持的成员机会解析为不可用，并保留其条目。

```text
export interface MarketingModel {
  opportunityCatalog(): readonly OpportunityCatalogItem[]
  resolveOpportunity(id: string): OpportunityDefinition
}
export function resolveMarketingModel(config: MarketingConfig, semantic: SemanticModel): MarketingModel
```

- [ ] **步骤 4：添加显式预设配置。** 配置全部 6 个机会 id。让渠道、门店、ATV 和每单商品数机会可由当前 `orders` 数据集执行；让重新激活和复购保持不可用，并给出具体的缺失概念原因。

- [ ] **步骤 5：运行聚焦测试并提交。** 运行新的模型测试、现有语义模型测试、目标 Oxlint 和 `git diff --check`；提交 `feat(crm): define governed marketing opportunities`。

---

### 任务 2：确定性机会评估器

**文件：**
- Create：`apps/cli/config/examples/crm/opportunity-evaluator.ts`
- Create：`apps/cli/tests/crm-opportunity-evaluator.spec.ts`
- Modify：`apps/cli/config/examples/crm/semantic-analysis.ts`

**接口：**
- 消费：`MarketingModel`、`resolveAnalysisPlan`、`executeSemanticAnalysis` 和 `OpportunityRequest { start, end, comparison, opportunityIds? }`。
- 产出：`evaluateOpportunities(model, request, analyze, signal): Promise<RecommendationResultV1>`，其中最多包含 3 条确定性的 `RecommendationV1` 记录。

- [ ] **步骤 1：编写失败的评估器测试。** 覆盖封闭请求验证、固定请求展开、不可用类型、不完整覆盖、规则阈值、确定性分数、稳定顺序、按机会 id 处理并列、最多 3 条结果、保留源请求，以及不存在提供方字段或客户值。

```text
const result = await evaluateOpportunities(model, request, analyzeFixture, signal)
expect(result.recommendations).toHaveLength(3)
expect(result.recommendations.map(item => item.score)).toEqual([...result.recommendations.map(item => item.score)].sort((a, b) => b - a))
expect(JSON.stringify(result)).not.toMatch(/index|field|customerId|dsl|script/)
```

- [ ] **步骤 2：运行评估器测试并确认 RED。** 运行 `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts`；预期出现缺少评估器的失败。

- [ ] **步骤 3：实现固定分析展开和证据提取。** 只根据已解析的定义构造请求。复用现有规划器和执行器回调，要求已配置的比较覆盖，并将逻辑指标值、覆盖率、完整性、警告和规范化请求复制到有界证据记录中。

```text
export interface OpportunityRequest {
  start: string
  end: string
  comparison: 'previous_period' | 'prior_year'
  opportunityIds?: string[]
}
export type RecommendationEvidence = Pick<SemanticAnalysisResultV1,
  'request' | 'columns' | 'rows' | 'coverage' | 'completeness' | 'warnings'>
export interface AggregateAudienceCondition {
  id: string
  label: string
  available: boolean
  estimatedCount: number | null
  unavailableReason?: string
  limitations: readonly string[]
}
export interface AggregateAudiencePreview {
  count: number | null
  distributions: readonly { dimension: string; rows: readonly { value: string; count: number }[] }[]
  unavailableReason?: string
}
export interface UnavailableOpportunity { opportunityId: string; reason: string }
export interface RecommendationV1 {
  recommendationId: string
  opportunityId: string
  score: number
  priority: 1 | 2 | 3
  title: string
  actionTemplate: string
  evidence: readonly RecommendationEvidence[]
  audienceConditions: readonly AggregateAudienceCondition[]
  estimatedAudience: AggregateAudiencePreview
  primaryMetrics: readonly string[]
  guardrailMetrics: readonly string[]
  limitations: readonly string[]
}
export interface RecommendationResultV1 {
  version: 1
  request: OpportunityRequest
  recommendations: readonly RecommendationV1[]
  unavailable: readonly UnavailableOpportunity[]
}
export type AnalyzeOpportunity = (request: AnalysisRequest, signal: AbortSignal) => Promise<SemanticAnalysisResultV1>
export function evaluateOpportunities(
  model: MarketingModel, request: OpportunityRequest, analyze: AnalyzeOpportunity, signal: AbortSignal,
): Promise<RecommendationResultV1>
```

- [ ] **步骤 4：实现确定性评分和 id。** 根据已配置的影响权重、证据幅度、完整性惩罚和风险权重计算分数。将 `recommendationId` 派生为 `rec_` 加上由规范版本、机会 id、规范化请求和证据组成的规范化内容的 base64url SHA-256 摘要；绝不包含提供方或客户数据。

- [ ] **步骤 5：执行结果限制。** 拒绝过大的完整结果、过多的证据行、未知的已返回指标 id、不可用的必需操作数，以及会把缺失数据当作零的规则。

- [ ] **步骤 6：运行评估器、语义执行器和规划器测试并提交。** 运行 `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts apps/cli/tests/crm-semantic-analysis.spec.ts apps/cli/tests/crm-analysis-planner.spec.ts`；提交 `feat(crm): evaluate evidence-backed marketing opportunities`。

---

### 任务 3：会话范围的活动方案草稿规划器

**文件：**
- Create：`apps/cli/config/examples/crm/campaign-planner.ts`
- Create：`apps/cli/tests/crm-campaign-planner.spec.ts`
- Modify：`apps/cli/tests/crm-tools.spec.ts`

**接口：**
- 消费：当前 `crmRecommendations` 元数据（来自 `Agent.session.events`）、`MarketingModel` 和聚合语义分析回调。
- 产出：`findRecommendation(session, recommendationId): RecommendationV1` 和 `createCampaignPlan(model, recommendation, analyze, signal): Promise<CampaignPlanResultV1>`。

- [ ] **步骤 1：编写失败的会话解析测试。** 构建真实的工具调用和工具结果会话事件。接受一个有效的当前会话 id，并拒绝缺失 id、跨会话 id、格式错误的元数据、冲突的重复 id、超大元数据，以及摘要与其证据不匹配的 id。

```text
expect(findRecommendation(session, validId).recommendationId).toBe(validId)
expect(() => findRecommendation(otherSession, validId)).toThrow(/current session/)
```

- [ ] **步骤 2：编写失败的方案测试。** 覆盖仅有的 `draft` 状态、已配置的目标和机制、聚合人群计数和有界分布、不可用条件、排除条件、留出组指导、主要指标和护栏指标、就绪检查，以及不存在 export、publish、send、schedule、budget、endpoint、content 和 customer 字段。

- [ ] **步骤 3：运行规划器测试并确认 RED。** 运行 `pnpm exec vitest run apps/cli/tests/crm-campaign-planner.spec.ts`；预期出现缺少规划器函数的失败。

- [ ] **步骤 4：实现失败即关闭的事件扫描。** 只扫描 `tool/result` 事件中的 `crm_recommend_opportunities` 已提交结果，验证完整的带版本投影，核验摘要，并选择唯一匹配的建议。不要维护重启后会消失的内存注册表。

- [ ] **步骤 5：实现聚合人群预览。** 只将已配置的人群条件展开为语义请求，返回计数和有界分布；当任何必需条件或估算不可用时，将 `readyForHumanExecution: false`。

```text
export interface CampaignPlanResultV1 {
  version: 1
  recommendationId: string
  status: 'draft'
  audiencePreview: AggregateAudiencePreview
  readyForHumanExecution: false
}
```

- [ ] **步骤 6：运行活动、工具和会话 fixture 测试并提交。** 运行 `pnpm exec vitest run apps/cli/tests/crm-campaign-planner.spec.ts apps/cli/tests/crm-tools.spec.ts`；提交 `feat(crm): prepare draft campaign plans`。

---

### 任务 4：注册封闭的建议和方案工具

**文件：**
- Modify：`apps/cli/config/examples/crm/crm-tools.ts`
- Modify：`apps/cli/tests/crm-elasticsearch.spec.ts`
- Modify：`apps/web/tests/crm-preset.e2e.ts`

**接口：**
- 产出工具 `crm_opportunity_catalog`、`crm_recommend_opportunities` 和 `crm_campaign_plan`。
- 持久化 `{ crmRecommendations: { version: 1, request, data } }` 和 `{ crmCampaignPlan: { version: 1, recommendationId, data } }`。

- [ ] **步骤 1：扩展实际 ToolRuntime 测试并确认 RED。** 断言实现前 3 个工具都不存在，然后指定精确的封闭 schema。递归拒绝模型可见参数和结果中的名称 `index`、`field`、`formula`、`script`、`dsl`、`path`、`endpoint`、`customer`、`publish`、`send` 和 `export`。

- [ ] **步骤 2：添加执行和生命周期测试。** 通过实际注册表执行目录、建议和方案。断言网络请求前拒绝、会话范围的 id 查找、对最终 `{ content, meta }` 执行保留大小限制、元数据正确，以及 dispose 后移除全部 3 个工具。

- [ ] **步骤 3：实现工具注册。** 在活动方案编排入口获取 `exec.agent.session`，明确保留会话所有权，复用语义执行器回调，并采用部署限制和 1 MiB 保留结果预算中较小者。

```text
async execute(args, exec) {
  const recommendation = findRecommendation(exec.agent.session, args.recommendationId)
  return json(await createCampaignPlan(marketingModel, recommendation, analyze, exec.signal))
}
```

- [ ] **步骤 4：扩展真实 Web 组合。** 断言工具注册、不存在编码或写入工具、一个不可用的成员机会、一个可执行的渠道机会、带版本的建议元数据、当前会话的方案解析，以及不存在 customer 字段。

- [ ] **步骤 5：运行 CLI 和 Web 测试并提交。** 运行 `pnpm exec vitest run apps/cli/tests/crm-marketing-model.spec.ts apps/cli/tests/crm-opportunity-evaluator.spec.ts apps/cli/tests/crm-campaign-planner.spec.ts apps/cli/tests/crm-elasticsearch.spec.ts` 和 `pnpm exec vitest run --config vitest.web.config.ts apps/web/tests/crm-preset.e2e.ts`；提交 `feat(crm): expose marketing recommendation tools`。

---

### 任务 5：已持久化建议和方案验证

**文件：**
- Create：`packages/client/ui-crm/src/client/campaign-model.ts`
- Create：`packages/client/ui-crm/tests/crm-campaign-model.client.spec.ts`
- Modify：`packages/client/ui-crm/src/client/locales.ts`

**接口：**
- 产出 `readRecommendations(meta): RecommendationReport | null`、`readCampaignPlan(meta): CampaignPlanReport | null` 和 `campaignPlanDraft(recommendation, labels): string`。
- 只消费已持久化 JSON；不包含 Cordis 上下文、源字段映射或提供方请求。

- [ ] **步骤 1：编写验证器测试并确认 RED。** 接受具有代表性的可用和不可用建议，以及一个方案草稿。拒绝错误版本、额外键、重复 id、不稳定顺序、超过 3 条建议、无效分数、未知逻辑 id、证据与请求不匹配、无界字符串或数组、类似客户的键、执行字段、非草稿状态、格式错误的人群预览、摘要不匹配，以及过大的 UTF-8 投影。

```text
expect(readRecommendations(validMeta)?.recommendations).toHaveLength(2)
expect(readRecommendations({ ...validMeta, customerId: 'x' })).toBeNull()
expect(readCampaignPlan({ ...validPlanMeta, status: 'published' })).toBeNull()
```

- [ ] **步骤 2：编写本地化草稿测试。** 验证草稿包含建议 id、已配置标题、周期、证据指标、人群条件，以及明确请求方案草稿的内容；验证其中不包含提供方字段、客户 id、发布命令或自动提交指令。

- [ ] **步骤 3：实现精确键、大小和跨字段验证。** 仅在约定匹配时复用现有本地辅助函数。通过重新计算文档化摘要验证建议 id，要求分数有序，将方案指标和条件绑定到选中的建议，并保留所有限制。

- [ ] **步骤 4：添加类型化 locale 字符串。** 在两种 locale 中添加卡片标题、不可用标签、聚合人群标签、实验指导、草稿操作文案、就绪文案和文本回退无障碍标签。

- [ ] **步骤 5：运行所有 ui-crm 测试和类型检查并提交。** 运行 `pnpm exec vitest run packages/client/ui-crm/tests` 和 `pnpm run typecheck`；提交 `feat(crm): validate marketing recommendation metadata`。

---

### 任务 6：建议和活动方案卡片

**文件：**
- Create：`packages/client/ui-crm/src/client/CrmCampaignRow.tsx`
- Create：`packages/client/ui-crm/src/client/CrmCampaignRow.tsx`
- Create：`packages/client/ui-crm/tests/crm-campaign-row.client.spec.tsx`
- Create：`packages/client/ui-crm/tests/crm-campaign-row.client.spec.tsx`
- Modify：`packages/client/ui-crm/src/client/CrmRow.module.css`
- Modify：`packages/client/ui-crm/src/client/index.ts`
- Modify：`packages/client/ui-crm/tests/plugin.client.spec.ts`
- Modify：`packages/client/ui-crm/README.md`
- Modify：`packages/client/ui-crm/README.zh.md`
- Modify：`packages/client/ui-crm/README.i18n.yaml`

**接口：**
- 产出 `crm_recommend_opportunities` 和 `crm_campaign_plan` 的带键展示转换器。
- 只使用 `inputActions.setDraft()`；卡片操作不会提交输入或执行网络请求。

- [ ] **步骤 1：编写建议卡片测试并确认 RED。** 渲染 3 个候选项，断言优先级、证据、覆盖率、聚合规模、机制、主要和护栏指标、风险、限制以及不可用类型。点击 `Generate campaign plan`，断言只有一次本地化草稿调用，且没有提交调用。

- [ ] **步骤 2：编写方案卡片测试并确认 RED。** 渲染目标、证据假设、聚合计数和分布、排除条件、留出组指导、指标定义、风险、不可用条件和就绪清单。断言不存在 export、publish、send、schedule 或 approval 按钮。

- [ ] **步骤 3：实现记忆化的无障碍展示转换器。** 在派生视图值前验证元数据，使用无需悬停即可看到值的语义列表和表格，保留部分可用和不可用状态，并在移动端纵向排列内容。

- [ ] **步骤 4：可逆地注册两个展示转换器。** 添加带键的 slot 注册和 dispose 断言。无效元数据不返回 CRM 展示转换器，以便现有文本工具结果仍然可见。

- [ ] **步骤 5：更新 README 配对文件。** 记录元数据、仅限草稿的交互、模型可见影响、聚合隐私、回放和延后的执行连接器。重新记录双语配对。

- [ ] **步骤 6：运行 Client 测试和目录生成器并提交。** 运行 `pnpm exec vitest run packages/client/ui-crm/tests`、`pnpm run gen-client-catalog`、`pnpm run verify-client-catalog`、翻译配对、目标 Oxlint 和 `git diff --check`；提交 `feat(crm): render marketing opportunity plans`。

---

### 任务 7：Persona、快照、文档和浏览器验收

**文件：**
- Modify：`apps/cli/config/examples/crm/presets/crm/agent.cordis.yml`
- Modify：`apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md`
- Modify：`snapshots/session/crm-catalog/**`
- Modify：`snapshots/session/headless.snapshot.ts`
- Modify：`docs/user/guide/crm-monthly.md`
- Modify：`docs/user/guide/crm-monthly.zh.md`
- Modify：`docs/user/guide/crm-monthly.i18n.yaml`
- Create：`.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.md`
- Create：`.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.zh.md`
- Create：`.agents/notes/implemented/feature/2026-09-02-crm-marketing-recommendations.i18n.yaml`

**接口：**
- 固定完整的分析到建议再到方案流程，并记录活动执行前的边界。

- [ ] **步骤 1：添加 Persona 和 Skill 断言。** 在真实 Web 组合中要求先分析再给出建议，仅在请求建议后才要求机会目录和评估器；禁止没有实验的提升声明；仅在用户提交选中的建议草稿后才要求 `crm_campaign_plan`。

- [ ] **步骤 2：只扩展 `crm-catalog` 无密钥场景。** 记录目录执行、一个可用和一个不可用机会、两张卡片的建议结果、选中的建议 id、活动方案草稿、警告和两个已持久化元数据对象。递归断言不存在禁止的 schema 键。确认没有 SDK 或无关快照变化。

- [ ] **步骤 3：添加已实现的 Agent Note 配对文件。** 记录为什么确定性资格和评分先于模型解释、为什么 id 从会话事件解析、为什么按钮准备草稿、被拒绝的替代方案、隐私后果，以及后续审批和执行连接器的要求。审计相关的活动 Agent Note，并重新记录配对。

- [ ] **步骤 4：更新 CRM 指南配对文件。** 添加建议优先的工作流、提示词示例、已配置类型、不可用成员案例、聚合人群语义、卡片选择、草稿方案解读，以及明确不提供导出和执行。重新记录配对。

- [ ] **步骤 5：运行浏览器验收。** 在不暴露凭据的情况下启动真实 CRM 预设。分析一个有覆盖的周期，请求建议，验证卡片不超过 3 张且有一个不可用类型，点击一张卡片，确认输入草稿，提交草稿，验证聚合方案草稿，刷新或重启，并验证回放。确认控制台没有新增错误，也没有发布活动。

- [ ] **步骤 6：运行聚焦验证。** 运行所有新的 CRM 营销测试、现有语义和 ui-crm 测试、Web 组合、`pnpm run test:snapshot -- -t crm-catalog`、`pnpm run typecheck`、`pnpm run build`、`pnpm run doc-sync`、目标 Oxlint 和 `git diff --check`。

- [ ] **步骤 7：应用仓库推送前工作流并提交。** 根据已验证的基线检查变更范围，只报告已运行的命令，并提交 `feat(crm): add evidence-backed marketing recommendations`。未经用户明确授权不得推送。
