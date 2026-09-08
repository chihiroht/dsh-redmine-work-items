# 校准笔记（cordis 运行时接线）

> 本笔记记录 `code.host` / `code.client` 校准后的**已确认事实**与**仍需具 `cordis_*` 工具会话确认的点**。
> 依据：`@deepseek-ai/dsh-cordis-host-runner`、`@deepseek-ai/dsh-cordis-client-runner`、
> `@deepseek-ai/dsh-tool-cordis`、`@deepseek-ai/dsh-tools`、`@deepseek-ai/dsh-web`、`@deepseek-ai/dsh-fs` 的
> 已安装源码（`...\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\*`）与 `.d.ts` 类型声明。

## 一、已确认的 cordis 事实（校准后已按此实现）

### Host 半（`code.host`）
1. **求值环境**：在 `node:vm` 沙箱运行，body 是 `(async () => { <body> })()`。**无** `require` / `import` /
   `fetch` / `Buffer` / `process`。base64 用全局 `btoa` / `atob` / `TextEncoder` / `TextDecoder`。
2. **返回**：body 必须 `return` 一个插件对象（`{ name?, inject[], apply(ctx, config) }`），或裸函数。
3. **`apply(ctx, config)`** 的 `ctx` 是**受控 facade**（`guard.sandboxContext`）：
   - `ctx.get(name)` 可选查找；属性访问 `ctx.fs` / `ctx.web` / `ctx.bash` 需在 `inject` 里声明。
   - `ctx.tools` 恒可用：`ctx.tools.register(tool)`。
   - `ctx.effect(fn)` / `ctx.on` / `ctx.provide` / `ctx.timeout` 等是生命周期 verb（timer 需 `inject:['timer']`）。
   - `define` 请求**没有 config 字段**——插件配置只能来自 `apply` 的 `config` 参数（部署注入）或插件内
     内存 `state.config`（本插件用后者 + `wi:config` handle 更新）。
4. **`harness`**（沙箱 closure 符号）：
   - `harness.defineTool({ name, description, parameters, output:{ schema, render }, execute })` → 产出工具。
     `parameters` 为 schemastery 扁平体（`{ field: { type, required, description } }`）；
     `output.render(args, value)` 必须返回 `[{ type:'text', text: String(value) }]`。
   - `harness.registerTool(ctx, tool)`（等价 `ctx.tools.register`）；工具须由 `defineTool` 产出（marker 校验）。
   - `harness.handle(method, fn)` 注册 Client→Host RPC；`fn(args)` 结果经 JSON 往返。
5. **网络 `ctx.web.fetch({ url }, signal)`**：仅 GET、**不能带 header**。返回
   `{ url, statusCode, body:{ kind:'html'|'text', content:string }, truncated }`。
   → **Redmine 认证只能用 `?key=` 查询参数**，JSON 用 `JSON.parse(body.content)`。
   → 无法 POST / 无法带 `Authorization` / `Cookie` header。
6. **文件 `ctx.fs`**（与 `dsh-tool-fs` 同服务）：`resolve(path, {cwd,signal})` → `{ displayPath }`；
   `stat`、`readText`、`streamText`、`readBytes(target, signal, byteCap)`、`writeText`、`editText`、`sandboxMode`。
   是否暴露 `writeBytes` **待 L2 用 `Service.listService` 确认**（本版用 `typeof ctx.fs.writeBytes === 'function'` 兜底）。

### Client 半（`code.client`）
1. **求值**：浏览器侧 closure；`React` 与 `host` 是注入的 closure 符号；无 `fetch`/`require`。
2. **返回**：`{ inject:['slots'], apply(ctx) }`；`apply(ctx)` 的 ctx 是浏览器侧 facade，`ctx.slots` 可用。
3. **UI 注册**：`ctx.slots.inject(slotKey, () => ctx.slots.register({ name: slotKey, key? }, () => React.createElement(...)))`。
   组件是**工厂**（`() => React.createElement(..., null)`）。
4. **`host.call(method, args)`**：调 host 半 `harness.handle` 注册的方法，**返回 value 本体**；失败抛 `Error`。
5. **落点 slot**：`tool.view.cordis` 只接受 `key:'self'`（运行时绑定到本包），已实测为合法落点。

## 二、仍待 L2（具 `cordis_*` 工具会话）确认的点

这些是 cordis 规范禁止凭空推断、需 `cordis_inspect_query` 实测的项；当前实现做了**防御性兜底**，但不代表 100% 对齐：

- [ ] `ctx.fs` 是否暴露 `writeBytes`（读写二进制附件）。若无 `writeBytes`，本版回退 `writeText`（不保真）。
- [ ] `ctx.web.fetch` 的 `body.content` 对 Redmine JSON 是否就是 `text`（应为 `text`；若是 `html` 需调整解析）。
- [ ] `tool.view.cordis` 在 web profile 里是否由 `dsh-client-ui-cordis` 实际挂载并渲染（web 配置里已挂 `ui-cordis`，
      但需跑起来看到面板才确认）。
- [ ] 是否需要对动态插件也注册 `systemPrompt` 章节（本插件未用，非必需）。

## 三、沙箱硬限制（如实处理，非 bug）

1. **视觉识图（POST + Authorization）**：`ctx.web` 仅支持 GET、无 header → 无法调 OpenAI 兼容视觉接口。
   本版在 `describeImage` 记录 `description_status='skipped'` 并写入 `lastDescribeError` 说明。
   若 DSH 后续提供 web-POST 通道或允许 `ctx.shell`/`ctx.bash` 起 curl，可在此接入。
2. **附件二进制下载**：`WebFetchBody` 仅 `text`/`html`，且不能带 Cookie header → 二进制可能被解码损坏或 404。
   本版 best-effort：下载成功写盘、失败记 `skipped`，不阻塞核心功能。
3. **工具输出**：`output.render` 只返回 `[{type:'text', text}]` 文本块（不做图片/富文本 content block）。

## 四、与旧稿的主要差异（为何当初「不可跑」）

| 项 | 旧稿 | 校准后 |
|---|---|---|
| `harness.registerTool` | `(name, schema, handler)` | `harness.defineTool({…output, execute})` + `harness.registerTool(ctx, tool)` |
| 网络 | `globalThis.fetch` | `ctx.web.fetch({url})`，`?key=` 认证 |
| 文件 | `globalThis.__dsh_fs` | `ctx.fs`（inject `['fs']`） |
| `Buffer` | 用 `Buffer` | `btoa(binaryString(bytes))` |
| 插件 `inject` | `[]` | `['tools','fs','web']` |
| client 槽注册 | `slots.register` | `ctx.slots.inject(slot, ()=>ctx.slots.register({name,key}, ()=>React.createElement(...)))` |
| 视觉识图 | POST+header | 沙箱不可行 → `skipped` + `lastDescribeError` |
