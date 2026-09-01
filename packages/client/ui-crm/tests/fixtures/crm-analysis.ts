/** Representative persisted semantic analysis metadata for Client tests. */
interface TestRequest {
  metrics: string[]
  dimensions: string[]
  filters: unknown[]
  start: string
  end: string
  intent: string
  comparison?: string
  timeGrain?: string
  sort: { metric: string; direction: string }
  limit: number
}
interface TestMetricValue {
  value: number | null
  comparisonValue?: number | null
  changeRatio?: number | null
  unavailableReason?: string
  comparisonUnavailableReason?: string
  changeUnavailableReason?: string
}
interface TestAnalysis {
  crmAnalysis: {
    version: number
    request: TestRequest
    data: {
      version: number
      request: TestRequest
      columns: {
        dimensions: Array<{ id: string; name: string; dataType: string; composition: string }>
        metrics: Array<{ id: string; name: string; format: string; additivity: string; description: string; limitations: string[] }>
      }
      rows: Array<{ dimensions: Record<string, string | number>; metrics: Record<string, TestMetricValue> }>
      coverage: Record<string, unknown>
      completeness: {
        complete: boolean
        missingDimensionDocuments: number
        omittedDocuments: number
        limitedRows: number
        countErrorUpperBound: number
        approximateMetrics: string[]
        missingMetricDocuments: number
      }
      warnings: string[]
      drilldownDimensions: string[]
    }
  }
}

export function analysis(): TestAnalysis {
  const request = { metrics: ['sales_amount'], dimensions: ['channel'], filters: [], start: '2025-07-01', end: '2025-08-01',
    intent: 'ranking', comparison: 'previous_period', sort: { metric: 'sales_amount', direction: 'desc' }, limit: 10 }
  const data = { version: 1, request,
    columns: { dimensions: [{ id: 'channel', name: '渠道', dataType: 'keyword', composition: 'mutually_exclusive' }],
      metrics: [{ id: 'sales_amount', name: '销售额', format: 'currency', additivity: 'additive', description: '成交金额', limitations: [] }] },
    rows: [{ dimensions: { channel: '线上' }, metrics: { sales_amount: { value: 120, comparisonValue: 100, changeRatio: 0.2 } } }],
    coverage: { current: { start: '2025-07-01', end: '2025-08-01', recordCount: 3, available: true, observedStart: '2024-01-01' },
      comparison: { kind: 'previous_period', start: '2025-05-31', end: '2025-07-01', recordCount: 2, available: true,
        observedStart: '2024-01-01' } },
    completeness: { complete: true, missingDimensionDocuments: 0, omittedDocuments: 0, limitedRows: 0,
      countErrorUpperBound: 0, approximateMetrics: [], missingMetricDocuments: 0 },
    warnings: [], drilldownDimensions: ['store'] }
  return { crmAnalysis: { version: 1, request, data } }
}
