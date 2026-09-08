// lib/config.js — settings namespace + schema for @chihiroht/dsh-redmine-work-items.
// Mirrors the dsh-prompt-persona config pattern (ctx.settings.register + schemastery).

import z from '@deepseek-ai/schemastery'

export const SETTINGS_NAMESPACE = 'issue-tracker'

export const DEFAULT_BASE = ''

export const Config = z.object({
  redmine: z.object({
    baseUrl: z.string().default(DEFAULT_BASE),
    apiKey: z.string().default(''),
  }),
  autoSync: z.boolean().default(false),
  syncIntervalMin: z.number().min(5).max(24 * 60).default(10),
})

/** Normalize the current config value (never trust raw user input). */
export function resolveConfig(config = {}) {
  const red = config?.redmine ?? {}
  const autoSync = config?.autoSync
  const interval = config?.syncIntervalMin
  return {
    redmine: {
      baseUrl: (typeof red.baseUrl === 'string' && red.baseUrl.length > 0) ? red.baseUrl : DEFAULT_BASE,
      apiKey: typeof red.apiKey === 'string' ? red.apiKey : '',
    },
    autoSync: autoSync === true,
    syncIntervalMin: (typeof interval === 'number' && interval >= 5) ? interval : 10,
  }
}

/** Mask a secret for the settings snapshot (never echo the full key). */
function maskKey(value) {
  return value ? `${String(value).slice(0, 5)}…` : ''
}

/** Safe printable view of config for the browser settings panel. */
export function snapshotOf(value) {
  const resolved = resolveConfig(value)
  return {
    redmine: {
      baseUrl: resolved.redmine.baseUrl,
      apiKey: maskKey(resolved.redmine.apiKey),
    },
    autoSync: resolved.autoSync,
    syncIntervalMin: resolved.syncIntervalMin,
  }
}
