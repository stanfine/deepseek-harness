# CRM 周报实施计划

[English](2026-09-01-crm-weekly-report.md) | 中文

> **面向 Agent 工作者：** 必须使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 按任务执行本计划。步骤使用复选框（`- [ ]`）跟踪。

**目标：** 增加基于数据源的 CRM 周报，覆盖可比销售、生命周期可用性、产品贡献、不可用的流量指标和绑定证据的建议。

**架构：** 可选 CRM 预设继续将固定 Elasticsearch 索引和凭据放在模型参数之外。纯周期函数定义比较窗口；周报读取器编译有界聚合；原生工具持久化封闭展示元数据；CRM 客户端根据该元数据绘制表格和图表。业务 Skill 组装最终会话报告并标记缺失证据。

**技术栈：** TypeScript ESM、Cordis、Elasticsearch 7 JSON 请求、Schemastery、React、Apache ECharts、Vitest、录制会话快照。

**规格：** [.agents/notes/proposed/feature/2026-09-01-crm-weekly-report.zh.md](../../../.agents/notes/proposed/feature/2026-09-01-crm-weekly-report.zh.md)

## 全局约束

- 启动仍为 `dsh web --patch apps/cli/config/examples/crm/cordis.yml`；不增加 bin、独立服务、原始数据库工具或模型提供的 DSL。
- 模型输入绝不接受索引、字段、客户标识、脚本、算术表达式或 ECharts 选项对象。
- 结果绝不暴露凭据、标识、个人字段、端点或上游错误正文。
- 缺失、部分、未覆盖或分母为零的输入产生原因或 null 比率，绝不推断为零。
- 客户端文案继续由 locale 拥有；注册和观察器继续可销毁。
- 用户和模型可见变更更新聚焦测试、Web 组合和无密钥会话回放。

---

### 任务 1：标准周报周期

**文件：** 新建 `apps/cli/config/examples/crm/report-periods.ts`；测试 `apps/cli/tests/crm-report-periods.spec.ts`。

**产出：** `resolveReportPeriods(date, timeZone, fiscalYearStartMonth, today): ReportPeriods`，包含本期、上期、去年同期和财年累计窗口。

- [ ] 在生产代码前写入以下失败测试：

```ts
expect(resolveReportPeriods('2025-05-07', '+08:00', 4, '2025-05-10')).toMatchObject({
  current: { start: '2025-05-05', end: '2025-05-12', complete: false },
  previous: { start: '2025-04-28', end: '2025-05-05', complete: true },
  priorYear: { start: '2024-05-06', end: '2024-05-13' },
  fiscalYtd: { start: '2025-04-01', end: '2025-05-12' },
})
expect(() => resolveReportPeriods('2025-02-30', '+08:00', 4, '2025-05-10')).toThrow(/date/)
```

- [ ] 运行 `node_modules/.bin/vitest run apps/cli/tests/crm-report-periods.spec.ts`；确认缺失模块导致失败。
- [ ] 实现 ISO 验证、周一对齐、七天偏移、364 天去年同期偏移、财年选择和完整性，不使用依赖 locale 的解析。
- [ ] 运行聚焦测试并提交 `feat(crm): define weekly report periods`。

### 任务 2：销售配置和有界聚合

**文件：** 新建 `apps/cli/config/examples/crm/weekly-report.ts`；修改 `crm-tools.ts` 和 `presets/crm/agent.cordis.yml`；测试 `apps/cli/tests/crm-weekly-report.spec.ts`。

**产出：** `WeeklyReportConfig`、`WeeklyReportReader` 和 `sales(periods, signal): Promise<SalesReport>`。

- [ ] 写入失败的固件服务器测试，期望本期金额 `1200`、订单 `4`、购买客户 `3`、复购客户 `1`、数量 `6`、订单均价 `300`、件单量 `1.5`、件单价 `200`、频次 `4/3`、客均金额 `400`。
- [ ] 断言序列化输出排除固件客户 key、密码、端点和 `_search`；运行测试并确认 `WeeklyReportReader` 缺失。
- [ ] 为 `orderFacts`、`orderItems`、`members` 和可选 `traffic` 增加严格角色，并增加 `fiscalYearStartMonth` 和 `minimumOrderAmount`；加载时验证精确索引和所需字段。
- [ ] 实现各窗口的可加求和和有预算的 composite 客户分页。只有配置订单数字段求和大于一时才计为复购客户。
- [ ] 实现 `safeRatio`，使缺失或零分母返回 `{ value: null, reason }`；用先失败后通过的测试证明。
- [ ] 检查各角色覆盖，对未覆盖的比较窗口返回实际和所需覆盖，不执行查询。
- [ ] 运行新测试套件和 `crm-elasticsearch.spec.ts`；提交 `feat(crm): aggregate weekly sales metrics`。

### 任务 3：精确生命周期分群

**文件：** 修改 `weekly-report.ts`；扩展 `crm-weekly-report.spec.ts`。

**产出：** `lifecycle(periods, signal): Promise<LifecycleReport>`，包含新客、存量新客、留存和召回计数。

- [ ] 写入失败的两页 composite 固件，期望 `newPurchasers: 1`、存量新客 `base: 2, active: 1`、留存 `base: 2, active: 1`、召回 `base: 1, active: 1`。
- [ ] 实现共享截止时间的遍历，包含首购 `min` 和固定的本期、上一财年和更早历史 filter。在本地分类分桶，绝不保留或返回 key。
- [ ] 增加失败测试，其数据覆盖晚于所需上一财年日期；返回 `available: false` 及实际和所需覆盖。
- [ ] 增加失败的分页耗尽测试；拒绝指标，不返回部分计数。
- [ ] 运行周报套件并提交 `feat(crm): add bounded lifecycle cohorts`。

### 任务 4：产品贡献

**文件：** 修改 `weekly-report.ts`；扩展 `crm-weekly-report.spec.ts`。

**产出：** 基于商品行宽表角色的 `products(periods, groupBy: 'series' | 'sku', signal): Promise<ProductReport>`。

- [ ] 写入失败测试，检查每个返回分组的本期、上期和去年同期金额与数量，且不含商品行或客户标识。
- [ ] 编译按本期金额子聚合排序的 terms、固定比较 filter 和缺失 key 聚合。
- [ ] 解析省略数、计数误差上界和缺失 key；任一非零时标记结构不完整。
- [ ] 证明输出命名 `lineDocumentCount`，绝不命名 `orders` 或 `UV`，并保留有符号源金额。
- [ ] 运行周报套件并提交 `feat(crm): report product contribution`。

### 任务 5：原生报表工具

**文件：** 修改 `crm-tools.ts`、`crm-elasticsearch.spec.ts` 和 `apps/web/tests/crm-preset.e2e.ts`。

**产出：** `crm_report_periods`、`crm_sales_report`、`crm_lifecycle_report`、`crm_product_report` 和元数据 `{ crmReport: { version: 1, kind, request, data } }`。

- [ ] 为所有工具增加失败运行时测试，证明封闭 schema 拒绝索引、字段、DSL、客户 ID 和不支持的分组参数。
- [ ] 通过 `ctx.effect` 注册工具，保留标准 JSON 模型输出，并持久化不暴露传输配置的元数据。
- [ ] 扩展 Web 组合，断言报表工具存在，而 Shell、编辑器、任意 HTTP 和通用数据库工具仍不存在。
- [ ] 运行聚焦 CLI 和 Web 测试；提交 `feat(crm): expose bounded weekly report tools`。

### 任务 6：CRM 周报展示

**文件：** 在 `packages/client/ui-crm/` 下新建 `report-model.ts`、`ReportRow.tsx`、`report-options.ts` 及客户端测试；修改 `index.ts`、`locales.ts` 和 `CrmRow.module.css`。

**产出：** 封闭的 `readReport(meta)` 验证和周报工具 keyed rows。

- [ ] 为有效报表和错误数字、周期不匹配、未知版本、客户标识与不支持类型写入失败验证测试。
- [ ] 实现验证，保留 null 原因、精确性、覆盖和截断，并拒绝渲染使用但未验证的所有字段。
- [ ] 为四列 KPI 表、不可用生命周期面板、排序产品条形图、警告、源表、原始详情和客户标识文本缺失写入失败 React 测试。
- [ ] 实现 locale 拥有的对比表、ECharts 产品条形图、可访问源表和原始结果展开；复用 `EChart` 清理。
- [ ] 可逆注册所有报表工具 key，并测试销毁。
- [ ] 运行所有 `ui-crm` 测试、客户端类型检查／构建和 Client UI i18n 验证；提交 `feat(crm): render weekly report evidence`。

### 任务 7：Agent 工作流、快照、文档和验收

**文件：** 将 Skill 重命名为 `beauty-crm-reporting`；修改 CRM 预设、快照固件、真实 ES 测试、用户指南、包 README 和 proposed Agent Note 配对。

**产出：** 带有证据约束建议的周报会话，同时保留显式任意窗口的月报能力。

- [ ] 首先改变录制会话固件，使其请求一周、调用周期／销售／生命周期／产品工具、报告不可用流量，并生成包含观察、证据、假设、行动、验证和限制的建议。
- [ ] 不刷新运行回放，确认当前 Skill 未满足新的预期工作流。
- [ ] 重命名并更新 Skill 和 persona，使周报使用标准周期、查询可用章节，且绝不使用代理指标替代缺失流量。
- [ ] 刷新快照，检查所有工具错误和元数据，然后不刷新重新回放。
- [ ] 扩展可选真实 ES 测试，只检查配置角色和执行聚合；不获取客户 ID 或原始个人记录。
- [ ] 更新中英文文档、配对记录，并将 Agent Note 配对移动到 `implemented/feature`，改为现在时决策。
- [ ] 运行聚焦 CLI、Web、Client、快照、类型检查、lint、JSDoc、i18n、文档和 `git diff --check` 命令。
- [ ] 重启 CRM Web，验证 3080 端口和认证启动，并使用新 CRM 会话手工验收。
- [ ] 请求代码审查，用回归测试修复已验证 P1/P2，重跑受影响检查，并提交 `feat(crm): deliver source-backed weekly reports`。
