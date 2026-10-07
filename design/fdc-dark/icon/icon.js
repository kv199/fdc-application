/* Proposed application icons, not yet copied into src-tauri/icons. */
(() => {
  const icon = (file, px, alt = '') => `<img src="icon/${file}.png" width="${px}" height="${px}" alt="${alt}"/>`;
  const metal = (px, label = '') => `<span class="icon-proposal__metal" style="--icon-size:${px}px" ${label ? `role="img" aria-label="${label}"` : 'aria-hidden="true"'}><img class="icon-proposal__metal-texture" src="../../overlay/assets/textures/paint.jpg" alt=""/><img class="icon-proposal__metal-mark" src="icon/fdc-icon-lift-mark.svg" alt=""/></span>`;
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
    description: 'Three rounded FDC icon proposals. Lift now has shorter F arms, wider and closer throttle/brake pieces, and a subtle gradient; compare it with the app paint texture at tray size. The installed icon remains unchanged.',
    html: `<h2>Less arm. More signal.</h2><p class="icon-proposal__intro">Lift keeps both angled cuts in the F, shortens the cream arms, and widens the detached throttle and brake pieces. Their gaps are smaller. The tile now carries a quiet olive gradient; the same mark is also shown over FDC's existing painted material below.</p>
      <div class="icon-proposal__variants">
        <section class="panel icon-proposal__variant">${icon('fdc-icon', 192, 'Signal F icon: cream F with a continuous lime upper rail on a rounded dark olive tile')}<h3>Signal F</h3><p class="muted">The minimal baseline. One continuous rail.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-lift', 192, 'Lift icon: short cream F arms and wider green and red pieces with close diagonal cuts on an olive gradient tile')}<h3>Signal F · Lift</h3><p class="muted">Shorter cream arms, broader throttle and brake pieces, tighter cuts.</p></section>
        <section class="panel icon-proposal__variant">${icon('fdc-icon-pulse', 192, 'Pulse icon: cream F with one raised step in the lime rail')}<h3>Signal F · Pulse</h3><p class="muted">The previous single-step experiment.</p></section>
      </div>
      <section class="panel"><h3>Background finish</h3><p class="muted icon-proposal__intro">The guide favors a bold symbol and a quiet background at small sizes. These previews hold the same mark and compare only the tile treatment. The gradient is exported as SVG, PNG, and ICO. The material preview reads the existing FDC paint file without copying it into the book.</p><div class="icon-proposal__finish-grid"><figure>${icon('fdc-icon-lift', 160, 'Lift icon with subdued olive gradient')}<figcaption><strong>Olive gradient</strong><span>Portable icon export</span></figcaption><div class="icon-proposal__finish-sizes">${icon('fdc-icon-lift', 32)}${icon('fdc-icon-lift', 16)}</div></figure><figure>${metal(160, 'Lift mark over the FDC painted material')}<figcaption><strong>FDC painted material</strong><span>Book preview only</span></figcaption><div class="icon-proposal__finish-sizes">${metal(32)}${metal(16)}</div></figure></div></section>
      <section class="panel"><h3>At working sizes</h3><p class="muted">Judge the gaps and F silhouette at 24 and 16 px first. Each ICO export includes 16, 24, 32, 48, 64, 128, and 256 px layers.</p><table class="icon-proposal__size-table"><thead><tr><th scope="col">Size</th><th scope="col">Signal F</th><th scope="col">Lift</th><th scope="col">Pulse</th></tr></thead><tbody>${sizes}</tbody></table><h3>Against both themes</h3><div class="icon-proposal__contexts">${context('FDC Dark', 'dark')}${context('Light Configuration proposal', 'light')}</div><div class="icon-proposal__old"><img src="../../src-tauri/icons/icon.png" alt="Current installed FDC icon"/><p class="muted">Current installed icon, for comparison. No proposal replaces it yet.</p></div></section>
      <section class="panel"><h3>Source and handoff</h3><p>Lift is vector geometry based on the user's sketch. Its tile uses a subtle gradient from FDC's olive surfaces; the letter is readout <code>#edf0df</code>, with HUD throttle <code>#69e83f</code> and brake <code>#ff312b</code>. The material preview reuses <code>overlay/assets/textures/paint.jpg</code> and is not an exported icon. SVG is the gradient source; PNG and ICO are exports. No game branding or stock art is added.</p><div class="icon-proposal__files"><a href="icon/fdc-icon-lift.svg">Lift SVG ↗</a><a href="icon/fdc-icon-lift.png">Lift PNG ↗</a><a href="icon/fdc-icon-lift.ico">Lift ICO ↗</a><a href="icon/fdc-icon.svg">Signal F SVG ↗</a><a href="icon/fdc-icon-pulse.svg">Pulse SVG ↗</a></div></section>`
  });
})();
