/* Proposed application icons, not yet copied into src-tauri/icons. */
(() => {
  const icon = (file, px, alt = '') => `<img src="icon/${file}.png" width="${px}" height="${px}" alt="${alt}"/>`;
  const files = ['fdc-icon', 'fdc-icon-lift', 'fdc-icon-pulse'];
  const sizes = [64, 32, 24, 16].map(px => `<tr><th scope="row">${px} px</th>${files.map(file => `<td>${icon(file, px)}</td>`).join('')}</tr>`).join('');
  const context = (name, theme) => `<div class="icon-proposal__context icon-proposal__context--${theme}">${files.map(file => icon(file, 42)).join('')}<span>${name}</span></div>`;
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-icon',
    title: 'App icon · Signal F',
    section: 'FOUNDATIONS',
    status: 'proposal',
    proposalLabel: 'FDC ICON / PROPOSAL',
    proposalKicker: 'APP ICON / BOTH THEMES',
    description: 'Three rounded FDC icon proposals: the original Signal F, a sketch-led version with both arms detached and raised, and a single-step Pulse. Compare them at tray size; the installed app icon remains unchanged.',
    html: `<h2>Lift both arms.</h2><p class="icon-proposal__intro">This study follows the supplied sketch: the outer parts of both F arms are cut away, raised, and given the same diagonal ending. Cream retains the readable F; lime identifies the two floating segments. The palette and rounded tile stay aligned with FDC.</p>
      <div class="icon-proposal__variants">
        <section class="panel icon-proposal__variant">${icon('fdc-icon', 192, 'Signal F icon: cream F with a continuous lime upper rail on a rounded dark olive tile')}<h3>Signal F</h3><p class="muted">The minimal baseline. One continuous rail.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-lift', 192, 'Lift icon: cream F with both horizontal tips detached, raised, and angled in lime')}<h3>Signal F · Lift</h3><p class="muted">Both horizontal tips float upward. Their diagonal ends share the same angle.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-pulse', 192, 'Pulse icon: cream F with one raised step in the lime rail')}<h3>Signal F · Pulse</h3><p class="muted">The previous single-step experiment.</p></section>
      </div>
      <section class="panel"><h3>At working sizes</h3><p class="muted">Judge the gaps and F silhouette at 24 and 16 px first. Each ICO export includes 16, 24, 32, 48, 64, 128, and 256 px layers.</p><table class="icon-proposal__size-table"><thead><tr><th scope="col">Size</th><th scope="col">Signal F</th><th scope="col">Lift</th><th scope="col">Pulse</th></tr></thead><tbody>${sizes}</tbody></table><h3>Against both themes</h3><div class="icon-proposal__contexts">${context('FDC Dark', 'dark')}${context('Light Configuration proposal', 'light')}</div><div class="icon-proposal__old"><img src="../../src-tauri/icons/icon.png" alt="Current installed FDC icon"/><p class="muted">Current installed icon, for comparison. No proposal replaces it yet.</p></div></section>
      <section class="panel"><h3>Source and handoff</h3><p>The new Lift variant is vector geometry based on the user's sketch, using the same FDC palette: tile <code>#152019</code>, readout <code>#edf0df</code>, and lime <code>#c3ed83</code>. The sketch defines the composition; its sample colors are not used. SVG is the source; PNG and ICO are exports. No game branding or stock art is added.</p><div class="icon-proposal__files"><a href="icon/fdc-icon-lift.svg">Lift SVG ↗</a><a href="icon/fdc-icon-lift.png">Lift PNG ↗</a><a href="icon/fdc-icon-lift.ico">Lift ICO ↗</a><a href="icon/fdc-icon.svg">Signal F SVG ↗</a><a href="icon/fdc-icon-pulse.svg">Pulse SVG ↗</a></div></section>`
  });
})();
