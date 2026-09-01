const sheets = []

function range(address) {
  return { address, values: [], formulas: [], format: {}, merge() { this.merged = true } }
}

export const Workbook = { create() {
  sheets.length = 0
  return { worksheets: { add(name) {
    const ranges = new Map()
    const sheet = { name, ranges, chartsList: [], showGridLines: true,
      getRange(address) { if (!ranges.has(address)) ranges.set(address, range(address)); return ranges.get(address) },
      freezePanes: { freezeRows(count) { sheet.frozenRows = count } },
      charts: { add(type, source) { const chart = { type, source: source.address, title: '', setPosition(start, end) { chart.position = [start, end] } }; sheet.chartsList.push(chart); return chart } },
    }
    sheets.push(sheet)
    return sheet
  } } }
} }

export const SpreadsheetFile = { async exportXlsx() {
  return { async save(path) {
    const serializable = sheets.map(sheet => ({ ...sheet, ranges: [...sheet.ranges.values()] }))
    await import('node:fs/promises').then(fs => fs.writeFile(path, JSON.stringify(serializable)))
  } }
} }
