// Module 5 - research papers, 6G reference links and downloadable datasets.
import { useState } from 'react'
import { DATASETS, DATA_SOURCES, LINKS, PAPERS, ZIP_ALL } from '../data/resources'

const TABS = [
  ['papers', 'Research papers'],
  ['links', '6G references'],
  ['datasets', 'Datasets'],
]

const downloadUrl = (file) => `${import.meta.env.BASE_URL}downloads/${file}`

function Tag({ children, tone = 'bg-slate-800 text-slate-300' }) {
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${tone}`}>{children}</span>
}

function LinkCard({ item, tag }) {
  return (
    <a
      href={item.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex flex-col gap-1.5 rounded-lg border border-slate-800 bg-slate-800/40 p-3 transition-colors hover:border-cyan-500/60 hover:bg-slate-800"
    >
      <div className="flex flex-wrap items-center gap-1.5">
        {tag && <Tag tone="bg-cyan-500/15 text-cyan-300">{tag}</Tag>}
        <Tag>{item.org}</Tag>
      </div>
      <div className="text-sm font-medium leading-snug text-slate-100">{item.title} <span aria-hidden="true">↗</span></div>
      <p className="text-xs leading-snug text-slate-400">{item.note}</p>
    </a>
  )
}

const BTN =
  'inline-flex items-center gap-1.5 rounded-md bg-cyan-500 px-3 py-1.5 text-xs font-semibold text-[#020617] transition-colors hover:bg-cyan-400'

export default function ResourcesPanel() {
  const [tab, setTab] = useState('papers')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              tab === key ? 'bg-cyan-500 text-[#020617]' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'papers' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {PAPERS.map((p) => (
            <LinkCard key={p.url} item={p} tag={p.kind} />
          ))}
        </div>
      )}

      {tab === 'links' && (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {LINKS.map((l) => (
            <LinkCard key={l.url} item={l} />
          ))}
        </div>
      )}

      {tab === 'datasets' && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/40 p-3">
            <div>
              <div className="text-sm font-medium text-slate-100">Download everything</div>
              <div className="text-xs text-slate-400">{ZIP_ALL.note}</div>
            </div>
            <a href={downloadUrl(ZIP_ALL.file)} download className={BTN}>
              ⬇ {ZIP_ALL.file} ({ZIP_ALL.size})
            </a>
          </div>

          <div className="grid gap-2 md:grid-cols-2">
            {DATASETS.map((d) => (
              <div key={d.file} className="flex items-center justify-between gap-3 rounded-lg border border-slate-800 bg-slate-800/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-slate-100">{d.name}</span>
                    <Tag tone={d.real ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'}>
                      {d.real ? 'real data' : 'simulated'}
                    </Tag>
                  </div>
                  <div className="truncate font-mono text-[11px] text-slate-500">{d.file} · {d.size}</div>
                  <div className="text-xs text-slate-400">{d.note}</div>
                </div>
                <a href={downloadUrl(d.file)} download className={BTN}>⬇ Download</a>
              </div>
            ))}
          </div>

          <div>
            <div className="mb-2 text-[11px] uppercase tracking-wide text-slate-400">Get fresh data from the original sources</div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {DATA_SOURCES.map((s) => (
                <LinkCard key={s.url} item={{ ...s, org: new URL(s.url).hostname.replace('www.', '') }} />
              ))}
            </div>
          </div>

          <p className="text-[11px] leading-snug text-slate-500">
            TLE files are real CelesTrak element sets (epochs Sep-Oct 2026) and age quickly - refresh them from
            CelesTrak for long-term use. The ionosphere and trajectory files are simulated for development;
            do not present them as measured data.
          </p>
        </div>
      )}

      <p className="text-[11px] leading-snug text-slate-500">
        External links open in a new tab and were not re-verified automatically - confirm each source before citing it.
      </p>
    </div>
  )
}
