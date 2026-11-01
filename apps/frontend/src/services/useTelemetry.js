// React hook: owns the WebSocket client and keeps rolling histories for the charts.
import { useCallback, useEffect, useRef, useState } from 'react'
import { TelemetryClient, defaultWsUrl } from './websocket'

const MAX_POINTS = 150

export function useTelemetry() {
  const [status, setStatus] = useState('connecting')
  const [hello, setHello] = useState(null)
  const [packet, setPacket] = useState(null)
  const [chart, setChart] = useState([])
  const [ttffHistory, setTtffHistory] = useState([])

  const clientRef = useRef(null)
  const buffers = useRef({ chart: [], ttff: [], sat: null })

  useEffect(() => {
    const client = new TelemetryClient({
      url: defaultWsUrl(),
      onStatus: setStatus,
      onMessage: (msg) => {
        if (msg.type === 'hello') {
          setHello(msg)
          return
        }
        if (msg.type !== 'telemetry') return
        const buf = buffers.current

        // restart the chart whenever the tracked satellite changes
        const satName = msg.tracked ? msg.tracked.name : null
        if (satName !== buf.sat) {
          buf.sat = satName
          buf.chart = []
        }
        if (msg.state.playing) {
          if (msg.tracked) {
            const f = msg.tracked.features
            const inf = msg.tracked.inference
            buf.chart = [
              ...buf.chart,
              {
                seq: msg.seq,
                doppler_khz: f.doppler_shift_hz / 1000,
                truth_hz: inf.truth_future_doppler_error_hz,
                pred_hz: inf.future_doppler_error_hz,
                resid_hz: inf.residual_after_correction_hz,
              },
            ].slice(-MAX_POINTS)
          }
          buf.ttff = [
            ...buf.ttff,
            {
              seq: msg.seq,
              leo_ms: msg.ttff.leo_assisted_ms,
              payload: msg.ttff.ephemeris_payload_bytes,
            },
          ].slice(-MAX_POINTS)
        }
        setPacket(msg)
        setChart(buf.chart)
        setTtffHistory(buf.ttff)
      },
    })
    clientRef.current = client
    client.connect()
    return () => client.close()
  }, [])

  const send = useCallback((cmd) => clientRef.current && clientRef.current.send(cmd), [])
  return { status, hello, packet, chart, ttffHistory, send }
}
