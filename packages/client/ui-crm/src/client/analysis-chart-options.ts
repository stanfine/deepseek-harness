/** Deterministic semantic-analysis chart selection and closed Apache ECharts translation. */
import type { EChartsOption } from 'echarts'
import type { AnalysisReport, AnalysisMetricColumn } from './analysis-model.ts'

const MAX_DONUT_CATEGORIES = 8

/** Supported presentation chosen only from validated persisted result metadata. */
export type AnalysisView = { type: 'kpi' } | { type: 'table' }
  | { type: 'line' | 'horizontal-bar' | 'bar' | 'donut'; dimension: string; metric: string }
  | { type: 'bar-line'; dimension: string; barMetric: string; lineMetric: string }

/** Locale-owned labels required by comparison chart series. */
export interface AnalysisChartLabels { current: string; comparison: string }

function compatiblePair(metrics: readonly AnalysisMetricColumn[]): boolean {
  if (metrics.length !== 2) return false
  return first(metrics).format !== item(metrics, 1).format
}

function first<T>(values: readonly T[]): T {
  return item(values, 0)
}
function item<T>(values: readonly T[], index: number): T {
  const value = values[index]
  if (value === undefined) throw new Error('Validated analysis collection is empty')
  return value
}

/** Choose one truthful view from validated source semantics and completeness.
 * @param report Persisted and validated semantic analysis result.
 * @returns A deterministic chart family or table fallback.
 */
export function selectAnalysisView(report: AnalysisReport): AnalysisView {
  if (report.request.intent === 'summary' && report.request.dimensions.length === 0) return { type: 'kpi' }
  if (report.request.dimensions.length !== 1 || report.request.metrics.length === 0 || report.rows.length > 50) return { type: 'table' }
  const dimension = first(report.request.dimensions)
  if (report.request.comparison === undefined && compatiblePair(report.columns.metrics)) return { type: 'bar-line', dimension,
    barMetric: first(report.columns.metrics).id, lineMetric: item(report.columns.metrics, 1).id }
  if (report.request.metrics.length !== 1) return { type: 'table' }
  const metric = first(report.request.metrics)
  if (report.request.intent === 'trend' && first(report.columns.dimensions).dataType === 'date') {
    return { type: 'line', dimension, metric }
  }
  if (report.request.intent === 'ranking') return { type: 'horizontal-bar', dimension, metric }
  if (report.request.intent === 'composition') {
    const values = report.rows.map(row => reportMetric(row.metrics, metric).value)
    const nonnegative = values.every(value => value !== null && value >= 0)
    if (report.request.comparison === undefined && report.completeness.complete && report.rows.length <= MAX_DONUT_CATEGORIES
      && nonnegative && values.some(value => value !== null && value > 0)) {
      return { type: 'donut', dimension, metric }
    }
    if (report.rows.length > MAX_DONUT_CATEGORIES) return { type: 'horizontal-bar', dimension, metric }
  }
  return { type: 'bar', dimension, metric }
}

function metric(report: AnalysisReport, id: string): AnalysisMetricColumn {
  const value = report.columns.metrics.find(column => column.id === id)
  if (value === undefined) throw new Error('Validated analysis metric is missing')
  return value
}
function reportMetric(values: AnalysisReport['rows'][number]['metrics'], id: string) {
  const value = values[id]
  if (value === undefined) throw new Error('Validated analysis row metric is missing')
  return value
}
function categories(report: AnalysisReport, dimension: string): string[] {
  return report.rows.map(row => String(row.dimensions[dimension]))
}
function values(report: AnalysisReport, id: string, comparison = false): Array<number | null> {
  return report.rows.map(row => comparison ? reportMetric(row.metrics, id).comparisonValue ?? null : reportMetric(row.metrics, id).value)
}
function base(): EChartsOption {
  return { animation: false, tooltip: { trigger: 'axis', renderMode: 'richText', confine: true }, aria: { enabled: false } }
}
function zoom(horizontal: boolean): NonNullable<EChartsOption['dataZoom']> {
  return [{ type: 'slider', ...(horizontal ? { yAxisIndex: 0, right: 0, width: 15 } : { xAxisIndex: 0, bottom: 8 }),
    start: 0, end: 100, filterMode: 'none', showDetail: false },
  { type: 'inside', ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }), zoomOnMouseWheel: false, moveOnMouseWheel: false }]
}

/** Translate a closed analysis view into inert ECharts options without formulas or callbacks.
 * @param report Persisted and validated semantic analysis result.
 * @param view View returned by `selectAnalysisView`.
 * @param labels Locale-owned comparison labels.
 * @returns Declarative chart options preserving every persisted null value.
 */
export function analysisChartOption(report: AnalysisReport, view: AnalysisView, labels: AnalysisChartLabels): EChartsOption {
  const option = base()
  if (view.type === 'kpi' || view.type === 'table') return option
  if (view.type === 'donut') {
    const definition = metric(report, view.metric)
    return { ...option, tooltip: { trigger: 'item', renderMode: 'richText', confine: true }, legend: { type: 'scroll', bottom: 0 },
      series: [{ type: 'pie', name: definition.name, radius: ['38%', '66%'], center: ['50%', '45%'], label: { show: false },
        data: report.rows.map(row => ({ name: String(row.dimensions[view.dimension]),
          value: reportMetric(row.metrics, view.metric).value as number,
        })) }] }
  }
  const categoryData = categories(report, view.dimension)
  const categoryAxis = { type: 'category' as const, data: categoryData, axisLabel: { hideOverlap: true } }
  option.grid = { left: 20, right: 30, top: 50, bottom: 65, containLabel: true }
  if (view.type === 'bar-line') {
    const bar = metric(report, view.barMetric)
    const line = metric(report, view.lineMetric)
    option.xAxis = categoryAxis
    option.yAxis = [{ type: 'value', name: bar.name, scale: false }, { type: 'value', name: line.name, scale: false }]
    option.dataZoom = zoom(false)
    option.series = [{ type: 'bar', name: bar.name, data: values(report, bar.id), barMaxWidth: 48 },
      { type: 'line', name: line.name, data: values(report, line.id), yAxisIndex: 1, connectNulls: false, smooth: false }]
    return option
  }
  const definition = metric(report, view.metric)
  const horizontal = view.type === 'horizontal-bar'
  const valueAxis = { type: 'value' as const, name: definition.name, scale: false }
  option.xAxis = horizontal ? valueAxis : categoryAxis
  option.yAxis = horizontal ? { ...categoryAxis, inverse: true } : valueAxis
  option.dataZoom = zoom(horizontal)
  if (view.type === 'line') {
    const series: NonNullable<EChartsOption['series']> = [{ type: 'line',
      name: report.request.comparison === undefined ? definition.name : labels.current,
      data: values(report, definition.id), connectNulls: false, smooth: false }]
    if (report.request.comparison !== undefined) series.push({ type: 'line', name: labels.comparison,
      data: values(report, definition.id, true), connectNulls: false, smooth: false })
    option.series = series
  } else {
    const series: NonNullable<EChartsOption['series']> = [{ type: 'bar',
      name: report.request.comparison === undefined ? definition.name : labels.current,
      data: values(report, definition.id), barMaxWidth: 48 }]
    if (report.request.comparison !== undefined) series.push({ type: 'bar', name: labels.comparison,
      data: values(report, definition.id, true), barMaxWidth: 48 })
    option.series = series
  }
  return option
}
