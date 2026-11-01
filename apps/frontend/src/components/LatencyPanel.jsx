// Module 2 - Live TTFF acceleration + ephemeris binary stream size tracker.
import { useMemo } from 'react'

const MS_MIN = 10        // left edge of the log scale (ms)
const MS_MAX = 60000     // right edge (60 s)

// position (0-100 %) of a latency value on the logarithmic comparison scale
const logPct = (ms) =>
  Math.min(100, Math.max(0, ((Math.log10(Math.max(ms, MS_MIN)) - Math.log10(MS_MIN)) /
    (Math.log10(MS_MAX) - Math.log10(MS_MIN))) * 100))

const BREAKDOWN = [
  ['leo_round_trip', 'LEO round trip', '#38bdf8'],
  ['payload_tx', 'Payload TX', '#a78bfa'],
  ['ai_inference', 'LSTM inference', '#34d399'],
  ['doppler_search', 'Doppler search', '#f59e0b'],
  ['processing', 'Processing', '#94a3b8'],
]

function Sparkline({ data, min, max, color, height = 34 }) {
  const pts = useMemo(() => {
    const vals = data.filter((v) => v !== null && v !== undefined)
    if (vals.length < 2) return ''
    const lo = min ?? Math.min(...vals)
    const hi = max ?? Math.max(...vals)
    const span = hi - lo || 1
    return vals
      .map((v, i) => `${((i / (vals.length - 1)) * 100).toFixed(2)},${(height - ((v - lo) / span) * height).toFixed(2)}`)
      .join(' ')
  }, [data, min, max, height])
  return (
    <svg viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" className="h-9 w-full">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function LatencyPanel({ ttff, history }) {
  if (!ttff) return <p className="text-sm text-slate-400">Waiting for telemetry…</p>

  const limitBytes = ttff.ephemeris_payload_limit_bytes

  const conventionalMs = ttff.conventional_cold_start_s * 1000
  const leo = ttff.leo_assisted_ms
  const bytes = ttff.ephemeris_payload_bytes
  const bytePct = Math.min(100, (bytes / limitBytes) * 100)
  const byteColor = bytes >= limitBytes ? '#f43f5e' : bytes > 0.9 * limitBytes ? '#f59e0b' : '#34d399'
  const total = leo ?? 0

  return (
    <div className="space-y-4 text-sm">
      {/* headline numbers */}
      <div className="flex items-end justify-between gap-2">
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-400">Conventional cold start</div>
          <div className="font-mono text-2xl text-rose-400 line-through decoration-rose-400/40">
            {ttff.conventional_cold_start_s.toFixed(1)} s
          </div>
        </div>
        <div className="pb-1 text-xl text-slate-500">→</div>
        <div className="text-right">
          <div className="text-[11px] uppercase tracking-wide text-slate-400">LEO-assisted TTFF</div>
          <div className={`font-mono text-2xl ${ttff.target_met ? 'text-emerald-400' : 'text-amber-400'}`}>
            {leo !== null ? `${leo.toFixed(1)} ms` : 'no link'}
          </div>
        </div>
      </div>

      {leo !== null ? (
        <div className="flex items-center justify-between rounded bg-slate-800/60 px-3 py-2">
          <span className="text-slate-300">
            Speed-up <span className="font-mono text-emerald-300">×{ttff.speedup_x.toLocaleString()}</span>
          </span>
          <span className={`rounded px-2 py-0.5 text-xs font-semibold ${ttff.target_met ? 'bg-emerald-500/20 text-emerald-300' : 'bg-amber-500/20 text-amber-300'}`}>
            {ttff.target_met ? `< ${ttff.target_ms} ms target met` : `> ${ttff.target_ms} ms`}
          </span>
        </div>
      ) : (
        <div className="rounded bg-amber-500/10 px-3 py-2 text-amber-300">
          No OneWeb satellite above the elevation mask - LEO ephemeris stream unavailable.
        </div>
      )}

      {/* logarithmic latency comparison */}
      <div>
        <div className="relative h-14">
          <div className="absolute inset-x-0 top-0 h-5 rounded bg-slate-800">
            <div className="h-5 rounded bg-rose-500/70" style={{ width: `${logPct(conventionalMs)}%` }} />
          </div>
          <div className="absolute inset-x-0 top-7 h-5 rounded bg-slate-800">
            <div className="h-5 rounded bg-emerald-500/80 transition-all duration-300" style={{ width: `${leo !== null ? logPct(leo) : 0}%` }} />
          </div>
          <div className="absolute bottom-0 top-0 w-px bg-slate-300" style={{ left: `${logPct(ttff.target_ms)}%` }} title="100 ms target" />
        </div>
        <div className="mt-1 flex justify-between font-mono text-[10px] text-slate-500">
          <span>10 ms</span><span>100 ms</span><span>1 s</span><span>10 s</span><span>60 s</span>
        </div>
        <div className="mt-0.5 text-[10px] text-slate-500">log scale · vertical line = 100 ms target</div>
      </div>

      {/* latency breakdown */}
      {ttff.breakdown_ms && (
        <div>
          <div className="mb-1 text-[11px] uppercase tracking-wide text-slate-400">LEO-assisted latency budget</div>
          <div className="flex h-3 overflow-hidden rounded bg-slate-800">
            {BREAKDOWN.map(([key, , color]) => (
              <div key={key} style={{ width: `${(ttff.breakdown_ms[key] / total) * 100}%`, background: color }} />
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
            {BREAKDOWN.map(([key, label, color]) => (
              <div key={key} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-slate-300">
                  <span className="inline-block h-2 w-2 rounded-sm" style={{ background: color }} />
                  {label}
                </span>
                <span className="font-mono text-slate-400">{ttff.breakdown_ms[key].toFixed(2)} ms</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ephemeris payload tracker */}
      <div>
        <div className="mb-1 flex items-center justify-between text-[11px] uppercase tracking-wide text-slate-400">
          <span>Ephemeris binary stream</span>
          <span className="font-mono normal-case text-slate-300">
            {bytes} B / {limitBytes} B · {ttff.ephemeris_sat_count} sats
          </span>
        </div>
        <div className="h-2.5 overflow-hidden rounded bg-slate-800">
          <div className="h-full transition-all duration-300" style={{ width: `${bytePct}%`, background: byteColor }} />
        </div>
        <div className="mt-2 grid grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] text-slate-500">payload size (B)</div>
            <Sparkline data={history.map((h) => h.payload)} min={0} max={limitBytes} color="#a78bfa" />
          </div>
          <div>
            <div className="text-[10px] text-slate-500">LEO-assisted TTFF (ms)</div>
            <Sparkline data={history.map((h) => h.leo_ms)} min={0} color="#34d399" />
          </div>
        </div>
      </div>

      <p className="text-[10px] leading-snug text-slate-500">
        Analytical model: conventional figure and link / search / processing terms are assumptions; the LSTM
        inference time is measured on the backend.
      </p>
    </div>
  )
}
