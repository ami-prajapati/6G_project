// Module 4 - simulation controls: play/pause, time-warp, constellation filters, tracking target.
const STATUS_STYLE = {
  connected: 'bg-emerald-500/20 text-emerald-300',
  connecting: 'bg-amber-500/20 text-amber-300',
  reconnecting: 'bg-rose-500/20 text-rose-300',
}

function Btn({ active, onClick, children, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
        active ? 'bg-cyan-500 text-[#020617]' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
      } ${className}`}
    >
      {children}
    </button>
  )
}

export default function ControlPanel({ status, hello, packet, enabled, onToggle, send }) {
  const state = packet ? packet.state : { playing: true, warp: 1, track: 'auto' }
  const warps = hello ? hello.warps : [1, 10, 60]
  const constellations = hello ? hello.constellations : []

  return (
    <div className="space-y-4 text-sm">
      <div className="flex items-center justify-between">
        <span className={`rounded px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] || STATUS_STYLE.connecting}`}>
          WebSocket: {status}
        </span>
        <span className="font-mono text-[11px] text-slate-400">
          {packet ? packet.timestamp_utc.replace('T', ' ').replace('+00:00', ' UTC') : '--'}
        </span>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Playback</div>
        <div className="flex flex-wrap gap-2">
          <Btn active={state.playing} onClick={() => send({ cmd: 'play' })}>▶ Play</Btn>
          <Btn active={!state.playing} onClick={() => send({ cmd: 'pause' })}>⏸ Pause</Btn>
          <Btn onClick={() => send({ cmd: 'reset' })}>↺ Reset</Btn>
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Time-warp</div>
        <div className="flex gap-2">
          {warps.map((w) => (
            <Btn key={w} active={state.warp === w} onClick={() => send({ cmd: 'warp', value: w })} className="flex-1">
              {w}×
            </Btn>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Constellations</div>
        <div className="space-y-1.5">
          {constellations.map((c) => (
            <label key={c.name} className="flex cursor-pointer items-center justify-between rounded bg-slate-800/50 px-3 py-1.5">
              <span className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-cyan-400"
                  checked={enabled.includes(c.name)}
                  onChange={() => onToggle(c.name)}
                />
                <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: c.color }} />
                {c.name}
              </span>
              <span className="font-mono text-xs text-slate-500">{c.count} sats</span>
            </label>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 text-[11px] uppercase tracking-wide text-slate-400">Tracked satellite</div>
        <select
          value={state.track}
          onChange={(e) => send({ cmd: 'track', value: e.target.value })}
          className="w-full rounded-md border border-slate-700 bg-slate-800 px-2 py-1.5 text-sm text-slate-100"
        >
          <option value="auto">Auto (prefer OneWeb LEO)</option>
          {constellations.map((c) => (
            <option key={c.name} value={c.name}>{c.name} only</option>
          ))}
        </select>
      </div>

      {hello && !hello.model.loaded && (
        <div className="rounded bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-300">
          LSTM not loaded: {hello.model.reason}
        </div>
      )}
    </div>
  )
}
