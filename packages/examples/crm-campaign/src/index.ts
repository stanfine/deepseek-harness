/** Persisted CRM campaign-draft progress identities and events.
 * @module @deepseek-ai/dsh-crm-campaign
 */
import type { Branded } from '@deepseek-ai/dsh-brand'
import type {} from '@deepseek-ai/dsh-session/types'

/** Opaque current-session campaign-plan identity. */
export type CrmCampaignPlanId = Branded<'CrmCampaignPlanId'>
/** Deterministic identity for one external draft-creation attempt. */
export type CrmCampaignIdempotencyKey = Branded<'CrmCampaignIdempotencyKey'>
/** Opaque MA audience identity retained after creation. */
export type CrmMaAudienceId = Branded<'CrmMaAudienceId'>
/** Opaque MA campaign identity retained after creation. */
export type CrmMaCampaignId = Branded<'CrmMaCampaignId'>

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /**
     * A confirmed draft operation began before any remote write.
     * @param key - deterministic operation identity
     * @param planId - current-session plan identity
     * @param inputDigest - digest of the resolved governed inputs
     */
    'crm-campaign/draft-started': { key: CrmCampaignIdempotencyKey; planId: CrmCampaignPlanId; inputDigest: string }
    /**
     * MA created or resolved the governed audience for an operation.
     * @param key - deterministic operation identity
     * @param audienceId - opaque MA audience identity
     */
    'crm-campaign/audience-created': { key: CrmCampaignIdempotencyKey; audienceId: CrmMaAudienceId }
    /**
     * MA created or resolved the inactive campaign draft for an operation.
     * @param key - deterministic operation identity
     * @param audienceId - opaque MA audience identity
     * @param campaignId - opaque MA campaign identity
     * @param status - inactive-only lifecycle state
     */
    'crm-campaign/draft-created': {
      key: CrmCampaignIdempotencyKey
      audienceId: CrmMaAudienceId
      campaignId: CrmMaCampaignId
      status: 'inactive'
    }
    /**
     * A bounded failure ended one operation stage without deleting remote data.
     * @param key - deterministic operation identity
     * @param stage - stage that failed
     * @param code - bounded retry or reconciliation outcome
     */
    'crm-campaign/draft-failed': {
      key: CrmCampaignIdempotencyKey
      stage: 'validation' | 'audience' | 'campaign'
      code: 'FAILED' | 'AMBIGUOUS' | 'MANUAL_RECONCILIATION'
    }
  }
}
