# CRM MA 活动草案创建实施计划

[English](2026-09-03-crm-ma-campaign-draft.md) | 中文

> **供 Agent 工作者使用：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans，逐项实施本计划。步骤使用复选框（`- [ ]`）语法跟踪。

**目标：** 增加以营销建议为起点的 CRM 流程，在用户明确审批后创建受治理的 MA 人群，以及真实但未启动的单链路 MA 活动草案。

**架构：** 确定性 CRM 模块把汇总语义证据转换为建议、人群策略和生成的画布。独立的 MA 与 LOYALTY Service/Provider 模块负责远端协议；会话驱动的协调器负责幂等草案创建和只读结果回收。CRM 工具与客户端提供带版本、可重放的投影，不包含客户记录或原始 Provider 请求体。

**技术栈：** TypeScript、Cordis Service 与作用域工具、Schemastery、DSH credentials 与 approval Service、原生 `fetch`、React、ECharts、Vitest、无密钥会话快照。

**规格：** [营销建议设计](../specs/2026-09-02-crm-marketing-recommendations-design.zh.md)和 [MA 草案创建设计](../specs/2026-09-03-crm-ma-campaign-draft-design.zh.md)。

## 全局约束

- 使用部署值 `tenantId=mkt`、`buCode=catering` 和 `collectionId=mkt_catering_loyalty`；模型可见模式绝不暴露端点或凭据。
- 创建草案只能创建 MA 人群和未启动的 MA 活动。它不会提交审批、启动触达、发送消息、发券、修改已创建草案或删除外部数据。
- 人群规则、MA 节点、连接、能力、触达模板和 LOYALTY 卡券模板来自准确的部署白名单。模型不能提交表达式、字段、运算符、标签、画布 JSON 或 Provider 请求体。
- 每个模型可见结果都写入日志并可重放。外部写入解析当前会话中的方案 ID，通过 `tools/pre-execute` 审批，并使用确定性幂等键。
- Provider 每次操作解析一次凭据、限制响应字节、使用已配置超时、隐藏远端响应体，并要求显式设置 `allowHttp` 和 `allowUnauthenticated`。
- 结果只包含汇总值和不透明外部 ID；不包含客户 ID、姓名、手机、邮箱、人群成员或来源记录。
- 客户端把元数据视为不可信 JSON，校验失败时回退到文本。产品文本使用类型化本地化字典。
- 每项行为变更遵循测试优先的 RED/GREEN 循环。最终变更包含 Agent Note、无密钥快照、双语文档和用户确认的真实环境草案创建测试。

---

### 任务 1：完成确定性建议评估

**文件：** 新建 `apps/cli/config/examples/crm/opportunity-evaluator.ts`；新建 `apps/cli/tests/crm-opportunity-evaluator.spec.ts`；修改 `apps/cli/config/examples/crm/semantic-analysis.ts`。

**接口：** 产出 `evaluateOpportunities(model, request, analyze, signal): Promise<RecommendationResultV1>`；`OpportunityRequest` 只包含 `start`、`end`、`comparison` 和有界的 `opportunityIds`；`RecommendationResultV1` 最多包含三条确定性的汇总建议。

- [ ] 为闭合请求校验、固定分析展开、缺失值、覆盖、阈值、评分、同分排序、三条上限、证据保留及不含 Provider 或客户字段编写失败测试。
- [ ] 运行 `pnpm exec vitest run apps/cli/tests/crm-opportunity-evaluator.spec.ts`，确认断言因评分、证据和 ID 尚不完整而失败。
- [ ] 实现证据提取和确定性评分；使用版本、机会 ID、规范化请求和证据的 base64url SHA-256，生成带 `rec_` 前缀的 `recommendationId`。
- [ ] 强制单数据集请求、已知返回指标 ID、有界行数、完整序列化结果预算和缺失数据拒绝。
- [ ] 运行建议评估器、语义执行器与规划器测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): evaluate marketing opportunities`。

```text
export type AnalyzeOpportunity = (request: AnalysisRequest, signal: AbortSignal) => Promise<SemanticAnalysisResultV1>
export function evaluateOpportunities(model: MarketingModel, request: OpportunityRequest, analyze: AnalyzeOpportunity, signal: AbortSignal): Promise<RecommendationResultV1>
```

### 任务 2：构建会话驱动的活动方案

**文件：** 新建 `apps/cli/config/examples/crm/campaign-planner.ts`；新建 `apps/cli/tests/crm-campaign-planner.spec.ts`。

**接口：** 产出 `findRecommendation(session, recommendationId)` 和 `createCampaignPlan(model, recommendation, analyze, signal): Promise<CampaignPlanResultV1>`；结果包含不透明 `planId`、`status: 'preview'`、汇总人群预览、逻辑动作选项、日期、指标和就绪原因。

- [ ] 使用真实已提交 `tool/result` 事件，为有效查找、缺失及跨会话 ID、错误元数据、摘要不匹配、冲突、汇总预览和不可用条件编写失败测试。
- [ ] 运行规划器测试，确认缺少规划器行为导致 RED。
- [ ] 实现关闭失败的事件扫描和确定性方案 ID；不使用内存建议注册表。
- [ ] 只展开已配置的汇总人群条件，并保留覆盖、警告、排除项、对照组指导、主要指标、守护指标和限制。
- [ ] 运行规划器与会话测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): prepare governed campaign plans`。

```text
export interface CampaignPlanResultV1 { version: 1; planId: string; recommendationId: string; status: 'preview'; readyForCreation: boolean; readinessReasons: readonly string[] }
```

### 任务 3：增加 MA Service 与 HTTP Provider

**文件：** 新建 `apps/cli/config/examples/crm/ma-service.ts`；新建 `apps/cli/config/examples/crm/ma-http-provider.ts`；新建 `apps/cli/tests/crm-ma-provider.spec.ts`；修改 `apps/cli/config/examples/crm/cordis.yml`。

**接口：** 注册 `ctx.crmMa`，提供目录读取、`countAudience`、`validateCanvas`、`predictCanvas`、`createAudience`、`findAudienceByBusinessKey`、`createCampaignDraft`、`findCampaignByBusinessKey`、`campaignStatus` 和 `reachSummary`。所有请求使用解析后的逻辑规格，不使用原始请求体。

- [ ] 使用本地服务器编写失败测试，覆盖 `/api/ma-manage/{tenantId}/{buCode}` 下的准确路径、方法和请求体映射、响应限制、超时、中止、非 2xx 隐藏、HTTP 策略、认证解析和显式无认证模式。
- [ ] 运行 MA Provider 测试，确认因缺少 Service/Provider 模块而 RED。
- [ ] 实现 Cordis Service 接口和 Provider，按操作解析凭据、有界读取 JSON、转换安全错误，并使用品牌化外部 ID。
- [ ] 为 MA 端点和 `mkt/catering` 增加显式 Provider 配置；写方法不能通过通用 web fetch 访问。
- [ ] 运行 Provider 测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): add MA campaign provider`。

```text
export abstract class CrmMaService extends Service { abstract createAudience(spec: ResolvedMaAudience, key: string, signal: AbortSignal): Promise<MaAudienceRef>; abstract createCampaignDraft(spec: ResolvedMaCampaign, key: string, signal: AbortSignal): Promise<MaCampaignRef> }
```

### 任务 4：增加 LOYALTY 只读 Provider

**文件：** 新建 `apps/cli/config/examples/crm/loyalty-service.ts`；新建 `apps/cli/config/examples/crm/loyalty-http-provider.ts`；新建 `apps/cli/tests/crm-loyalty-provider.spec.ts`；修改 `apps/cli/config/examples/crm/cordis.yml`。

**接口：** 注册 `ctx.crmLoyalty`，提供 `couponTemplate`、`activitySummary`、`participationSummary` 和 `couponSummary`；不存在创建活动、发券或返回会员的方法。

- [ ] 使用 HTTP 夹具编写失败测试，覆盖白名单卡券查询、汇总参与和核销映射、响应限制、超时、认证、隐藏错误及拒绝包含客户的响应。
- [ ] 确认 RED，然后使用品牌化模板 ID 和汇总结果类型实现只读 Service 与 Provider。
- [ ] 配置 LOYALTY 端点和 `mkt/catering`；已返回身份或状态与配置不符时拒绝白名单模板。
- [ ] 运行 Provider 测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): add LOYALTY campaign reads`。

```text
export abstract class CrmLoyaltyService extends Service { abstract couponTemplate(id: LoyaltyCouponTemplateId, signal: AbortSignal): Promise<LoyaltyCouponTemplate>; abstract couponSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCouponSummary> }
```

### 任务 5：解析受治理的 MA 人群与画布

**文件：** 新建 `apps/cli/config/examples/crm/audience-policy.ts`；新建 `apps/cli/config/examples/crm/campaign-canvas.ts`；新建 `apps/cli/tests/crm-audience-policy.spec.ts`；新建 `apps/cli/tests/crm-campaign-canvas.spec.ts`；修改 `marketing-model.ts` 和 CRM preset。

**接口：** 产出 `resolveAudiencePolicy(config, marketingModel)`、`buildMaAudience(policy, recommendation)` 和 `buildSinglePathCanvas(config, plan, action)`；输出为不可变、与远端协议无关的解析值。

- [ ] 为准确配置键、已知机会 ID、白名单标签与字段、闭合运算符、证据取值映射、必须排除项、人群上限、已审批触达模板、已审批卡券模板和准确入口/条件/动作/结束拓扑编写失败测试。
- [ ] 确认 RED，然后实现不可变策略解析和确定性人群条件，不生成 MA 表达式。
- [ ] 使用稳定节点 ID 实现画布生成，并保证只有一个动作；分别根据白名单校验 MA 触达和 LOYALTY 卡券动作。
- [ ] 为可执行机会增加显式示例映射；在会员必需概念和映射完整前保持会员机会不可用。
- [ ] 运行两个新测试集和营销模型测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): generate governed MA campaigns`。

```text
export type CampaignAction = { kind: 'ma_delivery'; templateId: string } | { kind: 'loyalty_coupon'; templateId: string; capabilityId: string }
export function buildSinglePathCanvas(config: CanvasConfig, plan: CampaignPlanResultV1, action: CampaignAction): ResolvedMaCanvas
```

### 任务 6：实现幂等草案创建

**文件：** 新建 `packages/examples/crm-campaign/src/index.ts` 及其包脚手架；新建 `apps/cli/config/examples/crm/campaign-draft-creator.ts`；新建包测试和 CLI 创建器测试；重新生成 `packages/core/session/src/known-event-types.ts` 和持久化目录；更新 TypeScript 与 Python SDK 预期投影。

**接口：** 产出 `findCampaignPlan(session, planId)` 和 `createCampaignDraft(session, services, plan, signal): Promise<CampaignDraftResultV1>`；在每次远端写入前后追加带版本的进度事件。

- [ ] 为当前会话查找、确定性幂等键、完成结果重放、活动失败后复用人群、超时结果不明确查询、不支持核对、冲突记录、中止和有界安全错误编写失败测试。
- [ ] 确认 RED，然后在 CRM 示例包中为已开始、已创建人群、已创建活动和失败状态定义读取必需的会话事件；运行 `pnpm run gen-persistence-catalog`，并在同一变更中更新两套 SDK 投影。
- [ ] 实现协调器，在写入前重新校验目录、人群数量、画布校验和预执行，且不通过删除执行补偿。
- [ ] 写入结果不明确时，必须在重试前按外部业务键查询；无法查询时返回需要人工核对。
- [ ] 运行创建器、会话、SDK 预期输出和聚焦快照测试；提交 `feat(crm): create idempotent MA campaign drafts`。

```text
export interface CampaignDraftResultV1 { version: 1; planId: string; idempotencyKey: string; audienceId: string; campaignId: string; status: 'inactive'; created: boolean; warnings: readonly string[] }
```

### 任务 7：注册闭合工具与审批策略

**文件：** 修改 `apps/cli/config/examples/crm/crm-tools.ts`；新建 `apps/cli/tests/crm-marketing-tools.spec.ts`；修改 `apps/web/tests/crm-preset.e2e.ts` 和 CRM persona。

**接口：** 注册 `crm_opportunity_catalog`、`crm_recommend_opportunities`、`crm_campaign_plan`、`crm_campaign_create_draft`、`crm_campaign_status` 和 `crm_campaign_results`。为每个结果持久化带版本的展示元数据。

- [ ] 使用真实 ToolRuntime 为准确模式、生命周期销毁、保留结果预算、当前会话解析、元数据，以及递归不含物理字段、Provider 请求体、客户值、审批/启动/发送/发券参数编写失败测试。
- [ ] 增加作用域 `tools/pre-execute` 监听器，只为 `crm_campaign_create_draft` 返回 `{ kind: 'ask' }`，其他工具都调用 `next()` 委派。
- [ ] 注册工具并连接 MA/LOYALTY Service；要求确认字面量枚举 `['create_inactive_draft']`；全部只读工具不要求审批。
- [ ] 更新 persona，说明预览、外部写入审批、未启动状态及拒绝启动或发送；扩展 Web 组合断言。
- [ ] 运行 CLI 与 Web 聚焦测试、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): expose MA campaign draft workflow`。

```text
parameters: { planId: { type: 'string', required: true }, confirmation: { type: 'string', enum: ['create_inactive_draft'], required: true } }
```

### 任务 8：校验并呈现活动流程卡片

**文件：** 新建 `packages/client/ui-crm/src/client/campaign-model.ts`；在 `packages/client/ui-crm/src/client/` 下新建建议、方案和草案卡片；修改本地化字典与 presenter 注册；在 `packages/client/ui-crm/tests/` 下增加对应测试。

**接口：** 校验不可信的 `crmRecommendations`、`crmCampaignPlan` 和 `crmCampaignDraft` 元数据；按钮调用 `inputActions.setDraft()` 写入本地化提示，绝不提交。

- [ ] 为版本、字节与条目上限、ID 格式、准确键、证据一致性、单链路拓扑、仅未启动状态及拒绝客户或执行字段编写失败校验器测试。
- [ ] 为证据卡、人群数量、画布预览、就绪原因、创建确认草稿、成功 ID、回退呈现、键盘访问及中英文文本编写失败组件测试。
- [ ] 使用现有 CRM primitives 实现校验器与卡片；把四节点画布呈现为可访问的紧凑流程，只为定量分布使用 ECharts。
- [ ] 注册 presenter 和类型化本地化文本；重放必须使用已持久化元数据，而不是组件状态。
- [ ] 运行全部 `ui-crm` 测试、i18n 校验、定向 Oxlint 和 `git diff --check`；提交 `feat(crm): render MA campaign draft cards`。

### 任务 9：回收汇总活动结果

**文件：** 新建 `apps/cli/config/examples/crm/campaign-results.ts`；新建 `apps/cli/tests/crm-campaign-results.spec.ts`；修改 CRM 工具与客户端结果卡片。

**接口：** 产出 `collectCampaignResults(recordedDraft, attributionConfig, ma, loyalty, analyze, signal): Promise<CampaignResultsV1>`，包含 MA 状态与触达汇总、LOYALTY 汇总参与/核销、CRM 转化指标和明确的增量可用性。

- [ ] 为已记录 ID 查找、日期窗口、触达汇总、卡券汇总、归因要求、缺少对照组、来源覆盖、部分 Provider 失败及不含客户记录编写失败测试。
- [ ] 确认 RED，然后实现只读回收，各来源可独立不可用，模型可见数据不执行跨来源客户关联。
- [ ] 增加结果元数据校验与卡片；只有满足已配置规则时才标记归因转化，没有对照组时标记增量不可用。
- [ ] 运行结果、工具、客户端和语义分析测试；提交 `feat(crm): report aggregate campaign results`。

### 任务 10：完成文档、快照与真实环境验收

**文件：** 修改 CRM 用户指南双语对、`packages/client/ui-crm/README.md` 双语对、CRM Skills 与 persona 快照；新建已实施 Agent Note 及其分类要求的中文对；更新相关快照夹具。

**接口：** 记录准确的“分析 → 建议 → 预览 → 审批 → 未启动草案 → 结果”流程，以及触达前的显式边界。

- [ ] 为目录、建议、方案、审批请求、未启动草案元数据、状态、结果，以及拒绝启动或发券增加失败的无密钥快照预期。
- [ ] 更新夹具与文档所有者；记录双语配对，并为确定性证据、受治理生成、显式写入审批、幂等及执行分离增加 Agent Note。
- [ ] 运行聚焦单元和 Web 测试、无密钥快照、`pnpm run test:docs`、`pnpm run doc-sync`、`pnpm run build`、定向 lint 和 `git diff --check`。
- [ ] 使用只读凭据启动 CRM Web profile，在不写入的情况下验证建议、方案、画布和审批 UI。
- [ ] 用户批准最终可见预览后，只创建一个名称明确的未启动测试人群和活动草案；通过读取 API 验证 ID 与未启动状态，记录清理 ID，不审批或启动。
- [ ] 提交 `feat(crm): complete MA campaign draft workflow`；任何按要求执行的 push 前运行仓库 pre-push 工作流。
