/** Dedicated standard CRM report cards backed only by persisted tool results. */
import { useMemo } from 'react'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { EChartsOption } from 'echarts'
import { EChart } from './EChart.tsx'
import { readReport, type ExcelData, type LifecycleData, type ProductData, type SalesData } from './report-model.ts'
import type { CrmKey } from './locales.ts'
import css from './CrmRow.module.css'

type Props = ToolCallViewProps & PropsLocale<'crm'>
function number(value: number | null | undefined): string { return value === null || value === undefined ? '—' : value.toLocaleString('zh-CN', { maximumFractionDigits: 2 }) }
function comparisonOption(rows: SalesData['rows'], label: (key: CrmKey) => string): EChartsOption {
  const available = rows.filter(row => row.available)
  return { animation: false, tooltip: { trigger: 'axis', renderMode: 'richText', confine: true }, legend: { bottom: 0 },
    grid: { left: 20, right: 25, top: 30, bottom: 55, outerBoundsMode: 'same' }, xAxis: { type: 'category', data: available.map(row => label(row.period as CrmKey)) },
    yAxis: [{ type: 'value', name: label('money') }, { type: 'value', name: label('peopleOrders') }], series: [
      { type: 'bar', name: label('salesAmount'), data: available.map(row => row.amount) },
      { type: 'line', name: label('orderCount'), yAxisIndex: 1, data: available.map(row => row.orders) },
      { type: 'line', name: label('purchaserCount'), yAxisIndex: 1, data: available.map(row => row.purchasers) },
    ] }
}
function lifecycleOption(data: LifecycleData, label: (key: CrmKey) => string): EChartsOption {
  const cohorts = [[label('existingNew'), data.existingNew], [label('retained'), data.retained], [label('winback'), data.winback]] as const
  return { animation: false, tooltip: { trigger: 'axis', renderMode: 'richText' }, legend: { bottom: 0 }, grid: { outerBoundsMode: 'same', bottom: 55 },
    xAxis: { type: 'category', data: cohorts.map(([name]) => name) }, yAxis: { type: 'value' }, series: [
      { type: 'bar', name: label('cohortBase'), data: cohorts.map(([, value]) => value?.base ?? 0) },
      { type: 'bar', name: label('weeklyActive'), data: cohorts.map(([, value]) => value?.active ?? 0) },
    ] }
}
function productOption(data: ProductData, label: (key: CrmKey) => string): EChartsOption {
  const groups = data.groups ?? []
  return { animation: false, tooltip: { trigger: 'axis', renderMode: 'richText' }, legend: { bottom: 0 }, grid: { outerBoundsMode: 'same', bottom: 55 },
    xAxis: { type: 'value', name: label('money') }, yAxis: { type: 'category', inverse: true, data: groups.map(group => String(group.key)) }, series: [
      { type: 'bar', name: label('current'), data: groups.map(group => group.current?.amount ?? null) },
      { type: 'bar', name: label('previous'), data: groups.map(group => group.previous?.amount ?? null) },
      { type: 'bar', name: label('priorYear'), data: groups.map(group => group.priorYear?.amount ?? null) },
    ] }
}

/** Render one standard report result as business-specific KPIs and charts.
 * @param props Durable tool result and common inspection actions.
 * @returns Standard CRM report section or textual fallback.
 */
export function CrmReportRow({ block, t, inspect }: Props) {
  const settled = 'kind' in block
  const report = useMemo(() => settled && !block.isError ? readReport(block.meta) : null, [block, settled])
  const raw = settled ? block.content.map(item => item.type === 'text' ? item.text : JSON.stringify(item)).join('\n') : ''
  if (!settled) return <section className={css.card}><p role="status">{t('reportRunning')}</p></section>
  if (!report) return <section className={css.card}><p>{block.isError ? t('failed') : t('reportUnavailable')}</p><details><summary>{t('raw')}</summary><pre className={css.raw}>{raw}</pre></details></section>
  const sales = report.kind === 'sales' ? report.data as SalesData : null
  const lifecycle = report.kind === 'lifecycle' ? report.data as LifecycleData : null
  const product = report.kind === 'product' ? report.data as ProductData : null
  const excel = report.kind === 'excel' ? report.data as ExcelData : null
  const current = sales?.rows.find(row => row.period === 'current' && row.available)
  const salesMetrics = sales ? [
    ['salesAmount', (row: SalesData['rows'][number]) => row.amount],
    ['orderCount', (row: SalesData['rows'][number]) => row.orders],
    ['purchaserCount', (row: SalesData['rows'][number]) => row.purchasers],
    ['repeatPurchasers', (row: SalesData['rows'][number]) => row.repeatPurchasers],
    ['frequency', (row: SalesData['rows'][number]) => row.frequency?.value],
    ['atv', (row: SalesData['rows'][number]) => row.amountPerOrder?.value],
    ['bottlesPerOrder', (row: SalesData['rows'][number]) => row.itemsPerOrder?.value],
    ['api', (row: SalesData['rows'][number]) => row.amountPerItem?.value],
    ['customerValue', (row: SalesData['rows'][number]) => row.amountPerPurchaser?.value],
  ] as const : []
  return <section className={css.card} aria-label={t('reportTitle')}>
    <header className={css.header}><strong>{t('reportTitle')} · {report.request.date}</strong>{inspect && <button type="button" onClick={inspect}>{t('inspect')}</button>}</header>
    {report.kind === 'periods' && <div className={css.tableWrap}><table><tbody>{Object.entries(report.data).map(([key, value]) => <tr key={key}><th>{t(key as CrmKey)}</th><td>{(value as { start: string }).start} → {(value as { end: string }).end}</td></tr>)}</tbody></table></div>}
    {sales && <>{current && <><dl className={css.metrics}>{[
      [t('salesAmount'), current.amount], [t('orderCount'), current.orders], [t('purchaserCount'), current.purchasers], [t('repeatPurchasers'), current.repeatPurchasers],
      [t('frequency'), current.frequency?.value], [t('atv'), current.amountPerOrder?.value], [t('api'), current.amountPerItem?.value], [t('customerValue'), current.amountPerPurchaser?.value],
    ].map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{number(value as number)}</dd></div>)}</dl>{!current.complete && <p role="note" className={css.warning}>{t('weekIncomplete')}</p>}</>}
    <p className={css.context}>{t('sourceCoverage')}: {sales.coverage.earliest ?? '—'} → {sales.coverage.latest ?? '—'} · {t('missingTime')}: {sales.coverage.missingTime}</p>
    <div className={css.tableWrap}><table><thead><tr><th>{t('metric')}</th>{sales.rows.map(row => <th key={row.period}>{t(row.period as CrmKey)}</th>)}</tr></thead><tbody>
      {salesMetrics.map(([key, value]) => <tr key={key}><th>{t(key)}</th>{sales.rows.map(row => <td key={row.period}>{row.available ? number(value(row)) : '—'}</td>)}</tr>)}
    </tbody></table></div>
    {sales.rows.flatMap(row => row.available ? [row.repeatPurchasersReason,
      row.amountPerOrder?.reason, row.itemsPerOrder?.reason, row.amountPerItem?.reason,
      row.frequency?.reason, row.amountPerPurchaser?.reason].filter((reason): reason is string => !!reason)
      .map(reason => <p className={css.warning} key={`${row.period}-${reason}`}>{t(row.period as CrmKey)}: {reason}</p>) : [])}
    <EChart option={comparisonOption(sales.rows, t)} label={t('salesComparison')} errorLabel={t('renderError')} onPick={() => {}} />
    {sales.rows.filter(row => !row.available).map(row => <p className={css.warning} key={row.period}>
      {t(row.period as CrmKey)}: {row.unavailableReason}
    </p>)}<p className={css.context}>{sales.warning}</p></>}
    {lifecycle && (lifecycle.available ? <><dl className={css.metrics}><div><dt>{t('newPurchasers')}</dt><dd>{number(lifecycle.newPurchasers)}</dd></div></dl><EChart option={lifecycleOption(lifecycle, t)} label={t('lifecycleChart')} errorLabel={t('renderError')} onPick={() => {}} /></> : <p className={css.warning}>{t('lifecycleCoverage')} · {lifecycle.observedStart ?? '—'} → {lifecycle.observedEnd ?? '—'} ({t('requiredRange')} {lifecycle.requiredStart} → {lifecycle.requiredEnd})</p>)}
    {product && (product.available ? <><EChart option={productOption(product, t)} label={t('productChart')} errorLabel={t('renderError')} onPick={() => {}} />{product.truncated && <p className={css.warning}>{t('productTruncated')}</p>}<p className={css.context}>{product.warning}</p></> : <p className={css.warning}>{t('productUnavailable')} · {product.reason}</p>)}
    {excel && <div className={css.downloadPanel}><strong>{t('excelReady')}</strong><span>{excel.export.filename} · {number(excel.export.bytes)} bytes</span>
      <a className={css.download} href={excel.downloadUrl} download={excel.export.filename}>{t('downloadExcel')}</a>
      <span className={css.context}>{t('excelExpires')}: {new Date(excel.export.expiresAt).toLocaleString()}</span><span className={css.context}>{excel.warning}</span></div>}
    <details><summary>{t('raw')}</summary><pre className={css.raw}>{raw}</pre></details>
  </section>
}
