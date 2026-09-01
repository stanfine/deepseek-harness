/** Conversation-local CRM charts derived exclusively from persisted query results. */
import { useMemo, useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { chartTypes, drilldown, readChart, type ChartType, type Metric } from './model.ts'
import { chooseView, chartOption } from './chart-options.ts'
import { EChart } from './EChart.tsx'
import css from './CrmRow.module.css'

type Props = ToolCallViewProps & PropsLocale<'crm'>

/** Render measures, configurable ECharts views and a reviewable drilldown draft.
 * @param props Durable tool result and standard session input actions.
 * @returns CRM card or textual fallback for unsupported results.
 */
export function CrmRow({ block, t, useInput, inputActions, inspect }: Props) {
  const [selectedMetric, setMetric] = useState<Metric>()
  const [selectedType, setType] = useState<ChartType>()
  const [prepared, setPrepared] = useState(false)
  const draft = useInput(state => state.draft)
  const settled = 'kind' in block
  const chart = useMemo(() => settled && !block.isError ? readChart(block.meta) : null, [block, settled])
  const metric = selectedMetric ?? chart?.request.metric ?? 'records'
  const chartType = selectedType ?? chart?.request.chartType ?? 'auto'
  const raw = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  const source = chart?.data
  const buckets = source?.buckets ?? []
  const hasAmount = buckets.some(bucket => bucket.amount !== null)
  const view = useMemo(() => chart ? chooseView(chart, chartType, metric) : null, [chart, chartType, metric])
  const points = view?.points ?? []
  const measureLabel = t(metric)
  const option = useMemo(() => chart && view ? chartOption(chart, view, measureLabel) : null, [chart, view, measureLabel])
  const pick = (index: number) => {
    const point = points[index]
    if (!chart || chart.request.mode !== 'group' || draft !== '' || !point) return
    inputActions.setDraft(`${t('followup')}\n${drilldown(chart.request, point.key)}`)
    setPrepared(true)
  }
  const trend = chart?.request.mode === 'trend'
  const label = trend ? t('trend') : t('groups')
  const measures: Array<[string, number | null | undefined]> = [
    [t('missingDimension'), source?.missingDimension], [t('records'), source?.recordCount], [t('customers'), source?.customerCount], [t('missing'), source?.missingCustomer],
    [t('amount'), source?.amount?.sum], [t('average'), source?.amount?.avg], [t('amountCount'), source?.amount?.count],
  ]
  return <section className={css.card} aria-label={t('title')}>
    <header className={css.header}><strong>{t('title')}</strong>{inspect && <button type="button" onClick={inspect}>{t('inspect')}</button>}</header>
    {!settled ? <p role="status">{t('running')}</p> : chart === null ? <p>{block.isError ? t('failed') : t('unavailable')}</p> : <>
      <p className={css.context}>{chart.data.dataset} · {t('range')}: {chart.data.start} → {chart.data.end} · {chart.data.timeZone}</p>
      <p className={css.context}>{chart.data.amountMeaning}</p>
      {chart.request.filters.length > 0 && <p className={css.context}>{JSON.stringify(chart.request.filters)}</p>}
      {!source?.buckets && <dl className={css.metrics}>{measures.filter(([, value]) => value !== undefined).map(([name, value]) => <div key={name}><dt>{name}</dt><dd>{value === null ? '—' : value}</dd></div>)}</dl>}
      {source?.buckets && <p className={css.context}>{t('records')}: {source.recordCount}{source.missingDimension !== undefined && ` · ${t('missingDimension')}: ${source.missingDimension}`}</p>}
      {chart.data.truncated && <p role="note" className={css.warning}>{t('incomplete')}</p>}
      {chart.data.buckets !== undefined && <>
        <div className={css.header}><strong>{label}{chart.request.dimension ? ` · ${chart.request.dimension}` : ''}</strong>
          <label>{t('chartType')} <select aria-label={t('chartType')} value={chartType}
            onChange={(event) => { setType(event.target.value as ChartType) }}>
            {chartTypes.map(type => <option key={type} value={type}>{t(type)}</option>)}
          </select></label>
          {<label>{t('metric')} <select aria-label={t('metric')} value={metric} onChange={(event) => { setMetric(event.target.value as Metric) }}>
            <option value="records">{t('records')}</option><option value="amount" disabled={!hasAmount}>{t('amount')}</option><option value="average" disabled={!hasAmount}>{t('average')}</option>
          </select></label>}
        </div>
        {buckets.length === 0 ? <p>{t('empty')}</p> : <>
          {view?.adjusted && <p role="note">{t('adjusted')}</p>}
          {view?.type !== 'table' && option && <EChart option={option} label={label} errorLabel={t('renderError')} onPick={pick} />}
          {!trend && <p className={css.context}>{t('clickHint')}</p>}
          <div className={css.tableWrap}><table><thead><tr><th>{t('key')}</th><th>{measureLabel}</th>{!trend && <th>{t('drill')}</th>}</tr></thead><tbody>
            {points.map((bucket, index) => <tr key={String(bucket.key)}><td>{bucket.key}</td><td>{bucket.value ?? '—'}</td>{!trend && <td><button type="button" disabled={draft !== ''} aria-label={`${t('drill')} ${bucket.key}`} onClick={() => { pick(index) }}>{t('drill')}</button></td>}</tr>)}
          </tbody></table></div>
          {!trend && draft !== '' && <p>{prepared ? t('prepared') : t('draftBusy')}</p>}
        </>}
      </>}
      {chart.data.warning && <p className={css.context}>{chart.data.warning}</p>}
    </>}
    {settled && <details><summary>{t('raw')}</summary><pre className={css.raw}>{raw || (block.error ? `${block.error.name}: ${block.error.code}` : '')}</pre></details>}
  </section>
}
