// src/work-item-plugin.client.js
// 作为 code.client 传给 cordis_define 的 plain JS 函数体（无 JSX/TS/import）。
//
// ⚠️ 运行时接线为「初稿 + 待校准」：
//   - UI 落点 slot 名/协议：需 cordis_inspect 用 Slots.listSubTree 确认（示例用 tool.view.cordis key=self）。
//   - React 引用来自 DSH Client 环境（按 cordis-plugin-development 规范用 React.createElement）。
//   - host.call 为 Client→Host JSON RPC（对应 Host harness.handle('wi:*')）。
//   - 图片显示：Wi:image 返回 data URL（初稿），若 Host 提供静态 URL 可选 URL。
//
// 若 cordis_define 需要完整 function 源码，用 `function codeClient() { <以下函数体> }` 包裹。

function WorkItemView() {
  const [items, setItems] = React.useState([])
  const [search, setSearch] = React.useState('')
  const [kind, setKind] = React.useState('')
  const [selected, setSelected] = React.useState(null)
  const [err, setErr] = React.useState('')

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
    const r = await host.call('wi:sync')
    setErr(`同步：拉取 ${r?.synced ?? 0}，失败 ${r?.failed ?? 0}`)
    load()
  }
  const onOpen = async (id) => setSelected(await host.call('wi:get', id))

  return React.createElement(
    'div',
    { style: { padding: 8, fontSize: 13 } },
    React.createElement('div', { style: { display: 'flex', gap: 6, marginBottom: 6 } },
      React.createElement('button', { onClick: onSync }, '同步'),
      React.createElement('input', {
        value: search,
        onChange: (e) => setSearch(e.target.value),
        placeholder: '搜索工单',
        style: { flex: 1 },
      }),
      React.createElement('select', { value: kind, onChange: (e) => setKind(e.target.value) },
        ['', 'bug', 'other'].map((k) => React.createElement('option', { value: k, key: k }, k === '' ? '全部' : k === 'bug' ? 'Bug' : '其它')),
      ),
    ),
    err ? React.createElement('div', { style: { color: '#c00' } }, err) : null,
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
    React.createElement('p', null, `状态 ${item.status ?? ''} · 优先级 ${item.priority ?? ''} · 指派 ${item.assignee ?? ''} · 分类 ${item.category ?? ''}`),
    item.description ? React.createElement('pre', { style: { whiteSpace: 'pre-wrap' } }, item.description) : null,
    atts.length ? React.createElement('div', null,
      React.createElement('strong', null, '附件：'),
      atts.map((a) => React.createElement('div', { key: a.name, style: { marginTop: 4 } },
        a.name,
        a.local_path ? React.createElement('img', { src: '#', style: { maxWidth: '200px', display: 'block' } }) : null,
        a.ai_description ? React.createElement('p', { style: { fontSize: 12 } }, a.ai_description) : null,
      )),
    ) : null,
  )
}

return {
  inject: [],
  apply(ctx) {
    const slots = ctx.get('slots')
    if (slots === undefined) return
    // TODO(cordis_inspect): 落点以 Slots.listSubTree 实测为准。示例用 tool.view.cordis (key=self)。
    slots.inject('tool.view.cordis', () => slots.register(
      { name: 'tool.view.cordis', key: 'self' },
      () => React.createElement(WorkItemView, null),
    ))
  },
}
