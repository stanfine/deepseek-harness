/** Deterministic single-path MA campaign canvas generation. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { CampaignPlanResultV1 } from './campaign-planner.ts'

/** User-selectable logical campaign action. */
export type CampaignAction = { kind: 'ma_delivery'; templateId: string }
  | { kind: 'loyalty_coupon'; templateId: string; capabilityId: string }
/** Deployment-owned action definition. */
export interface CanvasActionDefinition { id: string; kind: CampaignAction['kind']; templateId: string; capabilityId: string }
/** Deployment-owned node, connector, and action allowlists. */
export interface CanvasConfig {
  nodeTypes: { entry: string; condition: string; action: string; end: string }
  connectorId: string
  actions: CanvasActionDefinition[]
}
/** Immutable validated canvas configuration. */
export interface ResolvedCanvasConfig extends CanvasConfig {}
/** One generated MA canvas node. */
export interface ResolvedMaNode { id: string; type: string; config: JsonValue }
/** One generated directed MA edge. */
export interface ResolvedMaEdge { id: string; source: string; target: string; connectorId: string }
/** Complete generated single-path canvas. */
export interface ResolvedMaCanvas { nodes: readonly ResolvedMaNode[]; edges: readonly ResolvedMaEdge[] }

function exact(value: object, keys: readonly string[]): void {
  if (Object.keys(value).some(key => !keys.includes(key))) throw new Error('Invalid canvas configuration keys')
}

/** Validate the complete canvas allowlist.
 * @param config Deployment canvas configuration.
 * @returns Immutable resolved configuration.
 */
export function resolveCanvasConfig(config: CanvasConfig): ResolvedCanvasConfig {
  exact(config, ['nodeTypes', 'connectorId', 'actions'])
  exact(config.nodeTypes, ['entry', 'condition', 'action', 'end'])
  if (Object.values(config.nodeTypes).some(value => !value.trim()) || !config.connectorId.trim()
    || !Array.isArray(config.actions) || config.actions.length === 0) throw new Error('Invalid canvas configuration')
  const keys = new Set<string>()
  const actions = config.actions.map((action) => {
    exact(action, ['id', 'kind', 'templateId', 'capabilityId'])
    const key = `${action.kind}:${action.templateId}`
    if (keys.has(key) || !['ma_delivery', 'loyalty_coupon'].includes(action.kind)
      || !action.id.trim() || !action.templateId.trim() || !action.capabilityId.trim()) throw new Error('Invalid canvas action')
    keys.add(key)
    return Object.freeze({ ...action })
  })
  return Object.freeze({ nodeTypes: Object.freeze({ ...config.nodeTypes }), connectorId: config.connectorId,
    actions: Object.freeze(actions) })
}

/** Generate an exact entry-condition-action-end canvas from one ready plan.
 * @param config Resolved deployment allowlists.
 * @param plan Ready current-session campaign plan.
 * @param action Logical allowlisted action selection.
 * @returns Immutable single-path canvas.
 */
export function buildSinglePathCanvas(
  config: ResolvedCanvasConfig, plan: CampaignPlanResultV1, action: CampaignAction,
): ResolvedMaCanvas {
  if (!plan.readyForCreation || plan.status !== 'preview') throw new Error('Campaign plan is not ready for canvas generation')
  const selected = config.actions.find(item => item.kind === action.kind && item.templateId === action.templateId)
  if (!selected) throw new Error('Campaign action template is not allowlisted')
  if (action.kind === 'loyalty_coupon' && action.capabilityId !== selected.capabilityId) throw new Error('Campaign action capability mismatch')
  const suffix = plan.planId
  const ids = { entry: `entry_${suffix}`, condition: `condition_${suffix}`, action: `action_${suffix}`, end: `end_${suffix}` }
  const nodes = [
    { id: ids.entry, type: config.nodeTypes.entry, config: { planId: plan.planId } },
    { id: ids.condition, type: config.nodeTypes.condition, config: { estimatedCount: plan.audiencePreview.estimatedCount ?? null } },
    { id: ids.action, type: config.nodeTypes.action, config: { kind: selected.kind, templateId: selected.templateId,
      capabilityId: selected.capabilityId } },
    { id: ids.end, type: config.nodeTypes.end, config: {} },
  ].map(item => Object.freeze(item))
  const pairs = [[ids.entry, ids.condition], [ids.condition, ids.action], [ids.action, ids.end]] as const
  const edges = pairs.map(([source, target], index) => Object.freeze({ id: `edge_${index + 1}_${suffix}`, source, target,
    connectorId: config.connectorId }))
  return Object.freeze({ nodes: Object.freeze(nodes), edges: Object.freeze(edges) })
}
