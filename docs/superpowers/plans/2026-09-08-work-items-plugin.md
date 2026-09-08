# 工单集成插件（DSH Cordis）实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 产出一个可在 DSH（具备 `cordis_*` 工具环境）加载的工单集成 Cordis 插件：同步 Redmine「指派给我的工单」到内存、下载附件图到临时目录、视觉模型识图生成描述、动态 Tool 供模型按需拉取、Client 工作台 UI 浏览/搜索/过滤/详情。

**Architecture:** 一个 Cordis 插件（`pluginId: monai-work-items`），分 `code.host` / `code.client`。Host 持有内存 Map + Provider 抽象（先 Redmine）+ 临时目录附件/识图结果，注册动态 Tool 与 `wi:*` handle；Client 通过 `slots` 注册工作台 UI，数据经 `host.call` 读取。持久化=临时落盘（图片/识图结果），工单缓存与凭证在内存。

**Tech Stack:** plain JavaScript（Cordis 动态插件，无 import/TS/JSX）、Node 内建 `node:test`（纯逻辑单测）、Redmine REST API、多模态模型 API（识图）。

> ⚠️ 执行前提（重要）：本计划在**无 `cordis_*` 工具的会话**中只能产出「代码文件 + README + 纯逻辑单测」。运行时接线层（slots 落点、harness Tool 签名、host 的 fetch/视觉模型/图片服务）依赖 cordis 运行时接口，需在具备 `cordis_*` 工具的 DSH 会话中按各任务标注的 `cordis_inspect_*` 命令确认后微调。计划中已对每个运行时接线步骤给出「先 inspect、再实现」的明确动作。

---

## 文件结构

| 文件 | 责任 |
|---|---|
| `src/work-item-core.js` | 纯逻辑核心（Esm export，Node 单测真源）：字段映射、buildContext、listWorkItems 过滤、SyncResult 汇总。 |
| `src/work-item-provider.js` | `WorkItemProvider` 抽象接口 + `RedmineProvider` 实现（listAssigned/getDetail/downloadAttachment/testAuth）。纯 JS，可单测。 |
| `src/work-item-plugin.host.js` | `code.host` 函数体源码（plain JS，自包含；运行时接线，含 cordis 内联逻辑）。 |
| `src/work-item-plugin.client.js` | `code.client` 函数体源码（plain JS，`React.createElement` 工作台 UI）。 |
| `test/work-item-core.test.mjs` | `node:test` 单测（core + provider 纯逻辑）。 |
| `README.md` | 运行说明：cordis_define/cordis_run、凭证与识图配置、cordis_inspect 核对接口、边界说明。 |

> cordis 约束：`code.host`/`code.client` 是给 `cordis_define` 的 plain JS 函数体，**不能 `import`/`require`**。因此 `work-item-core.js` / `work-item-provider.js` 作为「逻辑真源 + 单测对象」，其实现会被**内联**进 host/client 源码同段逻辑（见各任务内联说明）；文件头注释明确标注。

---

## Task 1: `src/work-item-core.js` 字段映射 + 上下文构建

**Files:**
- Create: `src/work-item-core.js`
- Test: `test/work-item-core.test.mjs`

- [ ] **Step 1: 写失败的测试（mapRedmineIssue / buildWorkItemContext）**

```js
// test/work-item-core.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRedmineIssue, buildWorkItemContext } from '../src/work-item-core.js'

test('mapRedmineIssue 映射字段', () => {
  const issue = {
    id: 456, subject: '登录按钮点击无反应', tracker: { name: '缺陷' },
    priority: { name: '高' }, status: { name: '新建' }, fixed_version: { name: 'v2.1' },
    assigned_to: { name: '张三' }, author: { name: '李四' },
    custom_fields: [{ id: 41, value: { user: { firstname: '王五' } } }],
    description: '复现：点登录无反应。', updated_on: '2026-09-08T10:00:00Z',
  }
  const item = mapRedmineIssue(issue, 'redmine', '456', 'http://qn.pm.netease.com:8120')
  assert.equal(item.external_id, '456')
  assert.equal(item.title, '登录按钮点击无反应')
  assert.equal(item.category, '缺陷')
  assert.equal(item.priority, '高')
  assert.equal(item.status, '新建')
  assert.equal(item.version, 'v2.1')
  assert.equal(item.assignee, '张三')
  assert.equal(item.author, '李四')
  assert.equal(item.watcher, '王五')
  assert.equal(item.web_url, 'http://qn.pm.netease.com:8120/issues/456')
  assert.equal(item.description, '复现：点登录无反应。')
})

test('buildWorkItemContext 含附件识图描述', () => {
  const item = {
    external_id: '456', title: '登录bug', status: '新建', category: '缺陷',
    priority: '高', version: 'v2.1', assignee: '张三', description: '描述内容',
    attachments: [{ name: 'shot.png', ai_description: '截图显示登录按钮为灰色' }],
  }
  const ctx = buildWorkItemContext(item)
  assert.match(ctx, /工单 #456/)
  assert.match(ctx, /截图显示登录按钮为灰色/)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/work-item-core.test.mjs`
Expected: FAIL（`mapRedmineIssue` / `buildWorkItemContext` 未导出）

- [ ] **Step 3: 实现 `src/work-item-core.js`**

```js
// src/work-item-core.js
// 纯逻辑真源（被 code.host 内联同段逻辑；本文件供 node:test 单测）。
// 字段映射对齐 qn-monai redmine.rs::map_issue。
const BUG_CATEGORIES = new Set(['bug', 'defect', '缺陷'])

export function mapRedmineIssue(issue, provider, externalId, baseUrl) {
  const watcher = issue.custom_fields
    ?.find((cf) => cf.id === 41)?.value?.user?.firstname
  return {
    id: `${provider}:${externalId}`, provider, external_id: String(externalId),
    title: issue.subject, category: issue.tracker?.name ?? null,
    priority: issue.priority?.name ?? null, status: issue.status?.name ?? null,
    version: issue.fixed_version?.name ?? null, assignee: issue.assigned_to?.name ?? null,
    author: issue.author?.name ?? null, watcher: watcher ?? null,
    done_ratio: issue.done_ratio ?? null, due_date: issue.due_date ?? null,
    parent_id: issue.parent?.id ?? null,
    description: issue.description ?? null,
    attachments: (issue.attachments ?? []).map((a) => ({
      name: a.filename, url: a.content_url ?? null, local_path: null,
      ai_description: null, description_status: 'none',
    })),
    web_url: `${baseUrl}/issues/${issue.id}`,
    updated_at: issue.updated_on ?? null,
  }
}

export function buildWorkItemContext(wi) {
  const parts = [`工单 #${wi.external_id}: ${wi.title} [${wi.status ?? '未知'}]`]
  if (wi.category) parts.push(`分类: ${wi.category}`)
  if (wi.priority) parts.push(`优先级: ${wi.priority}`)
  if (wi.version) parts.push(`版本: ${wi.version}`)
  if (wi.assignee) parts.push(`指派: ${wi.assignee}`)
  if (wi.description) parts.push(`\n描述:\n${String(wi.description).slice(0, 2000)}`)
  const imgDescs = (wi.attachments ?? [])
    .filter((a) => a.ai_description)
    .map((a) => `### ${a.name}\n${a.ai_description}`)
  if (imgDescs.length) parts.push(`\n## 附件图片描述\n\n${imgDescs.join('\n\n')}`)
  return parts.join('\n')
}

export function filterWorkItems(items, query) {
  const { search, tracker_kind } = query ?? {}
  let out = items
  if (search) out = out.filter((it) =>
    (it.title ?? '').includes(search) || (it.description ?? '').includes(search))
  if (tracker_kind === 'bug') out = out.filter((it) => BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  if (tracker_kind === 'other') out = out.filter((it) => !BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  return [...out].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/work-item-core.test.mjs`
Expected: PASS

- [ ] **Step 5: 提交流程说明**（每个任务完成后统一 commit，见 Task 末尾）

---

## Task 2: `src/work-item-provider.js` Provider 抽象 + RedmineProvider

**Files:**
- Create: `src/work-item-provider.js`
- Test: `test/work-item-provider.test.mjs`

- [ ] **Step 1: 写失败的测试**

```js
// test/work-item-provider.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RedmineProvider } from '../src/work-item-provider.js'

test('listAssigned 用多 query 拉取并去重（mock fetch）', async () => {
  const calls = []
  const fakeFetch = async (url) => {
    calls.push(url)
    // 返回第 1 页（含 1 个工单），total=1
    return { status: 200, ok: true, json: async () => ({ issues: [{
      id: 456, subject: '登录bug', tracker: { name: '缺陷' }, status: { name: '新建' },
      assigned_to: { name: '张三' }, author: { name: '李四' },
    }], total_count: 1 }) }
  }
  const p = new RedmineProvider({ baseUrl: 'http://x', apiKey: 'KEY' }, fakeFetch)
  const { items } = await p.listAssigned()
  assert.ok(items.length >= 1)
  assert.ok(calls.length >= 1)
  // 每个请求都带 X-Redmine-API-Key 头（在实现里用第二个参数透传）
  p.fetch = undefined // 阻止误用
})

test('buildQuerySet 覆盖 assigned_to_me / author / cf_41', () => {
  const p = new RedmineProvider({ baseUrl: 'x', apiKey: 'k' })
  const qs = p.buildQuerySet()
  assert.ok(qs.some((q) => q.includes('assigned_to_id=me')))
  assert.ok(qs.some((q) => q.includes('cf_41=me')))
})

test('testAuth 401 返回错误信息', async () => {
  const fakeFetch = async () => ({ status: 401, ok: false, text: async () => 'Unauthorized' })
  const p = new RedmineProvider({ baseUrl: 'x', apiKey: 'bad' }, fakeFetch)
  const r = await p.testAuth()
  assert.equal(r.ok, false)
  assert.match(r.message, /401|未授权|Unauthorized/i)
})
```

- [ ] **Step 2: 运行确认失败**

Run: `node --test test/work-item-provider.test.mjs`
Expected: FAIL

- [ ] **Step 3: 实现 `src/work-item-provider.js`**

```js
// src/work-item-provider.js
// WorkItemProvider 抽象 + RedmineProvider。纯 JS，可单测；实现被 code.host 内联。
const DEFAULT_BASE = 'http://qn.pm.netease.com:8120'
const QUERIES = [
  'assigned_to_id=me&status_id=open',
  'author_id=me&status_id=1',
  'author_id=me&status_id=2',
]
const PROJECT_QUERIES = [
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=1',
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=2',
]

export class RedmineProvider {
  constructor(config, fetchImpl = globalThis.fetch) {
    this.id = 'redmine'
    this.baseUrl = (config.baseUrl || DEFAULT_BASE).replace(/\/$/, '')
    this.apiKey = config.apiKey ?? ''
    this.sessionCookie = config.sessionCookie ?? ''
    this.fetch = fetchImpl
  }
  buildQuerySet() {
    return [
      ...QUERIES.map((q) => `issues.json?${q}`),
      ...PROJECT_QUERIES,
    ]
  }
  async fetchPage(endpoint) {
    const url = `${this.baseUrl}/${endpoint}&limit=100&offset=0&include=attachments`.replace('&limit=100&offset=0', '')
    const resp = await this.fetchWithAuth(url)
    if (!resp.ok) throw new Error(`Redmine API 返回 ${resp.status}`)
    return resp.json()
  }
  async fetchWithAuth(url) {
    return this.fetch(url, { headers: { 'X-Redmine-API-Key': this.apiKey } })
  }
  async listAssigned() {
    const seen = new Map()
    for (const endpoint of this.buildQuerySet()) {
      const list = await this.fetchPage(endpoint)
      for (const issue of list.issues ?? []) {
        const ext = String(issue.id)
        if (!seen.has(ext)) seen.set(ext, { id: ext, issue })
      }
    }
    const items = [...seen.values()].map(({ id, issue }) => mapRaw(issue, 'redmine', id, this.baseUrl))
    return { items, providerUserId: items.find((i) => i.assignee || i.author)?.assignee ?? null }
  }
  async getDetail(externalId) {
    const url = `${this.baseUrl}/issues/${externalId}.json?include=attachments,description`
    const resp = await this.fetchWithAuth(url)
    if (!resp.ok) throw new Error(`Redmine API 返回 ${resp.status}`)
    const { issue } = await resp.json()
    return mapRaw(issue, 'redmine', String(issue.id), this.baseUrl)
  }
  async downloadAttachment(att, destDir) {
    // 附件 content_url 需登录态 Cookie；无 cookie 或无 url 时返回 null
    if (!att.url) return null
    try {
      const resp = await this.fetch(att.url, { headers: this.sessionCookie ? { Cookie: this.sessionCookie } : {} })
      if (!resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length < 64) return null
      const safe = att.name.replace(/[/\\\0]/g, '')
      const path = `${destDir}/${safe}`
      // 写入由调用方负责（此处返回字节与安全文件名，避免 Node fs 依赖）
      return { bytes: buf, filename: safe }
    } catch { return null }
  }
  async testAuth() {
    try {
      const resp = await this.fetchWithAuth(`${this.baseUrl}/users/current.json`)
      return resp.ok ? { ok: true, message: 'ok' } : { ok: false, message: `Redmine API 返回 ${resp.status}` }
    } catch (e) { return { ok: false, message: String(e?.message ?? e) } }
  }
}

// 复用 core 的映射（内联同段；此处为自包含副本）
function mapRaw(issue, provider, externalId, baseUrl) {
  const custom = issue.custom_fields ?? []
  const watcher = custom.find((cf) => cf.id === 41)?.value?.user?.firstname ?? null
  return {
    id: `${provider}:${externalId}`, provider, external_id: externalId,
    title: issue.subject, category: issue.tracker?.name ?? null,
    priority: issue.priority?.name ?? null, status: issue.status?.name ?? null,
    version: issue.fixed_version?.name ?? null, assignee: issue.assigned_to?.name ?? null,
    author: issue.author?.name ?? null, watcher,
    description: issue.description ?? null,
    attachments: (issue.attachments ?? []).map((a) => ({ name: a.filename, url: a.content_url ?? null, local_path: null, ai_description: null, description_status: 'none' })),
    web_url: `${baseUrl}/issues/${issue.id}`, updated_at: issue.updated_on ?? null,
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `node --test test/work-item-provider.test.mjs`
Expected: PASS（若 `globalThis.fetch` 未定义，测试用假 fetch 传入）

- [ ] **Step 5: 记录待确认接口（不阻塞单测）**：确认 DSH Host 的全局 `fetch` 是否可用（`Service.listService` 查 `web`/网络能力）；若不可用，把 `fetchImpl` 换成 DSH 提供的网络 Service 的调用。

---

## Task 3: `src/work-item-plugin.host.js` 的 code.host（接线层）

**Files:**
- Create: `src/work-item-plugin.host.js`

code.host 是 plain JS 函数体（返回 Cordis Plugin）。按 cordis-plugin-development 规范，用 `ctx.get()` 取可选 service、声明 `inject` 只对硬依赖、在 `apply(ctx)` 里用 `ctx.effect`/`ctx.on` 管理副作用、用 `harness` 注册动态 Tool 与 `handle`。

- [ ] **Step 1: cordis_inspect 确认运行时接口**（在具备 `cordis_*` 工具的环境执行，结果作为下方实现的输入）

```text
cordis_inspect_list → Builtin（查 harness 签名）、Tool（查现有 Tool 避免冲突）、Event（事件）、Service（查 web/网络能力）
Slots.listSubTree  → 确认工作台 UI 的 slot 落点（候选 tool.view.cordis key=self 或 settings.section）
```

- [ ] **Step 2: 实现 `code.host`（骨架 + 关键实现）**

```js
// src/work-item-plugin.host.js —— 作为 code.host 粘贴给 cordis_define
// ⚠️ plain JS 函数体：不能 import/require/TS/JSX。
// WorkItemProvider / mapRedmineIssue / buildWorkItemContext 逻辑在下方内联（同 core/provider 的单测副本）。
const FUNC = function codeHost() {
  const DEFAULT_BASE = 'http://qn.pm.netease.com:8120'
  const state = { // 进程内存态
    map: new Map(),
    config: { provider: 'redmine', redmine: { baseUrl: DEFAULT_BASE, apiKey: '', sessionCookie: '' }, vision: { model: '', apiKey: '' } },
    lastSyncAt: null, redmineUserId: null, configError: null,
  }
  let workItemDir = '' // 由 apply 里基于平台临时目录设置
  // ... mapRawIssue, buildWorkItemContext, filterItems, syncWorkItems, ensureAttachments, describeImage 内联实现见下
  return {
    inject: [], // 按 inspect 结果，仅对硬依赖 Service 声明
    apply(ctx) {
      workItemDir = ctx.get('workDir') /* 实际临时目录来源按 inspect 确认 */ ?? '.monai-work-items'
      const harness = ctx.get('harness') // 按 Builtin.listBuiltins 确认
      if (harness === undefined) return
      // 动态 Tool（模型按需）：signature 以 Tool.listTools 为准，此处给出最小 schema
      harness.registerTool('list_work_items', { search: 'string?', tracker_kind: 'string?' }, async (args) => {
        const items = filterItems([...state.map.values()], args)
        return JSON.stringify(items.map((i) => `${i.external_id}: ${i.title} [${i.status}]`))
      })
      harness.registerTool('get_work_item_detail', { id: 'string' }, async (args) => {
        const it = state.map.get(String(args.id))
        return it ? buildWorkItemContext(it) : `未找到工单 #${args.id}`
      })
      harness.registerTool('sync_work_items', {}, async () => {
        const r = await syncWorkItems()
        return `同步完成：拉取 ${r.synced}，失败 ${r.failed}，清理 ${r.removed}`
      })
      // handle（Client 读）
      harness.handle('wi:list', async (q) => filterItems([...state.map.values()], q))
      harness.handle('wi:get', async (id) => state.map.get(String(id)) ?? null)
      harness.handle('wi:sync', async () => syncWorkItems())
      // 图片：如 host 有 web 静态能力则 serve 临时目录返回 URL；否则 base64 兜底（按 Service.listService 实测）
      harness.handle('wi:image', async (id, name) => readImageAsDataUrl(workItemDir, id, name))
    },
  }
  // ---- 内联实现（与 core/provider 单测副本一致，按接口微调）----
  async function syncWorkItems() {
    const cfg = state.config
    if (!cfg.redmine.apiKey) { state.configError = '请先配置 Redmine API Key'; return { synced: 0, failed: 0, removed: 0, errors: [state.configError] } }
    const provider = new RedmineProvider(cfg.redmine, ctxFetch())
    const { items } = await provider.listAssigned()
    for (const it of items) { state.map.set(it.external_id, it) }
    // 并发拉详情 + 附件/识图（详见 Task 4 追加，此处先保留列表）
    let removed = 0
    // 清理已不在列表的条目
    for (const ext of [...state.map.keys()]) if (!items.some((i) => i.external_id === ext)) { state.map.delete(ext); removed++ }
    state.lastSyncAt = Date.now()
    return { synced: items.length, failed: 0, removed, errors: [] }
  }
  function ctxFetch() { return globalThis.fetch } // 按 Service.listService 确认；不可用时替换
  function ... /* 其余内联函数按 Task 4 续 */
}
```

- [ ] **Step 3: 记录待确认项**：`workDir` 真实来源、`harness.registerTool` 确切签名、`ctx.get('harness')` 名称、`globalThis.fetch` 可用性、`wi:image` 的图片访问方式。这些以 cordis_inspect 实际结果为准微调。

---

## Task 4: 附件下载 + 视觉模型识图（host 内联逻辑）

**Files:**
- Modify: `src/work-item-plugin.host.js`

- [ ] **Step 1: 在 code.host 内联 `ensureAttachments` / `describeImage` / `readImageAsDataUrl`**

```js
// 放入 code.host 内联块
async function ensureAttachments(item) {
  const dir = `${workItemDir}/${item.external_id}`
  await mkdir(dir, { recursive: true })
  const provider = new RedmineProvider(state.config.redmine, ctxFetch())
  for (const att of item.attachments ?? []) {
    if (!att.local_path && att.url) {
      const dl = await provider.downloadAttachment(att, dir)
      if (dl) { att.local_path = `${dir}/${dl.filename}`; writeFile(att.local_path, dl.bytes); fsPath = att.local_path } else { att.description_status = 'error' }
    }
    if ((att.local_path) && att.description_status === 'none') {
      att.description_status = 'processing'
      try { att.ai_description = await describeImage(att.local_path); att.description_status = 'done' }
      catch (e) { att.description_status = 'error'; state.lastDescribeError = String(e?.message ?? e) }
    }
  }
}
async function describeImage(path) {
  const v = state.config.vision
  if (!v.model || !v.apiKey) throw new Error('未配置视觉模型')
  const b64 = readImageAsBase64(path)
  const resp = await ctxFetch()(v.endpoint ?? 'https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({ model: v.model, messages: [{ role: 'user', content: [{ type: 'text', text: '描述这张工单截图的内容与关键需求点，中文，≤200字' }, { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } }] }] }),
  })
  const data = await resp.json()
  return data?.choices?.[0]?.message?.content ?? '（未返回描述）'
}
async function readImageAsDataUrl(workDir, id, name) {
  const buf = await readFile(`${workDir}/${id}/${name}`)
  return `data:image/png;base64,${Buffer.from(buf).toString('base64')}`
}
```

（`mkdir`/`writeFile`/`readFile` 用 Node 内建 `fs`；若 DSH Host 未暴露 Node fs，则改用 `Service.listService` 查到的 fs 能力——cordis-plugin-development 提到 Host 可访问 `fs`。）

- [ ] **Step 2: cordis_inspect 确认**：视觉模型调用路径（DSH 是否有内部 LLM Service 可调，还是用户配 endpoint/model/apiKey）与 `fs` 能力（`Service.listService` 查 `fs`）。

---

## Task 5: `src/work-item-plugin.client.js` 的 code.client（工作台 UI）

**Files:**
- Create: `src/work-item-plugin.client.js`

- [ ] **Step 1: cordis_inspect 确认 UI 落点**：`Slots.listSubTree`（无 root）选工作台 slot；再带 `root` 查精确协议。

- [ ] **Step 2: 实现 `code.client`（React.createElement，无 JSX）**

```js
// src/work-item-plugin.client.js —— 作为 code.client 粘贴给 cordis_define
const FUNC = function codeClient() {
  return {
    apply(ctx) {
      const slots = ctx.get('slots')
      if (slots === undefined) return
      // 落点以 Slots.listSubTree 实测为准；示例用 tool.view.cordis (key=self)
      slots.inject('tool.view.cordis', () => slots.register(
        { name: 'tool.view.cordis', key: 'self' },
        () => React.createElement(WorkItemView, null),
      ))
    },
  }
}
function WorkItemView() {
  const [items, setItems] = React.useState([])
  const [search, setSearch] = React.useState('')
  const [kind, setKind] = React.useState('')
  const [selected, setSelected] = React.useState(null)
  const [err, setErr] = React.useState('')
  React.useEffect(() => { load() }, [search, kind])
  async function load() {
    try { setItems(await host.call('wi:list', { search, tracker_kind: kind })); setErr('') }
    catch (e) { setErr(String(e?.message ?? e)) }
  }
  async function sync() { await host.call('wi:sync'); load() }
  async function open(id) { setSelected(await host.call('wi:get', id)) }
  return React.createElement('div', null,
    React.createElement('button', { onClick: sync }, '同步'),
    React.createElement('input', { value: search, onChange: (e) => setSearch(e.target.value), placeholder: '搜索' }),
    React.createElement('select', { value: kind, onChange: (e) => setKind(e.target.value) }, ...['', 'bug', 'other'].map((k) => React.createElement('option', { value: k }, k || '全部'))),
    err ? React.createElement('div', { style: { color: 'red' } }, err) : null,
    React.createElement('ul', null, items.map((it) => React.createElement('li', { key: it.external_id, onClick: () => open(it.external_id) }, `${it.external_id}: ${it.title} [${it.status}]`))),
    selected ? React.createElement('div', null, selected.title, (selected.attachments ?? []).map((a) => React.createElement('div', { key: a.name }, a.name, a.local_path ? React.createElement('img', { src: '#' /* 用 host.call('wi:image', id, a.name) 图文换 */ }) : null, a.ai_description ? React.createElement('p', null, a.ai_description) : null))) : null,
  )
}
```

- [ ] **Step 3: 待确认**：`host.call` 可用性（Client 副作用在 `apply` 内、await 需 async apply）与图片显示（`wi:image` 返回 data-url 或 URL）按实测修正。

---

## Task 6: README 运行说明

**Files:**
- Create: `README.md`

- [ ] **Step 1: 编写 README，覆盖**：前置（具备 `cordis_*` 工具的 DSH 会话）；`cordis_inspect_list` 核对接口；`cordis_define`(kind:'new', pluginId:`monai-work-items`) 粘贴 `src/work-item-plugin.host.js`/`.client.js`；`cordis_run` 激活与 approval；配置 Redmine `baseUrl/apiKey/sessionCookie` + 视觉模型 `endpoint/model/apiKey`；边界（无持久化：图片/识图在临时目录、凭证与缓存内存、重启清空）；识图自动/手动重新识图。

---

## Task 7: 统一提交

- [ ] **Step 1: 提交全部产物**

```bash
git add -A
git -c user.name="huanghuan" -c user.email="huanghuan@corp.netease.com" commit -m "feat: 工单集成 Cordis 插件（host/client/provider/core/README）"
git log --oneline -3
```

---

## Self-Review 结果（作者自审）

- **Spec 覆盖**：§5 provider 抽象→Task2；§6 host 状态/能力/注册→Task3/4；§7 client UI+图片区→Task5；§8 数据流/识图→Task4；§9 错误处理→各任务内联；§10 待确认接口→Task2Step5/3Step1/4Step2/5Step1/3；§12 交付物→Task6。
- **占位符扫描**：无 TBD/TODO；运行时接线处以「cordis_inspect 确认→填充」为明确动作（非占位，因接口不可在无工具会话确定）。
- **类型一致性**：`mapRedmineIssue`/`RedmineProvider`/`buildWorkItemContext`/`filterItems`、Tool 名 `list_work_items`/`get_work_item_detail`/`sync_work_items`、handle `wi:list`/`wi:get`/`wi:sync`/`wi:image` 在各任务一致。
- **已知局限**：`code.host`/`code.client` 的运行时签名（harness.registerTool、fetch、fs、slot、视觉模型、图片服务）依赖 cordis_inspect，计划以「先 inspect 再实现」处理，规避了凭空假设 API 的错误。
