// test/work-item-provider.test.mjs
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { RedmineProvider } from '../src/work-item-provider.js'

function makeFetch(pages) {
  const calls = []
  const fn = async (url, opts = {}) => {
    calls.push({ url, opts })
    const page = pages.shift() || { status: 200, ok: true, json: async () => ({ issues: [], total_count: 0 }) }
    if (!page.ok) return { status: page.status, ok: false, text: async () => page.body }
    return { status: 200, ok: true, json: async () => page.json }
  }
  fn.calls = calls
  return fn
}

test('listAssigned 用多 query 拉取并聚合去重', async () => {
  const issue = { id: 456, subject: '登录bug', tracker: { name: '缺陷' }, status: { name: '新建' }, assigned_to: { name: '张三' }, author: { name: '李四' } }
  const fetchImpl = makeFetch([{ ok: true, json: { issues: [issue], total_count: 1 } }])
  const p = new RedmineProvider({ baseUrl: 'http://x', apiKey: 'KEY' }, fetchImpl)
  const { items } = await p.listAssigned()
  assert.ok(items.length >= 1)
  assert.equal(items[0].external_id, '456')
  assert.ok(fetchImpl.calls.length >= 1)
  assert.ok(fetchImpl.calls[0].opts.headers['X-Redmine-API-Key'] === 'KEY')
})

test('buildQuerySet 覆盖 assigned_to_me / author / cf_41', () => {
  const p = new RedmineProvider({ baseUrl: 'x', apiKey: 'k' })
  const qs = p.buildQuerySet()
  assert.ok(qs.some((q) => q.includes('assigned_to_id=me')))
  assert.ok(qs.some((q) => q.includes('cf_41=me')))
  assert.ok(qs.some((q) => q.includes('author_id=me')))
})

test('testAuth 非成功返回错误信息', async () => {
  const fetchImpl = makeFetch([{ ok: false, status: 401, body: 'Unauthorized' }])
  const p = new RedmineProvider({ baseUrl: 'x', apiKey: 'bad' }, fetchImpl)
  const r = await p.testAuth()
  assert.equal(r.ok, false)
  assert.match(r.message, /401/i)
})

test('getDetail 返回单条工单摘要字段', async () => {
  const fetchImpl = makeFetch([{ ok: true, json: { issue: { id: 9, subject: 'bug', tracker: { name: '缺陷' }, status: { name: '新建' } } } }])
  const p = new RedmineProvider({ baseUrl: 'http://x', apiKey: 'KEY' }, fetchImpl)
  const it = await p.getDetail('9')
  assert.equal(it.external_id, '9')
  assert.equal(it.category, '缺陷')
})

test('listAssigned 循环翻页直到 total（去重聚合）', async () => {
  const empty = { ok: true, json: { issues: [], total_count: 0 } }
  const pg1 = { ok: true, json: { issues: [
    { id: 1, subject: 'a', tracker: { name: '缺陷' } },
    { id: 2, subject: 'b', tracker: { name: '缺陷' } },
  ], total_count: 4 } }
  const pg2 = { ok: true, json: { issues: [
    { id: 3, subject: 'c', tracker: { name: '缺陷' } },
    { id: 4, subject: 'd', tracker: { name: '缺陷' } },
  ], total_count: 4 } }
  const fetchImpl = makeFetch([pg1, pg2, empty, empty, empty, empty])
  const p = new RedmineProvider({ baseUrl: 'http://x', apiKey: 'KEY' }, fetchImpl)
  const { items } = await p.listAssigned()
  assert.equal(fetchImpl.calls.length, 6) // 第1个 endpoint 翻2页 + 其余4个 endpoint 各1页
  assert.equal(items.length, 4)
  assert.ok(items.some((i) => i.external_id === '3'))
})
