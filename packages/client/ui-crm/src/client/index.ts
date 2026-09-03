/** Opt-in CRM query presentation registered through the conversation tool slot. */
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import { CrmRow } from './CrmRow.tsx'
import { CrmReportRow } from './CrmReportRow.tsx'
import { CrmAnalysisRow } from './CrmAnalysisRow.tsx'
import { CrmCampaignRow } from './CrmCampaignRow.tsx'
import { en, NS, zh, type CrmKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** CRM chart and follow-up copy. */
    crm: CrmKey
  }
}
/** Presentation registries required by this plugin. */
export const inject = ['slots', 'locale']
/** Register reversible locale and keyed chart contributions.
 * @param ctx Browser plugin context.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-crm: dictionaries')
  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
    { name: 'tool.call.toolview', key: 'crm_query', locale: NS }, CrmRow,
  ))
  for (const key of ['crm_report_periods', 'crm_sales_report', 'crm_lifecycle_report', 'crm_product_report', 'crm_export_weekly_excel']) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS }, CrmReportRow,
    ))
  }
  for (const key of ['crm_analyze', 'crm_drilldown']) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS }, CrmAnalysisRow,
    ))
  }
  for (const key of ['crm_recommend_opportunities', 'crm_campaign_plan', 'crm_campaign_create_draft', 'crm_campaign_status', 'crm_campaign_results']) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, locale: NS }, CrmCampaignRow,
    ))
  }
}
