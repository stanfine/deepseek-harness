/** Canonical CRM report windows derived without host locale or wall-clock reads. */

/** An inclusive start and exclusive end in the configured business calendar. */
export interface ReportWindow {
  start: string
  end: string
  complete: boolean
}

/** Comparable windows for one Monday-to-Sunday CRM report. */
export interface ReportPeriods {
  current: ReportWindow
  previous: ReportWindow
  priorYear: ReportWindow
  fiscalYtd: ReportWindow
}

function calendarDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new Error('Expected YYYY-MM-DD date')
  const result = new Date(`${value}T00:00:00Z`)
  if (!Number.isFinite(result.getTime()) || result.toISOString().slice(0, 10) !== value) throw new Error('Invalid calendar date')
  return result
}

function text(value: Date): string { return value.toISOString().slice(0, 10) }
function shifted(value: Date, days: number): Date { return new Date(value.getTime() + days * 86400000) }
function window(start: Date, end: Date, today: Date): ReportWindow {
  return { start: text(start), end: text(end), complete: end.getTime() <= today.getTime() }
}

/** Convert an instant to its date in a configured fixed-offset business calendar.
 * @param now Instant supplied by the caller.
 * @param timeZone Explicit fixed UTC offset.
 * @returns Business-calendar date in YYYY-MM-DD form.
 */
export function businessDate(now: Date, timeZone: string): string {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(timeZone)
  if (!match || !Number.isFinite(now.getTime())) throw new Error('Invalid business date input')
  const minutes = (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1)
  return text(new Date(now.getTime() + minutes * 60000))
}

/** Resolve aligned report windows from one date inside the requested week.
 * @param date Date inside the requested report week.
 * @param timeZone Explicit fixed UTC offset used by downstream aggregations.
 * @param fiscalYearStartMonth Fiscal-year start month from 1 through 12.
 * @param today Current business-calendar date supplied by the caller.
 * @returns Monday-aligned current, previous, prior-year, and fiscal-YTD windows.
 */
export function resolveReportPeriods(date: string, timeZone: string, fiscalYearStartMonth: number, today: string): ReportPeriods {
  if (!/^[+-](?:0\d|1[0-3]):[0-5]\d$/.test(timeZone)) throw new Error('timeZone must be an explicit UTC offset')
  if (!Number.isSafeInteger(fiscalYearStartMonth) || fiscalYearStartMonth < 1 || fiscalYearStartMonth > 12) throw new Error('Invalid fiscal year start month')
  const selected = calendarDate(date)
  const currentDate = calendarDate(today)
  const daysAfterMonday = (selected.getUTCDay() + 6) % 7
  const currentStart = shifted(selected, -daysAfterMonday)
  const currentEnd = shifted(currentStart, 7)
  const previousStart = shifted(currentStart, -7)
  const priorYearStart = shifted(currentStart, -364)
  const fiscalYear = currentStart.getUTCMonth() + 1 < fiscalYearStartMonth
    ? currentStart.getUTCFullYear() - 1 : currentStart.getUTCFullYear()
  const fiscalStart = new Date(Date.UTC(fiscalYear, fiscalYearStartMonth - 1, 1))
  return {
    current: window(currentStart, currentEnd, currentDate),
    previous: window(previousStart, currentStart, currentDate),
    priorYear: window(priorYearStart, shifted(priorYearStart, 7), currentDate),
    fiscalYtd: window(fiscalStart, currentEnd, currentDate),
  }
}
