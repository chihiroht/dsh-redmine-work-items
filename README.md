# 工单集成插件（DSH Cordis Plugin）

仿照 qn-monai 的工单集成，为 DSH 做的一个 **Cordis 动态插件**：同步 Redmine「指派给我的工单」到内存、下载附件图到临时目录、用视觉模型识图生成描述、动态 Tool 供模型按需拉取、Client 工作台浏览/搜索/过滤/详情。

> 设计：`docs/superpowers/specs/2026-09-08-redmine-work-items-plugin-design.md`
> 计划：`docs/superpowers/plans/2026-09-08-work-items-plugin.md`

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/work-item-core.js` | 纯逻辑真源：字段映射 / buildContext / 过滤（`node:test` 单测对象）。 |
| `src/work-item-provider.js` | WorkItemProvider 抽象 + RedmineProvider（listAssigned/getDetail/downloadAttachment/testAuth）。 |
| `src/work-item-plugin.host.js` | `code.host` 函数体（内联逻辑 + harness Tool/handle 注册）。 |
| `src/work-item-plugin.client.js` | `code.client` 函数体（工作台 UI，`React.createElement`）。 |
| `test/*.test.mjs` | `node:test` 单测（core/provider 纯逻辑）。 |
| `scripts/verify-provider.mjs` | 真实 Redmine 接入自检（L1，无需 cordis）。 |

## 执行前提

- **加载需在具备 `cordis_*` 工具（`cordis_define`/`cordis_run`/`cordis_inspect_*`）的 DSH 会话**。
- 本仓库本身不含 Node 依赖；纯逻辑单测用 Node 内建 `node:test`，无需 `npm install`。

## 1. 核对运行时接口（重要）

Cordis 规范要求「绝不从名字推断 API」。加载前在 DSH 会话跑：

```text
cordis_inspect_list                          # Host/Client 的 Services、Burins、Tools、Events、Slots、Theme
Slots.listSubTree (无 root)                  # 确认工作台 UI slot 落点
Builtin.listBuiltins  /  Tool.listTools      # 确认 harness 注册动态 Tool 的签名与现有 Tool（避免冲突）
Service.listService                          # 确认 Host 的 fs / 网络（fetch）/ workDir 能力
```

按结果微调 `code.host` / `code.client` 中所有 `TODO(cordis_inspect)` 标注处。

## 2. 创建并运行插件

1. 用 `cordis_define` 创建插件（`plugin.kind:'new'`，`pluginId: monai-work-items`）：
   - `code.host` ← 粘贴 `src/work-item-plugin.host.js` 的**函数体**（若需完整 function 源码，用 `function codeHost(){ <内容> }` 包裹）。
   - `code.client` ← 粘贴 `src/work-item-plugin.client.js` 的**函数体**（同上）。
2. `cordis_run` 激活。首次 `awaiting-approval` 时确认授权；`starting` 后等异步完成。
3. 用 `cordis_inspect_self(pluginId, packageId)` 读源码/诊断，`cordis_stop` 暂停、`cordis_undefine` 移除。

## 3. 配置（HOST 内 `state.config`，见 `code.host`）

凭证/模型在插件的设置入口填（位于 `state.config`）：

- Redmine：`redmine.baseUrl`（默认 `http://qn.pm.netease.com:8120`）、`redmine.apiKey`、`redmine.sessionCookie`。
- 视觉模型（识图）：`vision.endpoint`（OpenAI 兼容）、`vision.model`、`vision.apiKey`。

> ⚠️ 当前为「无持久化」边界：工单缓存、凭证、识图模型配置均存**进程内存**；附件图片与识图结果落到**插件临时目录**（系统会清理）。重启后需重新同步、重填凭证。

## 4. 使用

- **对话**：模型可调用动态 Tool `list_work_items` / `get_work_item_detail` / `sync_work_items`，按需拉取工单与附件识图描述。
- **工作台**：Client 工作台提供「同步 / 搜索 / Bug·其它过滤 / 详情 + 附件图」，数据经 `host.call('wi:*')` 读取。

## 5. 验证功能是否 OK（推荐顺序）

按「从可控到集成」分层验证，每层都给出明确的 OK 判据。**建议按 L0 → L1 → L2 → L3 顺序跑**。

### L0 纯逻辑（离线，无需凭证 / DSH）

```bash
node --test
```

**OK 判据：** 全部 PASS（core 映射/上下文/过滤 + provider 逻辑）。

### L1 Redmine 核心接入（需真实凭证 + 网络，无需 cordis）

```bash
REDMINE_API_KEY=xxx REDMINE_SESSION_COOKIE=xxx node scripts/verify-provider.mjs
```

（`REDMINE_BASE_URL` 可选，默认 `http://qn.pm.netease.com:8120`）

**OK 判据：** `testAuth` PASS + `listAssigned` 拉到「指派给我的工单」+ 有列表时 `getDetail` 取到详情；退出码 0。这一层能最快证明「核心功能（同步+详情+认证）OK」。

### L2 DSH 内的 cordis 集成（需具备 `cordis_*` 工具）

- **加载**：`cordis_define` + `cordis_run` 无 host 报错。
- **Tool 注册**：`Tool.listTools` 能见到 `list_work_items` / `get_work_item_detail` / `sync_work_items`。
- **同步**：对话让模型调 `sync_work_items` → 返回"同步完成：拉取 N"。
- **工作台**：`cordis_run` 卡（或对应 slot）渲染出工作台 UI；点「同步」能列工单、点开能看详情。
- **图片/识图**：同步到含图片附件的工单后，详情 `attachments[].ai_description` 有内容、`description_status=done`。

### L3 端到端（模型基于工单干活）

- 对话里让模型「查一下指派给我的工单并摘要」→ 模型调用 `list_work_items`/`get_work_item_detail` 返回工单文本 → 模型据此作答。

**OK 判据：** 模型能读取工单内容并据此继续工作（即"注入对话"达成）。

> 若 L2/L3 失败，多为 `code.host`/`code.client` 的 `TODO(cordis_inspect)` 运行时接线未按实际接口校准，把 `cordis_inspect_self` 诊断贴回来即可修。

## 已知边界与待校准

- 运行时接线（slot 落点、`harness.registerTool` 签名、`globalThis.fetch`、`fs`、视觉模型调用、图片访问）均为**初稿 + 待 `cordis_inspect` 校准**，见各文件 `TODO(cordis_inspect)`。
- 附件图片默认**不自动下载**；识图在同步到图片附件时触发，`description_status` 防重复识图。
