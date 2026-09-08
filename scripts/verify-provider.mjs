// scripts/verify-provider.mjs
// 真实 Redmine 接入自检（不依赖 cordis / DSH，只需 Node>=18 与真实凭证）。
// 用法：
//   REDMINE_BASE_URL=http://qn.pm.netease.com:8120 \
//   REDMINE_API_KEY=xxx \
//   REDMINE_SESSION_COOKIE=xxx \
//   node scripts/verify-provider.mjs
// 退出码：0=核心功能 OK；1=有失败；2=缺凭证。
import { RedmineProvider } from '../src/work-item-provider.js'

const base = process.env.REDMINE_BASE_URL || 'http://qn.pm.netease.com:8120'
const key = process.env.REDMINE_API_KEY || ''
const cookie = process.env.REDMINE_SESSION_COOKIE || ''
let failed = 0
const check = (ok, msg) => { if (ok) console.log('  [PASS] ' + msg); else { failed++; console.log('  [FAIL] ' + msg) } }

if (!key) { console.error('请先设置环境变量 REDMINE_API_KEY 后重跑。'); process.exit(2) }

const p = new RedmineProvider({ baseUrl: base, apiKey: key, sessionCookie: cookie })
console.log(`base_url = ${base}`)
console.log(`凭证：apiKey=${key ? key.slice(0, 6) + '…' : '(空)'} sessionCookie=${cookie ? '已设置' : '(空)'}\n`)

console.log('[1] testAuth 校验凭证...')
const auth = await p.testAuth()
check(auth.ok, auth.message)

console.log('[2] listAssigned 拉“指派给我的工单”...')
const { items, providerUserId } = await p.listAssigned()
check(items.length >= 1, `拉到 ${items.length} 个工单 (providerUserId=${providerUserId ?? '(未知)'})`)
items.slice(0, 5).forEach((i) => console.log(`     - #${i.external_id} ${i.title} [${i.status ?? ''}] ${i.web_url}`))

if (items.length) {
  console.log('[3] getDetail 拉单条详情...')
  const d = await p.getDetail(items[0].external_id)
  check(!!d, `#${d.external_id} 详情：category=${d.category ?? ''} attachments=${(d.attachments ?? []).length}`)
}

console.log(failed === 0 ? '\n✅ 核心功能（同步+详情+认证）验证 OK' : `\n❌ ${failed} 项失败，请检查凭证/网络/字段`)
process.exit(failed === 0 ? 0 : 1)
