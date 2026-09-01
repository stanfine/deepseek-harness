/** Validation and display types for persisted standard CRM report results. */
export type ReportKind = 'periods' | 'sales' | 'lifecycle' | 'product' | 'excel'
/** A computed ratio and an optional explanation when the value is unavailable. */
export interface Ratio { value: number | null; reason?: string }
/** Sales measures for one report comparison period. */
export interface SalesRow {
  period: string
  start: string
  end: string
  complete: boolean
  available: boolean
  unavailableReason?: string
  amount?: number
  orders?: number
  purchasers?: number
  repeatPurchasers?: number
  repeatPurchasersReason?: string
  quantity?: number
  amountPerOrder?: Ratio
  itemsPerOrder?: Ratio
  amountPerItem?: Ratio
  frequency?: Ratio
  amountPerPurchaser?: Ratio
}
/** Validated sales report data rendered by the CRM client. */
export interface SalesData {
  kind: 'sales'
  timeZone: string
  coverage: { earliest: string | null; latest: string | null; missingTime: number }
  rows: SalesRow[]
  warning: string
}
/** Lifecycle cohort counts and their computed rate. */
export interface Cohort { base: number; active: number; rate: Ratio }
/** Validated lifecycle report data or its source-coverage limitation. */
export interface LifecycleData {
  kind: 'lifecycle'
  available: boolean
  requiredStart?: string
  observedStart?: string | null
  requiredEnd?: string
  observedEnd?: string | null
  newPurchasers?: number
  existingNew?: Cohort
  retained?: Cohort
  winback?: Cohort
  warning?: string
}
/** Amount and quantity measures for one product period. */
export interface ProductMeasure { amount: number; quantity: number }
/** One series or SKU group across comparison periods. */
export interface ProductGroup {
  key: string | number
  lineDocumentCount: number
  current: ProductMeasure | null
  previous: ProductMeasure | null
  priorYear: ProductMeasure | null
}
/** Validated product report data or its unavailable reason. */
export interface ProductData {
  kind: 'product'
  available: boolean
  groupBy: 'series' | 'sku'
  reason?: string
  groups?: ProductGroup[]
  omitted?: number
  countErrorUpperBound?: number
  missingKey?: number
  truncated?: boolean
  warning?: string
}
/** The standard current, comparison, and fiscal-year report windows. */
export interface PeriodsData { current: Window; previous: Window; priorYear: Window; fiscalYtd: Window }
/** Validated metadata for a temporary weekly Excel download. */
export interface ExcelData {
  kind: 'excel'
  export: { id: string; filename: string; bytes: number; expiresAt: string }
  downloadUrl: string
  sheets: string[]
  warning: string
}
interface Window { start: string; end: string; complete: boolean }
/** All validated data variants supported by the CRM report card. */
export type ReportData = PeriodsData | SalesData | LifecycleData | ProductData | ExcelData
/** Persisted CRM report metadata accepted by the client renderer. */
export interface Report { kind: ReportKind; request: { date: string; groupBy?: string }; data: ReportData }

function object(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function finite(value: unknown): value is number { return typeof value === 'number' && Number.isFinite(value) }
function count(value: unknown): value is number { return finite(value) && Number.isSafeInteger(value) && value >= 0 }
function nullableText(value: unknown): boolean { return value === null || typeof value === 'string' }
function window(value: unknown): boolean { return object(value) && typeof value.start === 'string' && typeof value.end === 'string' && typeof value.complete === 'boolean' }
function ratio(value: unknown): boolean { return object(value) && (value.value === null || finite(value.value)) && (value.reason === undefined || typeof value.reason === 'string') }
function salesRow(value: unknown): boolean {
  if (!object(value) || typeof value.period !== 'string' || typeof value.start !== 'string' || typeof value.end !== 'string'
    || typeof value.complete !== 'boolean' || typeof value.available !== 'boolean') return false
  if (!value.available) return typeof value.unavailableReason === 'string'
  return ['amount', 'orders', 'purchasers', 'quantity'].every(key => finite(value[key]))
    && (count(value.repeatPurchasers) || value.repeatPurchasers === undefined && typeof value.repeatPurchasersReason === 'string')
    && ['amountPerOrder', 'itemsPerOrder', 'amountPerItem', 'frequency', 'amountPerPurchaser'].every(key => ratio(value[key]))
}
function cohort(value: unknown): boolean { return object(value) && count(value.base) && count(value.active) && ratio(value.rate) }
function lifecycle(value: Record<string, unknown>): boolean {
  if (value.available === false) return typeof value.requiredStart === 'string' && nullableText(value.observedStart)
    && typeof value.requiredEnd === 'string' && nullableText(value.observedEnd)
  return value.available === true && count(value.newPurchasers) && cohort(value.existingNew) && cohort(value.retained)
    && cohort(value.winback) && typeof value.warning === 'string'
}
function measure(value: unknown): boolean { return object(value) && finite(value.amount) && finite(value.quantity) }
function product(value: Record<string, unknown>): boolean {
  if (value.available === false) return typeof value.reason === 'string'
  return value.available === true && Array.isArray(value.groups) && value.groups.every(group => object(group)
    && (typeof group.key === 'string' || finite(group.key)) && count(group.lineDocumentCount)
    && [group.current, group.previous, group.priorYear].every(item => item === null || measure(item)))
    && count(value.omitted) && count(value.countErrorUpperBound) && count(value.missingKey)
    && typeof value.truncated === 'boolean' && typeof value.warning === 'string'
}
const EXCEL_SHEETS = ['Definition', 'Sales Overview', 'Lifecycle', 'Traffic', 'Product Series', 'Product SKU', 'Recommendations']
function excelDownloadUrl(value: unknown, id: string): boolean {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value)
    return (typeof globalThis.location?.origin !== 'string' || url.origin === globalThis.location.origin)
      && ['http:', 'https:'].includes(url.protocol) && url.pathname === '/api/crm.export'
      && url.search === `?id=${encodeURIComponent(id)}` && !url.hash
  } catch { return false }
}
function excel(value: Record<string, unknown>): boolean {
  if (!object(value.export) || !Array.isArray(value.sheets)) return false
  const exported = value.export
  return typeof exported.id === 'string' && /^[A-Za-z0-9_-]{32}$/.test(exported.id)
    && typeof exported.filename === 'string' && /^crm-weekly-\d{4}-\d{2}-\d{2}\.xlsx$/.test(exported.filename)
    && count(exported.bytes) && exported.bytes > 0 && typeof exported.expiresAt === 'string'
    && !Number.isNaN(Date.parse(exported.expiresAt))
    && excelDownloadUrl(value.downloadUrl, exported.id)
    && value.sheets.length === EXCEL_SHEETS.length && value.sheets.every((name, index) => name === EXCEL_SHEETS[index])
    && typeof value.warning === 'string'
}

/** Validate standard CRM report metadata before rendering.
 * @param meta Persisted tool result metadata.
 * @returns Closed report data, or null for textual fallback.
 */
export function readReport(meta: unknown): Report | null {
  if (!object(meta) || !object(meta.crmReport) || meta.crmReport.version !== 1) return null
  const { kind, request, data } = meta.crmReport
  if (!['periods', 'sales', 'lifecycle', 'product', 'excel'].includes(String(kind)) || !object(request)
    || typeof request.date !== 'string' || !object(data)) return null
  if (kind === 'periods') {
    if (!['current', 'previous', 'priorYear', 'fiscalYtd'].every(key => window(data[key]))) return null
  } else {
    if (data.kind !== kind) return null
    if (kind === 'sales' && (typeof data.timeZone !== 'string' || !object(data.coverage)
      || !nullableText(data.coverage.earliest) || !nullableText(data.coverage.latest) || !count(data.coverage.missingTime)
      || !Array.isArray(data.rows) || !data.rows.every(salesRow) || typeof data.warning !== 'string')) return null
    if (kind === 'lifecycle' && !lifecycle(data)) return null
    if (kind === 'product' && (!['series', 'sku'].includes(String(data.groupBy)) || !product(data))) return null
    if (kind === 'excel' && !excel(data)) return null
  }
  return { kind, request, data } as unknown as Report
}
