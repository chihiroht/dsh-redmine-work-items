# 设计文档：Redmine 工单集成插件（DSH Cordis Plugin）

- 日期：2026-09-08
- 状态：已获用户确认（方案 A：完整 Cordis 动态插件）
- 插件 ID：`monai-work-items`
- 参考来源：`E:\monai-app`（qn-monai）的工单集成功能（`src-tauri/src/issues/*`）

## 1. 背景与目标

qn-monai 工程内含一个「工单集成」功能：拉取 Redmine「指派给我的工单」列表与详情，缓存到本地 SQLite，提供前端工作台，并把工单文本上下文注入到聊天会话。现希望把这一功能点移植到 DSH，作为其生态内的一个插件。

用户明确选定的需求边界：

1. **工单管理工作台**（浏览 / 同步）——查看、搜索、过滤、展开详情的界面。
2. **把工单注入对话**——模型按需拉取工单信息并基于其工作。
3. **不需要持久化**——工单缓存与凭证放进程内存，落盘不在本次范围内。

## 2. 非目标（YAGNI）

本项目**明确不做**以下内容：

- 本地 SQLite / 文件持久化（用户确认不要；动态插件本身也是进程内临时）。
- 附件图片下载与 OCR 识图（monai 有，但因无持久化且增加复杂度，本次不迁移）。
- 创建 / 更新工单、写回 Redmine（本次只做「读 + 浏览 + 对话注入」）。
- 多 provider（如 YiXieZuo）抽象；本次只针对 Redmine。
- 自动定时同步；同步由用户 / 模型显式触发。

## 3. 方案概述

实现为一个 DSH **动态 Cordis 插件**，分为 `code.host` 与 `code.client` 两块：

- Host：调用 Redmine API 同步「指派给我的工单」到**内存 Map**；向 `harness` 注册 3 个**动态 Tool**（模型按需拉取）；向 `harness` 注册若干 `handle` 供 Client 读取缓存。
- Client：通过 `slots` 注册**工作台 UI**（列表 + 搜索 + Bug/其它过滤 + 详情），数据经 `host.call` 从 Host 读取。

无持久化的取舍正契合动态插件「进程内临时」的特性。

## 4. 架构

```
┌── Client (code.client) ──────────────────┐   ┌── Host (code.host) ─────────────────────┐
│  工作台 UI（slots.register）              │   │  内存 Map<externalId, WorkItem>          │
│  · 同步按钮 / 搜索框 / Bug·其它过滤        │   │  内存 config {baseUrl, apiKey, cookie}   │
│  · 分页列表 / 详情面板                     │   │  · syncWorkItems()  → Redmine 聚合并发    │
│              │  host.call("wi:*")         │   │  · listWorkItems(query) / getWorkItem(id)│
│              └──────── JSON RPC ─────────┼──▶│  · buildContext(workItem) → 给模型文本     │
│                                          │   │  · harness Tool × 3 + handle × 3          │
└──────────────────────────────────────────┘   └───────────────┬─────────────────────────┘
                                                                 │ fetch (X-Redmine-API-Key)
                                                                 ▼
                                                    Redmine (qn.pm.netease.com:8120)
```

## 5. Host 组件明细（`code.host`）

### 5.1 状态（进程内存）

- `map: Map<externalId, WorkItem>` —— 工单缓存，键为 `external_id`（如 `"123"`）。
- `config: { baseUrl, apiKey, sessionCookie }` —— 凭证与地址，会话内由用户在设置面板填写。
- `lastSyncAt?: number`、`redmineUserId?: string` —— 元信息（供 UI 展示与工具上下文）
- `configError?: string` —— 未配置凭证时的提示。

### 5.2 数据结构（对齐 qn-monai）

- `WorkItemSummary`：`{ id, external_id, title, category, priority, status, version, assignee, author, watcher, web_url, updated_at }`
- `WorkItem`：`WorkItemSummary + { description, attachments: [{name, url}], done_ratio?, due_date?, parent_id? }`
- `SyncResult`：`{ synced, failed, removed, errors: string[] }`
- `ListQuery`：`{ search?, tracker_kind?: 'bug'|'other' }`

字段映射（源于 `redmine.rs::map_issue`）：

| Redmine | 插件字段 |
|---|---|
| `subject` | `title` |
| `tracker.name` | `category` |
| `priority.name` | `priority` |
| `status.name` | `status` |
| `fixed_version.name` | `version` |
| `assigned_to.name` | `assignee` |
| `author.name` | `author` |
| custom_field id=41 的 user | `watcher` |
| `web_url` | `{baseUrl}/issues/{id}` |
| `attachments[].filename` / `content_url` | `attachments[].name` / `.url` |

### 5.3 能力函数（纯逻辑，便于单测）

- `syncWorkItems()`：
  1. 校验 `config.apiKey` 存在。
  2. 以**多 query 聚合**拉列表（每页 100，循环翻页）：`issues.json?assigned_to_id=me&status_id=open`、`issues.json?author_id=me&status_id=1`、`issues.json?author_id=me&status_id=2`、`projects/redmine-system-builder/issues.json?cf_41=me&status_id=1`、`...&status_id=2`。
  3. 对聚合到的每个工单，**并发**（上限 10）拉详情 `GET /issues/{id}.json?include=attachments,description`。
  4. 字段映射后写入 `map`；同步结束后清理已不在列表上的条目（`removed`）。
  5. 返回 `SyncResult`；单条失败不阻塞整体，`failed` 计数并收集（最多前 10 条）错误。
- `listWorkItems(query)`：从 `map` 过滤排序，返回 `WorkItemSummary[]`。过滤：`search` 命中 title/description；`tracker_kind==='bug'` 时 `LOWER(category) IN ('bug','defect','缺陷')`，`'other'` 时取其余。
- `getWorkItem(id)`：返回 `WorkItem` 详情（含附件 URL；**不下载附件**——无持久化）。本机无该 id 时返回 `null`。
- `buildContext(workItem)`：qn-monai `format_work_item_context` 的 JS 复刻 —— 生成形如
  `工单 #123: 标题 [状态] / 分类 / 优先级 / 版本 / 指派 / 备注 / 描述摘要(≤2000字符)` 的纯文本，供 Tool 返回给模型。

### 5.4 对外注册

- **动态 Tool（harness 注册）**，模型按需调用：
  - `list_work_items`：参数 `{ search?, tracker_kind? }`，返回工单摘要文本列表。
  - `get_work_item_detail`：参数 `{ id }`，返回单条 `buildContext` 文本。
  - `sync_work_items`：无参，触发同步并返回 `SyncResult` 摘要文本。
- **handle（Client 读）**：
  - `harness.handle('wi:list', q)` → 返回 summaries
  - `harness.handle('wi:get', id)` → 返回详情
  - `harness.handle('wi:sync')` → 触发同步，返回结果
- 所有 Tool / handle 在**当前插件 Fiber**内注册，插件停止/更新时自动移除。

## 6. Client 组件明细（`code.client`）

用 `React.createElement`（不用 JSX）通过 `slots.register` 注册工作台：

- 顶部：同步按钮 + 搜索框 + 「Bug / 其它」过滤切换。
- 主体：工单分页列表（title / 状态 / 优先级 / 分类 / 指派 / 更新时间）。
- 详情：点击列表项展开详情面板（描述 + 附件 fileName → web_url 链接）。
- 数据一律 `host.call('wi:list'|'wi:get'|'wi:sync')` 获取，不直接触碰 Host 状态。
- 交互态（当前页码、搜索词、选中项）在组件内存维护即可。

### UI 落点（slot）

**待运行时确认**（见 §10）。候选：

1. `tool.view.cordis`（`key: 'self'`）——紧贴 `cordis_run` 卡片，交互直观；适合「运行一次即看工单」的用法。
2. 某个 settings / sidebar 区域 —— 若希望工作台常驻。

## 7. 数据流

1. 触发同步：模型调 `sync_work_items` Tool，或 UI 点「同步」→ Host `syncWorkItems()` → fetch Redmine → 写内存 Map → 返回 `SyncResult`。
2. 模型调 `list_work_items` / `get_work_item_detail` → Host 返回 `buildContext` 格式化文本 → 模型基于工单继续工作。
3. 工作台 UI → `host.call('wi:list')` 渲染列表 → 点开 → `host.call('wi:get')` 渲染详情。

## 8. 错误处理

- Redmine 401 / 403 / 网络错 / 超时(15s) → 中文错误消息；Tool 返回携带 `error` 字段；UI 显示错误条。
- 未配置凭证 → 插件启动提示「请先配置 Redmine API Key / Session Cookie」，相应 Tool / handle 返回该提示。
- 单条工单拉取失败 → 计入 `failed`，不中断整体同步，错误列表最多存 10 条。
- Host handle 被调用但插件未运行 / `pluginRunId` 不符 → `host.call` 失败均在 Client 侧捕获并展示。

## 9. 测试

- **纯函数单测**：字段映射（map_issue 等价）、`listWorkItems` 过滤（search / tracker_kind）、`buildContext` 文本（对照 qn-monai 既有逻辑）。
- **mock 链路**：本地构造 Redmine 响应 JSON 验证「同步→缓存→列表→详情→文本」全链路，不依赖真实网络。
- **真实现场**：配真实 API Key 验证同步、列表、详情与 Tool 返回；凭证缺失时验证错误提示。

## 10. 待确认的运行时接口（需 `cordis_inspect`）

Cordis 官方规范要求「绝不从名字推断完整 API」。以下项在**有 `cordis_*` 工具的 DSH 会话**中通过 `cordis_inspect_list` / `Slots.listSubTree` / `Builtin.listBuiltins` / `Tool.listTools` 确认后再定稿代码，本设计先给出基于规范的写法并标明待核：

1. 工作台 UI 的**确切 slot 名与注册协议**（候选见 §6），及其 props / 注册 key。
2. Host 调 Redmine 的**网络能力**：Host 是否暴露全局 `fetch`，还是需经某个 Service（如 `web`）。按 `Service.listService` 结果选最小集。
3. `harness` 注册动态 Tool 的**确切方法签名与 schema 约定**（按 `Builtin.listBuiltins` + `Tool.listTools` 核对，避免与现有 Tool 冲突）。
4. `host.call` / `harness.handle` 的**参数与返回值约束**（必须 lossless JSON；不能传函数/类实例/Service 等）。

## 11. 风险与开放问题

- **P0：运行时接口** —— 若 host 无全局 `fetch` 且需走特定 Service，则 host 网络层实现要按实际接口改写；已在 §10 标注为待确认。
- **P1：无持久化** —— 插件/进程重启后缓存与凭证清空，需重新同步、重填凭证。用户已接受。后续若需持久化，应另启一轮（改造成 profile bundle / 引入存储），不在本次范围。
- **P1：slot 落点** —— 若 `tool.view.cordis` 的 UI 生命周期不满足「常驻浏览」，需改用 settings/sidebar 区域。以 `cordis_inspect` 实测为准。
- **P2：同步规模** —— 多 query 聚合 + 并发拉详情，工单量大时注意限流（并发上限 10 已纳入）。

## 12. 交付物与运行路径

- 本仓库（`dsh-redmine-work-items`）将包含：本设计文档、插件 `code.host` / `code.client` 代码、README 运行说明。
- **运行**：因本设计会话无 `cordis_*` 工具，插件代码交由用户在**具备 cordis 工具**的 DSH 会话，用 `cordis_define`（`plugin.kind:'new'`）创建、`cordis_run` 激活；激活后分别在 host / client 的 Run 卡片或 `cordis_inspect_self` 中处理 approval、渲染与诊断。详细步骤写入 README。
