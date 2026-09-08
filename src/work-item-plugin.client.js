// src/work-item-plugin.client.js
// 作为 code.client 传给 cordis_define 的 plain JS 函数体（无 JSX / TS / import）。
//
// ⚠️ 已按 @deepseek-ai/dsh-cordis-client-runner 校准：
//   - apply(ctx) 拿到浏览器侧 façade：ctx.get(name) 可选查找；声明过的服务可 ctx.serviceName 访问。
//     UI 落点用 ctx.slots；必须返回 { inject:['slots'], apply(ctx){…} }。
//   - React 是 client 半的 closure 符号（由 client runner 注入），可直接用 React.createElement。
//   - host.call(method, args) 调 host 半 harness.handle 注册的方法：返回 value 本体，失败抛 Error。
//   - slot 'tool.view.cordis' 只接受 key:'self'（运行时把它绑定到本包），已实测为合法落点。
//
// 注：附件图片 readImageAsDataUrl 依赖 host 已把附件落到 '?key=' 可下载且能用 fs.readBytes 读出的情况；
//   因 ctx.web 无 header + 仅 text/html body，附件二进制可能下载失败 → UI 里图片区做兜底（不渲染破图）。

function WorkItemView() {
  const [items, setItems] = React.useState([])
  const [kind, setKind] = React.useState('')
  const [search, setSearch] = React.useState('')
  const [selected, setSelected] = React.useState(null)
  const [err, setErr] = React.useState('')
  const [showConfig, setShowConfig] = React.useState(false)
  const [apiKey, setApiKey] = React.useState('')
  const [keyMask, setKeyMask] = React.useState('')

  async function load() {
    try {
      const list = await host.call('wi:list', { search, tracker_kind: kind })
      setItems(list || [])
      setErr('')
    } catch (e) {
      setErr(String(e?.message ?? e) || '加载失败')
    }
  }
  React.useEffect(() => { load() }, [search, kind])

  const onSync = async () => {
    setErr('同步中…')
    try {
      const r = await host.call('wi:sync')
      setErr(`同步：拉取 ${r?.synced ?? 0}，失败 ${r?.failed ?? 0}，清理 ${r?.removed ?? 0}${r?.errors?.[0] ? `（${r.errors[0]}）` : ''}`)
      load()
    } catch (e) {
      setErr(String(e?.message ?? e) || '同步失败')
    }
  }
  const onOpen = async (id) => {
    try { setSelected(await host.call('wi:get', id)) } catch (e) { setErr(String(e?.message ?? e)) }
  }
  const openConfig = async () => {
    try {
      const c = await host.call('wi:config', null)
      setKeyMask(c?.redmine?.apiKey ?? '')
      setShowConfig(true)
    } catch { setShowConfig(true) }
  }
  const onSaveConfig = async () => {
    try {
      const c = await host.call('wi:config', { redmine: { apiKey } })
      setApiKey('')
      setKeyMask(c?.redmine?.apiKey ?? '')
      setShowConfig(false)
      setErr('配置已保存')
    } catch (e) { setErr(String(e?.message ?? e) || '保存失败') }
  }

  return React.createElement('div', { style: { padding: 8, fontSize: 13 } },
    React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } },
      React.createElement('button', { onClick: onSync }, '同步'),
      React.createElement('button', { onClick: openConfig }, '配置'),
      React.createElement('input', {
        value: search,
        onChange: (e) => setSearch(e.target.value),
        placeholder: '搜索工单',
        style: { flex: 1 },
      }),
      React.createElement('select', { value: kind, onChange: (e) => setKind(e.target.value) },
        ['', 'bug', 'other'].map((k) => React.createElement('option',
          { value: k, key: k }, k === '' ? '全部' : k === 'bug' ? 'Bug' : '其它'))),
    ),
    err ? React.createElement('div', { style: { color: '#c00', marginBottom: 6 } }, err) : null,
    showConfig ? React.createElement('div', { style: { marginBottom: 6, border: '1px solid #ccc', padding: 6 } },
      React.createElement('div', null, '当前 Redmine API Key：', keyMask || '未设置'),
      React.createElement('div', { style: { display: 'flex', gap: 6, marginTop: 4 } },
        React.createElement('input', {
          value: apiKey,
          onChange: (e) => setApiKey(e.target.value),
          placeholder: '粘贴 API Key',
          style: { flex: 1 },
        }),
        React.createElement('button', { onClick: onSaveConfig }, '保存'),
        React.createElement('button', { onClick: () => { setShowConfig(false); setApiKey('') } }, '取消')),
    ) : null,
    React.createElement('ul', { style: { listStyle: 'none', padding: 0, margin: 0, maxHeight: 260, overflow: 'auto' } },
      items.map((it) => React.createElement('li', {
        key: it.external_id,
        onClick: () => onOpen(it.external_id),
        style: { cursor: 'pointer', padding: '4px 0', borderBottom: '1px solid #eee' },
      }, `${it.external_id}: ${it.title} [${it.status ?? ''}] ${it.priority ?? ''}`)),
    ),
    selected ? React.createElement(DetailView, { item: selected }) : null,
  )
}

function DetailView({ item }) {
  const atts = item.attachments ?? []
  return React.createElement('div', { style: { marginTop: 8, borderTop: '1px solid #ccc', paddingTop: 8 } },
    React.createElement('h4', null, `#${item.external_id} ${item.title}`),
    React.createElement('p', null,
      `状态 ${item.status ?? ''} · 优先级 ${item.priority ?? ''} · 指派 ${item.assignee ?? ''} · 分类 ${item.category ?? ''} · 作者 ${item.author ?? ''}`),
    item.description ? React.createElement('pre', { style: { whiteSpace: 'pre-wrap' } }, item.description) : null,
    atts.length ? React.createElement('div', null,
      React.createElement('strong', null, '附件：'),
      atts.map((a) => React.createElement('div', { key: a.name, style: { marginTop: 4 } },
        React.createElement('span', null, a.name),
        a.ai_description ? React.createElement('p', { style: { fontSize: 12, color: '#555' } }, a.ai_description) : null,
        a.description_status === 'skipped'
          ? React.createElement('span', { style: { fontSize: 11, color: '#999' } }, '（识图/下载在沙箱受限）')
          : null,
      ))) : null,
  )
}

return {
  inject: ['slots'],
  apply(ctx) {
    ctx.slots.inject('tool.view.cordis', () => ctx.slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(WorkItemView, null),
    ))
  },
}
