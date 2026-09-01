/** Imperative Apache ECharts lifecycle isolated from CRM data acquisition. */
import { useEffect, useRef, useState } from 'react'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, LegendComponent, DataZoomComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'
import css from './CrmRow.module.css'

interface Props {
  option: EChartsOption
  label: string
  errorLabel: string
  onPick: (index: number) => void
}

/** Render an interactive SVG chart, resize with its container, and dispose on unmount.
 * @param props Closed options and a click callback owned by the CRM card.
 * @returns Chart region or a localized error; the parent retains its source table.
 */
export function EChart({ option, label, errorLabel, onPick }: Props) {
  const element = useRef<HTMLDivElement>(null)
  const instance = useRef<EChartsType | null>(null)
  const latest = useRef({ option, onPick })
  latest.current = { option, onPick }
  const redraw = useRef<(() => void) | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    const host = element.current
    if (!host) return
    use([BarChart, LineChart, PieChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent, SVGRenderer])
    const draw = () => {
      const style = getComputedStyle(host)
      const color = style.color
      try {
        instance.current?.setOption({ ...latest.current.option, textStyle: { color },
          darkMode: document.body.hasAttribute('data-ds-dark-theme'),
        }, { notMerge: true })
        setFailed(false)
      } catch {
        // Rendering failures retain the parent's accessible source table and raw result.
        setFailed(true)
      }
    }
    try { instance.current = init(host, undefined, { renderer: 'svg' }) }
    catch {
      // Initialization may fail when the browser cannot allocate a rendering surface.
      setFailed(true)
      return
    }
    instance.current.on('click', (event: unknown) => {
      if (typeof event !== 'object' || event === null || !('componentType' in event) || event.componentType !== 'series'
        || !('dataIndex' in event) || typeof event.dataIndex !== 'number' || !Number.isSafeInteger(event.dataIndex)) return
      latest.current.onPick(event.dataIndex)
    })
    redraw.current = draw
    const observer = new ResizeObserver(() => { instance.current?.resize() })
    observer.observe(host)
    const theme = new MutationObserver(draw)
    theme.observe(document.body, { attributes: true, attributeFilter: ['style', 'data-ds-dark-theme'] })
    return () => {
      redraw.current = null
      theme.disconnect()
      observer.disconnect()
      instance.current?.dispose()
      instance.current = null
    }
  }, [])
  useEffect(() => { redraw.current?.() }, [option])
  return <>
    <div ref={element} className={css.chart} role="img" aria-label={label} hidden={failed} />
    {failed && <p role="status">{errorLabel}</p>}
  </>
}
