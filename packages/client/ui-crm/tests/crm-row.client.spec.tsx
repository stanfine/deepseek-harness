// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { setPlatformAPI, getInstanceByDom } from 'echarts/core'
import { act } from '@testing-library/react'
import { beforeAll, afterEach, expect, it, vi } from 'vitest'
import { makeTranslate } from '@deepseek-ai/dsh-client-test-runtime'
import { CrmRow } from '../src/client/CrmRow.tsx'
import { zh } from '../src/client/locales.ts'
import { zh as commonZh } from '../../locale/src/locales/zh.ts'

beforeAll(() => {
  setPlatformAPI({ measureText: text => ({ width: text.length * 7 }) })
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 640 })
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 340 })
})
afterEach(cleanup)
const request = { dataset: 'orders', mode: 'group', dimension: 'channel', start: '2025-01-01', end: '2025-02-01', filters: [] }
const data = { ...request, timeZone: '+08:00', amountMeaning: 'Source amount', recordCount: 2, truncated: true, buckets: [{ key: 'pos', recordCount: 2, amount: { count: 2, sum: -10, avg: -5, min: -10, max: 0 } }] }
function props(extra: object = {}, draft = ''): Parameters<typeof CrmRow>[0] {
  return { block: { kind: 'tool-result', callId: 'q', call: { name: 'crm_query', argsRaw: JSON.stringify(request) }, content: [{ type: 'text', text: 'raw-result' }], isError: false, meta: { crm: { version: 1, request, data } }, ...extra },
    t: makeTranslate(zh, commonZh),
    useInput: (select: (s: { draft: string }) => unknown) => select({ draft }),
    inputActions: { setDraft: vi.fn(), submit: vi.fn() },
  } as unknown as Parameters<typeof CrmRow>[0]
}
it('draws source-backed signed group values and prepares but does not submit drilldown', () => {
  const p = props()
  const setDraft = vi.fn(), submit = vi.fn()
  p.inputActions.setDraft = setDraft
  p.inputActions.submit = submit
  render(<CrmRow {...p} />)
  expect(screen.getByRole('img', { name: '分组对比' })).toBeTruthy()
  expect(screen.getByText('分组存在截断或近似计数，不代表完整贡献。')).toBeTruthy()
  fireEvent.change(screen.getByLabelText('图表指标'), { target: { value: 'amount' } })
  expect(screen.getByRole('cell', { name: '-10' })).toBeTruthy()
  fireEvent.click(screen.getByRole('button', { name: '下钻 pos' }))
  expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('"value":"pos"'))
  expect(submit).not.toHaveBeenCalled()
})
it('preserves an existing composer draft', () => {
  const p = props({}, 'unfinished')
  const setDraft = vi.fn()
  p.inputActions.setDraft = setDraft
  render(<CrmRow {...p} />)
  fireEvent.click(screen.getByRole('button', { name: '下钻 pos' }))
  expect(setDraft).not.toHaveBeenCalled()
})
it('keeps failed and unsupported results textual rather than drawing misleading charts', () => {
  render(<CrmRow {...props({ isError: true })} />)
  expect(screen.queryByRole('img')).toBeNull()
  expect(screen.getByText('raw-result')).toBeTruthy()
})
it('draws chronological zero and nonzero trend buckets', () => {
  const p = props({ meta: { crm: { version: 1, request: { ...request, mode: 'trend' }, data: { ...data, interval: 'day', buckets: [{ key: '2025-01-01', recordCount: 0, amount: null }, { key: '2025-01-02', recordCount: 2, amount: null }] } } } })
  render(<CrmRow {...p} />)
  expect(screen.getByRole('img', { name: '时间趋势' })).toBeTruthy()
  expect(screen.getByRole('cell', { name: '0' })).toBeTruthy()
})

it('switches ECharts types without querying again and disposes the previous instance', () => {
  const rendered = render(<CrmRow {...props()} />)
  const host = screen.getByRole('img', { name: '分组对比' })
  const engine = getInstanceByDom(host)
  expect(engine).toBeDefined()
  expect(host.querySelector('svg')).not.toBeNull()
  expect(host.closest('section')?.querySelector('dl')).toBeNull()
  fireEvent.change(screen.getByLabelText('图表类型'), { target: { value: 'horizontal-bar' } })
  expect(engine?.getOption().series).toMatchObject([{ type: 'bar' }])
  fireEvent.change(screen.getByLabelText('图表类型'), { target: { value: 'table' } })
  expect(screen.queryByRole('img')).toBeNull()
  expect(engine?.isDisposed()).toBe(true)
  rendered.unmount()
})
it('uses the Agent chart request and routes a chart-mark click to a reviewed draft', () => {
  const p = props({ meta: { crm: { version: 1, request: { ...request, chartType: 'horizontal-bar', metric: 'amount' }, data } } })
  const setDraft = vi.fn()
  p.inputActions.setDraft = setDraft
  render(<CrmRow {...p} />)
  expect(screen.getByRole<HTMLSelectElement>('combobox', { name: '图表类型' }).value).toBe('horizontal-bar')
  const engine = getInstanceByDom(screen.getByRole('img', { name: '分组对比' }))
  act(() => { engine?.trigger('click', { componentType: 'series', dataIndex: 0 } as never) })
  expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('"value":"pos"'))
})

it('keeps document counts selectable when the Agent requested an unavailable amount', () => {
  const members = { ...data, buckets: [{ key: 'pos', recordCount: 2, amount: null }] }
  render(<CrmRow {...props({ meta: { crm: { version: 1, request: { ...request, metric: 'amount' }, data: members } } })} />)
  fireEvent.change(screen.getByLabelText('图表指标'), { target: { value: 'records' } })
  expect(screen.getByRole('cell', { name: '2' })).toBeTruthy()
})
it('renders a complete group as a donut and removes its cartesian axes', () => {
  render(<CrmRow {...props({ meta: { crm: { version: 1, request, data: { ...data, truncated: false, missingDimension: 0 } } } })} />)
  fireEvent.change(screen.getByLabelText('图表类型'), { target: { value: 'donut' } })
  const engine = getInstanceByDom(screen.getByRole('img', { name: '分组对比' }))
  expect(engine?.getOption().series).toMatchObject([{ type: 'pie', radius: ['38%', '66%'], data: [{ name: 'pos', value: 2 }] }])
})

it('renders intent-selected rankings and drills into the sorted group rather than its old index', () => {
  const p = props({ meta: { crm: { version: 1, request: { ...request, intent: 'ranking' }, data: { ...data, recordCount: 5, buckets: [
    { key: 'first', recordCount: 2, amount: null }, { key: 'leader', recordCount: 3, amount: null },
  ] } } } })
  const setDraft = vi.fn()
  p.inputActions.setDraft = setDraft
  render(<CrmRow {...p} />)
  const engine = getInstanceByDom(screen.getByRole('img', { name: '分组对比' }))
  expect(engine?.getOption().yAxis).toMatchObject([{ data: ['leader', 'first'] }])
  act(() => { engine?.trigger('click', { componentType: 'series', dataIndex: 0 } as never) })
  expect(setDraft).toHaveBeenCalledWith(expect.stringContaining('"value":"leader"'))
})
