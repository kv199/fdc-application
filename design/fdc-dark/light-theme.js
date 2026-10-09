/* Configuration-only light palette proposal; no application theme switch. */
(() => {
  const swatches = entries => `<div class="light-proposal__swatches">${entries.map(([name, token]) => `<div class="light-proposal__swatch" style="--sample:var(${token})"><i aria-hidden="true"></i><strong>${name}</strong><code data-light-token="${token}">${token}</code></div>`).join('')}</div>`;
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-light',
    title: 'Light theme · Configuration',
    section: 'FOUNDATIONS',
    status: 'proposal',
    theme: 'light',
    proposalLabel: 'FDC LIGHT / PROPOSAL',
    proposalKicker: 'CONFIGURATION ONLY / HUD UNCHANGED',
    description: 'Proposed light roles for the Configuration window. The painted header, in-game HUD and Delta keep their current dark design. Values below resolve from the separate proposal CSS, not the app runtime.',
    html: `<div class="row"><div><span class="label">CONFIGURATION ONLY / PROPOSAL</span><h2>Light work area, familiar FDC</h2><p class="light-proposal__lead">The app keeps its painted dark header, type, square edges and current layout. Light roles make lists, forms and recorded data easier to scan. The on-game HUD and Delta are outside this theme.</p></div><div><a href="LIGHT_THEME.md">Token and usage notes ↗</a><br><a href="?board=foundation-light-maps">Events and Driver map comparison ↗</a></div></div>
      <section class="panel"><h3>SURFACES AND TEXT</h3>${swatches([
        ['Canvas','--bg'],['Inset / navigation','--surface-deep'],['Ordinary panel','--surface'],['Raised plate','--panel'],
        ['Hover wash','--surface-hover'],['Normal text','--text'],['Supporting text','--text-muted'],['Fine metadata','--text-subtle'],
        ['Default edge','--line'],['Strong edge','--line-strong'],['Disabled text','--text-faint']
      ])}<p class="muted">The raised plate remains the one main working area. Tables and form fields use the cooler inset.</p></section>
      <section class="panel"><h3>ACTIONS AND MEANINGS</h3>${swatches([
        ['FDC lime fill','--accent'],['Lime hover','--accent-hover'],['Readable green text','--accent-ink'],['Focus ring','--focus-ring'],
        ['Destructive text / fill','--danger'],['Best / learned cue in Configuration','--best'],['Attention text','--warning'],['Advisory text','--notice']
      ])}<p class="muted">Lime fill stays close to FDC Dark. On light surfaces, focus and green text use darker roles for contrast. The HUD’s telemetry green and shift colors are unchanged.</p></section>
      <nav class="appnav" aria-label="Light proposal navigation specimen"><a href="?board=hud-config">HUD</a><a href="?board=events-library" class="active" aria-current="page">EVENTS</a><a href="?board=driver-list">DRIVER</a><a href="?board=shift-light">SHIFT LIGHT</a><a href="?board=garage">GARAGE</a><a href="?board=settings">SETTINGS</a></nav>
      <div class="light-proposal__samples">
        <section class="plate"><div class="row"><div><h3>EVENTS</h3><p class="muted">One raised working area for the next action.</p></div><span class="label">1 EVENT</span></div><div class="light-proposal__actions"><button class="button primary" type="button">CREATE</button><button class="button" type="button">OPEN</button><button class="button danger" type="button">DELETE</button><button class="button" type="button" disabled>EXPORT</button></div><p class="light-proposal__statuses"><span class="green">READY</span><span class="purple">PERSONAL BEST</span><span class="amber">UNSAVED</span><span class="red">DELETE</span></p></section>
        <section class="panel"><h3>RECORDED RESULT</h3><p class="muted">Supporting data stays on the ordinary surface.</p><div class="row"><span>BEST LAP</span><strong class="num purple">01:08.953</strong></div><div class="row"><span>SESSION</span><strong class="num">12 LAPS</strong></div><div class="light-proposal__class-row" aria-label="Vehicle class examples"><span class="badge class-a">A 700</span><span class="badge class-s1">S1 800</span><span class="badge class-s2">S2 998</span><span class="badge class-c">C 600</span></div></section>
      </div>
      <p class="light-proposal__note"><strong>Theme boundary.</strong> Only Configuration gains these roles. The dark header uses the current paint texture and dark text roles. The in-game HUD, Delta, telemetry colors, class hues, mode hues, type scale and spacing keep their existing values. This page is a design proposal, not a live app preference.</p>`
  });
})();
