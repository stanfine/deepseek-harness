# CRM 月报

[English](crm-monthly.md) | 中文

本教程从源码工作区启动 Web 配置中的只读美妆个护 CRM Agent。Agent 使用原生工具查询 Elasticsearch，在会话中输出月报，并接受渠道或门店下钻请求。可选 Web 插件将查询结果显示为指标卡、分组柱状图和时间趋势折线图；标准周报还可生成有时效的 Excel 下载。本示例不包含 MongoDB、定时任务或独立看板页面。

## 启动 CRM Agent

1. 按[开发指南](../../development.zh.md)完成仓库环境准备，并在应用中配置 DeepSeek 模型。在仓库根目录的 zsh 中执行以下命令。随附 preset 会读取 `mkt_catering_loyalty_behavior_consumer_order`、`mkt_catering_loyalty_customer`、`mkt_catering_loyalty_behavior_consumer_order_fact` 和 `mkt_catering_loyalty_behavior_consumer_order_item_wide` 四个索引。Elasticsearch 账号只需对这四个名称拥有索引元数据和文档搜索权限，不需要写入、删除、集群管理、脚本管理或通配索引权限；插件不能替代数据库权限控制。

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
export DSH_CRM_CDP_URL='http://your-cdp-host:12000'
export DSH_CRM_CDP_ALLOW_HTTP=true
export DSH_CRM_CDP_ALLOW_UNAUTHENTICATED=true
pnpm dsh web --patch apps/cli/config/examples/crm/cordis.yml
```

HTTP Basic 认证不会加密凭据或数据。仅在可信测试网络中开启此选项；生产环境使用 HTTPS 或安全隧道。不要将密码粘贴进 Agent 会话、被跟踪的文件或命令行参数。凭据变更后需要重启应用。

## 创建受治理的营销草稿

输入：`分析 2025 年 3 月相对上月的营销机会，先给建议，不要创建活动。` Agent 从 CRM 汇总证据评估受治理的机会，并返回最多三条排序建议。它会调用 `crm_activation_catalog` 查询当前 MA 的分组、分类、内容以及有效 CDP 标签，不自行编造外部 id。然后要求它为其中一条建议准备活动计划。计划包含汇总人群估算、配置动作、验证指标、限制和就绪原因，不执行写入。

审阅计划后，明确要求创建对应的未启动草稿。写工具只接受已记录的 `planId` 和固定确认词 `create_inactive_draft`，随后触发宿主审批。人群条件、排除规则、MA 节点、连接器、模板、能力和提供方请求体均来自部署配置。提供方会将这些值编译为 MA `AudienceInfo` 和 X6 `flowData`，校验流程，并且不会调用 MA 预执行。批准后只创建一个人群和一个 `DRAFT` 或 `INACTIVE` 活动。工作流不能审批活动、启动、发送、发券、编辑或删除。会话事件和确定性业务键使重试能够安全复用；远端结果不明确且无法查询时要求人工对账。

使用计划 id 调用 `crm_campaign_status`，或指定日期范围调用 `crm_campaign_results`。结果从当前会话解析活动 id，只公开 MA 与已配置 LOYALTY 的汇总值及不可用原因，不关联客户明细。部署方建立活动到订单的归因规则前，CRM 转化保持不可用；没有受治理的留出组对比时，增量性保持不可用。

2. 新建会话，选择 **美妆个护 CRM** 预设。此覆盖配置替换可发现的预设根目录，不会迁移引用其他预设的旧会话。需要保留现有编码会话时，使用独立的 DSH 主目录或部署。应用保留现有模型设置及其他配置。

3. 输入业务需求，例如：

```text
先核实数据时间覆盖，再生成 2025 年 3 月的美妆个护 CRM 月报。
比较上月，分析购买客户、原始订单金额、注册会员、渠道和门店表现。
数据不完整或口径不确定时必须说明；不要编造复购率或净销售额。
```

若要生成参照 REMY 工作簿的标准周报，可输入：`生成包含 2025-04-30 的美妆个护 CRM 周报，并给出有证据的建议。` Agent 会解析周一至周日周期，并调用固定的销售、客户生命周期、产品系列和 SKU 周报工具。Web 客户端根据持久化工具元数据绘制周报 KPI 卡和 ECharts 对比图。当前数据源没有流量事件链，因此 UV 和转化率保持不可用；超出实际覆盖范围的生命周期和去年同期指标会被拒绝。订单事实字段尚不能证明满足工作簿中的退款、取消、币种、低于 50 元及同会员同日订单规则。 预设还将复购人数设为不可用，且未声明生命周期历史完整；部署所有者确认这些定义后才能启用。

需要 Excel 时可输入：`把这份周报和建议导出为 Excel。` Agent 在标准周报取数完成后调用固定的 `crm_export_weekly_excel` 工具，生成 Definition、Sales Overview、Lifecycle、Traffic、Product Series、Product SKU 和 Recommendations 七个工作表。工具不接受任意路径、公式、字段或查询 DSL；下载使用随机标识并限制文件数量与有效期。文件只含聚合结果、口径和有证据的建议，不含客户明细。`DSH_CRM_ARTIFACT_TOOL_MODULE` 指向部署提供的 artifact-tool ESM 模块，`DSH_CRM_EXPORT_ROOT` 指向仅运行时可写的私有目录；缺少或错误模块配置会在导出时明确失败。

下钻追问示例：`保持相同月份，查看 pos 渠道的门店贡献，并展示有限条脱敏明细。` 工具调用及结果沿用现有会话日志和 CRM 图表卡片。预设不添加 Shell、任意 HTTP、文件编辑器或通用数据库查询工具。

## 灵活提出业务问题

对于固定周报或月报版式之外的分析，可直接使用业务指标和维度名称提问。例如：`比较 2025 年 4 月与上月的渠道销售额、订单数和客单价，按销售额排序；选择 pos 后继续下钻门店。` Agent 先查询 `crm_metric_catalog` 和 `crm_dimension_catalog`，再调用 `crm_analyze`。选择返回的渠道会生成供确认的追问；提交后，Agent 使用相同日期、指标、对比、筛选和所选父级值调用 `crm_drilldown`。

初始目录包含销售额、订单数、件数、购买人数、客单价、连带率、件单价、购买频次和人均消费。订单文档来源提供日、周、月、渠道、子渠道、门店、门店类型和订单类型，因此每个已暴露维度都至少有一个同逻辑数据集的可用指标。省份、产品系列和 SKU 仍可供固定周报工具使用；在对应事实表和商品行数据集配置语义指标之前，灵活分析目录暂不暴露这些维度。结果记录当前值与对比值、不可用原因、覆盖范围、遗漏分组、计数误差和允许的后续维度。指标缺失覆盖是指标值计数而不是唯一文档数，因此可能超过来源文档数。未显式声明构成关系的维度保持未知，不能生成环图。客户端验证持久化结果，并确定性选择指标卡、折线图、横向条形图、对比柱状图、环图或表格。模型不能提供源字段、Elasticsearch DSL、公式或 ECharts 选项。

目录中的不可用条目代表受治理的拒绝，不代表零。复购、生命周期、流量转化、活动归因、目标和成本只有在部署配置声明业务定义及充分数据覆盖后才能启用。维度缺失、Top N 截断、近似计数或对比历史缺失的警告会保留在图表卡片中，也必须出现在文字建议中。

一次语义请求只读取一个逻辑数据集。当前来源可以使用有限的订单文档回答渠道和门店问题，也可以由专用来源回答固定周报的可加事实，但不会在一次语义请求内连接这些数据集。分散在 CRM、交易、流量、活动或成本系统中的数据可以先分别形成有来源证据的章节，无须先建设数据仓库；跨系统客户身份、归因、统一指标定义、时间对齐和总数核对仍需受治理的映射或实现这些规则的数据提供方，Agent 不得根据相同字段名自行推断关联。

## 配置数据与限额

[预设配置](../../../apps/cli/config/examples/crm/presets/crm/agent.cordis.yml)将 `orders` 映射到 `mkt_catering_loyalty_behavior_consumer_order`，将 `members` 映射到 `mkt_catering_loyalty_customer`。日期使用明确的 UTC 偏移，结束日期不包含在范围内。[业务 Skill](../../../apps/cli/config/examples/crm/skills/beauty-crm-monthly/SKILL.md)负责指标定义与报告规则。

仅部署配置可以修改索引、日期／金额／客户字段、维度、预览叶字段、时区和查询限额。不要把个人信息字段配置为预览叶字段或分组维度。数组预览保留行项目关联，但不会验证字段是否包含个人信息。凭据字段只填写环境变量名称；`crm_catalog` 不返回连接地址或凭据。

`crm_profile` 返回文档数、日期范围和缺失日期数。`crm_query` 支持汇总统计、有限 Top 分组、有限近期预览、按日或按月的日期直方图和分页精确去重标识统计。数据源错误、分片不完整、总命中数不精确、响应字节超限或精确统计预算耗尽均明确报错。去重分页共享超时期限，读取实时索引而非时间点快照；并发写入时，需要稳定的报表副本才能获得可审计结果。Top 分组披露遗漏数量及计数误差上界，不包含维度缺失值。

这些字段映射不能证明订单唯一、历史完整、客户身份一致、币种、退款口径或业务数据真实有效。普通对象数组中的行项目不能通过按品类分组整单金额来正确统计品类销售额。Agent 将不支持的指标标为不可计算，不编造数据。此示例仅适用于源码工作区，不包含在已发布的 CLI 包中。

## 使用会话图表

要求 CRM Agent 展示按日趋势及渠道或门店对比。新查询成功后，会话工具卡片直接显示指标卡、柱状图或折线图，可切换源金额与文档数。分组下钻会沿用日期和筛选条件，将问题填入输入框供确认发送；已有草稿不会被覆盖。不支持、失败或缺少图表元数据的旧结果保留文字形式，可要求 Agent 重新查询。金额标签保留来源口径，不推断币种或净销售额。图表保留截断提示，并提供数据表及原始结果。

## 动态选择图表

可以直接提出展示要求，例如：`用横向条形图展示渠道金额排行，日趋势用面积图。` Agent 通过 `crm_query` 传递 `chartType` 和 `metric`；应用将返回的数据映射为 ECharts 图表。每张分组或趋势卡片还提供图表类型与指标选择、文本提示框和缩放滑块。点击图形和表格按钮一样，只准备供确认的下钻问题。切换视图不会重新查询 Elasticsearch；修改日期或筛选条件才会查询。分组不完整、存在重叠、缺失维度或指标、负值或不可加指标时，不支持饼图和环图。本地切图在卡片重新挂载时重置；Agent 指定的视图随历史保存。示例支持七种展示方式，不开放完整的 ECharts 类型目录或任意 JavaScript 选项。

月报主动查询日趋势、渠道结构和门店排行，无须在输入中逐个指定图表名称。例如输入 `分析渠道占比和门店金额排行，并解释每日走势`。Agent 在分组和趋势查询中记录分析目的 `intent`。数据支持完整占比时使用环图，否则卡片说明替代展示。排行只排序返回的分组，源查询截断时不代表全部门店。只有一个时间点时展示表格。更新预设和 Skill 后新建 CRM 会话，避免历史会话保留旧指引。
