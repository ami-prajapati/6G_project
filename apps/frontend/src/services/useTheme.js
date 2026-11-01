// Light/dark theme: persisted in localStorage, applied as a `light` class on <html> (dark is the default).
import { useCallback, useEffect, useState } from 'react'

const KEY = 'theme'

function initialTheme() {
  try {
    return localStorage.getItem(KEY) === 'light' ? 'light' : 'dark'
  } catch (e) {
    return 'dark'
  }
}

export function useTheme() {
  const [theme, setTheme] = useState(initialTheme)

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light')
    try {
      localStorage.setItem(KEY, theme)
    } catch (e) {
      /* storage unavailable - theme just will not persist */
    }
  }, [theme])

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), [])
  return { theme, toggle }
}
