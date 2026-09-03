---
description: "用于受控 CRM 活动草案创建和安全重试的持久化进度事件。"
kind: "package-reference"
---

# @deepseek-ai/dsh-crm-campaign

[English](README.md) | 中文

## 概述

`dsh-crm-campaign` 拥有受控 CRM 活动草案创建的持久化事件词汇。它记录不透明 ID、确定性操作键、进度和有界失败代码，不记录 Provider 响应正文、凭据、客户记录或人群成员。

## 目录

- [使用本包](#use-this-package)
- [开发备注](#dev-note)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)

-----

<a id="use-this-package"></a>
## 使用本包

追加 CRM 活动事件前先导入本包。远端写入前追加 `draft-started`，MA 解析人群后追加 `audience-created`，仅在 MA 返回未启用活动后追加 `draft-created`。使用 `draft-failed` 支持安全重试和人工核对，不执行自动删除。

<a id="dev-note"></a>
## 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

持久化目录生成器读取 `src/index.ts` 中的声明合并；此事件词汇发生变化时应重新生成目录。

</details>

<a id="model-experience"></a>
## 模型体验

### 活动草案进度事件

#### 模型看到什么

不会直接看到任何内容。`crm-campaign/*` 事件仅写入日志；CRM 工具单独投射经过校验的有界结果，重放则通过这些事件避免重复执行外部写入。

#### Token 影响

没有影响。这些事件不进入派生模型历史。

#### KV Cache 影响

没有直接影响；这些事件不进入派生模型历史。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>

- 本包只记录活动草案创建。它不包含审批、活动启动、触达、发券、客户导出或删除事件。
