// WebSocket telemetry client with automatic reconnect + small REST helpers.

export const API_BASE = import.meta.env.VITE_API_URL || ''

export function defaultWsUrl() {
  if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL
  // deployed frontend (e.g. Vercel) + separate backend: derive wss://<backend>/ws/telemetry from VITE_API_URL
  if (API_BASE) return `${API_BASE.replace(/\/+$/, '').replace(/^http/, 'ws')}/ws/telemetry`
  const proto = window.location.protocol === 'https:' ? 'wss' : 'ws'
  return `${proto}://${window.location.host}/ws/telemetry`
}

export async function fetchOrbits() {
  const res = await fetch(`${API_BASE}/api/telemetry/orbits`)
  if (!res.ok) throw new Error(`orbits request failed: ${res.status}`)
  return res.json()
}

export class TelemetryClient {
  /**
   * @param {{url:string, onMessage:(msg:object)=>void, onStatus:(s:string)=>void}} opts
   * status values: 'connecting' | 'connected' | 'reconnecting'
   */
  constructor({ url, onMessage, onStatus }) {
    this.url = url
    this.onMessage = onMessage
    this.onStatus = onStatus
    this.ws = null
    this.closed = false
    this.attempt = 0
    this.timer = null
  }

  connect() {
    this.closed = false
    this.onStatus(this.attempt === 0 ? 'connecting' : 'reconnecting')
    const ws = new WebSocket(this.url)
    this.ws = ws
    ws.onopen = () => {
      this.attempt = 0
      this.onStatus('connected')
    }
    ws.onmessage = (ev) => {
      try {
        this.onMessage(JSON.parse(ev.data))
      } catch (err) {
        console.error('bad telemetry message', err)
      }
    }
    ws.onclose = () => {
      if (this.closed) return
      this.attempt += 1
      this.onStatus('reconnecting')
      const delay = Math.min(5000, 500 * 2 ** Math.min(this.attempt, 4))
      this.timer = setTimeout(() => this.connect(), delay)
    }
    ws.onerror = () => ws.close()
  }

  /** Send a command such as {cmd:'warp', value:10}. Silently ignored while disconnected. */
  send(cmd) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(cmd))
  }

  close() {
    this.closed = true
    clearTimeout(this.timer)
    if (this.ws) this.ws.close()
  }
}
