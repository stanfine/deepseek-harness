/** Bounded read-only HTTP provider for LOYALTY aggregate data. */
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type { CrmLoyaltyService, LoyaltyCountSummary, LoyaltyCouponTemplate, LoyaltyCouponTemplateId,
  LoyaltySummaryRequest } from './loyalty-service.ts'

/** Explicit LOYALTY transport configuration. */
export interface LoyaltyConfig {
  endpoint: string
  allowHttp: boolean
  allowUnauthenticated: boolean
  tenantId: string
  buCode: string
  usernameEnv: string
  passwordEnv: string
  timeoutMs: number
  maxResponseBytes: number
  couponTemplateIds: string[]
}
/** Cordis configuration schema for the LOYALTY provider. */
export const Config = z.object({ endpoint: z.string().required(), allowHttp: z.boolean().required(),
  allowUnauthenticated: z.boolean().required(), tenantId: z.string().required(), buCode: z.string().required(),
  usernameEnv: z.string().required(), passwordEnv: z.string().required(), timeoutMs: z.number().required(),
  maxResponseBytes: z.number().required(), couponTemplateIds: z.array(z.string()).required() })
/** Validated settings without credential values. */
export interface ResolvedLoyaltyConfig extends LoyaltyConfig { endpoint: string }

function auth(config: LoyaltyConfig, env: NodeJS.ProcessEnv): string | undefined {
  const user = env[config.usernameEnv]; const password = env[config.passwordEnv]
  if (user === undefined && password === undefined && config.allowUnauthenticated) return undefined
  if (!user || !password) throw new Error('LOYALTY credentials are required unless allowUnauthenticated is enabled')
  if (user.includes(':')) throw new Error('LOYALTY username cannot contain colon')
  return `Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`
}

/** Validate transport policy and allowlists.
 * @param config Deployment configuration.
 * @param env Credential source.
 * @returns Validated configuration.
 */
export function resolveLoyaltyConfig(config: LoyaltyConfig, env: NodeJS.ProcessEnv): ResolvedLoyaltyConfig {
  const url = new URL(config.endpoint)
  if (url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('LOYALTY endpoint must be a root URL')
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && config.allowHttp)) throw new Error('HTTPS required unless allowHttp is enabled')
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0 || !Number.isSafeInteger(config.maxResponseBytes)
    || config.maxResponseBytes <= 0 || new Set(config.couponTemplateIds).size !== config.couponTemplateIds.length) {
    throw new Error('Invalid LOYALTY configuration')
  }
  auth(config, env)
  return Object.freeze({ ...config, endpoint: url.origin,
    couponTemplateIds: Object.freeze([...config.couponTemplateIds]) }) as ResolvedLoyaltyConfig
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid LOYALTY JSON response')
  return value as Record<string, unknown>
}
function requiredText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid LOYALTY text')
  return value
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('Invalid LOYALTY count')
  return value
}

/** Stateless LOYALTY reader with no mutation methods. */
export class CrmLoyaltyHttpProvider implements CrmLoyaltyService {
  private readonly config: ResolvedLoyaltyConfig
  private readonly env: NodeJS.ProcessEnv

  /** Create one bounded LOYALTY HTTP client.
   * @param config Validated transport configuration.
   * @param env Credential environment.
   */
  constructor(config: ResolvedLoyaltyConfig, env: NodeJS.ProcessEnv) {
    this.config = config
    this.env = env
  }
  private async get(prefix: 'coupon' | 'activity', path: string, signal: AbortSignal): Promise<unknown> {
    const combined = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    try {
      const authorization = auth(this.config, this.env)
      const root = prefix === 'coupon' ? 'loyalty-coupon' : 'loyalty-activity'
      const response = await fetch(`${this.config.endpoint}/api/${root}/${this.config.tenantId}/${this.config.buCode}${path}`, {
        redirect: 'manual', signal: combined, headers: { accept: 'application/json',
          ...(authorization === undefined ? {} : { authorization }) },
      })
      if (!response.ok) throw new Error(`LOYALTY HTTP ${response.status}`)
      if (!response.body) throw new Error('Empty LOYALTY response')
      const reader = response.body.getReader(); const chunks: Uint8Array[] = []; let size = 0
      while (true) {
        const chunk = await reader.read(); if (chunk.done) break
        size += chunk.value.byteLength
        if (size > this.config.maxResponseBytes) throw new Error('LOYALTY response byte limit exceeded')
        chunks.push(chunk.value)
      }
      try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
      catch { throw new Error('Invalid LOYALTY JSON response') }
    } catch (error) {
      if (error instanceof Error && /^(?:LOYALTY HTTP |LOYALTY response |Invalid LOYALTY |Empty LOYALTY )/.test(error.message)) throw error
      throw new Error(combined.aborted ? 'LOYALTY request cancelled or timed out' : 'LOYALTY connection failed')
    }
  }
  async couponTemplate(id: LoyaltyCouponTemplateId, signal: AbortSignal): Promise<LoyaltyCouponTemplate> {
    if (!this.config.couponTemplateIds.includes(id)) throw new Error('LOYALTY coupon template is not allowlisted')
    const value = object(await this.get('coupon', `/coupon_template/${encodeURIComponent(id)}`, signal))
    if (value.id !== id) throw new Error('LOYALTY coupon template identity mismatch')
    return { id, name: requiredText(value.name), status: requiredText(value.status) }
  }
  activitySummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCountSummary> {
    return this.countSummary('/activity/count', request, signal)
  }
  participationSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCountSummary> {
    return this.countSummary('/activity-record/count', request, signal)
  }
  private async countSummary(path: string, request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCountSummary> {
    const query = `?activityId=${encodeURIComponent(request.activityId)}&startDate=${request.start}&endDate=${request.end}`
    return { count: count(await this.get('activity', `${path}${query}`, signal)) }
  }
  async couponSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<{ received: number; redeemed: number }> {
    const query = `?activityId=${encodeURIComponent(request.activityId)}&startDate=${request.start}&endDate=${request.end}`
    const received = count(await this.get('coupon', `/coupon_item/statisticReceive${query}`, signal))
    const redeemed = count(await this.get('coupon', `/coupon_item/statisticRedeem${query}`, signal))
    return { received, redeemed }
  }
}

/** Register the read-only LOYALTY provider.
 * @param ctx Cordis plugin context.
 * @param config Explicit deployment settings.
 */
export function apply(ctx: Context, config: LoyaltyConfig): void {
  ctx.provide('crmLoyalty', new CrmLoyaltyHttpProvider(resolveLoyaltyConfig(config, process.env), process.env))
}
