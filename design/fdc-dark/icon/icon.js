/* A proposed application icon, not yet copied into src-tauri/icons. */
(() => {
  const size = px => `<figure><img src="icon/fdc-icon.png" width="${px}" height="${px}" alt=""/><figcaption>${px} px</figcaption></figure>`;
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-icon',
    title: 'App icon · Signal F',
    section: 'FOUNDATIONS',
    status: 'proposal',
    proposalLabel: 'FDC ICON / PROPOSAL',
    proposalKicker: 'APP ICON / BOTH THEMES',
    description: 'A rounded dark-olive application tile with one cream F and a lime signal rail. The icon is an original vector proposal, shown at Windows tray and taskbar sizes; the installed app icon remains unchanged.',
    html: `<h2>One signal. One letter.</h2><p class="icon-proposal__intro">At tray size, the current gauge, three letters, and two traces compete for a few pixels. This mark uses the first letter of FDC as a compact identifier. The lime upper rail reads as an active signal, while two clipped ends echo the HUD geometry. The tile is rounded for Windows; the mark remains square and precise.</p>
      <div class="icon-proposal__comparison">
        <section class="panel icon-proposal__hero"><img src="icon/fdc-icon.png" width="256" height="256" alt="Proposed FDC icon: lime and cream F on a rounded dark olive tile"/><h3>Signal F</h3><p class="muted">Flat dark olive, FDC lime, and warm instrument text. No texture or tiny readout detail.</p></section>
        <section class="panel"><h3>At working sizes</h3><p class="muted">The same PNG, rendered at common Windows icon sizes. The ICO includes 16, 24, 32, 48, 64, 128, and 256 px layers.</p><div class="icon-proposal__sizes">${[64,48,32,24,16].map(size).join('')}</div><h3>Against both themes</h3><div class="icon-proposal__contexts"><div class="icon-proposal__context icon-proposal__context--dark"><img src="icon/fdc-icon.png" alt=""/><span>FDC Dark</span></div><div class="icon-proposal__context icon-proposal__context--light"><img src="icon/fdc-icon.png" alt=""/><span>Light Configuration proposal</span></div></div><div class="icon-proposal__old"><img src="../../src-tauri/icons/icon.png" alt="Current installed FDC icon"/><p class="muted">Current installed icon, for comparison. This proposal does not replace it yet.</p></div></section>
      </div>
      <section class="panel"><h3>Source and handoff</h3><p>The mark is authored as vector geometry for this book. It uses the current FDC palette: tile <code>#152019</code>, readout <code>#edf0df</code>, and interaction lime <code>#c3ed83</code>. It contains no stock art, generated raster texture, game branding, or copied logo. The SVG is the source; PNG and ICO are exports.</p><div class="icon-proposal__files"><a href="icon/fdc-icon.svg">SVG source ↗</a><a href="icon/fdc-icon.png">1024 px PNG ↗</a><a href="icon/fdc-icon.ico">Windows ICO ↗</a></div></section>`
  });
})();
