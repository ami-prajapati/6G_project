// One button that switches between the dark and light theme.
export default function ThemeToggle({ theme, onToggle }) {
  const toLight = theme === 'dark'
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      title={toLight ? 'Switch to light theme' : 'Switch to dark theme'}
      className="flex items-center gap-2 rounded-md border border-slate-700 bg-slate-800 px-3 py-1.5 text-sm font-medium text-slate-100 transition-colors hover:bg-slate-700"
    >
      <span aria-hidden="true">{toLight ? '☀️' : '🌙'}</span>
      {toLight ? 'Light' : 'Dark'}
    </button>
  )
}
