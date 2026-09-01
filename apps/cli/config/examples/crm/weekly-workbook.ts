/** Fixed CRM weekly workbook renderer over structured report results. */
import { dirname } from 'node:path'
import { mkdir } from 'node:fs/promises'
import type { LifecycleReport, ProductReport, SalesReport } from './weekly-report.ts'
import type { ReportPeriods } from './report-periods.ts'

/** One evidence-bound recommendation written as workbook data. */
export interface WorkbookRecommendation {
  observation: string
  evidence: string
  hypothesis: string
  action: string
  validationMetric: string
  limitation: string
}

/** Complete fixed input for one exported workbook. */
export interface WeeklyWorkbookInput {
  date: string
  periods: ReportPeriods
  sales: SalesReport
  lifecycle: LifecycleReport
  productSeries: ProductReport
  productSku: ProductReport
  recommendations: WorkbookRecommendation[]
}

interface ArtifactRange {
  values: unknown[][]
  formulas: string[][]
  format: {
    fill?: string
    font?: { bold?: boolean; color?: string; size?: number }
    numberFormat?: string
    borders?: { preset: string; style: string; color: string }
    wrapText?: boolean
    horizontalAlignment?: string
    verticalAlignment?: string
    columnWidth?: number
    rowHeight?: number
  }
  merge(): void
}
interface ArtifactChart {
  title: string
  setPosition(start: string, end: string): void
}
interface ArtifactSheet {
  showGridLines: boolean
  getRange(address: string): ArtifactRange
  freezePanes: { freezeRows(count: number): void }
  charts: { add(type: string, range: ArtifactRange): ArtifactChart }
}
interface ArtifactWorkbook {
  worksheets: { add(name: string): ArtifactSheet }
}
interface ArtifactBlob { save(path: string): Promise<void> }
interface ArtifactApi {
  Workbook: { create(): ArtifactWorkbook }
  SpreadsheetFile: { exportXlsx(workbook: ArtifactWorkbook): Promise<ArtifactBlob> }
}

const HEADER = '#4527A0'
const SUBHEADER = '#EDE7F6'
const BORDER = '#D8D4E6'

function title(sheet: ArtifactSheet, text: string, endColumn: string): void {
  const range = sheet.getRange(`A1:${endColumn}1`)
  range.merge()
  range.values = [[text]]
  range.format = { fill: HEADER, font: { bold: true, color: '#FFFFFF', size: 16 }, rowHeight: 28 }
}

function header(range: ArtifactRange): void {
  range.format = { fill: SUBHEADER, font: { bold: true, color: '#2B174F' },
    borders: { preset: 'all', style: 'thin', color: BORDER }, wrapText: true }
}

function body(range: ArtifactRange): void {
  range.format = { borders: { preset: 'all', style: 'thin', color: BORDER }, wrapText: true, verticalAlignment: 'top' }
}

function periodLabel(period: string): string {
  return ({ current: '本周', previous: '上周', priorYear: '去年同期', fiscalYtd: '财年累计' } as Record<string, string>)[period] ?? period
}

function buildDefinition(workbook: ArtifactWorkbook, input: WeeklyWorkbookInput): void {
  const sheet = workbook.worksheets.add('Definition')
  sheet.showGridLines = false
  title(sheet, `美妆个护 CRM 周报｜${input.periods.current.start} 至 ${input.periods.current.end}`, 'D')
  sheet.getRange('A3:D3').values = [['指标', '计算口径', '当前状态', '限制']]
  header(sheet.getRange('A3:D3'))
  const rows = [
    ['销售金额', '订单事实表 orderAmount 合计', '可用', '退款、取消、币种及低于 50 元规则待确认'],
    ['订单数', '订单事实表 orderCount 合计', '可用', '同会员同日订单是否合并待确认'],
    ['购买人数', '稳定客户键精确分页去重', '预算内精确', '实时读取不是时间点快照'],
    ['复购人数', '需要数据所有者确认复购定义及数据源', '不可用', '不以周内多单替代业务复购'],
    ['客户生命周期', '新客、现有新客、留存、回流', input.lifecycle.available ? '可用' : '不可用', '只有声明完整历史后才计算'],
    ['流量与转化', 'UV、注册转化、购买转化', '不可用', '当前未接入访问与注册事件链'],
    ['商品系列', '商品行宽表 series 聚合', input.productSeries.available ? '可用' : '不可用', '商品行文档不等于订单或 UV'],
    ['商品 SKU', '商品行宽表 sku 聚合', input.productSku.available ? '可用' : '不可用', '有限 Top 分组可能截断长尾'],
  ]
  sheet.getRange(`A4:D${3 + rows.length}`).values = rows
  body(sheet.getRange(`A4:D${3 + rows.length}`))
  sheet.getRange('A3:A11').format.columnWidth = 18
  sheet.getRange('B3:B11').format.columnWidth = 34
  sheet.getRange('C3:C11').format.columnWidth = 16
  sheet.getRange('D3:D11').format.columnWidth = 44
  sheet.freezePanes.freezeRows(3)
}

function buildSales(workbook: ArtifactWorkbook, input: WeeklyWorkbookInput): void {
  const sheet = workbook.worksheets.add('Sales Overview')
  sheet.showGridLines = false
  title(sheet, 'Sales Overview', 'G')
  sheet.getRange('A3:G3').values = [['周期', '开始日期', '结束日期（不含）', '销售金额', '订单数', '购买人数', '状态']]
  header(sheet.getRange('A3:G3'))
  const salesRows = input.sales.rows.map(row => [periodLabel(row.period), row.start, row.end,
    row.available ? row.amount ?? null : null, row.available ? row.orders ?? null : null,
    row.available ? row.purchasers ?? null : null,
    row.available ? row.complete ? '完整' : '未完结' : row.unavailableReason ?? '不可用'])
  sheet.getRange(`A4:G${3 + salesRows.length}`).values = salesRows
  body(sheet.getRange(`A4:G${3 + salesRows.length}`))
  sheet.getRange(`A4:G${3 + salesRows.length}`).format.rowHeight = 34
  sheet.getRange(`D4:F${3 + salesRows.length}`).format.numberFormat = '#,##0.00'
  sheet.getRange('A10:D10').values = [['指标', '本周', '上周', '环比']]
  header(sheet.getRange('A10:D10'))
  const current = input.sales.rows.find(row => row.period === 'current')
  const previous = input.sales.rows.find(row => row.period === 'previous')
  const metrics: Array<[string, number | null, number | null]> = [
    ['销售金额', current?.amount ?? null, previous?.amount ?? null],
    ['订单数', current?.orders ?? null, previous?.orders ?? null],
    ['购买人数', current?.purchasers ?? null, previous?.purchasers ?? null],
    ['购买频次', current?.frequency?.value ?? null, previous?.frequency?.value ?? null],
    ['客单价', current?.amountPerOrder?.value ?? null, previous?.amountPerOrder?.value ?? null],
    ['瓶单数', current?.itemsPerOrder?.value ?? null, previous?.itemsPerOrder?.value ?? null],
    ['件单价', current?.amountPerItem?.value ?? null, previous?.amountPerItem?.value ?? null],
    ['客户价值', current?.amountPerPurchaser?.value ?? null, previous?.amountPerPurchaser?.value ?? null],
  ]
  sheet.getRange(`A11:C${10 + metrics.length}`).values = metrics
  for (let row = 11; row <= 10 + metrics.length; row++) {
    sheet.getRange(`D${row}`).formulas = [[`=IF(OR(B${row}="",C${row}="",C${row}=0),"",(B${row}-C${row})/C${row})`]]
  }
  body(sheet.getRange(`A11:D${10 + metrics.length}`))
  sheet.getRange(`B11:C${10 + metrics.length}`).format.numberFormat = '#,##0.00'
  sheet.getRange(`D11:D${10 + metrics.length}`).format.numberFormat = '0.0%'
  const amountRows = input.sales.rows.filter(row => row.period !== 'fiscalYtd').map(row => [periodLabel(row.period), row.available ? row.amount ?? null : null])
  sheet.getRange(`A24:B${24 + amountRows.length}`).values = [['周期', '销售金额'], ...amountRows]
  header(sheet.getRange('A24:B24'))
  body(sheet.getRange(`A25:B${24 + amountRows.length}`))
  sheet.getRange(`B25:B${24 + amountRows.length}`).format.numberFormat = '#,##0.00'
  const chart = sheet.charts.add('bar', sheet.getRange(`A24:B${24 + amountRows.length}`))
  chart.title = '周度销售金额对比'
  chart.setPosition('I3', 'Q19')
  sheet.getRange('A20:G21').values = [[`数据源覆盖：${input.sales.coverage.earliest ?? '空'} 至 ${input.sales.coverage.latest ?? '空'}；缺失时间文档 ${input.sales.coverage.missingTime}`, null, null, null, null, null, null],
    ['配置字段均按源指标聚合；预算内客户分页精确，但实时读取不是时间点快照。', null, null, null, null, null, null]]
  sheet.getRange('A20:G21').format = { fill: '#FFF8E1', wrapText: true, font: { color: '#5D4037' } }
  sheet.getRange('A:A').format.columnWidth = 20
  sheet.getRange('B:G').format.columnWidth = 18
  sheet.freezePanes.freezeRows(3)
}

function buildLifecycle(workbook: ArtifactWorkbook, input: WeeklyWorkbookInput): void {
  const sheet = workbook.worksheets.add('Lifecycle')
  sheet.showGridLines = false
  title(sheet, 'Customer Lifecycle', 'E')
  if (!input.lifecycle.available) {
    sheet.getRange('A3:E5').values = [['状态', '所需开始', '实际开始', '所需结束', '实际结束'],
      ['历史覆盖不足，拒绝计算', input.lifecycle.requiredStart, input.lifecycle.observedStart,
        input.lifecycle.requiredEnd, input.lifecycle.observedEnd], [null, null, null, null, null]]
    header(sheet.getRange('A3:E3'))
    body(sheet.getRange('A4:E4'))
  } else {
    sheet.getRange('A3:D3').values = [['客户分群', '基数', '本周活跃', '活跃率']]
    header(sheet.getRange('A3:D3'))
    const rows = [
      ['本周新客', input.lifecycle.newPurchasers, input.lifecycle.newPurchasers, null],
      ['现有新客', input.lifecycle.existingNew.base, input.lifecycle.existingNew.active, input.lifecycle.existingNew.rate.value],
      ['留存客', input.lifecycle.retained.base, input.lifecycle.retained.active, input.lifecycle.retained.rate.value],
      ['回流客', input.lifecycle.winback.base, input.lifecycle.winback.active, input.lifecycle.winback.rate.value],
    ]
    sheet.getRange('A4:D7').values = rows
    body(sheet.getRange('A4:D7'))
    sheet.getRange('D4:D7').format.numberFormat = '0.0%'
    const chart = sheet.charts.add('bar', sheet.getRange('A3:C7'))
    chart.title = '客户生命周期对比'
    chart.setPosition('F3', 'N18')
  }
  sheet.getRange('A:E').format.columnWidth = 22
}

function buildTraffic(workbook: ArtifactWorkbook): void {
  const sheet = workbook.worksheets.add('Traffic')
  sheet.showGridLines = false
  title(sheet, 'Traffic', 'D')
  sheet.getRange('A3:D6').values = [['指标', '状态', '所需数据源', '说明'],
    ['访问 UV', '不可用', '访问事件', '不能以订单或购买人数替代'],
    ['注册转化率', '不可用', '访问与注册事件及稳定身份键', '当前没有完整事件链'],
    ['购买转化率', '不可用', '访问与购买事件及稳定身份键', '当前没有完整事件链']]
  header(sheet.getRange('A3:D3'))
  body(sheet.getRange('A4:D6'))
  sheet.getRange('A:D').format.columnWidth = 30
}

function buildProduct(workbook: ArtifactWorkbook, report: ProductReport, name: string): void {
  const sheet = workbook.worksheets.add(name)
  sheet.showGridLines = false
  title(sheet, name, 'H')
  if (!report.available) {
    sheet.getRange('A3:H4').values = [['状态', '原因', null, null, null, null, null, null],
      ['不可用', report.reason, null, null, null, null, null, null]]
    header(sheet.getRange('A3:H3'))
    body(sheet.getRange('A4:H4'))
    return
  }
  sheet.getRange('A3:H3').values = [['维度值', '本周金额', '上周金额', '去年同期金额', '商品行文档', '本周数量', '上周数量', '去年同期数量']]
  header(sheet.getRange('A3:H3'))
  const rows = report.groups.map(group => [group.key, group.current?.amount ?? null,
    group.previous?.amount ?? null, group.priorYear?.amount ?? null, group.lineDocumentCount, group.current?.quantity ?? null,
    group.previous?.quantity ?? null, group.priorYear?.quantity ?? null])
  if (rows.length > 0) {
    sheet.getRange(`A4:H${3 + rows.length}`).values = rows
    body(sheet.getRange(`A4:H${3 + rows.length}`))
    sheet.getRange(`B4:H${3 + rows.length}`).format.numberFormat = '#,##0.00'
    const chart = sheet.charts.add('bar', sheet.getRange(`A3:D${3 + Math.min(rows.length, 10)}`))
    chart.title = `${name} 金额对比`
    chart.setPosition('J3', 'R20')
  }
  const noteRow = 5 + rows.length
  sheet.getRange(`A${noteRow}:H${noteRow + 1}`).values = [['返回分组基于商品行文档，不代表订单或访问；缺失或省略分组会导致贡献不完整。', null, null, null, null, null, null, null],
    [`截断=${report.truncated}；省略=${report.omitted}；缺失键=${report.missingKey}；误差上界=${report.countErrorUpperBound}`, null, null, null, null, null, null, null]]
  sheet.getRange(`A${noteRow}:H${noteRow + 1}`).format = { fill: '#FFF8E1', wrapText: true }
  sheet.getRange('A:A').format.columnWidth = 28
  sheet.getRange('B:H').format.columnWidth = 18
  sheet.freezePanes.freezeRows(3)
}

function buildRecommendations(workbook: ArtifactWorkbook, recommendations: WorkbookRecommendation[]): void {
  const sheet = workbook.worksheets.add('Recommendations')
  sheet.showGridLines = false
  title(sheet, 'Evidence-bound Recommendations', 'F')
  sheet.getRange('A3:F3').values = [['观察', '证据', '假设', '行动', '验证指标', '限制']]
  header(sheet.getRange('A3:F3'))
  const rows = recommendations.length > 0 ? recommendations.map(item => [item.observation, item.evidence,
    item.hypothesis, item.action, item.validationMetric, item.limitation])
    : [['尚未提供建议', '请先在会话中基于周报证据生成建议后重新导出', '假设：无', '无', '无', '无']]
  sheet.getRange(`A4:F${3 + rows.length}`).values = rows
  body(sheet.getRange(`A4:F${3 + rows.length}`))
  sheet.getRange(`A4:F${3 + rows.length}`).format.rowHeight = 42
  sheet.getRange('A:F').format.columnWidth = 32
}

/** Render one fixed weekly workbook and save it to a caller-confined path.
 * @param moduleSpecifier Deployment-provided artifact-tool module URL.
 * @param outputPath Prevalidated path owned by the export registry.
 * @param input Fixed report results and bounded recommendation data.
 */
export async function renderWeeklyWorkbook(moduleSpecifier: string, outputPath: string, input: WeeklyWorkbookInput): Promise<void> {
  const loaded: unknown = await import(moduleSpecifier)
  const api = loaded as ArtifactApi
  if (typeof api.Workbook?.create !== 'function' || typeof api.SpreadsheetFile?.exportXlsx !== 'function') {
    throw new Error('Configured artifact-tool module is incompatible')
  }
  const workbook = api.Workbook.create()
  buildDefinition(workbook, input)
  buildSales(workbook, input)
  buildLifecycle(workbook, input)
  buildTraffic(workbook)
  buildProduct(workbook, input.productSeries, 'Product Series')
  buildProduct(workbook, input.productSku, 'Product SKU')
  buildRecommendations(workbook, input.recommendations)
  await mkdir(dirname(outputPath), { recursive: true, mode: 0o700 })
  const blob = await api.SpreadsheetFile.exportXlsx(workbook)
  await blob.save(outputPath)
}
