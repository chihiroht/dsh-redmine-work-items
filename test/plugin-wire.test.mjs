// test/plugin-wire.test.mjs
// 用符合 @deepseek-ai/dsh-cordis-host-runner 真实形状的 mock 驱动 code.host：
//   - harness.defineTool(...) → registerTool(ctx, tool) 记录注册；
//   - harness.handle(method, fn) 记录 Client→Host RPC；
//   - ctx.web.fetch({url},signal) 返回 { statusCode, body:{kind,content} }（Redmine ?key= 认证）；
//   - ctx.fs.resolve/readBytes/writeText 提供文件垫片。
// 目标：证明「工具注册 + 同步 + 过滤 + 详情」在真实 API 契约下能跑通（而非仅语法通过）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const hostSrc = readFileSync(join(here, '..', 'src', 'work-item-plugin.host.js'), 'utf8')

function loadHost(body) {
  // 与沙箱一致：把 body 当作 async 函数体；注入 harness / btoa / ctx 等 closure 符号。
  const fn = new Function(
    'harness', 'btoa', 'atob', 'TextEncoder', 'TextDecoder', 'ctx', 'host', 'React',
    `"use strict"; return (async () => {\n${body}\n})()`,
  )
  return fn
}

function makeHarness() {
  const tools = []
  const handlers = new Map()
  return {
    tools, handlers,
    defineTool(def) { return { ...def, __dynamic: true } },
    registerTool(ctx, tool) { tools.push(tool) },
    handle(method, fn) { handlers.set(method, fn) },
  }
}

function makeCtx() {
  const fs = new Map() // path -> Uint8Array
  const webCalls = []
  let redminePages = []
  return {
    get webCalls() { return webCalls },
    set redminePages(v) { redminePages = v },
    get(name) {
      if (name === 'fs') return this.fs
      if (name === 'web') return this.web
      return undefined
    },
    // tools：占位（register 由 harness 接管）
    tools: { register() {} },
    fs: {
      resolve: async (path) => ({ displayPath: path }),
      readBytes: async (target) => fs.get(target.displayPath) ?? new Uint8Array(0),
      writeText: async (target, buf) => { fs.set(target.displayPath, new Uint8Array(buf)) },
      writeBytes: async (target, bytes) => { fs.set(target.displayPath, new Uint8Array(bytes)) },
    },
    web: {
      fetch: async ({ url }, signal) => {
        webCalls.push(url)
        // 按命中顺序吐出预设页；Redmine JSON 文本
        const page = redminePages.shift() ?? { statusCode: 200, body: JSON.stringify({ issues: [], total_count: 0 }) }
        const content = typeof page.body === 'string' ? page.body : JSON.stringify(page.body)
        return { url, statusCode: page.statusCode ?? 200, truncated: false, body: { kind: 'text', content } }
      },
    },
  }
}

test('wire: code.host apply 注册 3 个工具 + 4 个 handle，sync 拉取并过滤', async () => {
  const harness = makeHarness()
  const ctx = makeCtx()
  // 预设 Redmine：两页 issues（第一个 endpoint 翻页）
  ctx.redminePages = [
    { statusCode: 200, body: JSON.stringify({ issues: [
      { id: 1, subject: '登录 bug', tracker: { name: '缺陷' }, status: { name: '新建' }, assigned_to: { name: '黄欢' }, updated_on: '2026-09-08' },
      { id: 2, subject: '性能优化', tracker: { name: '任务' }, status: { name: '进行中' }, updated_on: '2026-09-08' },
    ], total_count: 2 }) },
    { statusCode: 200, body: JSON.stringify({ issues: [], total_count: 0 }) },
    { statusCode: 200, body: JSON.stringify({ issues: [], total_count: 0 }) },
    { statusCode: 200, body: JSON.stringify({ issues: [], total_count: 0 }) },
    { statusCode: 200, body: JSON.stringify({ issues: [], total_count: 0 }) },
  ]
  const plugin = await loadHost(hostSrc)(harness, btoa, atob, TextEncoder, TextDecoder, ctx, undefined, undefined)
  assert.equal(typeof plugin.apply, 'function', 'host 体应返回带 apply 的插件对象')

  // 先设配置（wi:config）
  await plugin.apply(ctx, { redmine: { baseUrl: 'http://x', apiKey: 'KEY' } })

  // 工具与 handle 注册
  assert.deepEqual(harness.tools.map((t) => t.name).sort(), ['get_work_item_detail', 'list_work_items', 'sync_work_items'])
  for (const m of ['wi:list', 'wi:get', 'wi:sync', 'wi:image', 'wi:config']) {
    assert.ok(harness.handlers.has(m), `应注册 handle ${m}`)
  }

  // 同步
  const sync = await harness.handlers.get('wi:sync')()
  assert.equal(sync.synced, 2)
  assert.ok(ctx.webCalls.some((u) => u.includes('key=KEY')), '认证应走 ?key= 查询参数')

  // 列表（全量）
  const all = await harness.handlers.get('wi:list')({})
  assert.equal(all.length, 2)

  // 过滤 bug
  const bugs = await harness.handlers.get('wi:list')({ tracker_kind: 'bug' })
  assert.equal(bugs.length, 1)
  assert.equal(bugs[0].external_id, '1')

  // 详情（wi:get 返回工单对象，供工作台渲染）
  const detail = await harness.handlers.get('wi:get')('1')
  assert.equal(detail?.external_id, '1')
  assert.ok(String(detail?.title).includes('登录 bug'))
})

test('wire: 未配置 apiKey 时 sync 返回错误提示而不抛', async () => {
  const harness = makeHarness()
  const ctx = makeCtx()
  const plugin = await loadHost(hostSrc)(harness, btoa, atob, TextEncoder, TextDecoder, ctx, undefined, undefined)
  await plugin.apply(ctx, {})
  const sync = await harness.handlers.get('wi:sync')()
  assert.equal(sync.synced, 0)
  assert.match(sync.errors[0], /API Key/i)
})

// ---------- client 半接线 ----------
const clientSrc = readFileSync(join(here, '..', 'src', 'work-item-plugin.client.js'), 'utf8')
function loadClient(body) {
  const fn = new Function('React', 'host', 'ctx', `"use strict"; return (async () => {\n${body}\n})()`)
  return fn
}
function makeReactMock() {
  return {
    useState: (init) => [init, () => {}],
    useEffect: () => {},
    createElement: (type, props, ...children) => ({ type, props, children }),
  }
}
function makeClientCtx() {
  const registered = []
  return {
    registered,
    slots: {
      inject: (slotKey, cb) => { cb(); return () => {} },
      register: (options, component) => { registered.push({ options, component }); return () => {} },
    },
  }
}

test('wire: code.client apply 注册到 tool.view.cordis(slot key=self)，组件可渲染', async () => {
  const React = makeReactMock()
  const host = { call: async () => [] }
  const ctx = makeClientCtx()
  const plugin = await loadClient(clientSrc)(React, host, ctx)
  assert.equal(typeof plugin.apply, 'function')
  assert.deepEqual(plugin.inject, ['slots'])

  await plugin.apply(ctx)
  assert.equal(ctx.registered.length, 1)
  const { options, component } = ctx.registered[0]
  assert.equal(options.name, 'tool.view.cordis')
  assert.equal(options.key, 'self')

  // 组件工厂应返回可渲染的 React 元素树（type 是 WorkItemView 组件函数）
  const tree = component()
  assert.ok(tree && typeof tree === 'object')
  assert.equal(typeof tree.type, 'function')
})
