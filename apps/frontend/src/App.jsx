// Main dashboard layout: globe, TTFF panel, Doppler monitor, controls + resources.
import { useEffect, useState } from 'react'
import ControlPanel from './components/ControlPanel.jsx'
import DopplerChart from './components/DopplerChart.jsx'
import GlobeViewer from './components/GlobeViewer.jsx'
import LatencyPanel from './components/LatencyPanel.jsx'
import ResourcesPanel from './components/ResourcesPanel.jsx'
import ThemeToggle from './components/ThemeToggle.jsx'
import { fetchOrbits } from './services/websocket'
import { useTelemetry } from './services/useTelemetry'
import { useTheme } from './services/useTheme'

function Panel({ id, title, children, className = '' }) {
  return (
    <section id={id} className={`scroll-mt-4 rounded-xl border border-slate-800 bg-slate-900/60 p-4 shadow-lg ${className}`}>
      <h2 className="mb-3 text-sm font-semibold tracking-wide text-slate-200">{title}</h2>
      {children}
    </section>
  )
}

export default function App() {
  const { status, hello, packet, chart, ttffHistory, send } = useTelemetry()
  const { theme, toggle: toggleTheme } = useTheme()
  const [orbits, setOrbits] = useState(null)
  const [enabled, setEnabled] = useState([])

  // once the backend says hello: enable every constellation and fetch the orbit rings
  useEffect(() => {
    if (!hello) return
    setEnabled(hello.constellations.map((c) => c.name))
    fetchOrbits().then(setOrbits).catch((err) => console.error(err))
  }, [hello])

  const toggle = (name) => {
    const next = enabled.includes(name) ? enabled.filter((n) => n !== name) : [...enabled, name]
    setEnabled(next)
    send({ cmd: 'constellations', enabled: next })
  }

  const trackedColor =
    packet && packet.tracked && hello
      ? (hello.constellations.find((c) => c.name === packet.tracked.constellation) || {}).color
      : undefined

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 px-6 py-4">
        <div>
          <h1 className="text-lg font-semibold">6G LEO-Assisted Fast GNSS TTFF Engine</h1>
          <p className="text-xs text-slate-400">
            NTN ephemeris streaming + LSTM Doppler correction · ground station {hello ? hello.station.name : 'Ahmedabad'}
            {hello ? ` (${hello.station.lat.toFixed(4)}° N, ${hello.station.lon.toFixed(4)}° E)` : ''}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <div className="font-mono text-xs text-slate-400">
            {packet ? `packet #${packet.seq} · ${packet.visible.length} sats in view` : 'connecting…'}
          </div>
          <a
            href="#resources"
            className="rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700"
          >
            📚 Resources
          </a>
          <ThemeToggle theme={theme} onToggle={toggleTheme} />
        </div>
      </header>

      <main className="grid gap-4 p-4 lg:grid-cols-3">
        {/* the globe card stretches to the full height of the row, so there is no empty gap under it */}
        <Panel title="1 · 3D Globe — constellations, orbits & RF links" className="flex flex-col lg:col-span-2">
          <div className="relative min-h-[520px] flex-1">
            <GlobeViewer packet={packet} hello={hello} orbits={orbits} enabled={enabled} theme={theme} />
          </div>
        </Panel>

        <div className="space-y-4">
          <Panel title="4 · Simulation & constellation controls">
            <ControlPanel status={status} hello={hello} packet={packet} enabled={enabled} onToggle={toggle} send={send} />
          </Panel>
          <Panel title="2 · Live TTFF acceleration & ephemeris stream">
            <LatencyPanel ttff={packet ? packet.ttff : null} history={ttffHistory} />
          </Panel>
        </div>

        <Panel title="3 · AI Doppler correction monitor (LSTM, 50 ms ahead)" className="lg:col-span-3">
          <DopplerChart tracked={packet ? packet.tracked : null} chart={chart} color={trackedColor} theme={theme} />
        </Panel>

        <Panel id="resources" title="5 · Research papers, 6G references & datasets" className="lg:col-span-3">
          <ResourcesPanel />
        </Panel>
      </main>
    </div>
  )
}
