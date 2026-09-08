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
    if (fetchImpl === undefined) throw new Error('RedmineProvider 需要 fetch 实现')
    this.id = 'redmine'
    this.baseUrl = (config.baseUrl || DEFAULT_BASE).replace(/\/$/, '')
    this.apiKey = config.apiKey ?? ''
    this.sessionCookie = config.sessionCookie ?? ''
    this.fetch = fetchImpl
  }
  buildQuerySet() {
    return [...QUERIES.map((q) => `issues.json?${q}`), ...PROJECT_QUERIES]
  }
  async fetchWithAuth(url) {
    return this.fetch(url, { headers: { 'X-Redmine-API-Key': this.apiKey } })
  }
  async fetchPage(endpoint, offset = 0) {
    const url = `${this.baseUrl}/${endpoint}&limit=100&offset=${offset}&include=attachments`
    const resp = await this.fetchWithAuth(url)
    if (!resp.ok) throw new Error(`Redmine API 返回 ${resp.status}`)
    return resp.json()
  }
  async listAssigned() {
    const seen = new Map()
    for (const endpoint of this.buildQuerySet()) {
      let offset = 0
      while (true) {
        const list = await this.fetchPage(endpoint, offset)
        const issues = list.issues ?? []
        for (const issue of issues) {
          const ext = String(issue.id)
          if (!seen.has(ext)) seen.set(ext, mapRaw(issue, 'redmine', ext, this.baseUrl))
        }
        offset += issues.length
        const total = list.total_count ?? offset
        if (issues.length === 0 || offset >= total) break
      }
    }
    const items = [...seen.values()]
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
      const headers = this.sessionCookie ? { Cookie: this.sessionCookie } : {}
      const resp = await this.fetch(att.url, { headers })
      if (!resp.ok) return null
      const buf = Buffer.from(await resp.arrayBuffer())
      if (buf.length < 64) return null
      const safe = att.name.replace(/[/\\\0]/g, '')
      return { bytes: buf, filename: safe }
    } catch {
      return null
    }
  }
  async testAuth() {
    try {
      const resp = await this.fetchWithAuth(`${this.baseUrl}/users/current.json`)
      return resp.ok
        ? { ok: true, message: 'ok' }
        : { ok: false, message: `Redmine API 返回 ${resp.status}` }
    } catch (e) {
      return { ok: false, message: String(e?.message ?? e) }
    }
  }
}

// 与 work-item-core 的 mapRedmineIssue 保持同段逻辑（内联副本）
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
    attachments: (issue.attachments ?? []).map((a) => ({
      name: a.filename, url: a.content_url ?? null, local_path: null,
      ai_description: null, description_status: 'none',
    })),
    web_url: `${baseUrl}/issues/${issue.id}`, updated_at: issue.updated_on ?? null,
  }
}
