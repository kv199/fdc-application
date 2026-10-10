// Sets the Configuration theme before the first paint from the saved display
// preferences, so a light window never flashes dark. settings.js keeps it in
// sync afterwards; the in-game HUD never loads this file.
;(function () {
  const root = document.documentElement
  try {
    const saved = JSON.parse(localStorage.getItem('fdc.display-preferences.v1') || '{}')
    const theme = saved?.theme === 'light' || saved?.theme === 'system' ? saved.theme : 'dark'
    const light = theme === 'light'
      || (theme === 'system' && window.matchMedia?.('(prefers-color-scheme: light)').matches)
    root.dataset.theme = light ? 'light' : 'dark'
  } catch {
    root.dataset.theme = 'dark'
  }
})()
