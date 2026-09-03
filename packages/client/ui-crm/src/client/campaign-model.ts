/** Strict browser validation for persisted CRM marketing presentations. */
interface RecommendationCard {
  recommendationId: string
  title: string
  score: number
  priority: number
  actionTemplate: string
  limitations: string[]
}
interface PlanCard {
  planId: string
  readyForCreation: boolean
  readinessReasons: string[]
  audiencePreview: { conditions: unknown[]; estimatedCount?: number; unavailableReasons: string[] }
  actionTemplate: string
  primaryMetrics: string[]
  guardrailMetrics: string[]
  limitations: string[]
}
export type CampaignView =
  | { kind: 'recommendations'; data: { recommendations: RecommendationCard[] } }
  | { kind: 'plan'; data: PlanCard }
  | { kind: 'draft'; data: { planId: string; campaignId: string; audienceId: string; status: 'inactive'; created: boolean; warnings: string[] } }
  | { kind: 'status'; data: { id: string; status: string; started: boolean; archived: boolean } }
  | { kind: 'results'; data: { reachPeople: number; channels: Array<{ channel: string; count: number }> } }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
}

/** Read one bounded CRM campaign presentation.
 * @param meta Persisted tool-result metadata.
 * @returns A safe campaign view or null.
 */
export function readCampaign(meta: unknown): CampaignView | null {
  if (!object(meta)) return null
  if (object(meta.crmRecommendations) && exact(meta.crmRecommendations, ['version', 'request', 'data'])
    && meta.crmRecommendations.version === 1 && object(meta.crmRecommendations.data)
    && exact(meta.crmRecommendations.data, ['version', 'request', 'recommendations', 'unavailable'])) {
    const rows = meta.crmRecommendations.data.recommendations
    if (!Array.isArray(rows) || rows.length > 3 || !rows.every(row => object(row)
      && exact(row, ['recommendationId', 'opportunityId', 'score', 'priority', 'title', 'actionTemplate', 'evidence', 'primaryMetrics', 'guardrailMetrics', 'limitations'])
      && typeof row.recommendationId === 'string'
      && typeof row.title === 'string' && finite(row.score) && finite(row.priority) && typeof row.actionTemplate === 'string'
      && strings(row.limitations))) return null
    return { kind: 'recommendations', data: { recommendations: rows as RecommendationCard[] } }
  }
  if (object(meta.crmCampaignPlan) && exact(meta.crmCampaignPlan, ['version', 'data'])
    && meta.crmCampaignPlan.version === 1 && object(meta.crmCampaignPlan.data)) {
    const data = meta.crmCampaignPlan.data
    if (!exact(data, ['version', 'planId', 'recommendationId', 'status', 'readyForCreation', 'readinessReasons',
      'audiencePreview', 'actionTemplate', 'primaryMetrics', 'guardrailMetrics', 'limitations'])
      || typeof data.planId !== 'string' || typeof data.readyForCreation !== 'boolean' || !strings(data.readinessReasons)
      || !object(data.audiencePreview) || !Array.isArray(data.audiencePreview.conditions)
      || !exact(data.audiencePreview, data.audiencePreview.estimatedCount === undefined
        ? ['conditions', 'unavailableReasons'] : ['conditions', 'estimatedCount', 'unavailableReasons'])
      || data.audiencePreview.estimatedCount !== undefined && !finite(data.audiencePreview.estimatedCount)
      || !strings(data.audiencePreview.unavailableReasons) || typeof data.actionTemplate !== 'string'
      || !strings(data.primaryMetrics) || !strings(data.guardrailMetrics) || !strings(data.limitations)) return null
    return { kind: 'plan', data: data as unknown as PlanCard }
  }
  if (!object(meta.crmCampaign) || !exact(meta.crmCampaign, ['version', 'kind', 'data'])
    || meta.crmCampaign.version !== 1 || !object(meta.crmCampaign.data)) return null
  const { kind, data } = meta.crmCampaign
  if (kind === 'draft' && exact(data, ['version', 'planId', 'idempotencyKey', 'audienceId', 'campaignId', 'status', 'created', 'warnings'])
    && typeof data.planId === 'string' && typeof data.campaignId === 'string'
    && typeof data.audienceId === 'string' && data.status === 'inactive' && typeof data.created === 'boolean' && strings(data.warnings)) {
    return { kind, data } as CampaignView
  }
  if (kind === 'status' && exact(data, ['id', 'status', 'started', 'archived'])
    && typeof data.id === 'string' && typeof data.status === 'string'
    && typeof data.started === 'boolean' && typeof data.archived === 'boolean') return { kind, data } as CampaignView
  if (kind === 'results' && exact(data, ['reachPeople', 'channels'])
    && Number.isSafeInteger(data.reachPeople) && (data.reachPeople as number) >= 0 && Array.isArray(data.channels)
    && data.channels.length <= 100 && data.channels.every(row => object(row) && typeof row.channel === 'string'
      && Number.isSafeInteger(row.count) && (row.count as number) >= 0)) return { kind, data } as CampaignView
  return null
}
