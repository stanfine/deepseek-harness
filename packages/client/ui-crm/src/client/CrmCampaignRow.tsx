/** CRM recommendation, preview, inactive-draft, status, and result cards. */
import { useMemo } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { readCampaign } from './campaign-model.ts'
import css from './CrmRow.module.css'

type Props = ToolCallViewProps & PropsLocale<'crm'>

/** Render governed CRM campaign results from persisted metadata.
 * @param props Durable tool result and localized labels.
 * @returns Campaign-specific card or raw fallback.
 */
export function CrmCampaignRow({ block, t, inspect }: Props) {
  const settled = 'kind' in block
  const view = useMemo(() => settled && !block.isError ? readCampaign(block.meta) : null, [block, settled])
  const raw = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  if (!settled) return <section className={css.card}><p role="status">{t('campaignRunning')}</p></section>
  if (!view) return <section className={css.card}><p>{block.isError ? t('failed') : t('campaignUnavailable')}</p><details><summary>{t('raw')}</summary><pre className={css.raw}>{raw}</pre></details></section>
  return <section className={css.card} aria-label={t('campaignTitle')}>
    <header className={css.header}><strong>{t('campaignTitle')}</strong>{inspect && <button type="button" onClick={inspect}>{t('inspect')}</button>}</header>
    {view.kind === 'recommendations' && view.data.recommendations.map(item => <article key={item.recommendationId}>
      <strong>#{item.priority} {item.title}</strong><p>{item.actionTemplate}</p><p className={css.context}>{t('campaignScore')}: {item.score.toFixed(2)}</p>
      {item.limitations.map(text => <p className={css.warning} key={text}>{text}</p>)}</article>)}
    {view.kind === 'plan' && <><dl className={css.metrics}><div><dt>{t('campaignAudience')}</dt><dd>{view.data.audiencePreview.estimatedCount?.toLocaleString() ?? '—'}</dd></div><div><dt>{t('campaignReady')}</dt><dd>{view.data.readyForCreation ? t('yes') : t('no')}</dd></div></dl><p>{view.data.actionTemplate}</p><p><strong>{t('campaignSelections')}:</strong> {view.data.activation.group.name} · {view.data.activation.category.name} · {view.data.activation.content.name}</p><div className={css.canvas}><strong>{t('campaignCanvas')}</strong><p>{view.data.canvas.nodes.map(node => node.type).join(' → ')}</p></div>{[...view.data.readinessReasons, ...view.data.limitations].map(text => <p className={css.warning} key={text}>{text}</p>)}</>}
    {view.kind === 'draft' && <><p><strong>{t('campaignInactive')}</strong></p><p>{t('campaignId')}: {view.data.campaignId}</p><p>{t('campaignAudienceId')}: {view.data.audienceId}</p></>}
    {view.kind === 'status' && <dl className={css.metrics}><div><dt>{t('campaignStatus')}</dt><dd>{view.data.status}</dd></div><div><dt>{t('campaignStarted')}</dt><dd>{view.data.started ? t('yes') : t('no')}</dd></div></dl>}
    {view.kind === 'results' && <>{view.data.ma.available && view.data.ma.data
      ? <><dl className={css.metrics}><div><dt>{t('campaignReach')}</dt><dd>{view.data.ma.data.reachPeople.toLocaleString()}</dd></div></dl>{view.data.ma.data.channels.map(row => <p key={row.channel}>{row.channel}: {row.count.toLocaleString()}</p>)}</>
      : <p className={css.warning}>{view.data.ma.reason}</p>}
    <p className={css.warning}>{view.data.conversion.reason}</p>
    <p className={css.warning}>{view.data.incrementality.reason}</p></>}
    <details><summary>{t('raw')}</summary><pre className={css.raw}>{raw}</pre></details>
  </section>
}
