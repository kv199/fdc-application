/* Proposed application icons, not yet copied into src-tauri/icons. */
(() => {
  const icon = (file, px, alt = '') => `<img src="icon/${file}.png" width="${px}" height="${px}" alt="${alt}"/>`;
  const sizes = [64, 32, 24, 16].map(px => `<tr><th scope="row">${px} px</th><td>${icon('fdc-icon', px)}</td><td>${icon('fdc-icon-pulse', px)}</td></tr>`).join('');
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-icon',
    title: 'App icon · Signal F',
    section: 'FOUNDATIONS',
    status: 'proposal',
    proposalLabel: 'FDC ICON / PROPOSAL',
    proposalKicker: 'APP ICON / BOTH THEMES',
    description: 'Two original rounded FDC icon proposals: the minimal Signal F and one telemetry pulse variant. Compare them at Windows tray and taskbar sizes; the installed app icon remains unchanged.',
    html: `<h2>One letter. Two signals.</h2><p class="icon-proposal__intro">Signal F keeps the icon legible at tray size. Pulse tests one functional detail: its lime rail rises like a live telemetry step. Both use the same F, HUD-inspired cuts, rounded tile, and FDC palette. Neither changes the installed app icon.</p>
      <div class="icon-proposal__variants">
        <section class="panel icon-proposal__variant">${icon('fdc-icon', 192, 'Signal F icon: cream F with a straight lime rail on a rounded dark olive tile')}<h3>Signal F</h3><p class="muted">The quieter original. One continuous lime rail.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-pulse', 192, 'Pulse icon: cream F with a lime rail that rises in one step on a rounded dark olive tile')}<h3>Signal F · Pulse</h3><p class="muted">One raised step suggests incoming telemetry without a gauge or tiny readout.</p></section>
      </div>
      <section class="panel"><h3>At working sizes</h3><p class="muted">Compare the silhouettes at 24 and 16 px first. If the step stops reading at tray size, the simpler mark is stronger. Both ICO exports include 16, 24, 32, 48, 64, 128, and 256 px layers.</p><table class="icon-proposal__size-table"><thead><tr><th scope="col">Size</th><th scope="col">Signal F</th><th scope="col">Pulse</th></tr></thead><tbody>${sizes}</tbody></table><h3>Against both themes</h3><div class="icon-proposal__contexts"><div class="icon-proposal__context icon-proposal__context--dark">${icon('fdc-icon', 42)}${icon('fdc-icon-pulse', 42)}<span>FDC Dark</span></div><div class="icon-proposal__context icon-proposal__context--light">${icon('fdc-icon', 42)}${icon('fdc-icon-pulse', 42)}<span>Light Configuration proposal</span></div></div><div class="icon-proposal__old"><img src="../../src-tauri/icons/icon.png" alt="Current installed FDC icon"/><p class="muted">Current installed icon, for comparison. Neither proposal replaces it yet.</p></div></section>
      <section class="panel"><h3>Source and handoff</h3><p>Both marks are authored as vector geometry for this book. They use the current FDC palette: tile <code>#152019</code>, readout <code>#edf0df</code>, and interaction lime <code>#c3ed83</code>. No stock art, generated raster texture, game branding, or copied logo. SVG is the source; PNG and ICO are exports.</p><div class="icon-proposal__files"><a href="icon/fdc-icon.svg">Signal F SVG ↗</a><a href="icon/fdc-icon-pulse.svg">Pulse SVG ↗</a><a href="icon/fdc-icon-pulse.png">Pulse PNG ↗</a><a href="icon/fdc-icon-pulse.ico">Pulse ICO ↗</a></div></section>`
  });
})();
