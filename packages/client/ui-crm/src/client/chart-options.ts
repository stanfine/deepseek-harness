/** Semantic chart selection and a closed translation into Apache ECharts options. */
import type { EChartsOption } from 'echarts'
import type { Chart, ChartType, Metric } from './model.ts'

/** Resolved chart values shared by graphics and the accessible table. */
export interface ChartView {
  type: Exclude<ChartType, 'auto'>
  metric: Metric
  adjusted: boolean
  points: Array<{ key: string | number; value: number | null }>
}

/** Choose a supported display without changing source values or concealing incomplete data.
 * @param chart Validated canonical query result.
 * @param requested Desired chart type, or automatic choice.
 * @param metric Selected source measure.
 * @returns Compatible chart type, measure and unchanged points.
 */
export function chooseView(chart: Chart, requested: ChartType, metric: Metric): ChartView {
  const buckets = chart.data.buckets ?? []
  const points = buckets.map(bucket => ({ key: bucket.key,
    value: metric === 'records' ? bucket.recordCount : metric === 'amount' ? bucket.amount?.sum ?? null : bucket.amount?.avg ?? null,
  }))
  const temporal = chart.request.mode === 'trend'
  const proportions = !temporal && chart.data.truncated === false && chart.data.missingDimension === 0 && metric !== 'average'
    && buckets.reduce((sum, bucket) => sum + bucket.recordCount, 0) === chart.data.recordCount
    && points.every(point => point.value !== null && point.value >= 0)
    && points.some(point => point.value !== null && point.value > 0)
    && (metric === 'records' || buckets.every(bucket => bucket.amount?.count === bucket.recordCount))
  const ranking = !temporal && chart.request.intent === 'ranking'
  if (ranking) points.sort((a, b) => a.value === null ? b.value === null ? 0 : 1 : b.value === null ? -1 : b.value - a.value)
  const comparison = ranking || points.some(point => String(point.key).length > 12) || points.length > 8 ? 'horizontal-bar' : 'bar'
  const automatic = temporal ? points.length < 2 ? 'table' : 'line'
    : chart.request.intent === 'composition' && proportions ? 'donut' : comparison
  let type = requested === 'auto' ? automatic : requested
  if ((type === 'pie' || type === 'donut') && !proportions) type = temporal ? automatic : comparison
  if ((type === 'line' || type === 'area') && (!temporal || points.length < 2)) type = temporal ? 'table' : comparison
  return { type, metric, adjusted: requested === 'auto' ? !temporal && chart.request.intent === 'composition' && !proportions : type !== requested, points }
}

/** Translate the closed view into ECharts configuration; tooltips never interpret HTML.
 * @param chart Canonical query context.
 * @param view Resolved chart type and values.
 * @param measureLabel Localized measure name.
 * @returns Declarative ECharts options with safe tooltips and no executable user input.
 */
export function chartOption(chart: Chart, view: ChartView, measureLabel: string): EChartsOption {
  const circular = view.type === 'pie' || view.type === 'donut'
  const horizontal = view.type === 'horizontal-bar'
  const line = view.type === 'line' || view.type === 'area'
  const option: EChartsOption = {
    animation: false,
    tooltip: { trigger: circular || chart.request.mode === 'group' ? 'item' : 'axis', renderMode: 'richText', confine: true },
    aria: { enabled: false },
  }
  if (circular) {
    option.legend = { type: 'scroll', bottom: 0 }
    option.series = [{ type: 'pie', name: measureLabel, radius: view.type === 'donut' ? ['38%', '66%'] : '66%',
      center: ['50%', '45%'], label: { show: false },
      data: view.points.map(point => ({ name: String(point.key), value: point.value ?? 0 })),
    }]
    return option
  }
  const categories = view.points.map(point => String(point.key))
  const categoryAxis = { type: 'category' as const, data: categories, axisLabel: { hideOverlap: true }, inverse: horizontal }
  const valueAxis = { type: 'value' as const, name: measureLabel, scale: false }
  option.grid = { left: 20, right: 30, top: 50, bottom: 65, containLabel: true }
  option.xAxis = horizontal ? valueAxis : categoryAxis
  option.yAxis = horizontal ? categoryAxis : valueAxis
  option.dataZoom = [{ type: 'slider', ...(horizontal ? { yAxisIndex: 0, right: 0, width: 15 } : { xAxisIndex: 0, bottom: 8 }),
    start: 0, end: 100, filterMode: 'none', showDetail: false },
  { type: 'inside', ...(horizontal ? { yAxisIndex: 0 } : { xAxisIndex: 0 }), zoomOnMouseWheel: false, moveOnMouseWheel: false }]
  const values = view.points.map(point => point.value)
  option.series = line
    ? [{ type: 'line', name: measureLabel, data: values, connectNulls: false, smooth: false,
      ...(view.type === 'area' ? { areaStyle: { opacity: 0.15 } } : {}) }]
    : [{ type: 'bar', name: measureLabel, data: values, barMaxWidth: 48 }]
  return option
}
