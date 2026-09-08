// src/work-item-plugin.host.js
// 作为 code.host 传给 cordis_define 的 plain JS 函数体（无 import / require / TS / JSX）。
//
// ⚠️ 已按 @deepseek-ai/dsh-cordis-host-runner / dsh-cordis-client-runner 源码校准。cordis 沙箱事实：
//   1. host 半在 node:vm 沙箱求值：无 require / import / fetch / Buffer。
//      网络走 ctx.web、文件走 ctx.fs、进程走 ctx.bash；base64 用全局 btoa/atob/TextEncoder。
//   2. ctx.web.fetch({ url }, signal)：仅支持 GET、不能带 header，返回
//      { url, statusCode, body:{ kind:'html'|'text', content }, truncated }。
//      → Redmine 认证用 `?key=` 查询参数；JSON 用 JSON.parse(body.content)。
//   3. harness.defineTool({ name, description, parameters, output:{ schema, render }, execute })
//      产出工具，harness.registerTool(ctx, tool)（或 ctx.tools.register）注册；
//      output.render 必须返回 [{ type:'text', text: String(value) }]。
//   4. harness.handle(method, (args) => value) 注册 Client→Host RPC，结果经 JSON 往返。
//   5. 服务需在 plugins 的 inject 声明（['tools','fs','web']），apply 里用 ctx.web / ctx.fs；
//      ctx.tools 恒可用。
//
// 沙箱限制（本版如实处理，不阻塞核心功能）：
//   - 视觉识图需要 POST + Authorization header，ctx.web 仅支持 GET → describeImage 记录
//     description_status='skipped' 并在 lastDescribeError 说明原因（若 DSH 后续提供 web-POST
//     或 bash/curl 通道，可在此接入）。
//   - 附件二进制下载：ctx.web 的 WebFetchBody 仅 text/html 且不能带 Cookie header，
//     二进制可能被解码损坏 → 保留元数据 + best-effort，失败不报错。
//
// 纯逻辑（mapRawIssue / buildContext / filterItems / 分页）与 src/work-item-core.js、
// src/work-item-provider.js 保持同段；但传输层在此适配 ctx.web（provider.js 是 fetch-Response
// 传输，仅用于纯逻辑单测与 verify-provider.mjs）。改动时须同步这三处。

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
  const imgDescs = (wi.attachments ?? [])
    .filter((a) => a.ai_description)
    .map((a) => `### ${a.name}\n${a.ai_description}`)
  if (imgDescs.length) parts.push(`\n## 附件图片描述\n\n${imgDescs.join('\n\n')}`)
  return parts.join('\n')
}

function filterItems(items, query) {
  const { search, tracker_kind } = query ?? {}
  let out = items
  if (search) out = out.filter((it) =>
    (it.title ?? '').includes(search) || (it.description ?? '').includes(search))
  if (tracker_kind === 'bug') out = out.filter((it) => BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  if (tracker_kind === 'other') out = out.filter((it) => !BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  return [...out].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}

// ---- 与 provider.js 同段的查询集 ----
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
const QUERY_SET = [...QUERIES.map((q) => `issues.json?${q}`), ...PROJECT_QUERIES]

return {
  name: 'monai-work-items',
  inject: ['tools', 'fs', 'web'],
  apply(ctx, config) {
    const state = {
      map: new Map(),
      config: Object.assign({
        provider: 'redmine',
        redmine: { baseUrl: DEFAULT_BASE, apiKey: '', sessionCookie: '' },
        vision: { endpoint: '', model: '', apiKey: '' },
      }, config ?? {}),
      lastSyncAt: null,
      lastDescribeError: null,
    }

    function cfg() {
      const red = state.config.redmine || {}
      return { baseUrl: (red.baseUrl || DEFAULT_BASE).replace(/\/$/, ''), apiKey: red.apiKey || '' }
    }

    // ---- ctx.web 适配（GET + ?key 认证 + JSON.parse）----
    function withKey(url) {
      const key = cfg().apiKey
      return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}`
    }
    async function webGetJson(url, signal) {
      const res = await ctx.web.fetch({ url }, signal)
      if (res.statusCode >= 400) throw new Error(`Redmine API 返回 ${res.statusCode}`)
      return JSON.parse(res.body.content)
    }
    function pageUrl(endpoint, offset) {
      const c = cfg()
      const joined = `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=100&offset=${offset}&include=attachments`
      return withKey(`${c.baseUrl}/${joined}`)
    }

    // ---- provider（ctx.web 传输版）----
    function makeProvider(signal) {
      return {
        id: 'redmine',
        buildQuerySet: () => QUERY_SET,
        async fetchPage(endpoint, offset) {
          const data = await webGetJson(pageUrl(endpoint, offset), signal)
          return { issues: data.issues ?? [], total_count: data.total_count ?? 0 }
        },
        async listAssigned() {
          const seen = new Map()
          for (const endpoint of this.buildQuerySet()) {
            let offset = 0
            while (true) {
              const list = await this.fetchPage(endpoint, offset)
              for (const issue of list.issues) {
                const ext = String(issue.id)
                if (!seen.has(ext)) seen.set(ext, mapRawIssue(issue, 'redmine', ext, cfg().baseUrl))
              }
              offset += list.issues.length
              if (list.issues.length === 0 || offset >= list.total_count) break
            }
          }
          const items = [...seen.values()]
          return { items, providerUserId: items.find((i) => i.assignee || i.author)?.assignee ?? null }
        },
        async getDetail(externalId) {
          const c = cfg()
          const data = await webGetJson(withKey(`${c.baseUrl}/issues/${externalId}.json?include=attachments,description`), signal)
          return mapRawIssue(data.issue, 'redmine', String(data.issue.id), c.baseUrl)
        },
        async downloadAttachment(att) {
          // 注：ctx.web 无 header 且仅 text/html body；二进制可能损坏 → best-effort。
          if (!att.url) return null
          try {
            const res = await ctx.web.fetch({ url: withKey(att.url) }, signal)
            if (res.statusCode >= 400) return null
            const text = res.body.content
            if (!text || text.length < 64) return null
            return { bytes: textToBytes(text), filename: safeName(att.name) }
          } catch { return null }
        },
        async testAuth() {
          try { await webGetJson(withKey(`${cfg().baseUrl}/users/current.json`), signal); return { ok: true, message: 'ok' } }
          catch (e) { return { ok: false, message: String(e?.message ?? e) } }
        },
      }
    }

    // ---- 同步 + 附件 + 识图（识图在沙箱内无法 POST，如实跳过）----
    async function syncWorkItems(signal) {
      if (!cfg().apiKey) return { synced: 0, failed: 0, removed: 0, errors: ['请先配置 Redmine API Key'] }
      const provider = makeProvider(signal)
      const { items } = await provider.listAssigned()
      for (const it of items) {
        state.map.set(it.external_id, it)
        await runAttachmentStep(it, provider, signal)
      }
      let removed = 0
      for (const ext of [...state.map.keys()]) {
        if (!items.some((i) => i.external_id === ext)) { state.map.delete(ext); removed++ }
      }
      state.lastSyncAt = Date.now()
      return { synced: items.length, failed: 0, removed, errors: [] }
    }

    async function runAttachmentStep(item, provider, signal) {
      for (const att of item.attachments ?? []) {
        if (!att.local_path && att.url) {
          const dl = await provider.downloadAttachment(att)
          if (dl) {
            try {
              await writeBytes(item.external_id, dl.filename, dl.bytes, signal)
              att.local_path = `${item.external_id}/${dl.filename}`
            } catch { att.description_status = 'error' }
          } else {
            att.description_status = 'skipped' // 下载失败/受限
          }
        }
        if (att.local_path && att.description_status === 'none') {
          const ok = await describeImage(att.local_path, signal)
          att.description_status = ok ? 'done' : 'skipped'
        }
      }
    }

    async function writeBytes(ext, name, bytes, signal) {
      const target = await ctx.fs.resolve(`.monai-work-items/${ext}/${name}`, { signal })
      if (typeof ctx.fs.writeBytes === 'function') await ctx.fs.writeBytes(target, bytes, undefined, signal)
      else await ctx.fs.writeText(target, textFromBytes(bytes), undefined, signal)
    }

    async function describeImage(path, signal) {
      const v = state.config.vision || {}
      if (!v.model || !v.apiKey) return null
      // ctx.web 仅支持 GET + 无 header，无法 POST OpenAI 兼容视觉接口。
      state.lastDescribeError = '视觉识图需 POST + Authorization（ctx.web 仅支持 GET 且无 header）；本版跳过识图。'
      return null
    }

    async function readImageAsDataUrl(ext, name, signal) {
      const target = await ctx.fs.resolve(`.monai-work-items/${ext}/${name}`, { signal })
      const bytes = await ctx.fs.readBytes(target, signal)
      return `data:image/png;base64,${btoa(binaryString(bytes))}`
    }

    // ---- 动态 Tool ----
    function makeTool(spec) {
      const tool = harness.defineTool(spec)
      harness.registerTool(ctx, tool)
    }
    makeTool({
      name: 'list_work_items',
      description: '列出已同步的「指派给我的工单」。参数 tracker_kind=bug|other 可过滤 Bug/其它。',
      parameters: {
        search: { type: 'string', description: '按标题/描述子串过滤' },
        tracker_kind: { type: 'string', description: 'bug 或 other，可选' },
      },
      output: { schema: { type: 'string' }, render: (args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args) {
        const items = filterItems([...state.map.values()], args)
        return items.length ? items.map((i) => `${i.external_id}: ${i.title} [${i.status}]`).join('\n')
          : '（暂无工单，先调用 sync_work_items 同步）'
      },
    })
    makeTool({
      name: 'get_work_item_detail',
      description: '取单个工单详情（含描述与附件/识图描述）。',
      parameters: { id: { type: 'string', required: true, description: '工单 external_id' } },
      output: { schema: { type: 'string' }, render: (args, value) => [{ type: 'text', text: String(value) }] },
      async execute(args) {
        const it = state.map.get(String(args?.id))
        return it ? buildContext(it) : `未找到工单 #${args?.id}`
      },
    })
    makeTool({
      name: 'sync_work_items',
      description: '从 Redmine 同步「指派给我的工单」到内存，并尝试附件/识图。',
      parameters: {},
      output: { schema: { type: 'string' }, render: (args, value) => [{ type: 'text', text: String(value) }] },
      async execute() {
        const r = await syncWorkItems()
        const base = `同步完成：拉取 ${r.synced}，失败 ${r.failed}，清理 ${r.removed}`
        return r.errors && r.errors.length ? `${base}（${r.errors[0]}）` : base
      },
    })

    // ---- Client→Host RPC ----
    harness.handle('wi:list', async (args) => filterItems([...state.map.values()], args ?? {}))
    harness.handle('wi:get', async (id) => state.map.get(String(id)) ?? null)
    harness.handle('wi:sync', async () => syncWorkItems())
    harness.handle('wi:image', async (ext, name) => {
      try { return await readImageAsDataUrl(ext, name) } catch { return null }
    })
    harness.handle('wi:config', async (patch) => {
      if (patch && typeof patch === 'object') {
        if (patch.redmine) Object.assign(state.config.redmine, patch.redmine)
        if (patch.vision) Object.assign(state.config.vision, patch.vision)
      }
      return {
        redmine: { ...state.config.redmine, apiKey: maskKey(state.config.redmine.apiKey) },
        vision: { ...state.config.vision, apiKey: maskKey(state.config.vision.apiKey) },
      }
    })
  },
}

// ---- 工具/helper（宿主层）----
function maskKey(k) { return k ? `${String(k).slice(0, 5)}…` : '' }
function safeName(n) { return String(n).replace(/[/\\\0]/g, '') }
function binaryString(bytes) {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return s
}
function textToBytes(text) {
  const arr = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) arr[i] = text.charCodeAt(i) & 0xff
  return arr
}
function textFromBytes(bytes) { return binaryString(bytes) }
