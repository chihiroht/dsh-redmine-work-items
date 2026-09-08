// lib/index.js — @chihiroht/dsh-redmine-work-items Host plugin (dsh-prompt-persona pattern).
// Registers the issue-tracker settings namespace, mounts same-origin HTTP routes
// (settings + work-items), and registers model tools backed by the same backend.

import { SETTINGS_NAMESPACE, Config, resolveConfig } from './config.js'
import { IssueTrackerBackend, registerIssueTrackerRoutes } from './web.js'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = '@chihiroht/dsh-redmine-work-items'
export const inject = ['settings', 'tools']

function buildContext(wi) {
  const parts = [`工单 #${wi.external_id}: ${wi.title} [${wi.status ?? '未知'}]`]
  if (wi.category) parts.push(`分类: ${wi.category}`)
  if (wi.priority) parts.push(`优先级: ${wi.priority}`)
  if (wi.version) parts.push(`版本: ${wi.version}`)
  if (wi.assignee) parts.push(`指派: ${wi.assignee}`)
  if (wi.description) parts.push(`\n描述:\n${String(wi.description).slice(0, 2000)}`)
  const imgDescs = (wi.attachments ?? []).filter(a => a.ai_description).map(a => `### ${a.name}\n${a.ai_description}`)
  if (imgDescs.length) parts.push(`\n## 附件图片描述\n\n${imgDescs.join('\n\n')}`)
  return parts.join('\n')
}

function buildItemsText(items) {
  return items.length ? items.map(i => `${i.external_id}: ${i.title} [${i.status}]`).join('\n')
    : '（暂无工单，先调用 sync_work_items 同步）'
}

export function apply(ctx, config = {}) {
  ctx.settings.register(SETTINGS_NAMESPACE, Config, {
    base: config,
    applies: 'live',
    validate: (value) => { resolveConfig(value) },
  })

  const backend = new IssueTrackerBackend(ctx)
  registerIssueTrackerRoutes(ctx, backend)

  const tools = ctx.tools
  tools.register(defineTool({
    name: 'list_work_items',
    description: '列出已同步的「指派给我的工单」。参数 tracker_kind=bug|other 可过滤 Bug/其它。',
    parameters: {
      search: { type: 'string', description: '按标题/描述子串过滤' },
      tracker_kind: { type: 'string', description: 'bug 或 other，可选' },
    },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) { return buildItemsText(backend.list(args ?? {})) },
  }))
  tools.register(defineTool({
    name: 'get_work_item_detail',
    description: '取单个工单详情（含描述与附件/识图描述）。',
    parameters: { id: { type: 'string', required: true, description: '工单 external_id' } },
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute(args) {
      const it = backend.map.get(String(args?.id))
      return it ? buildContext(it) : `未找到工单 #${args?.id}`
    },
  }))
  tools.register(defineTool({
    name: 'sync_work_items',
    description: '从 Redmine 同步「指派给我的工单」到内存。',
    parameters: {},
    output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: String(value) }] },
    async execute() {
      const r = await backend.sync()
      const base = `同步完成：拉取 ${r.synced}，失败 ${r.failed}，清理 ${r.removed}`
      return r.errors && r.errors.length ? `${base}（${r.errors[0]}）` : base
    },
  }))

  // 自动同步：开启时按 syncIntervalMin 定期拉取。
  ctx.effect(() => {
    const timer = setInterval(async () => {
      try {
        const s = resolveConfig(ctx.settings.get(SETTINGS_NAMESPACE))
        if (s.autoSync && Date.now() - (backend.lastSyncAt || 0) > s.syncIntervalMin * 60 * 1000) {
          await backend.sync()
        }
      } catch { /* 静默 */ }
    }, 60000)
    return () => clearInterval(timer)
  }, 'issue-tracker: auto-sync')
}
