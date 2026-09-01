/** Bounded CRM weekly-report aggregations over deployment-owned data roles. */
import type { JsonValue } from '@deepseek-ai/dsh-session'
import type { ReportPeriods, ReportWindow } from './report-periods.ts'

type JsonObject = { [key: string]: JsonValue }
type PeriodName = keyof ReportPeriods

/** Fixed fields for additive order facts. */
export interface OrderFactRole {
  dataset: string
  timeField: string
  customerField: string
  amountField: string
  orderCountField: string
  quantityField: string
}

/** Fixed fields for line-item contribution. */
export interface OrderItemRole {
  dataset: string
  timeField: string
  amountField: string
  quantityField: string
  seriesField: string
  skuField: string
}

/** Deployment-owned weekly report settings and acquisition budgets. */
export interface WeeklyReportConfig {
  timeZone: string
  timeoutMs: number
  maxBuckets: number
  distinctPageSize: number
  maxDistinctPages: number
  fiscalYearStartMonth: number
  lifecycleHistoryCompleteFrom?: string
  weeklyMultipleOrdersAreRepeatPurchasers: boolean
  orderFacts: OrderFactRole
  orderItems: OrderItemRole
}

/** Internal protected transport; callers never receive its role fields or request body. */
export type SearchTransport = (dataset: string, body: JsonObject, signal: AbortSignal) => Promise<JsonValue>

/** A ratio whose absent value retains the business reason. */
export interface Ratio { value: number | null; reason?: string }

/** One comparable sales row. */
export interface SalesRow {
  period: PeriodName
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
  exactCustomers?: boolean
  missingCustomers?: number
}

/** Comparable weekly sales measures and source coverage. */
export interface SalesReport {
  kind: 'sales'
  timeZone: string
  coverage: { earliest: string | null; latest: string | null; missingTime: number }
  rows: SalesRow[]
  warning: string
}

/** One lifecycle base, active subset, and bounded rate. */
export interface LifecycleMeasure { base: number; active: number; rate: Ratio }

/** Exact cohort counts or an explicit history-coverage refusal. */
export type LifecycleReport = {
  kind: 'lifecycle'
  available: false
  requiredStart: string
  observedStart: string | null
  requiredEnd: string
  observedEnd: string | null
} | {
  kind: 'lifecycle'
  available: true
  exact: true
  newPurchasers: number
  existingNew: LifecycleMeasure
  retained: LifecycleMeasure
  winback: LifecycleMeasure
  warning: string
}

/** Additive values for one product comparison window. */
export interface ProductMeasure { amount: number; quantity: number }
/** One returned line-item group; document count is never presented as order count. */
export interface ProductGroup {
  key: string | number
  lineDocumentCount: number
  current: ProductMeasure | null
  previous: ProductMeasure | null
  priorYear: ProductMeasure | null
}
/** Bounded product contribution or an explicit current-period coverage refusal. */
export type ProductReport = {
  kind: 'product'
  available: false
  groupBy: 'series' | 'sku'
  reason: string
} | {
  kind: 'product'
  available: true
  groupBy: 'series' | 'sku'
  periodAvailability: Record<'current' | 'previous' | 'priorYear', boolean>
  groups: ProductGroup[]
  omitted: number
  countErrorUpperBound: number
  missingKey: number
  truncated: boolean
  warning: string
}

function object(value: JsonValue | undefined): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid weekly report response')
  return value
}
function numeric(value: JsonValue | undefined): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid weekly report number')
  return value
}
function count(value: JsonValue | undefined): number {
  const result = numeric(value)
  if (result < 0 || !Number.isSafeInteger(result)) throw new Error('Invalid weekly report count')
  return result
}
function aggregate(value: JsonValue | undefined): number { return numeric(object(value).value) }
function field(value: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z][A-Za-z0-9_]*)*$/.test(value)) throw new Error('Invalid weekly report field')
}
function dateShiftYear(value: string, years: number): string {
  const source = new Date(`${value}T00:00:00Z`)
  source.setUTCFullYear(source.getUTCFullYear() + years)
  return source.toISOString().slice(0, 10)
}
function dateShiftDays(value: string, days: number): string {
  return new Date(Date.parse(`${value}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10)
}

/** Divide two available measures without manufacturing a value for a zero denominator.
 * @param numerator Available additive numerator.
 * @param denominator Available additive denominator.
 * @param reason Explanation returned when the denominator is zero.
 * @returns Numeric ratio or an explicit unavailable reason.
 */
export function safeRatio(numerator: number, denominator: number, reason: string): Ratio {
  return denominator === 0 ? { value: null, reason } : { value: numerator / denominator }
}

/** Compile and parse weekly report aggregations without exposing role fields to the model. */
export class WeeklyReportReader {
  private readonly config: WeeklyReportConfig
  private readonly search: SearchTransport

  /** Create a reader over one fixed deployment mapping.
   * @param config Validated source roles and budgets.
   * @param search Protected Elasticsearch transport.
   */
  constructor(config: WeeklyReportConfig, search: SearchTransport) {
    this.config = config
    this.search = search
    if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$/.test(config.timeZone)) throw new Error('Invalid weekly report time zone')
    for (const value of [config.timeoutMs, config.maxBuckets, config.distinctPageSize, config.maxDistinctPages]) {
      if (!Number.isSafeInteger(value) || value <= 0) throw new Error('Invalid weekly report budget')
    }
    if (!Number.isSafeInteger(config.fiscalYearStartMonth) || config.fiscalYearStartMonth < 1 || config.fiscalYearStartMonth > 12) throw new Error('Invalid fiscal year start month')
    for (const role of [config.orderFacts, config.orderItems]) {
      if (!/^[a-z][a-z0-9_]*$/.test(role.dataset)) throw new Error('Invalid weekly report dataset')
      for (const value of Object.values(role)) if (value !== role.dataset) field(value)
    }
  }

  private async coverage(signal: AbortSignal, source: Pick<OrderFactRole | OrderItemRole, 'dataset' | 'timeField'> = this.config.orderFacts): Promise<SalesReport['coverage']> {
    const result = object(await this.search(source.dataset, { size: 0, query: { match_all: {} }, aggs: {
      earliest: { min: { field: source.timeField } }, latest: { max: { field: source.timeField } },
      missingTime: { missing: { field: source.timeField } },
    } }, signal))
    const aggs = object(result.aggregations)
    const instant = (raw: JsonValue | undefined): string | null => {
      const value = object(raw).value
      if (value === null) return null
      return new Date(numeric(value)).toISOString()
    }
    return { earliest: instant(aggs.earliest), latest: instant(aggs.latest), missingTime: count(object(aggs.missingTime).doc_count) }
  }

  private covered(window: ReportWindow, coverage: SalesReport['coverage']): boolean {
    return coverage.earliest !== null && coverage.latest !== null
      && coverage.earliest.slice(0, 10) <= window.start && coverage.latest.slice(0, 10) >= dateShiftDays(window.end, -1)
  }

  private async salesWindow(period: PeriodName, window: ReportWindow, signal: AbortSignal): Promise<SalesRow> {
    const role = this.config.orderFacts
    let after: JsonValue | undefined
    let amount = 0, orders = 0, quantity = 0, purchasers = 0, repeatPurchasers = 0, missingCustomers = 0
    for (let page = 0; page < this.config.maxDistinctPages; page++) {
      const composite: JsonObject = { size: this.config.distinctPageSize,
        sources: [{ customer: { terms: { field: role.customerField } } }] }
      if (after !== undefined) composite.after = after
      const result = object(await this.search(role.dataset, { size: 0, query: { bool: { filter: [{ range: {
        [role.timeField]: { gte: `${window.start}T00:00:00${this.config.timeZone}`, lt: `${window.end}T00:00:00${this.config.timeZone}` },
      } }] } }, aggs: {
        amount: { sum: { field: role.amountField } }, orders: { sum: { field: role.orderCountField } },
        quantity: { sum: { field: role.quantityField } },
        customers: { composite, aggs: { orderCount: { sum: { field: role.orderCountField } } } },
        missingCustomer: { missing: { field: role.customerField } },
      } }, signal))
      const aggs = object(result.aggregations)
      if (page === 0) {
        amount = aggregate(aggs.amount); orders = aggregate(aggs.orders); quantity = aggregate(aggs.quantity)
        missingCustomers = count(object(aggs.missingCustomer).doc_count)
      }
      const customers = object(aggs.customers)
      if (!Array.isArray(customers.buckets)) throw new Error('Invalid weekly report customer buckets')
      for (const raw of customers.buckets) {
        const bucket = object(raw)
        purchasers++
        if (aggregate(bucket.orderCount) > 1) repeatPurchasers++
      }
      if (customers.after_key === undefined || customers.buckets.length === 0) return {
        period, start: window.start, end: window.end, complete: window.complete, available: true,
        amount, orders, purchasers, quantity,
        ...(this.config.weeklyMultipleOrdersAreRepeatPurchasers ? { repeatPurchasers }
          : { repeatPurchasersReason: 'Repeat-purchaser source and business definition are not configured.' }),
        amountPerOrder: safeRatio(amount, orders, 'order count is zero'),
        itemsPerOrder: safeRatio(quantity, orders, 'order count is zero'),
        amountPerItem: safeRatio(amount, quantity, 'item quantity is zero'),
        frequency: safeRatio(orders, purchasers, 'purchaser count is zero'),
        amountPerPurchaser: safeRatio(amount, purchasers, 'purchaser count is zero'),
        exactCustomers: true, missingCustomers,
      }
      after = customers.after_key
    }
    throw new Error('Weekly report customer count exceeds page budget')
  }

  /** Aggregate comparable sales measures and exact bounded customer counts.
   * @param periods Canonical report windows.
   * @param signal Caller cancellation shared by coverage and customer pages.
   * @returns Available rows plus explicit source-coverage gaps.
   */
  async sales(periods: ReportPeriods, signal: AbortSignal): Promise<SalesReport> {
    const traversal = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const coverage = await this.coverage(traversal)
    const rows: SalesRow[] = []
    for (const period of ['current', 'previous', 'priorYear', 'fiscalYtd'] as const) {
      const window = periods[period]
      rows.push(this.covered(window, coverage) ? await this.salesWindow(period, window, traversal) : {
        period, ...window, available: false,
        unavailableReason: `Source coverage ${coverage.earliest ?? 'empty'} to ${coverage.latest ?? 'empty'} does not contain ${window.start} to ${window.end}.`,
      })
    }
    return { kind: 'sales', timeZone: this.config.timeZone, coverage, rows,
      warning: 'Configured fact fields are source measures. Live pagination is exact within its budget but is not a point-in-time snapshot.' }
  }

  /** Classify customer lifecycle cohorts only when the fact source covers all required history.
   * @param periods Canonical current and fiscal windows.
   * @param signal Caller cancellation shared by profile and all composite pages.
   * @returns Exact bounded counts or an explicit coverage refusal.
   */
  async lifecycle(periods: ReportPeriods, signal: AbortSignal): Promise<LifecycleReport> {
    const traversal = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const coverage = await this.coverage(traversal)
    const fiscalStart = periods.fiscalYtd.start
    const priorFiscalStart = dateShiftYear(fiscalStart, -1)
    const requiredEnd = periods.current.end
    if (!this.config.lifecycleHistoryCompleteFrom || coverage.earliest === null || coverage.latest === null
      || this.config.lifecycleHistoryCompleteFrom > priorFiscalStart
      || coverage.earliest.slice(0, 10) > priorFiscalStart || coverage.latest.slice(0, 10) < dateShiftDays(requiredEnd, -1)) return {
      kind: 'lifecycle', available: false, requiredStart: priorFiscalStart, observedStart: coverage.earliest?.slice(0, 10) ?? null,
      requiredEnd, observedEnd: coverage.latest?.slice(0, 10) ?? null,
    }
    const role = this.config.orderFacts
    let after: JsonValue | undefined
    let newPurchasers = 0
    const existingNew = { base: 0, active: 0 }
    const retained = { base: 0, active: 0 }
    const winback = { base: 0, active: 0 }
    for (let page = 0; page < this.config.maxDistinctPages; page++) {
      const composite: JsonObject = { size: this.config.distinctPageSize,
        sources: [{ customer: { terms: { field: role.customerField } } }] }
      if (after !== undefined) composite.after = after
      const reportRange = (start: string, end: string): JsonObject => ({ range: { [role.timeField]: {
        gte: `${start}T00:00:00${this.config.timeZone}`, lt: `${end}T00:00:00${this.config.timeZone}`,
      } } })
      const result = object(await this.search(role.dataset, { size: 0, query: { bool: { filter: [{ range: {
        [role.timeField]: { lt: `${requiredEnd}T00:00:00${this.config.timeZone}` },
      } }] } }, aggs: { customers: { composite, aggs: {
        firstPurchase: { min: { field: role.timeField } },
        current: { filter: reportRange(periods.current.start, periods.current.end) },
        priorFiscal: { filter: reportRange(priorFiscalStart, fiscalStart) },
        earlier: { filter: { range: { [role.timeField]: { lt: `${priorFiscalStart}T00:00:00${this.config.timeZone}` } } } },
      } } } }, traversal))
      const customers = object(object(result.aggregations).customers)
      if (!Array.isArray(customers.buckets)) throw new Error('Invalid weekly lifecycle buckets')
      for (const raw of customers.buckets) {
        const bucket = object(raw)
        const first = new Date(numeric(object(bucket.firstPurchase).value)).toISOString().slice(0, 10)
        const current = count(object(bucket.current).doc_count)
        const priorFiscal = count(object(bucket.priorFiscal).doc_count)
        const earlier = count(object(bucket.earlier).doc_count)
        if (current > 0 && first >= periods.current.start && first < periods.current.end) newPurchasers++
        if (first >= fiscalStart && first < periods.current.start) {
          existingNew.base++
          if (current > 0) existingNew.active++
        }
        if (priorFiscal > 0) {
          retained.base++
          if (current > 0) retained.active++
        } else if (earlier > 0) {
          winback.base++
          if (current > 0) winback.active++
        }
      }
      if (customers.after_key === undefined || customers.buckets.length === 0) return {
        kind: 'lifecycle', available: true, exact: true, newPurchasers,
        existingNew: { ...existingNew, rate: safeRatio(existingNew.active, existingNew.base, 'existing-new base is zero') },
        retained: { ...retained, rate: safeRatio(retained.active, retained.base, 'retained base is zero') },
        winback: { ...winback, rate: safeRatio(winback.active, winback.base, 'winback base is zero') },
        warning: 'Exact configured identifiers across live pages; cross-index identity consistency and point-in-time stability are not implied.',
      }
      after = customers.after_key
    }
    throw new Error('Weekly lifecycle count exceeds page budget')
  }

  /** Aggregate bounded series or SKU contribution from a configured line-item source.
   * @param periods Canonical report windows.
   * @param groupBy Closed product grouping choice.
   * @param signal Caller cancellation shared by coverage and aggregation.
   * @returns Source-backed product groups with incomplete comparisons left null.
   */
  async products(periods: ReportPeriods, groupBy: 'series' | 'sku', signal: AbortSignal): Promise<ProductReport> {
    if (groupBy !== 'series' && groupBy !== 'sku') throw new Error('Unknown product grouping')
    const traversal = AbortSignal.any([signal, AbortSignal.timeout(this.config.timeoutMs)])
    const role = this.config.orderItems
    const coverage = await this.coverage(traversal, role)
    const availability = {
      current: this.covered(periods.current, coverage), previous: this.covered(periods.previous, coverage),
      priorYear: this.covered(periods.priorYear, coverage),
    }
    if (!availability.current) return { kind: 'product', available: false, groupBy,
      reason: `Line-item coverage ${coverage.earliest ?? 'empty'} to ${coverage.latest ?? 'empty'} does not contain ${periods.current.start} to ${periods.current.end}.` }
    const aggregateFor = (window: ReportWindow): JsonObject => ({ filter: { range: { [role.timeField]: {
      gte: `${window.start}T00:00:00${this.config.timeZone}`, lt: `${window.end}T00:00:00${this.config.timeZone}`,
    } } }, aggs: { amount: { sum: { field: role.amountField } }, quantity: { sum: { field: role.quantityField } } } })
    const periodAggs: JsonObject = { current: aggregateFor(periods.current) }
    if (availability.previous) periodAggs.previous = aggregateFor(periods.previous)
    if (availability.priorYear) periodAggs.priorYear = aggregateFor(periods.priorYear)
    const earliest = [periods.current.start, availability.previous ? periods.previous.start : periods.current.start,
      availability.priorYear ? periods.priorYear.start : periods.current.start].sort()[0]!
    const groupField = groupBy === 'series' ? role.seriesField : role.skuField
    const result = object(await this.search(role.dataset, { size: 0, query: { bool: { filter: [{ range: { [role.timeField]: {
      gte: `${earliest}T00:00:00${this.config.timeZone}`, lt: `${periods.current.end}T00:00:00${this.config.timeZone}`,
    } } }] } }, aggs: {
      groups: { terms: { field: groupField, size: this.config.maxBuckets, show_term_doc_count_error: true,
        order: { 'current>amount': 'desc' } }, aggs: periodAggs },
      missingKey: { missing: { field: groupField } },
    } }, traversal))
    const aggs = object(result.aggregations)
    const groups = object(aggs.groups)
    if (!Array.isArray(groups.buckets)) throw new Error('Invalid weekly product buckets')
    const measure = (bucket: JsonObject, period: keyof typeof availability): ProductMeasure | null => {
      if (!availability[period]) return null
      const source = object(bucket[period])
      return { amount: aggregate(source.amount), quantity: aggregate(source.quantity) }
    }
    const projected = groups.buckets.map((raw): ProductGroup => {
      const bucket = object(raw)
      if (typeof bucket.key !== 'string' && typeof bucket.key !== 'number') throw new Error('Invalid weekly product key')
      return { key: bucket.key, lineDocumentCount: count(bucket.doc_count),
        current: measure(bucket, 'current'), previous: measure(bucket, 'previous'), priorYear: measure(bucket, 'priorYear') }
    })
    const omitted = count(groups.sum_other_doc_count)
    const countErrorUpperBound = count(groups.doc_count_error_upper_bound)
    const missingKey = count(object(aggs.missingKey).doc_count)
    if (projected.length === 0 && missingKey > 0) return { kind: 'product', available: false, groupBy,
      reason: `Configured ${groupBy} field has no values in the report query.` }
    return { kind: 'product', available: true, groupBy, periodAvailability: availability, groups: projected,
      omitted, countErrorUpperBound, missingKey, truncated: omitted > 0 || countErrorUpperBound > 0 || missingKey > 0,
      warning: 'Returned groups are line-item documents, not orders or visits. Omitted or missing groups prevent complete contribution totals.' }
  }
}
