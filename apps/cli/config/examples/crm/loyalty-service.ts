/** Aggregate-only LOYALTY reads exposed to the CRM campaign workflow. */
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque configured coupon-template identity. */
export type LoyaltyCouponTemplateId = Branded<'LoyaltyCouponTemplateId'>
/** Safe coupon-template projection. */
export interface LoyaltyCouponTemplate { id: LoyaltyCouponTemplateId; name: string; status: string }
/** Closed aggregate period request. */
export interface LoyaltySummaryRequest { activityId: string; start: string; end: string }
/** Aggregate count without member records. */
export interface LoyaltyCountSummary { count: number }
/** Read-only LOYALTY capability. */
export interface CrmLoyaltyService {
  couponTemplate(id: LoyaltyCouponTemplateId, signal: AbortSignal): Promise<LoyaltyCouponTemplate>
  activitySummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCountSummary>
  participationSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<LoyaltyCountSummary>
  couponSummary(request: LoyaltySummaryRequest, signal: AbortSignal): Promise<{ received: number; redeemed: number }>
}

declare module '@deepseek-ai/cordis' { interface Context { crmLoyalty: CrmLoyaltyService } }
