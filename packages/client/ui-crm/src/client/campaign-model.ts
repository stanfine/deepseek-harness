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
  activation: { group: { name: string }; category: { name: string }; content: { name: string } }
  canvas: { nodes: Array<{ id: string; type: string }>; edges: Array<{ source: string; target: string }> }
}
interface DraftCard { planId: string; campaignId: string; audienceId: string; status: 'inactive'; created: boolean; warnings: string[] }
interface StatusCard { id: string; status: string; started: boolean; archived: boolean }
interface ResultsCard {
  planId: string
  campaignId: string
  period: { start: string; end: string }
  ma: { available: boolean; data?: { reachPeople: number; channels: Array<{ channel: string; count: number }> }; reason?: string }
  loyalty: { available: boolean; reason?: string }
  conversion: { available: false; reason: string }
  incrementality: { available: false; reason: string }
}
/** Validated browser projection for one CRM marketing tool result. */
export type CampaignView =
  | { kind: 'recommendations'; data: { recommendations: RecommendationCard[] } }
  | { kind: 'plan'; data: PlanCard }
  | { kind: 'draft'; data: DraftCard }
  | { kind: 'status'; data: StatusCard }
  | { kind: 'results'; data: ResultsCard }

function object(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function strings(value: unknown): value is string[] { return Array.isArray(value) && value.every(item => typeof item === 'string') }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && Object.keys(value).every(key => keys.includes(key))
}

function catalogItem(value: unknown, kind: string): value is Record<string, unknown> {
  return object(value) && typeof value.id === 'string' && typeof value.name === 'string'
    && value.kind === kind && value.enabled === true
}

function activation(value: unknown): boolean {
  return object(value) && exact(value, ['group', 'category', 'content'])
    && catalogItem(value.group, 'group') && catalogItem(value.category, 'category')
    && catalogItem(value.content, 'content') && typeof value.content.flowNodeId === 'string'
}

function canvas(value: unknown): boolean {
  if (!object(value) || !exact(value, ['nodes', 'edges']) || !Array.isArray(value.nodes) || value.nodes.length !== 4
    || !Array.isArray(value.edges) || value.edges.length !== 3) return false
  return value.nodes.every(node => object(node) && exact(node, ['id', 'type', 'config'])
    && typeof node.id === 'string' && typeof node.type === 'string' && object(node.config))
    && value.edges.every(edge => object(edge) && exact(edge, ['id', 'source', 'target', 'connectorId'])
      && typeof edge.source === 'string' && typeof edge.target === 'string')
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
      'audiencePreview', 'activation', 'canvas', 'actionTemplate', 'primaryMetrics', 'guardrailMetrics', 'limitations'])
      || typeof data.planId !== 'string' || typeof data.readyForCreation !== 'boolean' || !strings(data.readinessReasons)
      || !object(data.audiencePreview) || !Array.isArray(data.audiencePreview.conditions)
      || !exact(data.audiencePreview, data.audiencePreview.estimatedCount === undefined
        ? ['conditions', 'unavailableReasons'] : ['conditions', 'estimatedCount', 'unavailableReasons'])
      || data.audiencePreview.estimatedCount !== undefined && !finite(data.audiencePreview.estimatedCount)
      || !strings(data.audiencePreview.unavailableReasons) || typeof data.actionTemplate !== 'string'
      || !activation(data.activation) || !canvas(data.canvas) || !strings(data.primaryMetrics)
      || !strings(data.guardrailMetrics) || !strings(data.limitations)) return null
    return { kind: 'plan', data: data as unknown as PlanCard }
  }
  if (!object(meta.crmCampaign) || !exact(meta.crmCampaign, ['version', 'kind', 'data'])
    || meta.crmCampaign.version !== 1 || !object(meta.crmCampaign.data)) return null
  const { kind, data } = meta.crmCampaign
  if (kind === 'draft' && exact(data, ['version', 'planId', 'idempotencyKey', 'audienceId', 'campaignId', 'status', 'created', 'warnings'])
    && typeof data.planId === 'string' && typeof data.campaignId === 'string'
    && typeof data.audienceId === 'string' && data.status === 'inactive' && typeof data.created === 'boolean' && strings(data.warnings)) {
    return { kind, data } as unknown as CampaignView
  }
  if (kind === 'status' && exact(data, ['id', 'status', 'started', 'archived'])
    && typeof data.id === 'string' && typeof data.status === 'string'
    && typeof data.started === 'boolean' && typeof data.archived === 'boolean') {
    return { kind, data } as unknown as CampaignView
  }
  if (kind === 'results' && exact(data, ['version', 'planId', 'campaignId', 'period', 'ma', 'loyalty', 'conversion', 'incrementality'])
    && data.version === 1 && typeof data.planId === 'string' && typeof data.campaignId === 'string'
    && object(data.period) && exact(data.period, ['start', 'end']) && typeof data.period.start === 'string'
    && typeof data.period.end === 'string' && object(data.ma) && typeof data.ma.available === 'boolean'
    && object(data.loyalty) && typeof data.loyalty.available === 'boolean' && object(data.conversion)
    && data.conversion.available === false && typeof data.conversion.reason === 'string' && object(data.incrementality)
    && data.incrementality.available === false && typeof data.incrementality.reason === 'string') {
    if (data.ma.available && (!exact(data.ma, ['available', 'data']) || !object(data.ma.data)
      || !Number.isSafeInteger(data.ma.data.reachPeople) || (data.ma.data.reachPeople as number) < 0
      || !Array.isArray(data.ma.data.channels) || data.ma.data.channels.length > 100
      || !data.ma.data.channels.every(row => object(row) && exact(row, ['channel', 'count'])
        && typeof row.channel === 'string' && Number.isSafeInteger(row.count) && (row.count as number) >= 0))) return null
    if (!data.ma.available && (!exact(data.ma, ['available', 'reason']) || typeof data.ma.reason !== 'string')) return null
    return { kind, data } as unknown as CampaignView
  }
  return null
}
