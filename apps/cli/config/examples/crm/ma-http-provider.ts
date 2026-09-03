/** Bounded HTTP provider for the configured MA deployment. */
import type { Context } from '@deepseek-ai/cordis'
import type { JsonValue } from '@deepseek-ai/dsh-session'
import z from '@deepseek-ai/schemastery'
import type { CrmMaService, MaAudienceId, MaAudienceRef, MaCampaignId, MaCampaignRef, MaCampaignStatus,
  MaReachSummary, ResolvedMaAudience, ResolvedMaCampaign } from './ma-service.ts'

/** Explicit transport and deployment settings for MA. */
export interface MaConfig {
  endpoint: string
  allowHttp: boolean
  allowUnauthenticated: boolean
  tenantId: string
  buCode: string
  usernameEnv: string
  passwordEnv: string
  timeoutMs: number
  maxResponseBytes: number
}

/** Cordis configuration schema for the MA provider. */
export const Config = z.object({
  endpoint: z.string().required(), allowHttp: z.boolean().required(), allowUnauthenticated: z.boolean().required(),
  tenantId: z.string().required(), buCode: z.string().required(), usernameEnv: z.string().required(), passwordEnv: z.string().required(),
  timeoutMs: z.number().required(), maxResponseBytes: z.number().required(),
})

/** Validated MA settings without resolved credential values. */
export interface ResolvedMaConfig extends MaConfig { endpoint: string }

function authorization(config: MaConfig, env: NodeJS.ProcessEnv): string | undefined {
  const username = env[config.usernameEnv]
  const password = env[config.passwordEnv]
  if (username === undefined && password === undefined && config.allowUnauthenticated) return undefined
  if (!username || !password) throw new Error('MA credentials are required unless allowUnauthenticated is enabled')
  if (username.includes(':')) throw new Error('MA username cannot contain colon')
  return `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`
}

/** Validate MA transport policy without publishing credentials.
 * @param config Deployment configuration.
 * @param env Credential source.
 * @returns Validated configuration.
 */
export function resolveMaConfig(config: MaConfig, env: NodeJS.ProcessEnv): ResolvedMaConfig {
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('MA endpoint must be a root URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.allowHttp)) throw new Error('HTTPS required unless allowHttp is enabled')
  if (!/^[a-z][a-z0-9_-]*$/.test(config.tenantId) || !/^[a-z][a-z0-9_-]*$/.test(config.buCode)) throw new Error('Invalid MA tenant or business unit')
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0
    || !Number.isSafeInteger(config.maxResponseBytes) || config.maxResponseBytes <= 0) throw new Error('Invalid MA transport limits')
  authorization(config, env)
  return Object.freeze({ ...config, endpoint: url.origin })
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid MA JSON response')
  return value as Record<string, unknown>
}

function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Invalid MA ${name}`)
  return value
}

/** Stateless MA transport whose callers can supply only resolved logical specs. */
export class CrmMaHttpProvider implements CrmMaService {
  private readonly config: ResolvedMaConfig
  private readonly env: NodeJS.ProcessEnv

  /** Create one bounded MA HTTP client.
   * @param config Validated transport configuration.
   * @param env Credential environment.
   */
  constructor(config: ResolvedMaConfig, env: NodeJS.ProcessEnv) {
    this.config = config
    this.env = env
  }

  private async request(path: string, method: 'GET' | 'POST', body: JsonValue | undefined, signal: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const auth = authorization(this.config, this.env)
    try {
      const response = await fetch(`${this.config.endpoint}/api/ma-manage/${this.config.tenantId}/${this.config.buCode}${path}`, {
        method, redirect: 'manual', signal: combined, headers: { accept: 'application/json',
          ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...(auth === undefined ? {} : { authorization: auth }) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      if (!response.ok) throw new Error(`MA HTTP ${response.status}`)
      if (!response.body) throw new Error('Empty MA response')
      const reader = response.body.getReader()
      const chunks: Uint8Array[] = []
      let size = 0
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        size += chunk.value.byteLength
        if (size > this.config.maxResponseBytes) throw new Error('MA response byte limit exceeded')
        chunks.push(chunk.value)
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
      catch { throw new Error('Invalid MA JSON response') }
    } catch (error) {
      if (error instanceof Error && /^MA HTTP |^MA response |^Invalid MA |^Empty MA /.test(error.message)) throw error
      throw new Error(combined.aborted ? 'MA request cancelled or timed out' : 'MA connection failed')
    }
  }

  private audienceBody(spec: ResolvedMaAudience, key?: string): JsonValue {
    return { ...spec, own: true, extra: { ...spec.extra, ...(key === undefined ? {} : { businessKey: key }) } }
  }

  async countAudience(spec: ResolvedMaAudience, signal: AbortSignal): Promise<number> {
    const value = await this.request('/audience/count-customers', 'POST', this.audienceBody(spec), signal)
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid MA audience count')
    return value
  }

  async createAudience(spec: ResolvedMaAudience, key: string, signal: AbortSignal): Promise<MaAudienceRef> {
    const value = object(await this.request('/audience', 'POST', this.audienceBody(spec, key), signal))
    return { id: text(value.id, 'audience id') as MaAudienceId, name: text(value.name, 'audience name') }
  }

  async findAudienceByBusinessKey(key: string, signal: AbortSignal): Promise<MaAudienceRef | undefined> {
    const value = await this.request('/audience/list?proj=id,name,extra', 'GET', undefined, signal)
    const rows = Array.isArray(value) ? value : object(value).data
    if (!Array.isArray(rows)) throw new Error('Invalid MA audience list')
    const found = rows.map(object).find(item => object(item.extra).businessKey === key)
    return found === undefined ? undefined : { id: text(found.id, 'audience id') as MaAudienceId, name: text(found.name, 'audience name') }
  }

  async validateCanvas(id: MaCampaignId, canvas: JsonValue, signal: AbortSignal): Promise<readonly string[]> {
    const value = await this.request(`/campaign/${encodeURIComponent(id)}/validate`, 'POST', canvas, signal)
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw new Error('Invalid MA validation response')
    return Object.freeze([...value]) as readonly string[]
  }

  predictCanvas(canvas: JsonValue, signal: AbortSignal): Promise<JsonValue> {
    return this.request('/campaign/predict/start', 'POST', canvas, signal) as Promise<JsonValue>
  }

  async createCampaignDraft(spec: ResolvedMaCampaign, key: string, signal: AbortSignal): Promise<MaCampaignRef> {
    const value = object(await this.request('/campaign/new', 'POST', { ...spec, status: 'DRAFT', started: false, archived: false,
      extra: { ...spec.extra, businessKey: key } }, signal))
    return { id: text(value.id, 'campaign id') as MaCampaignId, name: text(value.name, 'campaign name'),
      status: text(value.status, 'campaign status') }
  }

  async findCampaignByBusinessKey(key: string, signal: AbortSignal): Promise<MaCampaignRef | undefined> {
    const value = await this.request('/campaign/list?proj=id,name,status,extra', 'GET', undefined, signal)
    const rows = Array.isArray(value) ? value : object(value).data
    if (!Array.isArray(rows)) throw new Error('Invalid MA campaign list')
    const found = rows.map(object).find(item => object(item.extra).businessKey === key)
    return found === undefined ? undefined : { id: text(found.id, 'campaign id') as MaCampaignId,
      name: text(found.name, 'campaign name'), status: text(found.status, 'campaign status') }
  }

  async campaignStatus(id: MaCampaignId, signal: AbortSignal): Promise<MaCampaignStatus> {
    const value = object(await this.request(`/campaign/${encodeURIComponent(id)}`, 'GET', undefined, signal))
    if (typeof value.started !== 'boolean' || typeof value.archived !== 'boolean') throw new Error('Invalid MA campaign status')
    return { id: text(value.id, 'campaign id') as MaCampaignId, status: text(value.status, 'campaign status'),
      started: value.started, archived: value.archived }
  }

  async reachSummary(id: MaCampaignId, start: string, end: string, signal: AbortSignal): Promise<MaReachSummary> {
    const query = `?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`
    const value = object(await this.request(`/flow-monitor/reach-summary/${encodeURIComponent(id)}${query}`, 'GET', undefined, signal))
    if (!Number.isSafeInteger(value.reachPeople) || (value.reachPeople as number) < 0 || !Array.isArray(value.channels)) {
      throw new Error('Invalid MA reach summary')
    }
    return { reachPeople: value.reachPeople as number, channels: Object.freeze([]) }
  }
}

/** Register the MA provider in the CRM preset.
 * @param ctx Cordis plugin context.
 * @param config Explicit deployment settings.
 */
export function apply(ctx: Context, config: MaConfig): void {
  ctx.provide('crmMa', new CrmMaHttpProvider(resolveMaConfig(config, process.env), process.env))
}
