// test/work-item-core.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapRedmineIssue, buildWorkItemContext, filterWorkItems } from '../src/work-item-core.js'

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

test('filterWorkItems bug/other 过滤与 search', () => {
  const items = [
    { external_id: '1', category: '缺陷', title: '登录bug', description: 'x', updated_at: '2026-01-01' },
    { external_id: '2', category: '功能', title: '改需求', description: 'y', updated_at: '2026-02-01' },
    { external_id: '3', category: 'Bug', title: '崩溃', description: 'z', updated_at: '2026-03-01' },
  ]
  const bug = filterWorkItems(items, { tracker_kind: 'bug' })
  assert.deepEqual(bug.map((i) => i.external_id), ['3', '1'])
  const other = filterWorkItems(items, { tracker_kind: 'other' })
  assert.deepEqual(other.map((i) => i.external_id), ['2'])
  const searched = filterWorkItems(items, { search: '登录' })
  assert.equal(searched.length, 1)
})
