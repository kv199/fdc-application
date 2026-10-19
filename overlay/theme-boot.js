// Sets the Configuration theme before the first paint from the saved display
// preferences, so a light window never flashes dark. settings.js keeps it in
// sync afterwards; the in-game HUD never loads this file.
// The theme choice comes from DisplayPreferences.effectiveTheme, so this page and
// settings.js share one switch. settings.html loads display-preferences.js first.
// If that script is missing, the catch below paints dark.
;(function () {
  const root = document.documentElement
  try {
    const saved = JSON.parse(localStorage.getItem('fdc.display-preferences.v1') || '{}')
    const theme = window.DisplayPreferences.effectiveTheme(saved?.theme)
    const light = theme === 'light'
      || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches)
    root.dataset.theme = light ? 'light' : 'dark'
  } catch {
    root.dataset.theme = 'dark'
  }
})()
