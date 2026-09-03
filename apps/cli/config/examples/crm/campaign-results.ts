/** Aggregate-only campaign result collection across independently available sources. */
import type { Session } from '@deepseek-ai/dsh-session'
import type { CrmMaService, MaCampaignId } from './ma-service.ts'
import type { CrmLoyaltyService } from './loyalty-service.ts'

/** Deployment-owned attribution mapping for one created campaign. */
export interface CampaignAttributionConfig {
  loyaltyActivityId?: string
  holdoutConfigured: boolean
}
/** One source projection that preserves partial failure. */
export type CampaignSourceResult<T> = { available: true; data: T } | { available: false; reason: string }
interface CampaignMaAggregate {
  status: string
  started: boolean
  archived: boolean
  reachPeople: number
  channels: readonly { channel: string; count: number }[]
}
interface CampaignLoyaltyAggregate {
  activities: number
  participations: number
  couponsReceived: number
  couponsRedeemed: number
}
/** Versioned aggregate campaign result. */
export interface CampaignResultsV1 {
  version: 1
  planId: string
  campaignId: string
  period: { start: string; end: string }
  ma: CampaignSourceResult<CampaignMaAggregate>
  loyalty: CampaignSourceResult<CampaignLoyaltyAggregate>
  conversion: { available: false; reason: string }
  incrementality: { available: false; reason: string }
}

/** Find the created inactive campaign associated with a current-session plan.
 * @param session Current durable session.
 * @param planId Opaque campaign-plan identity.
 * @returns Recorded MA campaign identity.
 */
export function findRecordedCampaign(session: Session, planId: string): MaCampaignId {
  const keys = session.events.filter(event => event.type === 'crm-campaign/draft-started' && event.data.planId === planId)
    .map(event => event.data.key)
  const ids = session.events.filter(event => event.type === 'crm-campaign/draft-created' && keys.includes(event.data.key))
    .map(event => event.data.campaignId as MaCampaignId)
  if (ids.length === 0) throw new Error('Created campaign was not found in the current session')
  if (new Set(ids).size !== 1) throw new Error('Conflicting recorded campaign ids')
  return ids[0]!
}

function date(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) }
function reason(): CampaignSourceResult<never> { return { available: false, reason: 'Source aggregate is unavailable' } }

/** Collect independent aggregate campaign results without customer-level joins.
 * @param session Current durable session.
 * @param planId Current-session plan identity.
 * @param period Closed reporting period.
 * @param attribution Deployment attribution mapping.
 * @param ma MA aggregate service.
 * @param loyalty Optional LOYALTY aggregate service.
 * @param signal Caller cancellation signal.
 * @returns Partial-safe aggregate result.
 */
export async function collectCampaignResults(
  session: Session, planId: string, period: { start: string; end: string }, attribution: CampaignAttributionConfig,
  ma: CrmMaService, loyalty: CrmLoyaltyService | undefined, signal: AbortSignal,
): Promise<CampaignResultsV1> {
  if (!date(period.start) || !date(period.end) || period.start >= period.end) throw new Error('Invalid campaign result period')
  const campaignId = findRecordedCampaign(session, planId)
  const [status, reach] = await Promise.allSettled([
    ma.campaignStatus(campaignId, signal), ma.reachSummary(campaignId, period.start, period.end, signal),
  ])
  const maResult = status.status === 'fulfilled' && reach.status === 'fulfilled'
    ? { available: true as const, data: { status: status.value.status, started: status.value.started,
      archived: status.value.archived, reachPeople: reach.value.reachPeople, channels: reach.value.channels } }
    : reason()
  let loyaltyResult: CampaignResultsV1['loyalty'] = { available: false, reason: 'No LOYALTY activity attribution is configured' }
  if (loyalty && attribution.loyaltyActivityId) {
    const request = { activityId: attribution.loyaltyActivityId, start: period.start, end: period.end }
    const values = await Promise.allSettled([loyalty.activitySummary(request, signal),
      loyalty.participationSummary(request, signal), loyalty.couponSummary(request, signal)])
    if (values.every(value => value.status === 'fulfilled')) {
      const [activities, participations, coupons] = values.map(value => (value as PromiseFulfilledResult<Awaited<ReturnType<CrmLoyaltyService['couponSummary']>>>).value)
      loyaltyResult = { available: true, data: { activities: activities.count, participations: participations.count,
        couponsReceived: coupons.received, couponsRedeemed: coupons.redeemed } }
    } else loyaltyResult = reason()
  }
  return { version: 1, planId, campaignId, period: { ...period }, ma: maResult, loyalty: loyaltyResult,
    conversion: { available: false, reason: 'No governed campaign-to-order attribution is configured' },
    incrementality: { available: false, reason: attribution.holdoutConfigured
      ? 'Holdout comparison is not available from the configured aggregate sources'
      : 'Incrementality requires a configured holdout group' } }
}
