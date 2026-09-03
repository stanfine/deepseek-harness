/** Protocol-independent MA service values used by the CRM workflow. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { Branded } from '@deepseek-ai/dsh-brand'

/** Opaque MA audience identity. */
export type MaAudienceId = Branded<'MaAudienceId'>
/** Opaque MA campaign identity. */
export type MaCampaignId = Branded<'MaCampaignId'>
/** Resolved governed audience accepted only from the policy compiler. */
export interface ResolvedMaAudience {
  id: string
  name: string
  description: string
  selectType: string
  usageType: string
  filter: JsonValue
  setting: JsonValue
  extra: Record<string, string>
}
/** Resolved inactive campaign accepted only from the canvas compiler. */
export interface ResolvedMaCampaign {
  id: string
  name: string
  groupId: string
  campaignCode: string
  category: string
  type: string
  priority: number
  summary: string
  setting: JsonValue
  extra: Record<string, string>
}
/** Created or reused MA audience reference. */
export interface MaAudienceRef { id: MaAudienceId; name: string }
/** Created or reused inactive MA campaign reference. */
export interface MaCampaignRef { id: MaCampaignId; name: string; status: string }
/** Safe campaign lifecycle projection. */
export interface MaCampaignStatus { id: MaCampaignId; status: string; started: boolean; archived: boolean }
/** Aggregate MA reach projection. */
export interface MaReachSummary { reachPeople: number; channels: readonly { channel: string; count: number }[] }

/** MA operations required by governed CRM campaign creation. */
export interface CrmMaService {
  countAudience(spec: ResolvedMaAudience, signal: AbortSignal): Promise<number>
  createAudience(spec: ResolvedMaAudience, key: string, signal: AbortSignal): Promise<MaAudienceRef>
  findAudienceByBusinessKey(key: string, signal: AbortSignal): Promise<MaAudienceRef | undefined>
  validateCanvas(campaignId: MaCampaignId, canvas: JsonValue, signal: AbortSignal): Promise<readonly string[]>
  predictCanvas(canvas: JsonValue, signal: AbortSignal): Promise<JsonValue>
  createCampaignDraft(spec: ResolvedMaCampaign, key: string, signal: AbortSignal): Promise<MaCampaignRef>
  findCampaignByBusinessKey(key: string, signal: AbortSignal): Promise<MaCampaignRef | undefined>
  campaignStatus(id: MaCampaignId, signal: AbortSignal): Promise<MaCampaignStatus>
  reachSummary(id: MaCampaignId, start: string, end: string, signal: AbortSignal): Promise<MaReachSummary>
}

declare module '@deepseek-ai/cordis' {
  interface Context { crmMa: CrmMaService }
}
