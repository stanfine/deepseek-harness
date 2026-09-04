# CRM 能力分类

[English](crm-capabilities.md) | 中文

美妆个护 CRM 预设组合了受治理的数据访问、语义分析、标准报表、图表和 MA 未启动活动草稿创建能力。本参考按用户目标整理可用能力，并把每个分类链接到其配置或实现来源。

## 入口与业务 Skill

[CRM 预设](../../../apps/cli/config/examples/crm/presets/crm/preset.yml)在 Web UI 中显示为**美妆个护 CRM**。[Agent 组合配置](../../../apps/cli/config/examples/crm/presets/crm/agent.cordis.yml)挂载数据 Provider、CRM 工具、业务指引、图表呈现和审批策略，但不开放 Shell、任意 HTTP 或任意数据库查询。

| 分类 | 名称 | 用途 |
| --- | --- | --- |
| Preset | 美妆个护 CRM | 提供用户可选择的 CRM Agent，并组合全部受治理能力。 |
| Skill | `beauty-crm-monthly` | 定义月报流程、指标解释、周期比较、下钻、证据规则和图表选择。 |
| Skill | `beauty-crm-weekly` | 定义周一至周日周报、对齐比较、生命周期和商品章节、建议及 Excel 导出。 |

Skill 来源是 [beauty-crm-monthly](../../../apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md)和 [beauty-crm-weekly](../../../apps/cli/config/examples/crm/skills/beauty-crm-weekly/SKILL.md)。Skill 约束 Agent 如何使用工具和解释结果，本身不连接数据库或外部系统。

## 数据 Provider

预设把外部系统映射为范围明确的服务 API。部署配置拥有接口地址、凭据、索引名、字段映射、时区、响应预算和传输策略。

| Provider | 用途 | 当前限制 |
| --- | --- | --- |
| Elasticsearch | 从配置的订单、会员、订单事实和商品行数据集读取聚合结果及有限脱敏预览。 | Agent 不能提交任意索引、字段、脚本或 Elasticsearch DSL。 |
| CDP | 查询受治理的人群标签目录。 | 配置的 CRM 证据策略能够创建 MA 原生人群时，不要求 CDP 标签。 |
| MA | 查询活动分组、分类和内容；创建人群和未启动草稿；读取状态与汇总触达结果。 | 创建流程不能审批、启动、发送、编辑、归档或删除活动。 |
| LOYALTY | 查询卡券模板及配置的卡券汇总结果。 | 不返回客户级记录。 |

Provider 实现在 [CRM 示例配置](../../../apps/cli/config/examples/crm/cordis.yml)下组合。只有部署配置明确允许时才能使用 HTTP；生产部署应使用 HTTPS 或安全隧道。

## 语义分析

[语义模型](../../../apps/cli/config/examples/crm/semantic-model.ts)为每个业务指标和维度配置数据集、计算方式、格式、可用性和限制。[分析规划器](../../../apps/cli/config/examples/crm/analysis-planner.ts)只接受已配置的指标、维度、时间粒度、筛选、比较、排序和 Top N 限额。[分析执行器](../../../apps/cli/config/examples/crm/semantic-analysis.ts)在返回指标值时同时披露覆盖、缺失、截断、近似和不可用原因。

初始配置包含销售额、订单数、件数、购买人数、客单价、连带率、件单价、购买频次、人均消费、商品销售额和商品件数。所选逻辑数据集支持时，可使用时间、渠道、子渠道、门店、门店类型、订单类型、产品系列和 SKU 维度。

| 工具 | 用途 |
| --- | --- |
| `crm_catalog` | 查询逻辑数据集、配置口径和查询限额。 |
| `crm_profile` | 在选择报告周期前检查已观测日期覆盖和日期缺失。 |
| `crm_metric_catalog` | 查询业务指标、定义、可用性和限制。 |
| `crm_dimension_catalog` | 查询业务维度、筛选方式和允许的下钻路径。 |
| `crm_analyze` | 执行受限的汇总、趋势、排行、构成或比较。 |
| `crm_drilldown` | 保留原周期、指标、筛选和父级选择，再增加一个受治理维度。 |
| `crm_query` | 为固定的旧月报和周报流程提供汇总、分组、趋势、去重客户或有限记录模式。 |

一次语义请求只读取一个逻辑数据集。跨系统身份解析、归因、时间对齐和总数核对需要部署方提供映射或实现相关规则的 Provider；Agent 不根据相似字段名推断关联。

## 标准报表与 Excel

周报模块解析标准周期，并计算固定的销售、生命周期、产品系列和 SKU 章节。月报 Skill 使用受治理查询和语义工具生成月度汇总、上期比较、日趋势、渠道构成、门店排行和后续下钻。

| 工具 | 用途 |
| --- | --- |
| `crm_report_periods` | 解析本周、上周、去年对齐周和财年累计周期。 |
| `crm_sales_report` | 计算受治理的周销售和购买者指标及对齐比较。 |
| `crm_lifecycle_report` | 仅在配置的历史数据充分时计算客户生命周期分群。 |
| `crm_product_report` | 计算有限的产品系列或 SKU 排行与比较。 |
| `crm_export_weekly_excel` | 根据固定周报及建议生成需要认证的临时下载。 |

工作簿包含 Definition、Sales Overview、Lifecycle、Traffic、Product Series、Product SKU 和 Recommendations。导出工具不接受任意路径、公式、源字段或查询 DSL，文件只包含聚合结果，不包含客户明细。

## 营销建议与活动草稿

[营销模型](../../../apps/cli/config/examples/crm/marketing-model.ts)声明支持的营销机会、证据规则、激活可用性、动作和衡量指标。评估器只对真实聚合证据支持的机会排序，并记录限制和不可用原因。

| 工具 | 用途 |
| --- | --- |
| `crm_opportunity_catalog` | 查询受治理的机会定义及激活要求。 |
| `crm_recommend_opportunities` | 针对一个周期及比较期生成有证据的排序建议。 |
| `crm_activation_catalog` | 在计划前实时读取 MA 分组、分类、内容及 CDP 标签。 |
| `crm_campaign_plan` | 生成包含受治理人群、投放选择、画布、指标和就绪状态的无写入预览。 |
| `crm_campaign_create_draft` | 经过固定确认和宿主审批后创建已审阅的 MA 人群及未启动活动草稿。 |
| `crm_campaign_status` | 查询当前会话所记录活动的汇总生命周期状态。 |
| `crm_campaign_results` | 查询可安全部分返回的 MA 和已配置 LOYALTY 汇总结果。 |

受治理流程是 `营销建议 → 实时投放目录 → 计划与人群预览 → 画布预览 → 用户审阅 → 宿主审批 → 未启动草稿 → 状态与汇总结果`。写工具只接受当前会话已记录的计划及固定确认词 `create_inactive_draft`。

[人群策略](../../../apps/cli/config/examples/crm/audience-policy.ts)把已记录的建议证据转换为 MA 人群。[画布生成器](../../../apps/cli/config/examples/crm/campaign-canvas.ts)生成从开始、人群、触达到结束的单路径流程。[MA 编译器](../../../apps/cli/config/examples/crm/ma-wire.ts)把该流程转换为 MA 人群和 X6 画布数据。[草稿协调器](../../../apps/cli/config/examples/crm/campaign-draft-creator.ts)记录确定性进度，并在外部结果已经确认时支持安全重放。

## Web 展示

可选的 [CRM UI 包](../../../packages/client/ui-crm/README.zh.md)在展示 KPI 卡、比较、图表、表格、下钻动作、建议、计划和活动状态前校验持久化结果元数据。无效元数据回退为原始工具结果。

| 展示器 | 用途 |
| --- | --- |
| `CrmRow` | 展示固定查询的汇总、分组、趋势和来源表格。 |
| `CrmAnalysisRow` | 展示语义汇总、趋势、排行、构成、比较和下钻提示。 |
| `CrmReportRow` | 展示标准周报的销售、生命周期和商品章节。 |
| `CrmCampaignRow` | 展示建议、人群与画布预览、未启动草稿、状态和汇总结果。 |
| `EChart` | 使用 ECharts SVG 渲染已校验图表，并保留无障碍数据表。 |

支持柱状图、横向条形图、折线图、面积图、饼图、环图和表格。系统根据分析意图、指标可加性、类别数量和完整性选图。客户端不执行任意 ECharts 选项、脚本、格式化函数或外部 URL。

## 持久化、安全与验证

[CRM 活动事件包](../../../packages/examples/crm-campaign/README.zh.md)记录草稿开始、人群创建、草稿创建和有限失败事件。它保存不透明外部 ID 和确定性操作键，但不保存凭据、Provider 响应正文、客户记录或人群成员。

该功能包含 Provider 配置、Elasticsearch 查询、语义规划与计算、周报、Excel、机会评估、人群策略、活动计划、画布编译、草稿重放、UI 校验、图表和 Web 预设的针对性测试。[CRM 会话快照](../../../snapshots/session/crm-catalog/snapshot.yml)在不使用生产凭据的情况下检查交付的提示词和工具 Schema。

## 已知限制

- 配置的源字段不能证明订单唯一性、身份一致性、退款处理、取消处理、币种或历史完整性。
- 流量转化、活动归因、增量性、成本和 ROI 在事件及业务定义得到治理前保持不可用。
- 商品行不等于订单、购买人数或去重 SKU 数。
- 图表展示返回的聚合结果，但不能修复缺失、重叠、近似或截断数据。
- 活动自动化止于未启动草稿和汇总结果读取。

启动、报表提示词、下钻示例、Excel 导出和活动草稿用法见 [CRM 月报指南](./crm-monthly.zh.md)。
