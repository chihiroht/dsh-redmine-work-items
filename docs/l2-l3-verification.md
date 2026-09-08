# L2 / L3 插件验证操作手册

> 适用：在具备 `cordis_*` 工具的 DSH 会话（如你起的 3080 `dsh web` 的 agent 会话）中，加载并验证工单集成插件。
>
> 插件代码来源：
> - `code.host`  ← `src/work-item-plugin.host.js` 全文
> - `code.client` ← `src/work-item-plugin.client.js` 全文
>
> 复制时**连同注释一起**粘贴即可（`//` 注释在函数体内合法、会被忽略，不影响运行）。若 `cordis_define` 需要完整 function 源码，用 `function codeHost() { <先复制 host 全文> }` / `function codeClient() { <先复制 client 全文> }` 包裹。

---

## Step 0 — cordis_inspect 确认运行时接口（先做，再写代码）

在 DSH 会话里跑，记录真实签名。这些决定了 `code.host`/`code.client` 里每个 `TODO(cordis_inspect)` 处该如何改：

```text
cordis_inspect_list                    # Host+Client 的 Service / Builtin / Tool / Event / Slot / Theme
Tool.listTools                         # 确认现有 Tool，避免命名冲突；看动态 Tool 注册后的 API
Service.listService                    # 查 Host 是否暴露 fs / 网络(fetch) / workDir / LLM(视觉模型)
Slots.listSubTree (无 root)            # 查工作台 UI 的 slot 落点；带 root 查精确协议
Object.keys(Builtin) / Event.listEvents # 确认 harness 名与事件
```

**要重点核对 5 处**（都在 `TODO(cordis_inspect)` 标注位）：

| 待确认 | 现状（需改的位） | 用 inspect 确认后改为 |
|---|---|---|
| Host 网络能力 | `globalThis.fetch`（host.js:228） | 若 Host 无全局 fetch，改用 `Service.listService` 查到的网络 Service |
| fs 能力 | `globalThis.__dsh_fs?.xxx`（host.js:223-227） | 用真实的 fs Service 调用（mkdir/writeFile/readFile 签名） |
| harness 名/API | `ctx.get('harness')` + `harness.registerTool`（host.js:221/232） | 按 `Builtin.listBuiltins` + `Tool.listTools` 的实际方法名与签名 |
| 工作台 UI slot | `tool.view.cordis` key=self（client.js:87） | 按 `Slots.listSubTree` 实测的 slot 名/协议/key |
| 视觉模型调用 | `globalThis.fetch(vision.endpoint)`（host.js:189） | 若 DSH 有内部 LLM Service 可调，改用之；否则保留 OpenAI 兼容 endpoint/model/apiKey |

---

## Step 1 — cordis_define 创建插件

```text
cordis_define  plugin.kind: 'new'
               pluginId: 'monai-work-items'
               code.host:   <粘贴 src/work-item-plugin.host.js 全文>
               code.client: <粘贴 src/work-item-plugin.client.js 全文>
```

返回 `packageId`（记为 `<P>`）。

## Step 2 — cordis_run 激活

```text
cordis_run  pluginId: 'monai-work-items'  packageId: '<P>'  mode: 'run'
```

- 首次 `awaiting-approval`：确认授权。
- `starting`：等异步完成；`cordis_inspect_self('monai-work-items','<P>')` 看状态与诊断。

---

## Step 3 — L2 逐项验证

| 验证点 | 操作 | OK 判据 | 若失败 |
|---|---|---|---|
| Host 加载 | `cordis_run` 后无 host 报错 | Run 卡无红字 / `inspect_self` 无 host 诊断 | 贴 `cordis_inspect_self` 诊断 |
| 动态 Tool 注册 | `Tool.listTools` | 见到 `list_work_items` / `get_work_item_detail` / `sync_work_items` | `harness.registerTool` 签名不符，改 host.js:232-243 |
| 同步（L2 主机） | 对话让模型调 `sync_work_items` | 返回「同步完成：拉取 N」 | 失败多为 fetch 能力/凭证；核对 host.js:228 + state.config.redmine.apiKey |
| 工作台 UI | `cordis_run` 卡或对应 slot | 出工作台（同步钮/搜索/过滤/列表） | slot 名/协议不符，改 client.js:87 |
| 图片 | 同步到含图附件工单后看详情 | `attachments[].ai_description` 有值、`description_status=done` | 视觉模型配置缺 / fs 未确认；见 Step 0 第 5 项 |

> 配置入口：`state.config.redmine.{baseUrl,apiKey,sessionCookie}`、`state.config.vision.{endpoint,model,apiKey}`（见 host.js:131-135）。当前为内存态，重启需重填。

## Step 4 — L3 端到端

在对话里发起：**「查一下指派给我的工单，挑一个安全漏洞类摘要」**

- OK 判据：模型调用 `list_work_items` →（可选 `get_work_item_detail`）→ 返回工单文本 → 模型据此作答。
- 若模型说「没有可用工具」，说明动态 Tool 未注册成功 → 回 Step 3 第一/二行。

---

## 失败快速排查

- **`service "x" is not declared`**：用了 `ctx.x` 却没 `inject:['x']`；改用 `ctx.get('x')` 判空，或对硬依赖加 `inject`。
- **`cannot get property "timer" without inject`**：同理，声明 `inject:['timer']`。
- **Client 解析失败**：是否用了 JSX / TS / import；必须 `React.createElement`。
- **Slot 注册失败**：slot 名/key/协议与 `Slots.listSubTree` 实测不符。
- **`host.call` 失败**：Handler 名是否对（`wi:list`/`wi:get`/`wi:sync`/`wi:image`）、参数是否 JSON，Host handler 是否真的注册成功。
- **UI 报错**：`cordis_inspect_self` 的 `client-render` 诊断 + 对应 Run 的堆栈。

> 需要修代码时：改 `src/work-item-plugin.host.js` / `src/work-item-plugin.client.js`（及 `src/work-item-core.js`/`src/work-item-provider.js` 的同段逻辑保持同步），在现有 Plugin 上用 `cordis_define`(kind:'existing') 追加新 package，再 `cordis_run`(mode:'update') 切到新版本。
