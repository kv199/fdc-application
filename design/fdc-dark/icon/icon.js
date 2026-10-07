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
    description: 'Three rounded FDC icon proposals: the original Signal F, a sketch-led version with matching angled cuts in both F arms and separate throttle/brake pieces, and a single-step Pulse. Compare them at tray size; the installed app icon remains unchanged.',
    html: `<h2>Both cuts belong to the F.</h2><p class="icon-proposal__intro">The enlarged Lift study follows the supplied sketch more closely. Both cream arms end in diagonal cuts. Their detached pieces repeat those cuts, with a narrow gap and slight upward shift. The upper piece uses FDC's throttle green; the lower uses its brake red.</p>
      <div class="icon-proposal__variants">
        <section class="panel icon-proposal__variant">${icon('fdc-icon', 192, 'Signal F icon: cream F with a continuous lime upper rail on a rounded dark olive tile')}<h3>Signal F</h3><p class="muted">The minimal baseline. One continuous rail.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-lift', 192, 'Lift icon: enlarged cream F with two diagonal cuts, a floating green upper piece, and a floating red lower piece')}<h3>Signal F · Lift</h3><p class="muted">The F and both floating pieces share the same cut. Green is throttle; red is brake.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-pulse', 192, 'Pulse icon: cream F with one raised step in the lime rail')}<h3>Signal F · Pulse</h3><p class="muted">The previous single-step experiment.</p></section>
      </div>
      <section class="panel"><h3>At working sizes</h3><p class="muted">Judge the gaps and F silhouette at 24 and 16 px first. Each ICO export includes 16, 24, 32, 48, 64, 128, and 256 px layers.</p><table class="icon-proposal__size-table"><thead><tr><th scope="col">Size</th><th scope="col">Signal F</th><th scope="col">Lift</th><th scope="col">Pulse</th></tr></thead><tbody>${sizes}</tbody></table><h3>Against both themes</h3><div class="icon-proposal__contexts">${context('FDC Dark', 'dark')}${context('Light Configuration proposal', 'light')}</div><div class="icon-proposal__old"><img src="../../src-tauri/icons/icon.png" alt="Current installed FDC icon"/><p class="muted">Current installed icon, for comparison. No proposal replaces it yet.</p></div></section>
      <section class="panel"><h3>Source and handoff</h3><p>Lift is vector geometry based on the user's sketch. Its tile and letter use FDC's dark <code>#152019</code> and readout <code>#edf0df</code>; the detached pieces use HUD throttle <code>#69e83f</code> and brake <code>#ff312b</code>. The sketch defines the composition, not the final color values. SVG is the source; PNG and ICO are exports. No game branding or stock art is added.</p><div class="icon-proposal__files"><a href="icon/fdc-icon-lift.svg">Lift SVG ↗</a><a href="icon/fdc-icon-lift.png">Lift PNG ↗</a><a href="icon/fdc-icon-lift.ico">Lift ICO ↗</a><a href="icon/fdc-icon.svg">Signal F SVG ↗</a><a href="icon/fdc-icon-pulse.svg">Pulse SVG ↗</a></div></section>`
  });
})();
