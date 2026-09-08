# 设计文档：工单集成插件（DSH Cordis Plugin）

- 日期：2026-09-08
- 状态：已获用户确认（方案 A：完整 Cordis 动态插件）；本次含需求扩展（多 provider、图片查看、视觉模型识图）
- 插件 ID：`monai-work-items`
- 参考来源：`E:\monai-app`（qn-monai）工单集成功能（`src-tauri/src/issues/*`）

## 1. 背景与目标

把 qn-monai 的「工单集成」能力移植到 DSH 作为插件：拉取工单系统「指派给我的工单」，提供前端工作台（浏览/搜索/过滤/详情 + 附件图片查看），把工单信息注入对话让模型基于其工作，并通过视觉模型识别工单图片以理解需求。

用户确认的需求边界：

1. **工单管理工作台**（浏览 / 同步 / 详情 / **附件图片查看**）。
2. **把工单注入对话**——模型按需拉取（动态 Tool）。
3. **多 provider 可插拔**——定义统一 Provider 接口，当前先实现 **Redmine**；YiXieZuo 等预留接口。
4. **附件图片下载 + 视觉模型识图**——下载工单附件图到**临时目录**，用多模态模型生成 `ai_description`（理解图中需求），识图结果随图缓存复用。
5. **持久化边界 = 临时落盘**：工单缓存、凭证留**内存**；图片文件与识图结果落到**插件临时目录**（系统自动清理）。

## 2. 非目标（YAGNI）

- 创建 / 更新工单、写回工单系统。
- 自动定时同步；同步由用户 / 模型显式触发。
- 除 Redmine 外，现阶段不实现其它 provider 的真实对接（只留可插拔接口，需后续 provider 的 API 信息再补）。
- 不引入正式数据库 / 本地长期持久化（临时落盘即可，凭证亦不进盘）。

## 3. 方案概述

实现为一个 DSH **动态 Cordis 插件**，分 `code.host` / `code.client`：

- Host：Provider 抽象（`RedmineProvider` 实现）同步工单 → **内存 Map**；下载附件图片到**临时目录**；调用**视觉模型**生成 `ai_description` 并随图缓存；向 `harness` 注册 3 个动态 Tool + 若干 `handle`。
- Client：`slots` 注册**工作台 UI**（列表/搜索/Bug·其它过滤/详情/图片区），数据经 `host.call` 获取。

## 4. 架构

```
┌── Client (code.client) ──────────────────┐   ┌── Host (code.host) ─────────────────────────┐
│  工作台 UI（slots.register）              │   │  内存: map<externalId,WorkItem>；config；      │
│  · 同步/搜索/Bug·其它过滤/详情/图片区       │   │        provider 实例；识图缓存                 │
│              │  host.call("wi:*")         │   │  临时目录: {tmp}/work-items/{external_id}/{图}  │
│              └──────── JSON RPC ─────────┼──▶│  · Provider 抽象(Redmine) → 聚合并发同步       │
│                                          │   │  · downloadAttachment() → 临时目录 + 图片访问    │
│                                          │   │  · describeImage() → 视觉模型生成 ai_description│
│                                          │   │  · harness Tool × 3 + handle × 3               │
└──────────────────────────────────────────┘   └───────────────┬───────────────────────────────┘
                                                                 │ fetch (X-Redmine-API-Key)
                                                                 ▼
                                                    Redmine (qn.pm.netease.com:8120)
```

## 5. Provider 抽象（新增）

定义统一接口，让不同工单系统可插拔：

```ts
interface WorkItemProvider {
  id: string                       // 'redmine' | 'yixiezuo' | ...
  // 同步"指派给我的工单"列表（聚合内部处理），返回 summaries + providerUserId
  listAssigned(): Promise<{ items: WorkItemSummary[]; providerUserId?: string }>
  // 拉单条详情（含描述、附件元数据）
  getDetail(externalId: string): Promise<WorkItem>
  // 下载附件到本地（返回本地路径），登录态处理由 provider 内部完成
  downloadAttachment(att: WorkItemAttachment, destDir: string): Promise<string | null>
  // 校验凭证有效性
  testAuth(): Promise<{ ok: boolean; message: string }>
}
```

- 通过 **provider registry**（`Map<providerId, Provider>`）注册/选择；`config.provider` 决定用哪个。
- 当前实现 `RedmineProvider`（对齐 qn-monai `redmine.rs`）；YiXieZuo 等仅登记占位，未实现时 `getProvider(id)` 返回「未实现」提示。

### 5.1 RedmineProvider 要点（源于 qn-monai）

- 认证：`X-Redmine-API-Key` header；凭证 `{baseUrl, apiKey, sessionCookie}`（默认 baseUrl `qn.pm.netease.com:8120`）。
- 列表聚合：多 query（`assigned_to_id=me&status_id=open`、`author_id=me&status_id=1/2`、`projects/redmine-system-builder/issues.json?cf_41=me&status_id=1/2`），每页 100 循环翻页，去重。
- 详情：`GET /issues/{id}.json?include=attachments,description`。
- 字段映射见 §5.2；附件下载用 `sessionCookie` 作为 `Cookie`（`content_url` 需登录态）。

### 5.2 统一字段模型

| 插件字段 | 说明 |
|---|---|
| `id` | `{provider}:{external_id}` |
| `external_id` / `title` / `category` / `priority` / `status` / `version` / `assignee` / `author` / `watcher` / `web_url` | 对齐 qn-monai |
| `description` | 工单描述 |
| `done_ratio` / `due_date` / `parent_id` | 详情附加（可选） |
| `attachments[].{name,url,local_path}` | 附件；`local_path` 为下载后临时路径 |
| `attachments[].ai_description` | 视觉模型识图结果（缓存） |
| `attachments[].description_status` | `'none'|'processing'|'done'|'error'` |

过滤规则：`search` 命中 title/description；`tracker_kind==='bug'` → `LOWER(category) IN ('bug','defect','缺陷')`，`'other'` → 其余。

## 6. Host 组件明细（`code.host`）

### 6.1 状态

- `map: Map<externalId, WorkItem>` —— 工单缓存（内存）。
- `config: { provider, redmine:{baseUrl,apiKey,sessionCookie}, vision:{endpoint,model,apiKey} }` —— 凭证 + 识图模型配置（内存，设置面板填写）。
- `workItemDir: string` —— 临时目录 `{平台临时目录}/monai-work-items/{provider}/{external_id}/`；附件与识图结果写这里。
- `visionCache` —— 识图结果缓存（`attachments[].ai_description` 已落在 WorkItem 里，天然复用）。
- `lastSyncAt` / `redmineUserId` / `configError`。

### 6.2 能力函数

- `syncWorkItems()`：`provider.listAssigned()` 聚合列表 → 并发(≤10)`provider.getDetail()` → 字段映射写 `map` → 对新增/更新工单的图片附件调用 `ensureAttachments()`（下载 + 识图）→ 清理已不在列表的条目。返回 `SyncResult{synced,failed,removed,errors}`。
- `ensureAttachments(item)`：对每个图片附件：若本地无 `local_path`，`provider.downloadAttachment()` 到临时目录；若图片无 `ai_description` 且 `description_status!=='processing'`，触发 `describeImage()` 并写回 `ai_description` / `description_status`。
- `describeImage(imagePath)`：读图 → 调视觉模型生成 `ai_description`（≤N 字符描述，聚焦图中与需求相关的文字/控件/流程）。失败置 `description_status='error'` 并记录原因。
- `listWorkItems(query)` / `getWorkItem(id)` / `buildContext(workItem)`：同前设计；`buildContext` 额外把图片的 `ai_description` 拼进 `## 附件图片描述`。

### 6.3 对外注册

- **动态 Tool（模型按需）**：
  - `list_work_items{search?,tracker_kind?}` → 摘要文本
  - `get_work_item_detail{id}` → `buildContext` 文本（含附件 `ai_description`）
  - `sync_work_items` → 触发同步，返回结果摘要
- **handle（Client 读）**：`wi:list` / `wi:get` / `wi:sync`；
  - `wi:image`（可选：返回图片的数据 URL / 访问元信息，供 UI 显示）。
- 所有 Tool / handle 在**当前插件 Fiber** 内注册，停止/更新自动移除。

## 7. Client 组件明细（`code.client`）

用 `React.createElement`（无 JSX）通过 `slots.register` 注册工作台：

- 顶部：同步按钮 + 搜索框 + 「Bug / 其它」过滤。
- 列表：title / 状态 / 优先级 / 分类 / 指派 / 更新时间。
- 详情：描述 + 附件区 —— 每张图显示缩略图（经 host 提供的访问方式）与 `ai_description`，附「重新识图」按钮（可选）。
- 数据经 `host.call('wi:*')` 获取；交互态（页码/搜索/选中项/识图状态）在组件内存维护。

### 图片访问（Client 如何显示本地图）

Client 是 Web，无法直读 host 文件。**优先**：host 借 DSH 的 `web` 能力serve 临时目录内的图片（提供 URL，`host.call('wi:image', id)` 返回 URL）。**兜底**：host 读图 → 返回 base64 data URL（适合小图，大图会撑大 JSON——需权衡）。**实现时按 `Service.listService` 实测选用**（见 §10）。

## 8. 数据流

1. 同步触发（模型 `sync_work_items` / UI 按钮）→ Host `syncWorkItems()`：`provider.listAssigned` → 并发 `getDetail` → 写内存 `map` → `ensureAttachments`（下载图片 + 识图）→ 返回 `SyncResult`。
2. 模型调用 `list_work_items` / `get_work_item_detail` → Host 返回 `buildContext` 文本（含识别描述）→ 模型基于工单/图片需求继续工作。
3. 工作台 UI → `host.call('wi:list'|'wi:get'|'wi:image')` → 渲染列表/详情/图片。
4. 识图：新增或图片无 `ai_description` 时自动触发；也可由 UI「重新识图」按钮手动触发。

## 9. 错误处理

- Redmine 401/403/网络错/超时(15s) → 中文错误；Tool 返回带 `error`；UI 错误条。
- 未配置凭证 → 启动提示 + Tool/handle 返回「请先配置」。
- 附件下载失败 → 图片标记为不可用，不阻塞整单。
- 识图失败 → `description_status='error'` + 原因，不重试同一次（可手动再识图）。
- 单条工单失败不中断整体，`failed` 计数，错误最多 10 条。
- Host handle 在插件未运行/`pluginRunId` 不符时调用失败 → Client 捕获展示。

## 10. 待确认的运行时接口（需 `cordis_inspect`）

Cordis 规范：绝不从名字推断完整 API。以下在**有 `cordis_*` 工具的 DSH 会话**中经 `cordis_inspect_list` / `Slots.listSubTree` / `Builtin.listBuiltins` / `Tool.listTools` 确认后再定稿；本设计给规范写法并标注：

1. 工作台 UI 的**确切 slot 名与注册协议**及 props/key（候选 `tool.view.cordis`(key=self) 或 settings/sidebar 区域）。
2. Host 调 Redmine 的**网络能力**：全局 `fetch` 可用性，或需经某 Service（如 `web`）。
3. **视觉模型调用路径**：DSH Host 是否可直接调某多模态模型 API（endpoint/model/key 由用户配置），还是需经 DSH 内部 LLM Service；确认接口与鉴权方式。
4. 图片给 Client 展示的**机制**：host 是否能用 `web` 能力 serve 静态文件（返回 URL），否则走 base64 data URL。
5. `harness` 注册动态 Tool 的**确切签名/schema 约定**（`Builtin.listBuiltins` + `Tool.listTools` 核对，避免命名冲突）。
6. `host.call` / `harness.handle` 的**参数/返回值约束**（lossless JSON；禁传函数/类/Service）。

## 11. 风险与开放问题

- **P0：运行时接口**：fetch、vision 模型 API、图片静态服务、slot 落点 —— 均取决于 DSH 实际暴露的能力，需按 §10 确认后实现。
- **P1：识图成本**：视觉模型调用烧 token/费用；已通过「识图结果缓存 + `description_status` 防重复」控制；建议只对图片类型的附件识图。
- **P1：临时目录生命周期**：图片/识图结果在进程临时目录，系统可能清理；工单缓存与凭证在内存（重启清空）。用户已接受。
- **P2：同步规模**：多 query 聚合 + 并发拉详情 + 逐个下载/识图，量大时注意限流（详情并发 ≤10；识图串行或限并发）。
- **P2：多 provider 状态差异**：不同系统字段、认证、附件访问不同；`WorkItemProvider` 接口需覆盖差异，回归时以 Redmine 为准。

## 12. 交付物与运行路径

- 本仓库（`dsh-redmine-work-items`）将包含：本设计文档、插件 `code.host` / `code.client` 代码、README（含「cordis_define / cordis_run 运行 + 凭证/识图配置 + cordis_inspect 核对接口」步骤）。
- **运行**：因本设计会话无 `cordis_*` 工具，插件代码交由用户在**具备 cordis 工具**的 DSH 会话用 `cordis_define`(kind:'new') 创建、`cordis_run` 激活，再经 Run 卡 / `cordis_inspect_self` 处理 approval、渲染与诊断。
