/** Session-backed idempotent MA campaign-draft creation coordinator. */
import { createHash } from 'node:crypto'
import type { CrmCampaignIdempotencyKey, CrmCampaignPlanId, CrmMaAudienceId,
  CrmMaCampaignId } from '@deepseek-ai/dsh-crm-campaign'
import type { Session } from '@deepseek-ai/dsh-session'
import { campaignPlanIdFor, type CampaignPlanResultV1 } from './campaign-planner.ts'
import type { CrmMaService, MaAudienceId, MaCampaignId, ResolvedMaAudience, ResolvedMaCampaign } from './ma-service.ts'
import type { ResolvedMaCanvas } from './campaign-canvas.ts'
import { compileMaCampaignSetting, compileMaFlowData } from './ma-wire.ts'

/** Fully resolved internal creation inputs; no field is model supplied. */
export interface CampaignDraftServices {
  ma: CrmMaService
  tenantId: string
  maxAudienceSize: number
  audience: ResolvedMaAudience
  campaign: ResolvedMaCampaign
  canvas: ResolvedMaCanvas
}
/** Safe versioned creation result. */
export interface CampaignDraftResultV1 {
  version: 1
  planId: string
  idempotencyKey: string
  audienceId: string
  campaignId: string
  status: 'inactive'
  created: boolean
  warnings: readonly string[]
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

/** Resolve a valid plan from current-session presentation metadata.
 * @param session Current session.
 * @param planId Opaque requested plan identity.
 * @returns Valid recorded campaign plan.
 */
export function findCampaignPlan(session: Session, planId: string): CampaignPlanResultV1 {
  const found = session.events.flatMap((event) => {
    if (event.type !== 'tool/result') return []
    const envelope = record(record(event.data.meta)?.crmCampaignPlan)
    const value = record(envelope?.data)
    return envelope?.version === 1 && value?.planId === planId ? [value as unknown as CampaignPlanResultV1] : []
  })
  if (found.length === 0) throw new Error('Campaign plan was not found in the current session')
  if (new Set(found.map(value => JSON.stringify(value))).size > 1) throw new Error('Conflicting campaign plan records')
  const plan = found[0]!
  if (campaignPlanIdFor(plan.recommendationId, plan.audiencePreview, plan.activation) !== plan.planId) throw new Error('Campaign plan digest mismatch')
  if (!plan.readyForCreation || plan.status !== 'preview') throw new Error('Campaign plan is not ready for creation')
  return plan
}

function operationIdentity(services: CampaignDraftServices, plan: CampaignPlanResultV1) {
  const input = { version: 1, tenantId: services.tenantId, plan, audience: services.audience,
    campaign: services.campaign, canvas: services.canvas }
  const inputDigest = createHash('sha256').update(JSON.stringify(input)).digest('base64url')
  return { inputDigest, key: `draft_${inputDigest}` as CrmCampaignIdempotencyKey }
}

function completed(session: Session, key: CrmCampaignIdempotencyKey): CampaignDraftResultV1 | undefined {
  const records = session.events.filter(event => event.type === 'crm-campaign/draft-created'
    && (event.data as { key: string }).key === key)
  if (new Set(records.map(event => JSON.stringify(event.data))).size > 1) throw new Error('Conflicting completed campaign records')
  const value = records[0]?.data as { key: CrmCampaignIdempotencyKey
    audienceId: CrmMaAudienceId
    campaignId: CrmMaCampaignId
    status: 'inactive' } | undefined
  if (!value) return undefined
  const started = session.events.find(event => event.type === 'crm-campaign/draft-started'
    && (event.data as { key: string }).key === key)
  if (!started) throw new Error('Campaign completion has no matching start record')
  const startData = started.data as { planId: CrmCampaignPlanId }
  return { version: 1, planId: startData.planId, idempotencyKey: key, audienceId: value.audienceId,
    campaignId: value.campaignId, status: 'inactive', created: false, warnings: Object.freeze([]) }
}

function recordedAudience(session: Session, key: CrmCampaignIdempotencyKey): MaAudienceId | undefined {
  const records = session.events.filter(event => event.type === 'crm-campaign/audience-created'
    && (event.data as { key: string }).key === key)
  if (new Set(records.map(event => (event.data as { audienceId: string }).audienceId)).size > 1) {
    throw new Error('Conflicting campaign audience records')
  }
  return (records[0]?.data as { audienceId: CrmMaAudienceId } | undefined)?.audienceId as unknown as MaAudienceId | undefined
}

function ambiguous(error: unknown): boolean {
  return error instanceof Error && /cancelled or timed out|connection failed/i.test(error.message)
}

/** Revalidate and create or replay one inactive MA campaign draft.
 * @param session Current session and durable operation log.
 * @param services Resolved internal MA inputs and service.
 * @param plan Valid current-session plan.
 * @param signal Caller cancellation signal.
 * @returns Created or replayed inactive draft reference.
 */
export async function createCampaignDraft(
  session: Session, services: CampaignDraftServices, plan: CampaignPlanResultV1, signal: AbortSignal,
): Promise<CampaignDraftResultV1> {
  signal.throwIfAborted()
  if (findCampaignPlan(session, plan.planId).recommendationId !== plan.recommendationId) throw new Error('Campaign plan mismatch')
  const { key, inputDigest } = operationIdentity(services, plan)
  const replay = completed(session, key)
  if (replay) return replay
  if (!session.events.some(event => event.type === 'crm-campaign/draft-started' && event.data.key === key)) {
    session.append('crm-campaign/draft-started', { key, planId: plan.planId as CrmCampaignPlanId, inputDigest })
  }
  try {
    const count = await services.ma.countAudience(services.audience, signal)
    if (count > services.maxAudienceSize) throw new Error('Audience exceeds configured maximum')
  } catch {
    session.append('crm-campaign/draft-failed', { key, stage: 'validation', code: 'FAILED' })
    throw new Error('Campaign audience validation failed')
  }
  let audienceId = recordedAudience(session, key)
  if (!audienceId) {
    try {
      audienceId = (await services.ma.createAudience(services.audience, key, signal)).id
    } catch (error) {
      if (ambiguous(error)) {
        try { audienceId = (await services.ma.findAudienceByBusinessKey(key, signal))?.id }
        catch {
          session.append('crm-campaign/draft-failed', { key, stage: 'audience', code: 'MANUAL_RECONCILIATION' })
          throw new Error('Audience creation requires manual reconciliation')
        }
      }
      if (!audienceId) {
        session.append('crm-campaign/draft-failed', { key, stage: 'audience', code: ambiguous(error) ? 'AMBIGUOUS' : 'FAILED' })
        throw new Error('Audience creation failed')
      }
    }
    session.append('crm-campaign/audience-created', { key, audienceId: audienceId as unknown as CrmMaAudienceId })
  }
  const flowData = compileMaFlowData(services.canvas, audienceId)
  try {
    const validation = await services.ma.validateCanvas(services.campaign.id as MaCampaignId, flowData, signal)
    if (validation.length > 0) throw new Error('MA canvas validation failed')
  } catch {
    session.append('crm-campaign/draft-failed', { key, stage: 'validation', code: 'FAILED' })
    throw new Error('Campaign canvas validation failed')
  }
  const campaign = { ...services.campaign, setting: compileMaCampaignSetting(flowData) }
  let campaignId: MaCampaignId
  try {
    const created = await services.ma.createCampaignDraft(campaign, key, signal)
    if (!['DRAFT', 'INACTIVE'].includes(created.status.toUpperCase())) throw new Error('MA campaign is not inactive')
    campaignId = created.id
  } catch (error) {
    if (ambiguous(error)) {
      try {
        const resolved = await services.ma.findCampaignByBusinessKey(key, signal)
        if (resolved && ['DRAFT', 'INACTIVE'].includes(resolved.status.toUpperCase())) campaignId = resolved.id
        else throw new Error('not resolved')
      } catch {
        session.append('crm-campaign/draft-failed', { key, stage: 'campaign', code: 'MANUAL_RECONCILIATION' })
        throw new Error('Campaign creation requires manual reconciliation')
      }
    } else {
      session.append('crm-campaign/draft-failed', { key, stage: 'campaign', code: 'FAILED' })
      throw new Error('Campaign creation failed')
    }
  }
  session.append('crm-campaign/draft-created', { key, audienceId: audienceId as unknown as CrmMaAudienceId,
    campaignId: campaignId! as unknown as CrmMaCampaignId, status: 'inactive' })
  return { version: 1, planId: plan.planId, idempotencyKey: key, audienceId, campaignId: campaignId!,
    status: 'inactive', created: true, warnings: Object.freeze([]) }
}
