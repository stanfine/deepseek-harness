/** Translation from governed CRM values to the deployed MA HTTP schema. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ResolvedMaCanvas } from './campaign-canvas.ts'
import type { MaAudienceId, ResolvedMaAudience } from './ma-service.ts'

interface LogicalCondition { source: 'tag' | 'field'; key: string; operator: string; values: string[] }

function logicalConditions(audience: ResolvedMaAudience): LogicalCondition[] {
  const filter = audience.filter as { all?: unknown }
  if (!Array.isArray(filter.all)) throw new Error('Invalid governed audience filter')
  return filter.all.map((item) => {
    if (!item || typeof item !== 'object') throw new Error('Invalid governed audience condition')
    const value = item as Partial<LogicalCondition>
    if (!['tag', 'field'].includes(value.source ?? '') || typeof value.key !== 'string'
      || typeof value.operator !== 'string' || !Array.isArray(value.values)
      || value.values.some(entry => typeof entry !== 'string')) throw new Error('Invalid governed audience condition')
    return value as LogicalCondition
  })
}

/** Compile one governed audience into MA AudienceInfo fields.
 * @param audience Protocol-independent governed audience.
 * @returns MA-compatible filter and setting.
 */
export function compileMaAudience(audience: ResolvedMaAudience): { filter: JsonValue; setting: JsonValue } {
  const requiredTags: string[] = []
  const excludedTags: string[] = []
  const fields: JsonValue[] = []
  for (const condition of logicalConditions(audience)) {
    if (condition.source === 'tag') {
      const target = condition.operator === 'not_equals' ? excludedTags : requiredTags
      target.push(...condition.values)
    } else {
      fields.push({ name: condition.key, type: 'string', array: condition.operator === 'in', dynamic: false,
        operator: condition.operator === 'not_equals' ? 'exclude' : condition.operator === 'equals' ? 'eq' : 'in',
        value: condition.values.join(',') })
    }
  }
  return { filter: { filedFilter: { array: false, dynamic: false,
    conditions: [{ array: false, dynamic: false, conditions: fields, relation: 'and' }], relation: 'and' },
  tagFilter: { requiredTags, optionalTags: [], excludedTags } },
  setting: { dwhType: 'lianwei_cdp', audienceGroup: 'outside' } }
}

/** Compile the stable CRM path into MA's X6 flowData array.
 * @param canvas Governed internal canvas.
 * @param audienceId Created MA audience identity.
 * @returns MA flowData nodes and edges.
 */
export function compileMaFlowData(canvas: ResolvedMaCanvas, audienceId: MaAudienceId): JsonValue {
  if (canvas.nodes.length !== 4 || canvas.edges.length !== 3) throw new Error('Invalid governed MA canvas')
  const [entry, audience, action, end] = canvas.nodes
  if (!entry || !audience || !action || !end) throw new Error('Invalid governed MA canvas')
  const actionConfig = action.config as { kind?: string; templateId?: string; capabilityId?: string }
  const edges = canvas.edges.map(edge => ({ id: edge.id, shape: 'edge', zIndex: 0,
    target: { cell: edge.target, port: 'in-top-1' }, source: { cell: edge.source, port: 'in-top-3' } }))
  const actionNode = actionConfig.kind === 'loyalty_coupon'
    ? { id: action.id, shape: 'CouponNode', zIndex: 3, data: { capabilityId: actionConfig.capabilityId,
      frequencyLimit: true, _type: 'coupon', _name: '卡券', configId: 'COUPON' }, position: { x: 510, y: 550 } }
    : { id: action.id, shape: 'FlowContentNode', zIndex: 3, data: { flowContentId: actionConfig.templateId,
      configId: actionConfig.capabilityId, _type: 'flow_content', _name: '营销触达' }, position: { x: 510, y: 550 } }
  return [...edges,
    { id: entry.id, shape: 'StartNode', zIndex: 1, data: { _name: '开始', _type: 'start' }, position: { x: 510, y: 100 } },
    { id: audience.id, shape: 'AudienceNode', zIndex: 2, data: { multiple: false, audienceId, unique: true,
      _type: 'audience_receive', _name: '人群包', configId: 'AUDIENCE_RECEIVE', audienceName: 'CRM 动态人群',
      snapshotId: '', uniqueField: 'Customer.id' }, position: { x: 510, y: 325 } },
    actionNode,
    { id: end.id, shape: 'EndNode', zIndex: 4, data: { _type: 'end', _name: '流程终点', configId: 'END' },
      position: { x: 510, y: 775 } }] as JsonValue
}

/** Wrap MA flowData in the CampaignSetting discriminator.
 * @param flowData Compiled MA flow array.
 * @returns MA CampaignSetting.
 */
export function compileMaCampaignSetting(flowData: JsonValue): JsonValue {
  return { type: 'FLOW', flowData: JSON.stringify(flowData) }
}
