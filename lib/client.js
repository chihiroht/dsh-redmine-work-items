window.__ModuleLoader__.load({ id: "@chihiroht/dsh-redmine-work-items", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";
Object.defineProperty(exports, "__esModule", { value: true });

const React = require("react");
const { useState, useEffect, useCallback, useRef } = React;
const h = React.createElement;
// react-dom/client is registered by the web app shell (the task-board plugin
// requires it); degrade gracefully if it is ever absent.
let createRoot = null;
try { createRoot = require("react-dom/client").createRoot; } catch (e) { createRoot = null; }

const SETTINGS_ROUTE = "/_dsh/issue-tracker/settings";
const WORK_ITEMS_ROUTE = "/_dsh/issue-tracker/work-items";

async function api(path, action, payload) {
  const init = action === undefined
    ? { credentials: "same-origin" }
    : { credentials: "same-origin", method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({ action }, payload)) };
  const res = await fetch(path, init);
  const body = await res.json();
  if (!res.ok || !body.ok) throw new Error((body && body.error && body.error.message) || ("request failed " + res.status));
  return body.value;
}

function htmlToText(html) {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<p[^>]*>/gi, "")
    .replace(/<\/div>/gi, "\n")
    .replace(/<div[^>]*>/gi, "")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "· ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<h[1-6][^>]*>/gi, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

const CSS = [
  ".itx-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-header{display:grid;gap:4px;padding:8px 2px}",
  ".itx-header h2{font-size:24px;letter-spacing:-.025em;margin:0}",
  ".itx-header p{max-width:640px;margin:4px 0 0;color:var(--dsw-alias-fg-muted,#77736d);font-size:13px;line-height:1.55}",
  ".itx-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:14px;background:var(--dsw-alias-bg-layer-1,#fff)}",
  ".itx-field{display:grid;gap:6px}",
  ".itx-field label{font-size:12px;font-weight:600;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-field input,.itx-field select{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:9px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px}",
  ".itx-actions{display:flex;gap:8px;flex-wrap:wrap}",
  ".itx-input-row{display:flex;gap:6px;align-items:center;flex-wrap:wrap}",
  ".itx-btn{display:inline-flex;align-items:center;height:32px;padding:0 14px;border-radius:999px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font-size:13px;font-weight:600;cursor:pointer}",
  ".itx-btn.primary{background:#6758d4;border-color:#6758d4;color:#fff}",
  ".itx-btn:disabled{opacity:.55;cursor:default}",
  ".itx-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5}",
  ".itx-alert.error{background:rgba(205,72,72,.1);color:#aa3939}",
  ".itx-alert.success{background:rgba(48,154,100,.1);color:#267d52}",
  // center-column panel takeover (attribute-scoped, no leak).
  "[data-pane='conversation'],[class*='centerCol']{position:relative}",
  "[data-dsh-issue-tracker-view]{position:absolute;inset:0;display:none;z-index:60;background:var(--dsw-alias-bg-base,#fff)}",
  "html[data-dsh-issue-tracker-active] [data-dsh-issue-tracker-view]{display:block}",
  "html[data-dsh-issue-tracker-active] [data-pane='conversation'] > :not([data-dsh-issue-tracker-view]),html[data-dsh-issue-tracker-active] [class*='centerCol'] > :not([data-dsh-issue-tracker-view]){display:none !important}",
  // full-screen view body.
  ".itx-view{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;box-sizing:border-box;padding:14px 18px 20px;color:var(--dsw-alias-fg-primary,#26231f);gap:10px}",
  ".itx-view-head{flex:none;display:flex;align-items:center;gap:10px;padding-bottom:10px;border-bottom:1px solid var(--dsw-alias-border-subtle,#dedbd5)}",
  ".itx-view-head h2{font-size:20px;letter-spacing:-.02em;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".itx-back{display:inline-flex;align-items:center;gap:4px;padding:5px 12px;font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#26231f);background:transparent;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:8px;cursor:pointer;white-space:nowrap;flex:none}",
  ".itx-back:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9)}",
  ".itx-back:active{transform:translateY(1px)}",
  ".itx-view-body{flex:1;min-height:0;overflow:auto;padding:10px 2px 16px;display:flex;flex-direction:column;gap:12px}",
  ".itx-toolbar{display:flex;gap:8px;flex-wrap:nowrap;align-items:center}",
  ".itx-search{flex:1 1 auto;min-width:90px;box-sizing:border-box;padding:8px 12px;border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:999px;background:var(--dsw-alias-bg-layer-1,#fff);color:inherit;font:inherit;font-size:13px}",
  ".itx-filter{position:relative;display:inline-flex}",
  ".itx-filter-btn{display:inline-flex;align-items:center;gap:6px;padding:6px 12px;font-size:13px;color:var(--dsw-alias-fg-muted,#77736d);background:var(--dsw-alias-bg-layer-2,#f0eee9);border:1px solid transparent;border-radius:999px;cursor:pointer;white-space:nowrap}",
  ".itx-filter-btn:hover{background:var(--dsw-alias-interactive-bg-active,#e6e2da);color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-filter-btn.active{color:var(--dsw-alias-fg-primary,#26231f);background:var(--dsw-alias-interactive-bg-active,#e6e2da);border-color:var(--dsw-alias-border-subtle,#dedbd5)}",
  ".itx-filter-caret{font-size:9px;opacity:.7}",
  ".itx-filter-menu{position:absolute;top:calc(100% + 4px);left:0;z-index:90;min-width:180px;max-height:320px;overflow:auto;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:10px;box-shadow:0 8px 30px rgba(0,0,0,.14);padding:6px;display:flex;flex-direction:column}",
  ".itx-filter-opt{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;cursor:pointer;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-filter-opt:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9)}",
  ".itx-filter-opt.selected{background:rgba(59,111,212,.09)}",
  ".itx-filter-check{width:16px;height:16px;flex:none;border:1px solid var(--dsw-alias-border-l1,#dedbd5);border-radius:5px;display:inline-flex;align-items:center;justify-content:center;color:#fff;font-size:11px;line-height:1;box-sizing:border-box}",
  ".itx-filter-check.checked{background:#3b6fd4;border-color:#3b6fd4}",
  ".itx-filter-opt-label{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px}",
  ".itx-filter-opt-count{flex:none;font-size:12px;color:var(--dsw-alias-fg-muted,#77736d)}",
  ".itx-list{margin:0;padding:0;list-style:none;font-size:13px}",
  ".itx-row{padding:8px 2px;border-bottom:1px solid var(--dsw-alias-border-subtle,#dedbd5);cursor:pointer;border-radius:8px}",
  ".itx-row:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9)}",
  ".itx-row-line{display:flex;align-items:center;gap:10px;min-width:0}",
  ".itx-id-pill{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-fg-muted,#77736d);background:var(--dsw-alias-bg-layer-2,#f0eee9);border-radius:6px;padding:2px 6px;cursor:pointer;white-space:nowrap}",
  ".itx-row-mid{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px;overflow:hidden}",
  ".itx-row-title{font-size:13px;font-weight:600;color:var(--dsw-alias-fg-primary,#26231f);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".itx-row-preview{font-size:11px;color:var(--dsw-alias-fg-muted,#77736d);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".itx-row-meta{flex:none;display:flex;align-items:center;gap:6px;flex-wrap:wrap;justify-content:flex-end}",
  ".itx-pill{display:inline-flex;align-items:center;border-radius:999px;padding:1px 8px;font-size:11px;font-weight:500;white-space:nowrap;line-height:1.4;background:var(--dsw-alias-bg-layer-2,#f0eee9);color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-pill.status.info{color:#3b6fd4}",
  ".itx-pill.status.success{color:#2f9e6e}",
  ".itx-pill.status.destructive{color:#d64545}",
  ".itx-pill.status.muted{color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-pill.priority.urgent{background:rgba(214,69,69,.13);color:#c53d31;border:1px solid rgba(214,69,69,.3)}",
  ".itx-pill.priority.high{background:rgba(59,111,212,.15);color:#2f5fc4;border:1px solid rgba(59,111,212,.32)}",
  ".itx-pill.priority.normal{background:rgba(59,111,212,.1);color:#2f5fc4}",
  ".itx-pill.priority.low{background:var(--dsw-alias-bg-layer-2,#f0eee9);color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-pill.version{background:rgba(59,111,212,.1);color:#2f5fc4}",
  ".itx-time{font-size:11px;color:var(--dsw-alias-fg-muted,#77736d);white-space:nowrap}",
  ".itx-detail{margin-top:8px;padding:10px 12px;border-radius:10px;background:var(--dsw-alias-interactive-bg-hover,#f4f2ee);font-size:12px;line-height:1.6;color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-detail-meta{display:flex;flex-wrap:wrap;gap:4px 16px;margin-bottom:10px}",
  ".itx-detail-field{color:var(--dsw-alias-fg-muted,#77736d);font-size:12px}",
  ".itx-detail-field .itx-detail-value{color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-detail-section-label{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.04em;color:var(--dsw-alias-fg-muted,#77736d);margin:0 0 4px}",
  ".itx-detail pre{white-space:pre-wrap;word-break:break-word;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px}",
  ".itx-open-ext{display:inline-flex;align-items:center;gap:6px;padding:6px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f0eee9);color:var(--dsw-alias-fg-muted,#6b7280);font-size:12px;font-weight:500;text-decoration:none;cursor:pointer;transition:background .12s ease,color .12s ease}",
  ".itx-open-ext:hover{background:var(--dsw-alias-interactive-bg-active,#e6e2da);color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-open-ext-icon{display:inline-flex;align-items:center;justify-content:center}",
  ".itx-open-ext-icon svg{display:block;width:13px;height:13px;flex:none}",
  ".itx-compose-wrap{position:relative;display:inline-flex;align-items:center}",
  ".itx-compose-btn{display:inline-flex;align-items:center;gap:4px;height:28px;padding:0 8px;border:0;background:transparent;color:var(--dsw-alias-fg-muted,#6b7280);border-radius:8px;cursor:pointer;font-size:12px;font-weight:500;white-space:nowrap}",
  ".itx-compose-btn:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9);color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-compose-btn-icon{display:inline-flex;align-items:center;justify-content:center}",
  ".itx-compose-btn-icon svg{display:block;width:14px;height:14px;flex:none}",
  ".itx-picker{position:absolute;bottom:calc(100% + 6px);left:0;z-index:100;width:380px;max-width:90vw;background:var(--dsw-alias-bg-layer-1,#fff);border:1px solid var(--dsw-alias-border-subtle,#dedbd5);border-radius:12px;box-shadow:0 10px 40px rgba(0,0,0,.16);display:flex;flex-direction:column;overflow:hidden}",
  ".itx-picker-head{display:flex;align-items:center;gap:6px;padding:8px 10px;border-bottom:1px solid var(--dsw-alias-border-subtle,#dedbd5)}",
  ".itx-picker-search-icon{display:inline-flex;align-items:center;justify-content:center;font-size:14px;color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-picker-search{flex:1;min-width:0;border:0;background:transparent;color:inherit;font:inherit;font-size:13px;outline:none}",
  ".itx-picker-close{border:0;background:transparent;color:var(--dsw-alias-fg-muted,#6b7280);font-size:16px;cursor:pointer;padding:2px 6px;border-radius:6px;flex:none}",
  ".itx-picker-close:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9);color:var(--dsw-alias-fg-primary,#26231f)}",
  ".itx-picker-tabs{display:flex;gap:4px;padding:6px 10px}",
  ".itx-picker-tab{border:0;background:transparent;border-radius:6px;padding:3px 10px;font-size:12px;color:var(--dsw-alias-fg-muted,#6b7280);cursor:pointer}",
  ".itx-picker-tab.active{background:var(--dsw-alias-interactive-bg-active,#e6e2da);color:var(--dsw-alias-fg-primary,#26231f);font-weight:600}",
  ".itx-picker-list{max-height:300px;overflow:auto;display:flex;flex-direction:column;padding:4px}",
  ".itx-picker-item{display:flex;align-items:center;gap:8px;padding:7px 8px;border-radius:8px;border:0;background:transparent;color:var(--dsw-alias-fg-primary,#26231f);cursor:pointer;text-align:left;font-size:12px;width:100%}",
  ".itx-picker-item:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9)}",
  ".itx-picker-id{flex:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;color:var(--dsw-alias-fg-muted,#6b7280);background:var(--dsw-alias-bg-layer-2,#f0eee9);border-radius:6px;padding:1px 5px}",
  ".itx-picker-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
  ".itx-picker-status{flex:none;font-size:11px;color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-picker-empty{padding:18px;text-align:center;font-size:12px;color:var(--dsw-alias-fg-muted,#6b7280)}",
  ".itx-picker-foot{padding:6px 10px;font-size:11px;color:var(--dsw-alias-fg-muted,#6b7280);border-top:1px solid var(--dsw-alias-border-subtle,#dedbd5)}",
  ".itx-imgs{display:flex;flex-wrap:wrap;gap:4px}",
  ".itx-lightbox{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.8)}",
  ".itx-lb-nav{position:absolute;top:50%;transform:translateY(-50%);font-size:40px;color:#fff;background:0 0;border:0;cursor:pointer;padding:0 20px;line-height:1}",
  ".itx-lb-prev{left:8px}",
  ".itx-lb-next{right:8px}",
  ".itx-lb-close{position:absolute;top:12px;right:16px;font-size:28px;color:#fff;background:0 0;border:0;cursor:pointer}",
  // sidebar entry row (matches the shell's nav item look).
  ".itx-entry{box-sizing:border-box;display:flex;align-items:center;gap:8px;width:100%;height:36px;padding:0 10px;background:transparent;border:none;border-radius:8px;color:var(--dsw-alias-label-secondary,#77736d);cursor:pointer;font-size:13px;white-space:nowrap}",
  ".itx-entry:hover{background:var(--dsw-alias-interactive-bg-hover,#f0eee9);color:var(--dsw-alias-label-primary,#26231f)}",
  ".itx-entry[data-active]{background:var(--dsw-alias-interactive-bg-active,#e6e2da);color:var(--dsw-alias-label-primary,#26231f);font-weight:600}",
  ".itx-entryIcon{display:inline-flex;align-items:center;justify-content:center;width:24px;height:24px;flex:none}",
  ".itx-entryIcon svg{display:block;width:18px;height:18px}",
  ".itx-entryLabel{overflow:hidden;text-overflow:ellipsis}",
  "[data-dsh-frame][data-sidebar-collapsed] .itx-entry,[data-sidebar-collapsed] .itx-entry{justify-content:center;padding:0;width:36px;height:36px;margin:0 auto 12px;border-radius:50%}",
  "[data-dsh-frame][data-sidebar-collapsed] .itx-entryLabel,[data-sidebar-collapsed] .itx-entryLabel{display:none}",
].join("\n");

function RedmineSettingsSection() {
  const [draft, setDraft] = useState({ baseUrl: "", apiKey: "", autoSync: false, syncIntervalMin: 10 });
  const [revision, setRevision] = useState(0);
  const [showKey, setShowKey] = useState(false);
  const [apiTest, setApiTest] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try {
      const snap = await api(SETTINGS_ROUTE);
      setRevision(snap && snap.settings ? snap.settings.revision : 0);
      const v = snap && snap.settings && snap.settings.value ? snap.settings.value : {};
      setDraft({ baseUrl: (v.redmine && v.redmine.baseUrl) || "", apiKey: "", autoSync: v.autoSync === true, syncIntervalMin: v.syncIntervalMin || 10 });
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const update = (patch) => setDraft((cur) => Object.assign({}, cur, patch));

  const doTest = async () => {
    setBusy(true); setError("");
    try {
      const r = await api(SETTINGS_ROUTE, "test", { apiKey: draft.apiKey, baseUrl: draft.baseUrl });
      const msg = r && r.message ? r.message : (r && r.ok ? "ok" : "fail");
      setApiTest(`${r && r.ok ? "通过" : "失败"}：${msg}`);
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const doSave = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const snap = await api(SETTINGS_ROUTE, "save", Object.assign({ expectedRevision: revision }, draft));
      setRevision(snap && snap.settings ? snap.settings.revision : 0);
      setDraft((d) => Object.assign({}, d, { apiKey: "" }));
      setMessage("已保存。");
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const field = (label, value, onChange, show, setShow, testResult, onTest, placeholder, secret) => h("div", { className: "itx-field" }, [
    h("label", null, label),
    h("div", { className: "itx-input-row" }, [
      h("input", { type: show || !secret ? "text" : "password", value: value, placeholder: placeholder, onChange: onChange, style: { flex: 1 } }),
      h("button", { className: "itx-btn", onClick: () => setShow(!show), tabIndex: -1 }, show ? "隐藏" : "显示"),
      h("button", { className: "itx-btn", disabled: busy || !value, onClick: onTest }, "测试连接"),
    ]),
    testResult ? h("div", { className: "itx-alert " + (testResult.indexOf("通过") === 0 ? "success" : "error") }, testResult) : null,
  ]);

  return h("div", { className: "itx-settings" }, [
    h("header", { className: "itx-header" }, [
      h("h2", null, "工单连接"),
      h("p", null, "配置 Redmine API 访问键以启用工单同步。apiKey 仅脱敏回显。"),
    ]),
    h("section", { className: "itx-panel" }, [
      field("API 访问键", draft.apiKey, (e) => update({ apiKey: e.target.value }), showKey, setShowKey, apiTest, () => doTest(), "粘贴 Redmine API 访问键", true),
      h("div", { className: "itx-field" }, [h("label", null, "Redmine baseUrl"), h("input", { value: draft.baseUrl, onChange: (e) => update({ baseUrl: e.target.value }) })]),
      h("div", { className: "itx-actions" }, [
        h("button", { className: "itx-btn primary", disabled: busy, onClick: doSave }, busy ? "保存中…" : "保存并同步"),
      ]),
      error ? h("div", { className: "itx-alert error" }, error) : null,
      message ? h("div", { className: "itx-alert success" }, message) : null,
      h("div", { className: "itx-field" }, [
        h("label", null, "自动同步"),
        h("div", { className: "itx-input-row" }, [
          h("label", null, "开启自动同步"),
          h("input", { type: "checkbox", checked: draft.autoSync, onChange: (e) => update({ autoSync: e.target.checked }) }),
        ]),
        h("div", { className: "itx-input-row" }, [
          h("label", null, "同步间隔"),
          h("select", { value: String(draft.syncIntervalMin), onChange: (e) => update({ syncIntervalMin: Number(e.target.value) }) }, [5,10,15,30,60].map(m => h("option", { value: String(m), key: m }, `${m} 分钟`))),
        ]),
      ]),
    ]),
  ]);
}

function unique(values) { return [...new Set(values.filter(Boolean))]; }

// monai semantic tones (workItemMeta): status = muted pill + colored text; priority = full colored pill.
function statusTone(status) {
  const s = String(status || "").toLowerCase().trim();
  if (/(resolved|完成并上传|完成|已解决|已上传|上线|通过)/.test(s)) return "success";
  if (/(rejected|已拒绝|拒绝|驳回)/.test(s)) return "destructive";
  if (/(closed|关闭|done)/.test(s)) return "muted";
  if (/(open|new|doing|in_progress|in progress|进行中|新建|待处理|处理|开发|测试|验收|评审|修复|实施)/.test(s)) return "info";
  return "muted";
}
function priorityTone(priority) {
  const p = String(priority || "").toLowerCase().trim();
  if (/(urgent|紧急|严重|critical)/.test(p)) return "urgent";
  if (/(high|高)/.test(p)) return "high";
  if (/(low|低)/.test(p)) return "low";
  return "normal";
}
function statusPill(status) {
  if (!status) return null;
  return h("span", { className: "itx-pill status " + statusTone(status) }, String(status));
}
function priorityPill(priority) {
  const value = priority || "普通";
  return h("span", { className: "itx-pill priority " + priorityTone(value) }, String(value));
}
function versionPill(version) {
  if (!version) return null;
  return h("span", { className: "itx-pill version" }, String(version));
}
// One inline "标签：值" meta field (monai flex-wrap field separation).
function detailField(label, value) {
  const v = value == null || value === "" ? "—" : value;
  return h("span", { className: "itx-detail-field" }, [label + "：", h("span", { className: "itx-detail-value" }, v)]);
}

// monai-style filter dropdown: pill trigger + popover of options with checkbox
// and count; the checked option is highlighted (blue check) per the DSH palette.
function FilterSelect({ allLabel, value, onChange, options, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => {
      if (ref.current && ref.current.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find(o => o.value === value);
  const isAll = value === "" || value === "all";
  const total = options.reduce((acc, o) => acc + (o.count || 0), 0);
  const buttonLabel = isAll ? placeholder : (current ? current.label : value);
  const option = (o, selected, clickValue) => h("div", { key: String(clickValue), className: "itx-filter-opt" + (selected ? " selected" : ""), onClick: () => { onChange(clickValue); setOpen(false); } }, [
    h("span", { className: "itx-filter-check" + (selected ? " checked" : "") }, selected ? "✓" : ""),
    h("span", { className: "itx-filter-opt-label" }, o.label),
    o.count != null ? h("span", { className: "itx-filter-opt-count" }, String(o.count)) : null,
  ]);
  return h("div", { className: "itx-filter", ref }, [
    h("button", { className: "itx-filter-btn" + (isAll ? "" : " active"), onClick: () => setOpen(!open), "aria-haspopup": "menu", "aria-expanded": open }, [
      h("span", null, buttonLabel),
      h("span", { className: "itx-filter-caret", "aria-hidden": true }, open ? "▲" : "▼"),
    ]),
    open ? h("div", { className: "itx-filter-menu", role: "menu" }, [
      option({ label: allLabel, count: total }, isAll, value === "all" ? "all" : ""),
      ...options.map(o => option(o, o.value === value, o.value)),
    ]) : null,
  ]);
}

// Sort selector dropdown: pill trigger showing the active key, popover to pick one.
function SortSelect({ value, onChange, options }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onClick = (e) => { if (ref.current && ref.current.contains(e.target)) return; setOpen(false); };
    const onKey = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onClick); document.removeEventListener("keydown", onKey); };
  }, [open]);
  const current = options.find(o => o.value === value);
  return h("div", { className: "itx-filter", ref }, [
    h("button", { className: "itx-filter-btn", onClick: () => setOpen(!open), "aria-haspopup": "menu", "aria-expanded": open }, [
      h("span", null, "⇅ " + (current ? current.label : "")),
      h("span", { className: "itx-filter-caret", "aria-hidden": true }, open ? "▲" : "▼"),
    ]),
    open ? h("div", { className: "itx-filter-menu", role: "menu" }, options.map(o => h("div", { key: o.value, className: "itx-filter-opt" + (o.value === value ? " selected" : ""), onClick: () => { onChange(o.value); setOpen(false); } }, [
      h("span", { className: "itx-filter-opt-label" }, o.label),
    ]))) : null,
  ]);
}

// Full-screen work-items board, rendered inside the center-column takeover
// container (no modal chrome). Props: onClose (optional close button), plus the
// standard conversation-view hooks which it does not rely on.
function IssueTrackerView(props) {
  const onClose = props && props.onClose;
  const [items, setItems] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatusState] = useState(() => {
    try { const s = localStorage.getItem("itx.filter.status"); return s !== null ? s : "新建"; } catch { return "新建"; }
  });
  const [category, setCategoryState] = useState(() => {
    try { return localStorage.getItem("itx.filter.category") || ""; } catch { return ""; }
  });
  const [owner, setOwnerState] = useState(() => {
    try { return localStorage.getItem("itx.filter.owner") || "all"; } catch { return "all"; }
  });
  const setStatus = (v) => { setStatusState(v); try { localStorage.setItem("itx.filter.status", v); } catch {} };
  const setCategory = (v) => { setCategoryState(v); try { localStorage.setItem("itx.filter.category", v); } catch {} };
  const setOwner = (v) => { setOwnerState(v); try { localStorage.setItem("itx.filter.owner", v); } catch {} };
  const [sortKey, setSortKeyState] = useState(() => {
    try { return localStorage.getItem("itx.filter.sort") || "updated"; } catch { return "updated"; }
  });
  const setSortKey = (v) => { setSortKeyState(v); try { localStorage.setItem("itx.filter.sort", v); } catch {} };
  const [counts, setCounts] = useState({});
  const [currentUser, setCurrentUser] = useState(null);
  const [selected, setSelected] = useState(null);
  const [lightboxIndex, setLightboxIndex] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [syncedAt, setSyncedAt] = useState("");

  const load = useCallback(async () => {
    setBusy(true); setError("");
    try { const d = await api(WORK_ITEMS_ROUTE) || {}; setItems(d.items || []); setCounts(d.counts || {}); setCurrentUser(d.currentUser || null); }
    catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setBusy(false); }
  }, []);
  useEffect(() => { load(); }, [load]);

  // 校验筛选：持久化/默认值若在当前数据里不存在则回退（状态 → 新建，分类/全部）。
  useEffect(() => {
    if (!items.length) return;
    const validStatuses = unique(items.map(i => i.status));
    const validCategories = unique(items.map(i => i.category));
    if (status && !validStatuses.includes(status)) setStatus(validStatuses.includes("新建") ? "新建" : "");
    if (category && !validCategories.includes(category)) setCategory("");
  }, [items, status, category]);

  const doSync = async () => {
    setBusy(true); setError(""); setMessage("");
    try {
      const r = await api(WORK_ITEMS_ROUTE, "sync");
      setMessage(`同步完成！共拉取 ${r && r.synced || 0} 个工单${r && r.errors && r.errors[0] ? `（${r.errors[0]}）` : ""}`);
      setSyncedAt(new Date().toLocaleTimeString());
      load();
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setBusy(false); }
  };

  const statuses = unique(items.map(i => i.status));
  const categories = unique(items.map(i => i.category));
  const statusOptions = statuses.map(s => ({ value: s, label: s, count: items.filter(i => i.status === s).length }));
  const categoryOptions = categories.map(s => ({ value: s, label: s, count: items.filter(i => i.category === s).length }));
  const ownerOptions = [
    { value: "assigned", label: "指派给我", count: counts.assigned || 0 },
    { value: "created", label: "我创建", count: counts.created || 0 },
    { value: "follow", label: "跟进QA", count: counts.follow || 0 },
  ];
  const me = currentUser && currentUser.name;
  const filtered = items.filter(it =>
    (!search || String(it.title || "").includes(search) || String(it.description || "").includes(search) || String(it.external_id).includes(search) || String(it.id || "").includes(search)) &&
    (!status || it.status === status) && (!category || it.category === category) &&
    (!owner || owner === "all" || (owner === "assigned" ? it.assignee === me : owner === "created" ? it.author === me : owner === "follow" ? it.watcher === me : true)));
  const sorted = [...filtered].sort((a, b) => {
    switch (sortKey) {
      case "id": return (Number(a.external_id) || 0) - (Number(b.external_id) || 0);
      case "priority": return priorityWeight(a.priority) - priorityWeight(b.priority);
      case "version": return String(a.version || "").localeCompare(String(b.version || ""));
      default: return String(b.updated_at || "").localeCompare(String(a.updated_at || ""));
    }
  });

  const lightbox = lightboxIndex !== null && selected ? (function () {
    var it = items.find(function (x) { return x.external_id === selected });
    var imgs = ((it && it.attachments) || []).filter(function (a) { return a.url }).map(function (a) { return "/_dsh/issue-tracker/attachment?url=" + encodeURIComponent(a.url) });
    var n = imgs.length;
    if (!n) return null;
    var idx = Math.min(lightboxIndex, n - 1);
    return h("div", { className: "itx-lightbox", onClick: function () { setLightboxIndex(null) } }, [
      h("button", { className: "itx-lb-nav itx-lb-prev", onClick: function (e) { e.stopPropagation(); setLightboxIndex((idx - 1 + n) % n) } }, "‹"),
      h("img", { src: imgs[idx], onClick: function (e) { e.stopPropagation() }, style: { maxWidth: "90vw", maxHeight: "88vh", objectFit: "contain" } }),
      h("button", { className: "itx-lb-nav itx-lb-next", onClick: function (e) { e.stopPropagation(); setLightboxIndex((idx + 1) % n) } }, "›"),
      h("button", { className: "itx-lb-close", onClick: function () { setLightboxIndex(null) } }, "×"),
    ]);
  })() : null;

  return h("div", { className: "itx-view" }, [
    h("div", { className: "itx-view-head" }, [
      onClose ? h("button", { className: "itx-back", "aria-label": "返回会话", "data-dsh-center-view-back": "", onClick: onClose }, [
        h("span", { "aria-hidden": true }, "‹"),
        h("span", null, "返回会话"),
      ]) : null,
      h("h2", null, "工单管理"),
      h("div", { className: "itx-toolbar" }, [
        h("input", { className: "itx-search", value: search, placeholder: "搜索工单…", onChange: (e) => setSearch(e.target.value) }),
        h(FilterSelect, { placeholder: "状态", allLabel: "全部状态", value: status, onChange: setStatus, options: statusOptions }),
        h(FilterSelect, { placeholder: "分类", allLabel: "全部分类", value: category, onChange: setCategory, options: categoryOptions }),
        h(FilterSelect, { placeholder: "指派给我", allLabel: "全部人员", value: owner, onChange: setOwner, options: ownerOptions }),
        h(SortSelect, { value: sortKey, onChange: setSortKey, options: SORT_OPTIONS }),
        h("button", { className: "itx-btn primary", disabled: busy, onClick: doSync }, busy ? "同步中…" : "同步"),
        syncedAt ? h("span", { className: "itx-pill" }, "同步 " + syncedAt) : null,
      ]),
    ]),
    h("div", { className: "itx-view-body" }, [
      error ? h("div", { className: "itx-alert error" }, error) : null,
      message ? h("div", { className: "itx-alert success" }, message) : null,
      h("ul", { className: "itx-list" }, sorted.length === 0
        ? [h("li", { className: "itx-row" }, "暂无工单，请先同步。")]
        : sorted.map((it) => h("li", { key: it.external_id, className: "itx-row", onClick: () => setSelected(selected === it.external_id ? null : it.external_id) }, [
          h("div", { className: "itx-row-line" }, [
            h("span", { className: "itx-id-pill", onClick: (e) => { e.stopPropagation(); } }, "#" + it.external_id),
            h("span", { className: "itx-row-mid" }, [
              h("span", { className: "itx-row-title" }, it.title),
              it.description ? h("span", { className: "itx-row-preview" }, htmlToText(it.description)) : null,
            ]),
            h("span", { className: "itx-row-meta" }, [
              statusPill(it.status),
              priorityPill(it.priority),
              versionPill(it.version),
              h("span", { className: "itx-time" }, it.updated_at ? String(it.updated_at).slice(0, 16) : ""),
            ]),
          ]),
          selected === it.external_id ? h("div", { className: "itx-detail", onClick: (e) => e.stopPropagation() }, [
            h("div", { className: "itx-detail-meta" }, [
              detailField("来源", it.provider),
              detailField("创建者", it.author),
              detailField("负责人", it.assignee),
              detailField("跟进QA", it.watcher),
              detailField("分类", it.category),
              detailField("版本", it.version),
            ]),
            it.description ? h("div", null, [
              h("div", { className: "itx-detail-section-label" }, "描述"),
              h("pre", null, htmlToText(it.description)),
            ]) : null,
            it.web_url ? h("div", null, h("a", { className: "itx-open-ext", href: it.web_url, target: "_blank", rel: "noopener noreferrer" }, [
              h("span", { className: "itx-open-ext-icon", dangerouslySetInnerHTML: { __html: EXT_ICON } }),
              h("span", null, "在外部打开"),
            ])) : null,
            (it.attachments || []).filter(a => a.url).length > 0 ? h("div", null, [
              h("div", { className: "itx-detail-section-label" }, "图片 (" + (it.attachments || []).filter(a => a.url).length + ")"),
              h("div", { className: "itx-imgs" }, (it.attachments || []).filter(a => a.url).map((a, idx) => h("img", { key: a.name, src: "/_dsh/issue-tracker/attachment?url=" + encodeURIComponent(a.url), alt: a.name || "", onClick: (e) => { e.stopPropagation(); setLightboxIndex(idx); }, style: { maxWidth: 220, maxHeight: 220, borderRadius: 8, margin: "4px 6px 0 0", objectFit: "contain", border: "1px solid #dedbd5", cursor: "zoom-in" } }))),
            ]) : null,
          ]) : null,
        ]))),
    ]),
    lightbox,
  ]);
}

/* ============================ shared DOM cores ============================ */
/* Adapted from the dsh-web shared sidebar-entry-core / panel-mount-core (the
   family plugin pattern: no sidebar nav slot exists, so the entry row is DOM
   injected and the view takes over the center column). */

// ---- open/close state ----
function createViewState() {
  let open = false;
  const listeners = [];
  return {
    isOpen: () => open,
    subscribe(listener) { listeners.push(listener); return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1); }; },
    setOpen(v) {
      if (open === v) return;
      open = v;
      if (v) {
        document.documentElement.removeAttribute("data-dsh-ssh-active");
        document.documentElement.removeAttribute("data-dsh-taskboard-active");
        document.documentElement.setAttribute("data-dsh-issue-tracker-active", "");
        document.dispatchEvent(new CustomEvent("dsh-panel-activate", { detail: "issue-tracker" }));
      } else {
        document.documentElement.removeAttribute("data-dsh-issue-tracker-active");
      }
      for (const listener of listeners) listener();
    },
    toggle() { this.setOpen(!open); },
  };
}

// ---- sidebar entry injection ----
function sidebarRoot() {
  const column = document.querySelector('[data-pane="sidebar"], [class*="sidebarCol"]');
  if (column === null) return undefined;
  const logo = column.querySelector('[class*="logoRow"]');
  const logoOwner = logo === null ? null : logo.parentElement;
  return logoOwner ?? (column.firstElementChild instanceof HTMLElement ? column.firstElementChild : undefined);
}
function newSessionButton(root) {
  const nested = root.querySelector('button[class*="newSession"]');
  if (nested !== null) return nested;
  for (const child of root.children) {
    if (child.tagName === "BUTTON") return child;
  }
  return undefined;
}
function createEntryRow(options) {
  const entry = document.createElement("button");
  entry.type = "button";
  entry.setAttribute(options.rowAttribute, "");
  if (options.plugin !== undefined) {
    entry.setAttribute("data-dsh-plugin", options.plugin);
    entry.setAttribute("data-dsh-part", "sidebar-entry");
  }
  entry.className = options.css["entry"] ?? "";
  const labelSpan = document.createElement("span");
  labelSpan.className = options.css["entryLabel"] ?? "";
  const iconSpan = document.createElement("span");
  iconSpan.className = options.css["entryIcon"] ?? "";
  iconSpan.innerHTML = options.icon;
  entry.append(iconSpan, labelSpan);
  const applyLabel = () => {
    entry.setAttribute("aria-label", options.label());
    if (options.tooltip !== undefined) entry.setAttribute("title", options.tooltip());
    labelSpan.textContent = options.label();
  };
  applyLabel();
  entry.addEventListener("click", options.onToggle);
  return { entry, applyLabel };
}
function placeEntryRow(root, entry, options) {
  const button = newSessionButton(root);
  if (button === undefined) return false;
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]');
    const base = (row !== null && row.parentElement === root) ? row : button;
    const family = Array.from(root.children).filter(
      (el) => el instanceof HTMLElement && el.matches(options.familySelectors.join(", ")),
    );
    const anchor = options.position === "before"
      ? (family.length > 0 ? family[0] : base.nextElementSibling)
      : (family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling);
    root.insertBefore(entry, anchor);
  }
  return true;
}
function mountSidebarEntry(options) {
  if (typeof document !== "undefined" && document.querySelector(options.rowSelector) !== null) return () => {};
  const { entry, applyLabel } = createEntryRow(options);
  let root = undefined;
  let placed = false;
  let unsubscribeRefresh = undefined;
  if (options.refresh !== undefined) {
    try { unsubscribeRefresh = options.refresh.subscribe(applyLabel); } catch { /* locale missing */ }
  }
  let rootObserver;
  const tryPlace = () => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect();
      root = undefined;
      placed = false;
    }
    if (placed) {
      if (document.body.contains(entry)) return;
      rootObserver.disconnect();
      root = undefined;
      placed = false;
    }
    root ??= sidebarRoot();
    if (root === undefined) return;
    placed = placeEntryRow(root, entry, options);
    if (placed) rootObserver.observe(root, { childList: true, subtree: true });
  };
  const waitObserver = new MutationObserver(() => { tryPlace(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false;
      tryPlace();
      return;
    }
    if (!root.contains(entry)) {
      placed = placeEntryRow(root, entry, options);
    }
  });
  const unsubscribeActive = options.active === undefined ? undefined : (() => {
    const syncActive = () => {
      if (options.active.isOpen()) entry.dataset.active = "true";
      else delete entry.dataset.active;
    };
    const unsubscribe = options.active.subscribe(syncActive);
    syncActive();
    return unsubscribe;
  })();
  tryPlace();
  return () => {
    waitObserver.disconnect();
    rootObserver.disconnect();
    if (unsubscribeRefresh !== undefined) unsubscribeRefresh();
    if (unsubscribeActive !== undefined) unsubscribeActive();
    entry.remove();
  };
}

// ---- center-column panel takeover ----
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]';
const ACTIVATE_EVENT = "dsh-panel-activate";
const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]';
function conversationColumn() {
  return document.querySelector(CONVERSATION_COLUMN_SELECTOR) ?? undefined;
}
function mountCenterPanel(options) {
  if (createRoot === null) return () => {};
  let root = undefined;
  let container = undefined;
  let unsubscribeLocale = undefined;
  try {
    unsubscribeLocale = options.locale?.subscribe(() => {
      if (root !== undefined) options.render(root);
    });
  } catch { /* locale service absent */ }
  const ensure = () => {
    if (container !== undefined) {
      if (container.isConnected) return;
      root?.unmount();
      root = undefined;
      container.remove();
      container = undefined;
    }
    const column = conversationColumn();
    if (column === undefined) return;
    container = document.createElement("div");
    container.dataset[options.viewDatasetKey] = "";
    container.dataset.dshPlugin = options.pluginName;
    container.className = options.viewClassName;
    column.appendChild(container);
    root = createRoot(container);
    options.render(root);
  };
  const waitObserver = new MutationObserver(() => { ensure(); });
  waitObserver.observe(document.body, { childList: true, subtree: true });
  const applyActive = () => {
    if (options.isOpen()) {
      document.documentElement.removeAttribute(options.siblingActiveAttribute);
      document.documentElement.setAttribute(options.activeAttribute, "");
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: options.panelName }));
    } else {
      document.documentElement.removeAttribute(options.activeAttribute);
    }
  };
  const onOtherActivate = (event) => {
    if (event.detail === options.siblingPanelName && options.isOpen()) options.close();
  };
  const onClickSidebarRow = (event) => {
    if (!options.isOpen()) return;
    const target = event.target;
    if (target instanceof Element && target.closest(SIDEBAR_ROW_SELECTOR) !== null) options.close();
  };
  document.addEventListener("click", onClickSidebarRow, true);
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate);
  const unsubscribe = options.subscribe(applyActive);
  applyActive();
  ensure();
  return () => {
    document.removeEventListener("click", onClickSidebarRow, true);
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate);
    waitObserver.disconnect();
    unsubscribe();
    if (unsubscribeLocale !== undefined) unsubscribeLocale();
    document.documentElement.removeAttribute(options.activeAttribute);
    root?.unmount();
    root = undefined;
    container?.remove();
    container = undefined;
  };
}

const inject = ["slots", "sessions", "inputTriggers"];

const ICON = '<svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 3.5h9M3.5 8h9M3.5 12.5h9"/><circle cx="1.6" cy="3.5" r="0.7" fill="currentColor" stroke="none"/><circle cx="1.6" cy="8" r="0.7" fill="currentColor" stroke="none"/><circle cx="1.6" cy="12.5" r="0.7" fill="currentColor" stroke="none"/></svg>';
const EXT_ICON = '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.2 3.2H4.2A1.7 1.7 0 0 0 2.5 4.9v6.2a1.7 1.7 0 0 0 1.7 1.7h6.2a1.7 1.7 0 0 0 1.7-1.7V9.1"/><path d="M9.3 2.5h4.2v4.2M13.3 2.7 7.6 8.4"/></svg>';
const LIST_ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 3.5h8M5 8h8M5 12.5h8"/><circle cx="2.5" cy="3.5" r="0.7" fill="currentColor" stroke="none"/><circle cx="2.5" cy="8" r="0.7" fill="currentColor" stroke="none"/><circle cx="2.5" cy="12.5" r="0.7" fill="currentColor" stroke="none"/></svg>';

const PICKER_BUG = /(bug|defect|缺陷)/i;

// List sorting (monai work-item toolbar): keyed by updated_at / id / priority / version.
const SORT_OPTIONS = [
  { value: "updated", label: "更新时间" },
  { value: "id", label: "工单 ID" },
  { value: "priority", label: "优先级" },
  { value: "version", label: "目标版本" },
];
const PRIORITY_WEIGHT = { urgent: 0, high: 1, normal: 2, low: 3 };
function priorityWeight(priority) {
  return PRIORITY_WEIGHT[priorityTone(priority)] ?? 2;
}

// id → {title, web_url} cache so the reference codec can serialize the title
// without a network call at submit time; populated when an item is picked.
const WORK_ITEM_CACHE = new Map();

// Composer work-item picker popup: search + 全部/Bug/其他 + list (monai pattern).
function WorkItemPicker({ onSelect, onClose }) {
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const d = await api(WORK_ITEMS_ROUTE) || {};
      let list = d.items || [];
      const q = query.trim();
      if (q) list = list.filter(it => String(it.title || "").includes(q) || String(it.description || "").includes(q) || String(it.external_id).includes(q) || String(it.id || "").includes(q));
      if (tab === "bug") list = list.filter(it => PICKER_BUG.test(String(it.category || "")));
      else if (tab === "other") list = list.filter(it => !PICKER_BUG.test(String(it.category || "")));
      setItems(list);
    } catch (e) { setError(e && e.message ? e.message : String(e)); }
    finally { setLoading(false); }
  }, [query, tab]);
  useEffect(() => { load(); }, [load]);
  return h("div", { className: "itx-picker" }, [
    h("div", { className: "itx-picker-head" }, [
      h("span", { className: "itx-picker-search-icon", "aria-hidden": true }, "⌕"),
      h("input", { className: "itx-picker-search", value: query, placeholder: "搜索工单…", onChange: (e) => setQuery(e.target.value), autoFocus: true }),
      h("button", { className: "itx-picker-close", onClick: onClose, "aria-label": "关闭" }, "×"),
    ]),
    h("div", { className: "itx-picker-tabs" }, [["all","全部"],["bug","Bug"],["other","其他"]].map((tv) => h("button", { key: tv[0], className: "itx-picker-tab" + (tab === tv[0] ? " active" : ""), onClick: () => setTab(tv[0]) }, tv[1]))),
    error ? h("div", { className: "itx-alert error" }, error) : null,
    loading ? h("div", { className: "itx-picker-empty" }, "加载中…")
      : items.length === 0 ? h("div", { className: "itx-picker-empty" }, "未找到匹配的工单")
      : h("div", { className: "itx-picker-list" }, items.map((it) => h("button", { key: it.external_id, className: "itx-picker-item", onClick: () => onSelect(it) }, [
          h("span", { className: "itx-picker-id" }, "#" + it.external_id),
          h("span", { className: "itx-picker-title" }, it.title),
          it.status ? h("span", { className: "itx-picker-status" }, it.status) : null,
        ]))),
    h("div", { className: "itx-picker-foot" }, "方向键选择 · Enter 确认"),
  ]);
}

// Composer tool-row button that opens the picker and inserts a structured
// reference chip (monai-style) into the draft via the scoped insert-reference
// event. Closure over ctx so it can reach the session-scope context.
function makeWorkItemComposerButton(ctx) {
  return function WorkItemComposerButton(props) {
    const useInput = props.useInput;
    const sessionId = props.sessionId;
    const input = typeof useInput === "function" ? useInput((s) => s) : { draft: "" };
    const inputRef = useRef(input);
    inputRef.current = input;
    const [open, setOpen] = useState(false);
    const onPick = (item) => {
      try {
        WORK_ITEM_CACHE.set(item.external_id, { title: item.title, web_url: item.web_url });
        const actx = ctx.sessions ? ctx.sessions.scope(sessionId) : undefined;
        if (actx && typeof actx.bail === "function") {
          const d = inputRef.current.draft || "";
          const span = { start: d.length, end: d.length, draftRev: inputRef.current.draftRev };
          const reference = {
            source: "work-item",
            ref: item.external_id,
            label: "#" + item.external_id + " " + item.title,
            appearance: "file",
            clipboardText: "#" + item.external_id,
          };
          actx.bail(actx, "slash/input-insert-reference", { reference, span });
        }
      } catch (e) { console.error("[dsh-issue-tracker] insert reference failed:", e); }
      setOpen(false);
    };
    return h("div", { className: "itx-compose-wrap" }, [
      h("button", { className: "itx-compose-btn", title: "引用工单", onClick: () => setOpen(!open) }, [
        h("span", { className: "itx-compose-btn-icon", dangerouslySetInnerHTML: { __html: LIST_ICON } }),
        h("span", null, "工单"),
      ]),
      open ? h(WorkItemPicker, { onSelect: onPick, onClose: () => setOpen(false) }) : null,
    ]);
  };
}

function apply(ctx) {
  ctx.effect(() => {
    const id = "@chihiroht/dsh-redmine-work-items/client";
    if (document.querySelector('style[data-plugin-css="' + id + '"]')) return () => {};
    const style = document.createElement("style");
    style.dataset.plugin = "@chihiroht/dsh-redmine-work-items";
    style.dataset.pluginCss = id;
    style.textContent = CSS;
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, "issue-tracker: styles");

  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "issue-tracker",
    order: 40,
    label: () => "工单管理",
    inject: () => ({}),
  }, RedmineSettingsSection));

  // Composer tool-row "工单" button: opens the picker and attaches the picked item.
  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "issue-tracker",
    order: 10,
  }, makeWorkItemComposerButton(ctx)));

  // Reference codec for the 'work-item' reference source: the inserted chip
  // serializes on submit via serializeReference; empty candidates keep it out
  // of the '/' menu (ready + empty groups render as null).
  ctx.effect(() => {
    const inputTriggers = ctx.get('inputTriggers');
    if (!inputTriggers || typeof inputTriggers.registerSource !== 'function') return () => {};
    try {
      const unregister = inputTriggers.registerSource({
        trigger: '/',
        name: 'work-item',
        order: 999,
        showGroupTitle: false,
        candidates: async () => [],
        onPick: () => ({ text: '' }),
        codec: {
          clipboardText: (ref) => `#${ref}`,
          serialize: async (ref) => {
            const info = WORK_ITEM_CACHE.get(String(ref));
            return `[工单 #${ref}${info && info.title ? "：" + info.title : ""}]`;
          },
        },
      });
      return () => { unregister(); };
    } catch (e) { console.error('[dsh-issue-tracker] register work-item codec failed:', e); return () => {}; }
  }, 'issue-tracker: work-item reference codec');

  // Sidebar entry (below 技能中心 / skill-explorer) + center-column takeover.
  ctx.effect(() => {
    const state = createViewState();
    let disposeEntry = () => {};
    let disposePanel = () => {};
    try {
      disposeEntry = mountSidebarEntry({
        rowAttribute: "data-dsh-issue-tracker-entry",
        rowSelector: "[data-dsh-issue-tracker-entry]",
        plugin: "issue-tracker",
        icon: ICON,
        css: { entry: "itx-entry", entryIcon: "itx-entryIcon", entryLabel: "itx-entryLabel" },
        label: () => "工单管理",
        tooltip: () => "工单管理：查看与同步 Redmine 工单",
        position: "after",
        familySelectors: [
          "[data-dsh-taskboard-entry]",
          "[data-dsh-ssh-entry]",
          "[data-dsh-skill-explorer-entry]",
          "[data-dsh-issue-tracker-entry]",
        ],
        onToggle: () => state.toggle(),
        active: { subscribe: state.subscribe, isOpen: state.isOpen },
      });
    } catch (error) { console.error("[dsh-issue-tracker] sidebar entry mount failed:", error); }
    try {
      disposePanel = mountCenterPanel({
        render: (root) => root.render(h(IssueTrackerView, { onClose: () => state.setOpen(false) })),
        viewDatasetKey: "dshIssueTrackerView",
        pluginName: "issue-tracker",
        viewClassName: "",
        activeAttribute: "data-dsh-issue-tracker-active",
        siblingActiveAttribute: "data-dsh-ssh-active",
        panelName: "issue-tracker",
        siblingPanelName: "ssh",
        isOpen: state.isOpen,
        close: () => state.setOpen(false),
        subscribe: state.subscribe,
        locale: undefined,
      });
    } catch (error) { console.error("[dsh-issue-tracker] center panel mount failed:", error); }
    return () => { disposeEntry(); disposePanel(); };
  }, "issue-tracker: sidebar entry + center panel");
}

exports.apply = apply;
exports.inject = inject;

return module.exports;
}});
