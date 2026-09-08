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
