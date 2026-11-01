// Module 3 - AI Doppler correction live monitor: feature ticker + real-time charts.
import { useMemo, useRef, useState } from 'react'
import {
  CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts'
import { downloadChartPng, downloadCsv, safeName, timestampTag } from '../services/exportChart'

const AXIS = { stroke: '#64748b', fontSize: 11 }
const GRID = { dark: '#1e293b', light: '#cbd5e1' }
const TIP = {
  dark: { backgroundColor: '#0f172a', border: '1px solid #334155', color: '#e2e8f0', fontSize: 12 },
  light: { backgroundColor: '#ffffff', border: '1px solid #cbd5e1', color: '#0f172a', fontSize: 12 },
}

function Tile({ label, value, unit, tone = 'text-slate-100' }) {
  return (
    <div className="rounded-md bg-slate-800/60 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`font-mono text-base ${tone}`}>
        {value}
        {unit && <span className="ml-1 text-[11px] text-slate-500">{unit}</span>}
      </div>
    </div>
  )
}

function DownloadBtn({ onClick, disabled, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-md border border-slate-700 bg-slate-800 px-2.5 py-1 text-xs font-medium text-slate-200 transition-colors hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-40"
    >
      {children}
    </button>
  )
}

const CSV_COLUMNS = [
  { key: 'seq', label: 'packet_seq' },
  { key: 'doppler_khz', label: 'doppler_shift_khz' },
  { key: 'truth_hz', label: 'actual_future_doppler_error_hz' },
  { key: 'pred_hz', label: 'lstm_predicted_error_hz' },
  { key: 'resid_hz', label: 'residual_after_correction_hz' },
]

const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(d))
const rms = (arr) => (arr.length ? Math.sqrt(arr.reduce((s, v) => s + v * v, 0) / arr.length) : 0)

export default function DopplerChart({ tracked, chart, color = '#34d399', theme = 'dark' }) {
  // running RMSE over the visible window: no correction vs LSTM-corrected
  const stats = useMemo(() => {
    const valid = chart.filter((p) => p.truth_hz !== null && p.resid_hz !== null)
    const raw = rms(valid.map((p) => p.truth_hz))
    const corrected = rms(valid.map((p) => p.resid_hz))
    return { raw, corrected, gain: raw > 0 ? (1 - corrected / raw) * 100 : 0, n: valid.length }
  }, [chart])

  const dopplerRef = useRef(null)
  const errorRef = useRef(null)
  const [dlError, setDlError] = useState('')

  if (!tracked) {
    return <p className="text-sm text-slate-400">No tracked satellite above the elevation mask for the selected constellations.</p>
  }

  const f = tracked.features
  const inf = tracked.inference
  const canExport = chart.length > 1
  const baseName = `${safeName(tracked.name)}_${timestampTag()}`
  const subtitle = `${tracked.name} (${tracked.constellation}, NORAD ${tracked.norad}) · ${chart.length} samples`

  const savePng = (ref, opts) => {
    setDlError('')
    downloadChartPng(ref.current, { theme, subtitle, ...opts }).catch((err) => setDlError(err.message))
  }

  return (
    <div className="space-y-4">
      {!inf.model_loaded && (
        <div className="rounded bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
          LSTM weights are not loaded on the backend, so the predicted residual is 0. Copy
          doppler_lstm_weights.pt and doppler_norm_stats.npz into packages/open_ntn_ttff/models/ and restart the API.
        </div>
      )}

      {/* live feature readout ticker */}
      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: color }} />
        <span className="font-mono text-slate-100">{tracked.name}</span>
        <span className="text-slate-500">
          {tracked.constellation} · NORAD {tracked.norad} · carrier {(tracked.carrier_hz / 1e9).toFixed(3)} GHz
        </span>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
        <Tile label="Rel. velocity" value={fmt(f.relative_velocity_km_s, 3)} unit="km/s" />
        <Tile label="Elevation" value={fmt(f.elevation_angle_deg, 1)} unit="°" />
        <Tile label="Doppler shift" value={fmt(f.doppler_shift_hz, 1)} unit="Hz" />
        <Tile label="Clock bias" value={f.clock_bias_seconds === null ? '-' : (f.clock_bias_seconds * 1e6).toFixed(3)} unit="µs" />
        <Tile label="Actual error +50 ms" value={fmt(inf.truth_future_doppler_error_hz, 3)} unit="Hz" tone="text-amber-300" />
        <Tile label="LSTM predicted" value={fmt(inf.future_doppler_error_hz, 3)} unit="Hz" tone="text-cyan-300" />
        <Tile label="Residual" value={fmt(inf.residual_after_correction_hz, 3)} unit="Hz" tone="text-fuchsia-300" />
        <Tile label="Inference" value={fmt(inf.inference_ms, 2)} unit="ms" tone="text-emerald-300" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-1 text-xs text-slate-400">Incoming Doppler shift (kHz)</div>
          <div ref={dopplerRef}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={chart} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID[theme]} strokeDasharray="3 3" />
              <XAxis dataKey="seq" hide />
              <YAxis {...AXIS} width={64} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(1)} />
              <Tooltip contentStyle={TIP[theme]} formatter={(v) => `${Number(v).toFixed(3)} kHz`} labelFormatter={() => ''} />
              <Line type="monotone" dataKey="doppler_khz" name="Doppler shift" stroke={color} dot={false} strokeWidth={1.8} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-slate-400">
            <span>Doppler error 50 ms ahead (Hz): actual vs LSTM prediction</span>
            <span className="font-mono text-[11px]">
              RMSE {stats.raw.toFixed(3)} → <span className="text-fuchsia-300">{stats.corrected.toFixed(3)}</span> Hz
              <span className={stats.gain >= 0 ? ' text-emerald-300' : ' text-rose-300'}> ({stats.gain.toFixed(0)}%)</span>
            </span>
          </div>
          <div ref={errorRef}>
          <ResponsiveContainer width="100%" height={210}>
            <LineChart data={chart} margin={{ top: 4, right: 12, bottom: 0, left: 0 }}>
              <CartesianGrid stroke={GRID[theme]} strokeDasharray="3 3" />
              <XAxis dataKey="seq" hide />
              <YAxis {...AXIS} width={64} domain={['auto', 'auto']} tickFormatter={(v) => v.toFixed(2)} />
              <Tooltip contentStyle={TIP[theme]} formatter={(v) => `${Number(v).toFixed(4)} Hz`} labelFormatter={() => ''} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="truth_hz" name="Actual error" stroke="#fbbf24" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Line type="monotone" dataKey="pred_hz" name="LSTM predicted" stroke="#22d3ee" dot={false} strokeWidth={1.6} isAnimationActive={false} />
              <Line type="monotone" dataKey="resid_hz" name="Residual after correction" stroke="#e879f9" strokeDasharray="4 3" dot={false} strokeWidth={1.2} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* downloads */}
      <div className="flex flex-wrap items-center gap-2">
        <DownloadBtn
          disabled={!canExport}
          onClick={() => savePng(dopplerRef, {
            title: 'Incoming Doppler shift (kHz)',
            legend: [{ name: 'Doppler shift', color }],
            filename: `${baseName}_doppler_shift.png`,
          })}
        >
          ⬇ Doppler chart (PNG)
        </DownloadBtn>
        <DownloadBtn
          disabled={!canExport}
          onClick={() => savePng(errorRef, {
            title: 'Doppler error 50 ms ahead (Hz): actual vs LSTM prediction',
            legend: [
              { name: 'Actual error', color: '#fbbf24' },
              { name: 'LSTM predicted', color: '#22d3ee' },
              { name: 'Residual after correction', color: '#e879f9' },
            ],
            filename: `${baseName}_error_prediction.png`,
          })}
        >
          ⬇ Error chart (PNG)
        </DownloadBtn>
        <DownloadBtn
          disabled={!canExport}
          onClick={() => downloadCsv(chart, CSV_COLUMNS, `${baseName}_chart_data.csv`)}
        >
          ⬇ Chart data (CSV)
        </DownloadBtn>
        {dlError && <span className="text-xs text-rose-400">Download failed: {dlError}</span>}
      </div>
      <div className="text-[10px] text-slate-500">
        RMSE is computed over the last {stats.n} streamed samples (no correction → after LSTM correction).
        Downloads contain the samples currently shown (up to 150).
      </div>
    </div>
  )
}
