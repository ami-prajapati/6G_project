/** @type {import('tailwindcss').Config} */
// The `slate` scale is driven by CSS variables (see src/index.css): the dark theme uses the normal scale,
// the light theme inverts it, so every existing `bg-slate-*` / `text-slate-*` class works in both themes.
const slate = Object.fromEntries(
  [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950].map((n) => [n, `rgb(var(--slate-${n}) / <alpha-value>)`]),
)

export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: { slate },
      fontFamily: { mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'] },
    },
  },
  plugins: [],
}
