// src/work-item-plugin.host.js
// 作为 code.host 传给 cordis_define 的 plain JS 函数体。
//
// ⚠️ cordis 约束：不能 import / require / TS / JSX。因此本函数体内联了
//    src/work-item-core.js 与 src/work-item-provider.js 的同段逻辑（单一真源是那两个文件，
//    此处为自包含副本，改动时须同步）。
//
// ⚠️ 运行时接线为「初稿 + 待校准」：下列标注 `TODO(cordis_inspect)` 的接口需在具备
//    cordis_* 工具的 DSH 会话用 cordis_inspect_list / Slots.listSubTree /
//    Builtin.listBuiltins / Tool.listTools / Service.listService 确认后再微调。
//    涉及：workDir 来源、ctx.get('harness'|'fs') 名称与签名、globalThis.fetch 可用性、
//    harness.registerTool 确切 API、视觉模型调用路径、图片访问方式。
//
// 若 cordis_define 需要完整 function 源码，用 `function codeHost() { <以下函数体> }` 包裹；
// 若需要函数体，直接使用本文件内容。

// ---- 内联逻辑（来自 src/work-item-core.js）----
const BUG_CATEGORIES = new Set(['bug', 'defect', '缺陷'])
function mapRawIssue(issue, provider, externalId, baseUrl) {
  const watcher = issue.custom_fields?.find((cf) => cf.id === 41)?.value?.user?.firstname
  return {
    id: `${provider}:${externalId}`, provider, external_id: String(externalId),
    title: issue.subject, category: issue.tracker?.name ?? null,
    priority: issue.priority?.name ?? null, status: issue.status?.name ?? null,
    version: issue.fixed_version?.name ?? null, assignee: issue.assigned_to?.name ?? null,
    author: issue.author?.name ?? null, watcher: watcher ?? null,
    description: issue.description ?? null,
    attachments: (issue.attachments ?? []).map((a) => ({
      name: a.filename, url: a.content_url ?? null, local_path: null,
      ai_description: null, description_status: 'none',
    })),
    web_url: `${baseUrl}/issues/${issue.id}`, updated_at: issue.updated_on ?? null,
  }
}
function buildContext(wi) {
  const parts = [`工单 #${wi.external_id}: ${wi.title} [${wi.status ?? '未知'}]`]
  if (wi.category) parts.push(`分类: ${wi.category}`)
  if (wi.priority) parts.push(`优先级: ${wi.priority}`)
  if (wi.version) parts.push(`版本: ${wi.version}`)
  if (wi.assignee) parts.push(`指派: ${wi.assignee}`)
  if (wi.description) parts.push(`\n描述:\n${String(wi.description).slice(0, 2000)}`)
  const imgDescs = (wi.attachments ?? []).filter((a) => a.ai_description)
    .map((a) => `### ${a.name}\n${a.ai_description}`)
  if (imgDescs.length) parts.push(`\n## 附件图片描述\n\n${imgDescs.join('\n\n')}`)
  return parts.join('\n')
}
function filterItems(items, query) {
  const { search, tracker_kind } = query ?? {}
  let out = items
  if (search) out = out.filter((it) => (it.title ?? '').includes(search) || (it.description ?? '').includes(search))
  if (tracker_kind === 'bug') out = out.filter((it) => BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  if (tracker_kind === 'other') out = out.filter((it) => !BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  return [...out].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}

// ---- 内联逻辑（来自 src/work-item-provider.js 的 RedmineProvider）----
const DEFAULT_BASE = 'http://qn.pm.netease.com:8120'
const QUERIES = [
  'assigned_to_id=me&status_id=open', 'author_id=me&status_id=1', 'author_id=me&status_id=2',
]
const PROJECT_QUERIES = [
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=1',
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=2',
]
function buildRedmineProvider(config, fetchImpl) {
  const base = (config.baseUrl || DEFAULT_BASE).replace(/\/$/, '')
  return {
    id: 'redmine',
    buildQuerySet() {
      return [...QUERIES.map((q) => `issues.json?${q}`), ...PROJECT_QUERIES]
    },
    async fetchWithAuth(url) {
      return fetchImpl(url, { headers: { 'X-Redmine-API-Key': config.apiKey ?? '' } })
    },
    async fetchPage(endpoint, offset = 0) {
      const url = `${base}/${endpoint}&limit=100&offset=${offset}&include=attachments`
      const resp = await this.fetchWithAuth(url)
      if (!resp.ok) throw new Error(`Redmine API 返回 ${resp.status}`)
      return resp.json()
    },
    async listAssigned() {
      const seen = new Map()
      for (const endpoint of this.buildQuerySet()) {
        let offset = 0
        while (true) {
          const list = await this.fetchPage(endpoint, offset)
          const issues = list.issues ?? []
          for (const issue of issues) {
            const ext = String(issue.id)
            if (!seen.has(ext)) seen.set(ext, mapRawIssue(issue, 'redmine', ext, base))
          }
          offset += issues.length
          const total = list.total_count ?? offset
          if (issues.length === 0 || offset >= total) break
        }
      }
      const items = [...seen.values()]
      return { items, providerUserId: items.find((i) => i.assignee || i.author)?.assignee ?? null }
    },
    async getDetail(externalId) {
      const url = `${base}/issues/${externalId}.json?include=attachments,description`
      const resp = await this.fetchWithAuth(url)
      if (!resp.ok) throw new Error(`Redmine API 返回 ${resp.status}`)
      const { issue } = await resp.json()
      return mapRawIssue(issue, 'redmine', String(issue.id), base)
    },
    async downloadAttachment(att) {
      if (!att.url) return null
      try {
        const headers = (config.sessionCookie ?? '') ? { Cookie: config.sessionCookie } : {}
        const resp = await fetchImpl(att.url, { headers })
        if (!resp.ok) return null
        const bytes = new Uint8Array(await resp.arrayBuffer())
        if (bytes.length < 64) return null
        const safe = att.name.replace(/[/\\\0]/g, '')
        return { bytes, filename: safe }
      } catch { return null }
    },
    async testAuth() {
      try {
        const resp = await this.fetchWithAuth(`${base}/users/current.json`)
        return resp.ok ? { ok: true, message: 'ok' } : { ok: false, message: `Redmine API 返回 ${resp.status}` }
      } catch (e) { return { ok: false, message: String(e?.message ?? e) } }
    },
  }
}

// ---- 状态（进程内存）----
const state = {
  map: new Map(),
  config: {
    provider: 'redmine',
    redmine: { baseUrl: DEFAULT_BASE, apiKey: '', sessionCookie: '' },
    vision: { endpoint: '', model: '', apiKey: '' },
  },
  lastSyncAt: null, redmineUserId: null, configError: null,
}
let workItemDir = ''

// ---- 同步 / 附件 / 识图（fsApi 由 apply 传入，来源需 cordis_inspect 确认）----
async function syncWorkItems(fetchImpl, fsApi) {
  const cfg = state.config
  if (!cfg.redmine.apiKey) {
    state.configError = '请先配置 Redmine API Key'
    return { synced: 0, failed: 0, removed: 0, errors: [state.configError] }
  }
  const provider = buildRedmineProvider(cfg.redmine, fetchImpl)
  const { items } = await provider.listAssigned()
  for (const it of items) state.map.set(it.external_id, it)
  for (const it of items) await ensureAttachments(it, provider, fsApi)
  let removed = 0
  for (const ext of [...state.map.keys()]) {
    if (!items.some((i) => i.external_id === ext)) { state.map.delete(ext); removed++ }
  }
  state.lastSyncAt = Date.now()
  return { synced: items.length, failed: 0, removed, errors: [] }
}

async function ensureAttachments(item, provider, fsApi) {
  const dir = `${workItemDir}/${item.external_id}`
  await fsApi.mkdir(dir, { recursive: true })
  for (const att of item.attachments ?? []) {
    if (!att.local_path && att.url) {
      const dl = await provider.downloadAttachment(att)
      if (dl) {
        att.local_path = `${dir}/${dl.filename}`
        await fsApi.writeFile(att.local_path, dl.bytes)
      } else { att.description_status = 'error' }
    }
    if (att.local_path && att.description_status === 'none') {
      att.description_status = 'processing'
      try {
        att.ai_description = await describeImage(att.local_path, fsApi)
        att.description_status = 'done'
      } catch (e) {
        att.description_status = 'error'
        state.lastDescribeError = String(e?.message ?? e)
      }
    }
  }
}

async function describeImage(path, fsApi) {
  const v = state.config.vision
  if (!v.model || !v.apiKey) throw new Error('未配置视觉模型 endpoint/model/apiKey')
  const b64 = await readImageAsBase64(path, fsApi)
  // TODO(cordis_inspect): 视觉模型调用路径——DSH Host 是否有内部 LLM Service 可调，
  //   还是按用户配置的 endpoint/model/apiKey（OpenAI 兼容）。此处给出 OpenAI 兼容示例。
  const resp = await globalThis.fetch(v.endpoint || 'https://api.deepseek.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${v.apiKey}` },
    body: JSON.stringify({
      model: v.model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '描述这张工单截图的内容与关键需求点，中文，≤200字' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${b64}` } },
        ],
      }],
    }),
  })
  const data = await resp.json()
  return data?.choices?.[0]?.message?.content ?? '（未返回描述）'
}

async function readImageAsDataUrl(id, name, fsApi) {
  const buf = await fsApi.readFile(`${workItemDir}/${id}/${name}`)
  return `data:image/png;base64,${b64frombytes(buf)}`
}
async function readImageAsBase64(path, fsApi) {
  return b64frombytes(await fsApi.readFile(path))
}

return {
  inject: [], // 仅对硬依赖 Service 声明；其余用 ctx.get 判空
  apply(ctx) {
    // TODO(cordis_inspect): 临时目录来源（如 ctx.get('workdir') / 某 service），
    //   Session/Scoped 目录。这里先用进程临时目录兜底并标注。
    workItemDir = (ctx.get('workDir') || ctx.get('tmpdir')) ?? '.monai-work-items'
    const harness = ctx.get('harness') // TODO(cordis_inspect): harness 名称/API 以 Builtin.listBuiltins 为准
    if (harness === undefined) return
    const fsApi = { // TODO(cordis_inspect): 用 Service.listService 查真实 fs 能力；若 DSH Host 暴露 Node fs 则用之
      mkdir: (p, o) => globalThis.__dsh_fs?.mkdir?.(p, o) ?? Promise.resolve(),
      writeFile: (p, b) => globalThis.__dsh_fs?.writeFile?.(p, b) ?? Promise.resolve(),
      readFile: (p) => (globalThis.__dsh_fs?.readFile ? globalThis.__dsh_fs.readFile(p) : Promise.reject(new Error('fs 未确认'))),
    }
    const fetchImpl = globalThis.fetch // TODO(cordis_inspect): 若 Host 无全局 fetch，改用 Service.listService 中的网络能力

    // 动态 Tool（模型按需）：签名/schema 以 Tool.listTools 为准
    const toolSchema = { type: 'object', properties: { search: { type: 'string' }, tracker_kind: { type: 'string' } } }
    harness.registerTool('list_work_items', toolSchema, async (args = {}) => {
      const items = filterItems([...state.map.values()], args)
      return JSON.stringify(items.map((i) => `${i.external_id}: ${i.title} [${i.status}]`))
    })
    harness.registerTool('get_work_item_detail', { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] }, async (args) => {
      const it = state.map.get(String(args?.id))
      return it ? buildContext(it) : `未找到工单 #${args?.id}`
    })
    harness.registerTool('sync_work_items', { type: 'object', properties: {} }, async () => {
      const r = await syncWorkItems(fetchImpl, fsApi)
      return `同步完成：拉取 ${r.synced}，失败 ${r.failed}，清理 ${r.removed}`
    })

    // handle（Client 读）
    harness.handle('wi:list', async (q) => filterItems([...state.map.values()], q))
    harness.handle('wi:get', async (id) => state.map.get(String(id)) ?? null)
    harness.handle('wi:sync', async () => syncWorkItems(fetchImpl, fsApi))
    harness.handle('wi:image', async (id, name) => {
      try { return await readImageAsDataUrl(id, name, fsApi) } catch { return null }
    })
  },
}

function b64frombytes(bytes) {
  // 浏览器/宿主环境可能无 Buffer，用 btoa 兜底；Node 用 Buffer。
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
