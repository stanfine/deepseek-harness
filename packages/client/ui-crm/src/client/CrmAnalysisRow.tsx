/** Flexible CRM analysis cards backed only by validated persisted metadata. */
import { useMemo, useState } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { analysisChartOption, selectAnalysisView, type AnalysisView } from './analysis-chart-options.ts'
import { readAnalysis, type AnalysisMetricColumn, type AnalysisMetricValue, type AnalysisReport } from './analysis-model.ts'
import { EChart } from './EChart.tsx'
import css from './CrmRow.module.css'

type Props = ToolCallViewProps & PropsLocale<'crm'>

function value(value: number | null, format: AnalysisMetricColumn['format']): string {
  if (value === null) return '—'
  const options = format === 'currency' ? { maximumFractionDigits: 2, minimumFractionDigits: 2 }
    : { maximumFractionDigits: format === 'decimal' ? 4 : 2 }
  return value.toLocaleString(undefined, options)
}
function change(metric: AnalysisMetricValue): string {
  return metric.changeRatio === null || metric.changeRatio === undefined ? '—'
    : metric.changeRatio.toLocaleString(undefined, { style: 'percent', maximumFractionDigits: 2 })
}
function metric(report: AnalysisReport, id: string): AnalysisMetricColumn {
  const result = report.columns.metrics.find(column => column.id === id)
  if (result === undefined) throw new Error('Validated analysis metric is missing')
  return result
}
function rowMetric(row: AnalysisReport['rows'][number], id: string): AnalysisMetricValue {
  const result = row.metrics[id]
  if (result === undefined) throw new Error('Validated analysis row metric is missing')
  return result
}
function chartLabel(report: AnalysisReport, view: AnalysisView): string {
  if (view.type === 'kpi' || view.type === 'table') return ''
  const dimension = report.columns.dimensions.find(column => column.id === view.dimension)
  const metricIds = view.type === 'bar-line' ? [view.barMetric, view.lineMetric] : [view.metric]
  return `${dimension?.name ?? view.dimension} · ${metricIds.map(id => metric(report, id).name).join(' / ')}`
}
function reasons(metric: AnalysisMetricValue): string[] {
  return [metric.unavailableReason, metric.comparisonUnavailableReason, metric.changeUnavailableReason]
    .filter((reason): reason is string => reason !== undefined)
}
function metricCell(valueText: string, reason: string | undefined) {
  return <>{valueText}{reason && <small className={css.cellReason}>{reason}</small>}</>
}
function draft(report: AnalysisReport, rowIndex: number, nextDimension: string, preface: string): string {
  const row = report.rows[rowIndex]
  if (row === undefined) throw new Error('Validated analysis row is missing')
  const selectedDimension = report.request.dimensions.at(-1)
  const selectedValue = selectedDimension === undefined ? undefined : row.dimensions[selectedDimension]
  return `${preface}\n${JSON.stringify({
    request: { start: report.request.start, end: report.request.end, metrics: report.request.metrics,
      comparison: report.request.comparison, timeGrain: report.request.timeGrain, filters: report.request.filters },
    parentValues: row.dimensions,
    selected: selectedDimension === undefined ? undefined : { dimension: selectedDimension, value: selectedValue },
    nextDimension,
  })}`
}

/** Render validated semantic analysis as KPIs, a deterministic chart, or an accessible table.
 * @param props Durable tool result, localized labels, and conversation input actions.
 * @returns CRM analysis card or textual fallback for rejected metadata.
 */
export function CrmAnalysisRow({ block, t, useInput, inputActions, inspect }: Props) {
  const [prepared, setPrepared] = useState(false)
  const currentDraft = useInput(state => state.draft)
  const settled = 'kind' in block
  const report = useMemo(() => settled && !block.isError ? readAnalysis(block.meta) : null, [block, settled])
  const view = useMemo(() => report === null ? null : selectAnalysisView(report), [report])
  const option = useMemo(() => report === null || view === null ? null
    : analysisChartOption(report, view, { current: t('analysisCurrent'), comparison: t('analysisComparison') }), [report, t, view])
  const raw = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  const nextDimension = report && report.request.dimensions.length > 0 ? report.drilldownDimensions[0] : undefined
  const summaryRow = report?.rows[0]
  const pick = (index: number) => {
    if (report === null || nextDimension === undefined || currentDraft !== '' || report.rows[index] === undefined) return
    inputActions.setDraft(draft(report, index, nextDimension, t('analysisFollowup')))
    setPrepared(true)
  }
  return <section className={css.card} role="region" aria-label={t('analysisTitle')}>
    <header className={css.header}><strong>{t('analysisTitle')}</strong>{inspect && <button type="button" onClick={inspect}>{t('inspect')}</button>}</header>
    {!settled ? <p role="status">{t('analysisRunning')}</p> : report === null ? <p>{block.isError ? t('failed') : t('analysisUnavailable')}</p> : <>
      <p className={css.context}>{t('range')}: {report.request.start} → {report.request.end}</p>
      {report.coverage.comparison && <p className={css.context}>{t('analysisComparison')}: {report.coverage.comparison.start} → {report.coverage.comparison.end}
        {!report.coverage.comparison.available && ` · ${report.coverage.comparison.reason ?? t('analysisComparisonUnavailable')}`}</p>}
      <div className={css.coverage} aria-label={t('analysisCoverage')}>
        <p><strong>{t('analysisCurrentCoverage')}</strong> · {t('analysisRecords')}: {report.coverage.current.recordCount}
          {' · '}{t('analysisCoverageWindow')}: {report.coverage.current.start} → {report.coverage.current.end}
          {' · '}{t('analysisObservedStart')}: {report.coverage.current.observedStart ?? '—'}</p>
        {report.coverage.comparison && <p><strong>{t('analysisComparisonCoverage')}</strong> · {t('analysisRecords')}: {report.coverage.comparison.recordCount}
          {' · '}{t('analysisCoverageWindow')}: {report.coverage.comparison.start} → {report.coverage.comparison.end}
          {' · '}{t('analysisObservedStart')}: {report.coverage.comparison.observedStart ?? '—'}</p>}
      </div>
      <dl className={css.definitions}>{report.columns.metrics.map(column => <div key={column.id}>
        <dt>{column.name}</dt><dd>{column.description}
          {column.limitations.length > 0 && <span>{t('analysisLimitations')}: {column.limitations.join('；')}</span>}</dd></div>)}</dl>
      {view?.type === 'kpi' && summaryRow && <dl className={css.metrics}>{report.columns.metrics.map((column) => {
        const result = rowMetric(summaryRow, column.id)
        return <div key={column.id}><dt>{column.name}</dt><dd>{value(result.value, column.format)}</dd>
          {report.request.comparison && <small>{t('analysisComparison')}: {value(result.comparisonValue ?? null, column.format)} · {t('analysisChange')}: {change(result)}</small>}
          {reasons(result).map(reason => <p className={css.metricNote} key={reason}>{reason}</p>)}</div>
      })}</dl>}
      {report.rows.length === 0 && <p>{t('analysisEmpty')}</p>}
      {report.rows.length > 0 && view && view.type !== 'kpi' && view.type !== 'table' && option && <EChart option={option} label={chartLabel(report, view)} errorLabel={t('renderError')} onPick={pick} />}
      {view?.type !== 'kpi' && <div className={css.tableWrap}><table aria-label={t('analysisTable')}><thead><tr>
        {report.columns.dimensions.map(column => <th key={column.id} scope="col">{column.name}</th>)}
        {report.columns.metrics.map(column => <th key={column.id} scope="col">{column.name}</th>)}
        {report.request.comparison && report.columns.metrics.map(column => <th key={`${column.id}-comparison`} scope="col">{column.name} · {t('analysisComparison')}</th>)}
        {report.request.comparison && report.columns.metrics.map(column => <th key={`${column.id}-change`} scope="col">{column.name} · {t('analysisChange')}</th>)}
        {nextDimension && <th scope="col">{t('drill')}</th>}
      </tr></thead><tbody>{report.rows.map((row, index) => <tr key={JSON.stringify(row.dimensions)}>
        {report.columns.dimensions.map(column => <th key={column.id} scope="row">{String(row.dimensions[column.id])}</th>)}
        {report.columns.metrics.map((column) => { const result = rowMetric(row, column.id); return <td key={column.id}>
          {metricCell(value(result.value, column.format), result.unavailableReason)}</td> })}
        {report.request.comparison && report.columns.metrics.map((column) => { const result = rowMetric(row, column.id); return <td key={`${column.id}-comparison`}>
          {metricCell(value(result.comparisonValue ?? null, column.format), result.comparisonUnavailableReason)}</td> })}
        {report.request.comparison && report.columns.metrics.map((column) => { const result = rowMetric(row, column.id); return <td key={`${column.id}-change`}>
          {metricCell(change(result), result.changeUnavailableReason)}</td> })}
        {nextDimension && <td><button type="button" disabled={currentDraft !== ''}
          aria-label={`${t('drill')} ${String(row.dimensions[report.request.dimensions.at(-1) ?? ''])}`}
          onClick={() => { pick(index) }}>{t('drill')}</button></td>}
      </tr>)}</tbody></table></div>}
      {!report.completeness.complete && <p role="note" className={css.warning}>{t('analysisPartial')}</p>}
      {report.warnings.map(warning => <p role="note" className={css.warning} key={warning}>{warning}</p>)}
      {nextDimension && report.rows.length > 0 && <p className={css.context}>{t('analysisNextDimension')}: {nextDimension} · {t('clickHint')}</p>}
      {nextDimension && currentDraft !== '' && <p>{prepared ? t('prepared') : t('draftBusy')}</p>}
    </>}
    {settled && <details><summary>{t('raw')}</summary><pre className={css.raw}>{raw || (block.error ? `${block.error.name}: ${block.error.code}` : '')}</pre></details>}
  </section>
}
