/** Bounded read-only CDP tag catalog provider. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CdpTagCatalogItem, CdpTagId, CrmCdpService } from './cdp-service.ts'

/** Explicit CDP transport settings. */
export interface CdpConfig {
  endpoint: string
  allowHttp: boolean
  allowUnauthenticated: boolean
  collectionId: string
  usernameEnv: string
  passwordEnv: string
  timeoutMs: number
  maxResponseBytes: number
}
/** Cordis configuration schema for the CDP provider. */
export const Config = z.object({ endpoint: z.string().required(), allowHttp: z.boolean().required(),
  allowUnauthenticated: z.boolean().required(), collectionId: z.string().required(), usernameEnv: z.string().required(),
  passwordEnv: z.string().required(), timeoutMs: z.number().required(), maxResponseBytes: z.number().required() })

function auth(config: CdpConfig, env: NodeJS.ProcessEnv): string | undefined {
  const username = env[config.usernameEnv]
  const password = env[config.passwordEnv]
  if (username === undefined && password === undefined && config.allowUnauthenticated) return undefined
  if (!username || !password || username.includes(':')) throw new Error('Invalid CDP credentials')
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/** Resolve CDP configuration without publishing credentials.
 * @param config Deployment settings.
 * @param env Credential source.
 * @returns Validated settings.
 */
export function resolveCdpConfig(config: CdpConfig, env: NodeJS.ProcessEnv): Readonly<CdpConfig> {
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('CDP endpoint must be a root URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.allowHttp)) throw new Error('HTTPS required unless allowHttp is enabled')
  if (!/^[a-z][a-z0-9_]*$/.test(config.collectionId) || !Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0
    || !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes <= 0) throw new Error('Invalid CDP configuration')
  auth(config, env)
  return Object.freeze({ ...config, endpoint: url.origin })
}

/** HTTP implementation of the bounded CDP tag catalog. */
export class CrmCdpHttpProvider implements CrmCdpService {
  constructor(private readonly config: Readonly<CdpConfig>, private readonly env: NodeJS.ProcessEnv) {}
  async tagCatalog(query: string | undefined, limit: number, signal: AbortSignal): Promise<readonly CdpTagCatalogItem[]> {
    const response = await fetch(`${this.config.endpoint}/api/cdp-portal/tag/${encodeURIComponent(this.config.collectionId)}/list`, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)]), redirect: 'manual', headers: {
        accept: 'application/json', ...(auth(this.config, this.env) === undefined ? {} : { authorization: auth(this.config, this.env)! }),
      },
    })
    if (!response.ok) throw new Error(`CDP HTTP ${response.status}`)
    const bytes = new Uint8Array(await response.arrayBuffer())
    if (bytes.byteLength > this.config.maxResponseBytes) throw new Error('CDP response byte limit exceeded')
    let value: unknown
    try { value = JSON.parse(Buffer.from(bytes).toString('utf8')) }
    catch { throw new Error('Invalid CDP JSON response') }
    if (!Array.isArray(value)) throw new Error('Invalid CDP tag catalog')
    const needle = query?.trim().toLocaleLowerCase()
    const rows = value.flatMap((entry): CdpTagCatalogItem[] => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
      const item = entry as Record<string, unknown>
      if (item.delete === true || typeof item.id !== 'string' || typeof item.code !== 'string' || typeof item.name !== 'string') return []
      const fullName = typeof item.fullName === 'string' ? item.fullName : item.name
      if (needle && !`${item.code} ${item.name} ${fullName}`.toLocaleLowerCase().includes(needle)) return []
      return [{ id: item.id as CdpTagId, code: item.code, name: item.name, fullName,
        ...(Number.isSafeInteger(item.matchCount) && (item.matchCount as number) >= 0 ? { matchCount: item.matchCount as number } : {}) }]
    })
    return Object.freeze(rows.slice(0, limit).map(item => Object.freeze(item)))
  }
}

/** Register the CDP provider.
 * @param ctx Cordis context.
 * @param config Deployment settings.
 */
export function apply(ctx: Context, config: CdpConfig): void {
  ctx.provide('crmCdp', new CrmCdpHttpProvider(resolveCdpConfig(config, process.env), process.env))
}
