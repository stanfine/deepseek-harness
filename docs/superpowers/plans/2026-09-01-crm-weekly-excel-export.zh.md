# CRM 周报 Excel 导出实施计划

[English](2026-09-01-crm-weekly-excel-export.md) | 中文

> 使用 executing-plans 工作流，并保留全部现有 CRM 改动。

**目标：** 在当前 DSH Web 应用中，将固定且基于数据源的 CRM 周报导出为经过认证、可下载的 `.xlsx`。

**设计：** 扩展 CRM 示例插件，增加工作簿渲染器、带过期机制的导出注册表、固定导出工具和认证 connection fetch 路由；扩展 CRM 客户端卡片，校验导出元数据并提供下载操作。

**参考：** [Agent Note](../../../.agents/notes/proposed/feature/2026-09-01-crm-weekly-excel-export.zh.md)

1. 先为工作簿模型投影、公式保护和标识排除编写失败测试；实现使用配置 artifact-tool 导入的 `weekly-workbook.ts`。
2. 先为导出根目录限制、随机 id、过期和清理编写失败测试；实现 `excel-exports.ts`。
3. 在 `crm-tools.ts` 中增加 `crm_export_weekly_excel`，注册 `/api/crm.export`，并在预设配置中增加明确的渲染器和导出设置。
4. 在 `ui-crm` 中增加经过校验的 `excel` CRM 元数据和本地化下载按钮；覆盖非法元数据与点击行为。
5. 更新周报 Skill、CRM 指南、包 README、Web 挂载测试和无密钥会话快照。
6. 运行聚焦单元／界面／Web 测试、真实 Elasticsearch 导出、工作簿检查／公式错误扫描／渲染、类型检查、lint、文档门禁和代码审查；重启 CRM Web 进程。
