# dsh-redmine-work-items

> DeepSeek Harness (DSH) 插件：把 Redmine 工单同步进 DSH —— 侧边栏「工单管理」看板 + 对话区 composer 引用 + 模型工具。纯插件实现，不修改 DSH 源码，可移植。

## 功能

- **侧边栏「工单管理」**：注入到「技能中心」下方；点击后占据中间对话区，渲染全屏工单看板。
- **工单看板**：
  - 搜索（标题 / 描述 / 工单号）；
  - 筛选：状态 / 分类 / 指派给我（带计数、下拉复选）；
  - 排序：更新时间 / 工单 ID / 优先级 / 目标版本；
  - 彩色状态 / 优先级 / 版本 pill（DSH 灰蓝白语义色）；
  - 详情字段分列、附件图片 Lightbox、「在外部打开」。
- **composer「工单」按钮**：弹出工单选择器，选中后以引用 chip 附加到对话；发送时序列化为 `[工单 #编号：标题]`。
- **模型工具**：`list_work_items` / `get_work_item_detail` / `sync_work_items` / `set_issue_tracker_config`。
- **自动同步**：按设定间隔自动拉取「指派给我」的工单。
- **设置面板「工单管理」**：配置 Redmine API 访问键 / baseUrl / 自动同步。

## 安装（DSH 插件）

```bash
# 方式 A：GitHub 仓库
dsh plugin --profile web add github:chihiroht/dsh-redmine-work-items

# 方式 B：本地 tarball（无需仓库/账号）
cd 插件目录 && pnpm pack
dsh plugin --profile web add ./dsh-redmine-work-items-0.1.0.tgz
```

## 配置

进入 DSH「设置 → 工单管理」：

- **API 访问键**（必填）：在 Redmine「我的账户」页获取。
- **Redmine baseUrl**（必填）：填你自己的 Redmine 地址（如 `https://your-redmine.example.com`）。
- **自动同步**：开关 + 间隔（最小 5 分钟）。

> 说明：新版本已移除 Session Cookie 字段——Redmine 走 API 访问键即可；网易 SSO 的 session cookie 在 Node host 端无法自动获取，故不再保留。

## 使用

1. 点侧边栏「工单管理」打开看板；
2. 点「同步」拉取指派给我的工单；
3. 输入框点「工单」→ 选一条 → 以引用 chip 附加到消息，发送后模型可识别 `[工单 #编号：标题]`（并可调用 `get_work_item_detail` 查询）。

## 兼容性

- 纯插件实现，**不修改 DSH 源码**；仅依赖 DSH 运行时提供的包（`@deepseek-ai/*` 作为 peerDependencies）。
- `lib/*.js` 为手写、无需构建；GitHub 直装即可用（无需 `prepare` 构建、无需 allowBuild）。

## 许可

MIT
