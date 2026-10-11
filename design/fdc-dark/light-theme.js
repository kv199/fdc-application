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
    description: 'Approved direction for the next light Configuration revision: a light painted header, neutral grey panels and clearer maps. Values below resolve from proposal CSS; the in-game HUD and Delta retain their dark design.',
    html: `<div class="row"><div><span class="label">CONFIGURATION ONLY / PROPOSAL</span><h2>Light canvas, neutral grey instruments</h2><p class="light-proposal__lead">Keep the light outer canvas and reduce glare inside it: grey cards, darker grey fields, dark text and lime only for actions and selection. A new light matte paint texture belongs to the header. Type, square edges and layout stay familiar. The in-game HUD and Delta are outside this theme.</p></div><div><a href="LIGHT_THEME.md">Token and usage notes ↗</a><br><a href="?board=foundation-light-maps">Events and Driver map comparison ↗</a></div></div>
      <section class="panel"><h3>SURFACES AND TEXT</h3>${swatches([
        ['Canvas','--bg'],['Inset / navigation','--surface-deep'],['Ordinary panel','--surface'],['Raised plate','--panel'],
        ['Hover wash','--surface-hover'],['Normal text','--text'],['Supporting text','--text-muted'],['Fine metadata','--text-subtle'],
        ['Default edge','--line'],['Strong edge','--line-strong'],['Disabled text','--text-faint']
      ])}<p class="muted">Separate the light canvas, grey cards, principal plate and darker inset with tone and visible borders. Tables and form fields use the neutral inset.</p></section>
      <section class="panel"><h3>HEADER MATERIAL</h3><div class="light-proposal__material" role="img" aria-label="Light neutral grey matte paint texture"></div><p class="muted">Fine grain, low contrast and no green tint. Confine texture to the header; panels and maps stay flat.</p><a href="textures/paint-light-source.png">Original PNG ↗</a></section>
      <section class="panel"><h3>ACTIONS AND MEANINGS</h3>${swatches([
        ['Muted lime fill','--accent'],['Muted lime hover','--accent-hover'],['Range fill','--range-fill'],['Readable green text','--accent-ink'],['Focus ring','--focus-ring'],
        ['Destructive text / fill','--danger'],['Best / learned cue in Configuration','--best'],['Attention text','--warning'],['Advisory text','--notice']
      ])}<p class="muted">Muted lime is shared by ready actions, selected states and toggle thumbs, including EDIT LAYOUT. Sliders use a slightly darker muted fill and a dark thumb, with the same shapes and state meanings as the dark theme. Supporting labels retain full opacity. Green text and focus use dark ink; pale accent fills are never text colors. The HUD’s telemetry and shift colors are unchanged.</p></section>

      <div class="light-proposal__controls" id="light-controls" aria-label="Muted lime HUD Configuration controls">
        <div>
          <section class="panel range-card"><div class="row"><h3>HUD OPACITY</h3><output class="num green">60%</output></div><input type="range" min="1" max="100" value="60" aria-label="Light proposal HUD opacity"></section>
          <section class="panel"><h3>ARRANGEMENT</h3><p class="muted">Grouped moves the HUD as one block. Freeform moves each block.</p><div class="segmented" role="group" aria-label="Light proposal HUD arrangement"><button type="button" aria-pressed="false">GROUPED</button><button type="button" class="selected" aria-pressed="true">FREEFORM</button></div><div class="light-proposal__control-actions"><button class="button primary" type="button">EDIT LAYOUT</button></div></section>
        </div>
        <section class="panel"><h3>WIDGETS</h3><div class="row light-proposal__widget"><span>Tires</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Tires" aria-checked="true"></button></div><div class="row light-proposal__widget"><span>Throttle & Brake</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Throttle & Brake" aria-checked="true"></button></div><div class="row light-proposal__widget"><span>Steering</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Steering" aria-checked="false"></button></div><div class="row light-proposal__widget"><span>Gear / Speed / RPM</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Gear / Speed / RPM" aria-checked="true"></button></div><div class="row light-proposal__widget"><span>Engine / Boost</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Engine / Boost" aria-checked="false"></button></div><div class="row light-proposal__widget"><span>Input Graph</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Input Graph" aria-checked="true"></button></div><div class="row light-proposal__widget"><span>Delta</span><button class="toggle" type="button" role="switch" aria-label="Light proposal Delta" aria-checked="true"></button></div></section>
      </div>
      <nav class="appnav" aria-label="Light proposal navigation specimen"><a href="?board=hud-config">HUD</a><a href="?board=events-library" class="active" aria-current="page">EVENTS</a><a href="?board=driver-list">DRIVER</a><a href="?board=shift-light">SHIFT LIGHT</a><a href="?board=garage">GARAGE</a><a href="?board=settings">SETTINGS</a></nav>
      <div class="light-proposal__samples">
        <section class="plate"><div class="row"><div><h3>EVENTS</h3><p class="muted">One raised working area for the next action.</p></div><span class="label">1 EVENT</span></div><div class="light-proposal__actions"><button class="button primary" type="button">CREATE</button><button class="button" type="button">OPEN</button><button class="button danger" type="button">DELETE</button><button class="button" type="button" disabled>EXPORT</button></div><p class="light-proposal__statuses"><span class="green">READY</span><span class="purple">PERSONAL BEST</span><span class="amber">UNSAVED</span><span class="red">DELETE</span></p></section>
        <section class="panel"><h3>RECORDED RESULT</h3><p class="muted">Supporting data stays on the ordinary surface.</p><div class="row"><span>BEST LAP</span><strong class="num purple">01:08.953</strong></div><div class="row"><span>SESSION</span><strong class="num">12 LAPS</strong></div><div class="light-proposal__class-row" aria-label="Vehicle class examples"><span class="badge class-a">A 700</span><span class="badge class-s1">S1 800</span><span class="badge class-s2">S2 998</span><span class="badge class-c">C 600</span></div></section>
      </div>
      <p class="light-proposal__note"><strong>Theme boundary.</strong> Only Configuration gains these roles. Its header uses textures/paint-light.jpg at 90% opacity with dark text and a darker inset status. The in-game HUD, Delta, telemetry colors, class hues, mode hues, type scale and spacing keep their existing values. This is the approved design direction, not an implemented FDC update.</p>`
  });
})();

// The specimen is local to the book. Keep its progress fill aligned with the
// native range value; the existing book handler updates the numeric readout.
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => {
    const update = range => {
      const min = Number(range.min) || 0;
      const max = Number(range.max) || 100;
      range.style.setProperty('--range-position', ((Number(range.value) - min) / (max - min) * 100) + '%');
    };
    document.querySelectorAll('.app--light-proposal input[type="range"]').forEach(range => {
      update(range);
      range.addEventListener('input', () => update(range));
    });
  });
}
