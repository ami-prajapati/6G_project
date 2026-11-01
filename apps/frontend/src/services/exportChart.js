// Download helpers for the live charts: PNG image (with title + legend) and CSV data.

const THEME = {
  dark: { bg: '#0f172a', fg: '#e2e8f0', sub: '#94a3b8' },
  light: { bg: '#ffffff', fg: '#0f172a', sub: '#475569' },
}

export const safeName = (s) => String(s).replace(/[^a-z0-9_-]+/gi, '_').replace(/^_+|_+$/g, '')

export function timestampTag() {
  return new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
}

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * Render the Recharts <svg> inside `container` to a PNG and download it.
 * Recharts draws its legend as HTML (outside the svg), so the legend is redrawn on the canvas.
 * @param {HTMLElement} container element that wraps the chart
 * @param {{title:string, subtitle?:string, legend?:{name:string,color:string}[], filename:string, theme?:string}} opts
 */
export function downloadChartPng(container, { title, subtitle = '', legend = [], filename, theme = 'dark' }) {
  const svg = container && container.querySelector('svg.recharts-surface')
  if (!svg) return Promise.reject(new Error('chart is not ready yet'))

  const rect = svg.getBoundingClientRect()
  const w = Math.round(rect.width)
  const h = Math.round(rect.height)
  const clone = svg.cloneNode(true)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  const xml = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([xml], { type: 'image/svg+xml;charset=utf-8' }))

  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const t = THEME[theme] || THEME.dark
      const scale = 2                      // 2x for a sharp image
      const pad = 16
      const headH = 56
      const legendH = legend.length ? 34 : 12
      const cw = w + pad * 2
      const ch = headH + h + legendH
      const canvas = document.createElement('canvas')
      canvas.width = cw * scale
      canvas.height = ch * scale
      const ctx = canvas.getContext('2d')
      ctx.scale(scale, scale)
      ctx.fillStyle = t.bg
      ctx.fillRect(0, 0, cw, ch)

      ctx.textBaseline = 'alphabetic'
      ctx.fillStyle = t.fg
      ctx.font = '600 15px system-ui, sans-serif'
      ctx.fillText(title, pad, 26)
      if (subtitle) {
        ctx.fillStyle = t.sub
        ctx.font = '12px system-ui, sans-serif'
        ctx.fillText(subtitle, pad, 44)
      }

      ctx.drawImage(img, pad, headH, w, h)

      let x = pad
      const y = headH + h + 20
      ctx.font = '12px system-ui, sans-serif'
      legend.forEach((item) => {
        ctx.fillStyle = item.color
        ctx.fillRect(x, y - 8, 16, 3)
        ctx.fillStyle = t.fg
        ctx.fillText(item.name, x + 22, y)
        x += 22 + ctx.measureText(item.name).width + 22
      })

      URL.revokeObjectURL(url)
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('could not create the PNG'))
          return
        }
        saveBlob(blob, filename)
        resolve()
      }, 'image/png')
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('could not render the chart'))
    }
    img.src = url
  })
}

/** Download an array of row objects as a CSV file. `columns` = [{key, label}] */
export function downloadCsv(rows, columns, filename) {
  const esc = (v) => (v === null || v === undefined ? '' : String(v))
  const lines = [columns.map((c) => c.label).join(',')]
  rows.forEach((r) => lines.push(columns.map((c) => esc(r[c.key])).join(',')))
  saveBlob(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' }), filename)
}
