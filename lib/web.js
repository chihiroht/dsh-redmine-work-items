// lib/web.js — host HTTP routes for @chihiroht/dsh-redmine-work-items.
// Settings (/_dsh/issue-tracker/settings) + work-items (/_dsh/issue-tracker/work-items).

import { exec } from 'node:child_process'
import { DEFAULT_BASE, SETTINGS_NAMESPACE, resolveConfig, snapshotOf } from './config.js'

const QUERIES = [
  'assigned_to_id=me&status_id=open',
  'author_id=me&status_id=1',
  'author_id=me&status_id=2',
]
const PROJECT_QUERIES = [
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=1',
  'projects/redmine-system-builder/issues.json?cf_41=me&status_id=2',
]
const QUERY_SET = [...QUERIES.map(q => `issues.json?${q}`), ...PROJECT_QUERIES]
const BUG_CATEGORIES = new Set(['bug', 'defect', '缺陷'])

function stripHtml(html) {
  return String(html || '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/div>/gi, '\n')
    .replace(/<div[^>]*>/gi, '')
    .replace(/<\/li>/gi, '\n')
    .replace(/<li[^>]*>/gi, '· ')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<h[1-6][^>]*>/gi, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/<[^>]+>/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function mapRawIssue(issue, provider, externalId, baseUrl) {
  const watcher = issue.custom_fields?.find(cf => cf.id === 41)?.value?.user?.firstname
  return {
    id: `${provider}:${externalId}`, provider, external_id: String(externalId),
    title: issue.subject, category: issue.tracker?.name ?? null,
    priority: issue.priority?.name ?? null, status: issue.status?.name ?? null,
    version: issue.fixed_version?.name ?? null, assignee: issue.assigned_to?.name ?? null,
    author: issue.author?.name ?? null, watcher: watcher ?? null,
    description: issue.description != null ? stripHtml(issue.description) : null,
    attachments: (issue.attachments ?? []).map(a => ({ name: a.filename, url: a.content_url ?? (a.id && a.filename ? `/attachments/download/${a.id}/${encodeURIComponent(a.filename)}` : null), local_path: null, ai_description: null, description_status: 'none' })),
    web_url: `${baseUrl}/issues/${issue.id}`, updated_at: issue.updated_on ?? null,
  }
}

function filterItems(items, query) {
  const { search, tracker_kind, owner } = query ?? {}
  let out = items
  if (search) out = out.filter(it => (it.title ?? '').includes(search) || (it.description ?? '').includes(search))
  if (tracker_kind === 'bug') out = out.filter(it => BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  if (tracker_kind === 'other') out = out.filter(it => !BUG_CATEGORIES.has(String(it.category ?? '').toLowerCase()))
  return [...out].sort((a, b) => String(b.updated_at ?? '').localeCompare(String(a.updated_at ?? '')))
}

async function readBody(req, maxBytes = 256 * 1024) {
  const chunks = []
  let bytes = 0
  for await (const chunk of req) {
    const part = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += part.length
    if (bytes > maxBytes) throw new RangeError('request body too large')
    chunks.push(part)
  }
  return chunks.length ? Buffer.concat(chunks).toString('utf8') : ''
}

export class IssueTrackerBackend {
  constructor(ctx) {
    this.ctx = ctx
    this.map = new Map()
    this.lastSyncAt = null
    this.currentUser = null
  }

  cfg() {
    const s = this.ctx.settings.get(SETTINGS_NAMESPACE) ?? {}
    const red = s.redmine ?? {}
    return { baseUrl: (red.baseUrl || DEFAULT_BASE).replace(/\/$/, ''), apiKey: red.apiKey || '' }
  }

  withKey(url) { const key = this.cfg().apiKey; return `${url}${url.includes('?') ? '&' : '?'}key=${encodeURIComponent(key)}` }

  curl(command) {
    return new Promise((resolve, reject) => {
      exec(command, { timeout: 30000, maxBuffer: 8 * 1024 * 1024 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`curl 退出码 ${err.code ?? err.message}: ${String(stderr || '').slice(0, 200)}`))
        else resolve(String(stdout))
      })
    })
  }

  curlBuffer(command) {
    return new Promise((resolve, reject) => {
      exec(command, { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(`curl 退出码 ${err.code ?? err.message}: ${String(stderr || '').slice(0, 200)}`))
        else resolve(Buffer.from(stdout))
      })
    })
  }

  async webGetJson(url) {
    const body = await this.curl(`curl -sfS -m 30 "${url}"`)
    try { return JSON.parse(body) } catch { throw new Error(`Redmine 返回非 JSON: ${String(body).slice(0, 200)}`) }
  }

  pageUrl(endpoint, offset) { const c = this.cfg(); const joined = `${endpoint}${endpoint.includes('?') ? '&' : '?'}limit=100&offset=${offset}&include=attachments`; return this.withKey(`${c.baseUrl}/${joined}`) }

  async fetchCurrentUser() {
    try {
      const data = await this.webGetJson(this.withKey(`${this.cfg().baseUrl}/users/current.json`))
      const u = data.user ?? {}
      return { id: u.id ?? null, name: u.firstname || u.login || (u.lastname || '') }
    } catch { return null }
  }

  async sync() {
    const c = this.cfg()
    if (!c.apiKey) return { synced: 0, failed: 0, removed: 0, errors: ['请先配置 Redmine API Key'] }
    try { this.currentUser = await this.fetchCurrentUser() } catch {}
    const seen = new Map()
    for (const endpoint of QUERY_SET) {
      let offset = 0
      while (true) {
        const data = await this.webGetJson(this.pageUrl(endpoint, offset))
        for (const issue of data.issues ?? []) {
          const ext = String(issue.id)
          if (!seen.has(ext)) seen.set(ext, mapRawIssue(issue, 'redmine', ext, c.baseUrl))
        }
        offset += (data.issues ?? []).length
        if ((data.issues ?? []).length === 0 || offset >= (data.total_count ?? 0)) break
      }
    }
    const items = [...seen.values()]
    // 列表 API 的附件字段为空，需拉每个工单 detail（include=attachments）拿真实附件（限并发 8）
    const m = this.cfg().baseUrl
    for (let i = 0; i < items.length; i += 8) {
      await Promise.all(items.slice(i, i + 8).map(async (it) => {
        try {
          const data = await this.webGetJson(this.withKey(`${m}/issues/${it.external_id}.json?include=attachments`))
          const issue = data.issue
          it.attachments = (issue.attachments ?? []).map(a => ({ name: a.filename, url: a.content_url ?? (a.id && a.filename ? `/attachments/download/${a.id}/${encodeURIComponent(a.filename)}` : null), local_path: null, ai_description: null, description_status: 'none' }))
          if (issue.description != null) it.description = stripHtml(issue.description)
        } catch { /* 保留列表数据 */ }
      }))
    }
    for (const it of items) this.map.set(it.external_id, it)
    let removed = 0
    for (const ext of [...this.map.keys()]) if (!items.some(i => i.external_id === ext)) { this.map.delete(ext); removed++ }
    this.lastSyncAt = Date.now()
    return { synced: items.length, failed: 0, removed, errors: [] }
  }

  list(query) { return filterItems([...this.map.values()], query ?? {}) }

  /** owner buckets: assigned-to-me / created-by-me / follow-up-qa (cf_41 watcher) */
  ownerOf(it, me) {
    const n = me?.name
    if (!n) return 'other'
    if (it.assignee === n) return 'assigned'
    if (it.author === n) return 'created'
    if (it.watcher === n) return 'follow'
    return 'other'
  }

  ownerCounts() {
    const me = this.currentUser
    const counts = { assigned: 0, created: 0, follow: 0, other: 0 }
    for (const it of this.map.values()) counts[this.ownerOf(it, me)]++
    return counts
  }

  filterByOwner(items, owner, me) {
    if (!owner || owner === 'all') return items
    return items.filter(it => this.ownerOf(it, me) === owner)
  }

  async settingsSnapshot() {
    const value = this.ctx.settings.get(SETTINGS_NAMESPACE)
    const descriptor = (this.ctx.settings.describe() ?? []).find(row => row.ns === SETTINGS_NAMESPACE)
    return { settings: { value: snapshotOf(value), revision: descriptor?.revision ?? 0, applies: descriptor?.applies ?? 'live' } }
  }

  async saveSettings(patch, expectedRevision) {
    if (!this.ctx.settings.writable) throw new Error('settings provider is read-only')
    const cur = resolveConfig(this.ctx.settings.get(SETTINGS_NAMESPACE))
    const next = resolveConfig({
      redmine: { baseUrl: patch?.baseUrl ?? cur.redmine.baseUrl, apiKey: patch?.apiKey ?? cur.redmine.apiKey },
      autoSync: patch?.autoSync,
      syncIntervalMin: patch?.syncIntervalMin,
    })
    await this.ctx.settings.replace(SETTINGS_NAMESPACE, next, expectedRevision)
    return this.settingsSnapshot()
  }

  async testRedmine(patch) {
    const cur = this.cfg()
    const apiKey = patch?.apiKey || cur.apiKey
    const baseUrl = (patch?.baseUrl || cur.baseUrl).replace(/\/$/, '')
    if (apiKey) {
      try {
        const data = await this.webGetJson(`${baseUrl}/users/current.json?key=${encodeURIComponent(apiKey)}`)
        return { ok: true, message: `ok：${data.user?.firstname || data.user?.login || '已认证'}` }
      } catch (e) { return { ok: false, message: String(e?.message ?? e) } }
    }
    return { ok: false, message: '未提供 API 访问键' }
  }

  responseJson(res, status, body) {
    const bytes = Buffer.from(JSON.stringify(body))
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader('Cache-Control', 'no-store')
    res.writeHead(status)
    res.end(bytes)
  }

  async handleSettings(req, res) {
    try {
      if (req.method === 'GET') return this.responseJson(res, 200, { ok: true, value: await this.settingsSnapshot() })
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return this.responseJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Use GET or POST' } }) }
      const body = JSON.parse(await readBody(req) || '{}')
      if (body?.action === 'save') {
        if (!Number.isSafeInteger(body.expectedRevision)) throw new Error('expectedRevision must be a non-negative integer')
        return this.responseJson(res, 200, { ok: true, value: await this.saveSettings(body, body.expectedRevision) })
      }
      if (body?.action === 'test') {
        return this.responseJson(res, 200, { ok: true, value: await this.testRedmine(body) })
      }
      return this.responseJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'unsupported action' } })
    } catch (error) {
      const conflict = error?.code === 'SETTINGS_CONFLICT'
      return this.responseJson(res, conflict ? 409 : 400, { ok: false, error: { code: conflict ? 'settings-conflict' : 'rejected', message: String(error?.message ?? error) } })
    }
  }

  async handleWorkItems(req, res) {
    try {
      if (req.method === 'GET') {
        const url = new URL(req.url ?? '/', 'http://x')
        const query = Object.fromEntries(url.searchParams)
        const items = this.filterByOwner(this.list(query), query.owner, this.currentUser)
        return this.responseJson(res, 200, { ok: true, value: { items, currentUser: this.currentUser, counts: this.ownerCounts() } })
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'GET, POST'); return this.responseJson(res, 405, { ok: false, error: { code: 'method-not-allowed', message: 'Use GET or POST' } }) }
      const body = JSON.parse(await readBody(req) || '{}')
      if (body?.action === 'sync') return this.responseJson(res, 200, { ok: true, value: await this.sync() })
      return this.responseJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'unsupported action' } })
    } catch (error) {
      return this.responseJson(res, 400, { ok: false, error: { code: 'rejected', message: String(error?.message ?? error) } })
    }
  }
  async handleAttachment(req, res) {
    try {
      const url = new URL(req.url ?? '/', 'http://x')
      const rel = url.searchParams.get('url')
      if (!rel) return this.responseJson(res, 400, { ok: false, error: { code: 'invalid-request', message: 'missing url' } })
      const c = this.cfg()
      const target = /^https?:\/\//.test(rel) ? rel : `${c.baseUrl}${rel.startsWith('/') ? '' : '/'}${rel}`
      const full = this.withKey(target)
      const buf = await this.curlBuffer(`curl -sfSL -m 30 "${full}"`)
      const ext = (rel.split('.').pop() || 'png').toLowerCase()
      const ct = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'gif' ? 'image/gif' : ext === 'webp' ? 'image/webp' : 'image/png'
      res.setHeader('Content-Type', ct)
      res.setHeader('Cache-Control', 'no-store')
      res.writeHead(200)
      res.end(buf)
    } catch (error) {
      return this.responseJson(res, 400, { ok: false, error: { code: 'rejected', message: String(error?.message ?? error) } })
    }
  }
}

export function registerIssueTrackerRoutes(ctx, backend) {
  ctx.inject(['webServer'], (webCtx) => {
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/_dsh/issue-tracker/settings', handler: backend.handleSettings.bind(backend) }), 'issue-tracker: settings route')
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/_dsh/issue-tracker/work-items', handler: backend.handleWorkItems.bind(backend) }), 'issue-tracker: work-items route')
    webCtx.effect(() => webCtx.webServer.register({ kind: 'exact', path: '/_dsh/issue-tracker/attachment', handler: backend.handleAttachment.bind(backend) }), 'issue-tracker: attachment route')
  })
}
