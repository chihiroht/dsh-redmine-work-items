// test/plugin-grammar.test.mjs
// 复刻 cordis 的 define-time 语法预检（dsh-cordis-host-runner/sandbox.precheckCode）：
// 把 host/client 文件内容当作 async 函数体，用 `new Function("(async ()=>{…})()")` 仅编译不执行。
// 目的：保证 code.host / code.client 在 cordis_define 时能通过解析、不会因为语法/TS 残留被拒。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const read = (name) => readFileSync(join(here, '..', 'src', name), 'utf8')

// 与 cordis 一致的包裹方式：作为 async 函数体执行（仅编译，不运行）。
function precheck(code) {
  const wrapped = `(async () => {\n${code}\n})()`
  // 编译即解析；不 invoke。new Function 在无 real vm 的宿主也作为解析门。
  // eslint-disable-next-line no-new-func
  new Function(wrapped)
}

test('code.host 作为 cordis 函数体能通过语法预检', () => {
  const src = read('work-item-plugin.host.js')
  assert.ok(/return \{/.test(src), 'host 体应以 return {...} 结束返回插件对象')
  assert.doesNotThrow(() => precheck(src))
})

test('code.client 作为 cordis 函数体能通过语法预检', () => {
  const src = read('work-item-plugin.client.js')
  assert.ok(/return \{/.test(src), 'client 体应以 return {...} 结束返回插件对象')
  assert.doesNotThrow(() => precheck(src))
})

test('host/client 不含被沙箱禁止的语法/符号（禁 import/require/TS 注解）', () => {
  const strip = (s) => s
    .replace(/\/\*[\s\S]*?\*\//g, '')     // block comments
    .replace(/\/\/[^\n]*/g, '')           // line comments
  for (const [label, raw] of [['host', 'work-item-plugin.host.js'], ['client', 'work-item-plugin.client.js']]) {
    const src = strip(read(raw))
    assert.ok(!/^\s*(import|export)\s/m.test(src), `${label} 不应有 import/export 顶层语句`)
    assert.ok(!/\brequire\s*\(/.test(src), `${label} 不应调用 require`)
    assert.ok(!/\bas\s+(const|type|string|number|object)\b/.test(src), `${label} 不应有 TS 注解`)
    assert.ok(!/\bBuffer\s*\./.test(src), `${label} 不应使用 Buffer（沙箱无 Buffer）`)
    assert.ok(!/(?<![.\w])fetch\s*\(/.test(src), `${label} 不应调用全局 fetch（沙箱拦截；应用 ctx.web.fetch）`)
  }
})
