/* Issue #40: design-only fixtures. No telemetry, reference engine or persistence. */
(() => {
  const states = {
    finish: { fill: '14.2%', lap: '01:23.616', label: 'Lap complete', delta: '−0.284', tone: 'ahead', best: '01:23.900', sectors: [['better', '−0.124', 'BETTER'], ['worse', '+0.083', 'WORSE'], ['best', '−0.243', 'BEST']], note: 'All three results stay visible at the finish. A best sector uses purple, even when it is also better than the reference.' },
    start: { lap: '00:00.000', label: 'Lap start', delta: '+0.000', tone: 'neutral', best: '01:23.900', sectors: [['active', '—', 'CURRENT'], ['pending', '—', 'WAITING'], ['pending', '—', 'WAITING']], note: 'The row keeps its shape. Unfinished sectors have no comparison value or result color.' },
    s1: { fill: '6.2%', lap: '00:27.104', label: 'S1 complete · S2 current', delta: '−0.124', tone: 'ahead', best: '01:23.900', sectors: [['better', '−0.124', 'BETTER'], ['active', '—', 'CURRENT'], ['pending', '—', 'WAITING']], note: 'S1 locks its result at the sector boundary. S2 stays neutral until it is complete.' },
    s2: { fill: '2.05%', lap: '00:54.920', label: 'S2 complete · S3 current', delta: '−0.041', tone: 'ahead', best: '01:23.900', sectors: [['better', '−0.124', 'BETTER'], ['worse', '+0.083', 'WORSE'], ['active', '—', 'CURRENT']], note: 'The lap is still ahead overall, although S2 was slower. Sector yellow does not change the main Delta’s green/red meaning.' },
    next: { lap: '00:00.000', label: 'Next lap', delta: '+0.000', tone: 'neutral', best: '01:23.900', sectors: [['active', '—', 'CURRENT'], ['pending', '—', 'WAITING'], ['pending', '—', 'WAITING']], note: 'Proposed reset: clear the previous lap’s results at the next start, then fill this row again. No old value looks like a result from the new lap.' },
    missing: { lap: '00:27.104', label: 'No sector reference', delta: '—', tone: 'neutral', best: '—', sectors: [['unavailable', '—', 'NO REF'], ['active', '—', 'CURRENT'], ['pending', '—', 'WAITING']], note: 'S1 has finished, but has no comparison. It stays neutral. Main Delta is also unavailable in this example; neither gets a fabricated result.' },
    equal: { fill: '4.15%', lap: '00:55.044', label: 'Equal sector · lap behind', delta: '+0.083', tone: 'behind', best: '01:23.900', sectors: [['equal', '0.000', 'EQUAL'], ['worse', '+0.083', 'WORSE'], ['active', '—', 'CURRENT']], note: 'An equal sector uses neutral ink with an explicit label. The main Delta keeps its existing red for a lap that is behind.' },
    offline: { lap: '—', label: 'Telemetry unavailable', delta: '—', tone: 'neutral', best: '—', sectors: [['unavailable', '—', 'NO DATA'], ['unavailable', '—', 'NO DATA'], ['unavailable', '—', 'NO DATA']], note: 'Unavailable-state specimen for review. Values and result colors are cleared; production visibility continues to follow the existing HUD rules.' }
  };
  const cells = sectors => sectors.map(([tone, value, label], index) => `<div class="sector-cell" data-sector-tone="${tone}"><span class="sector-cell__name">S${index + 1}</span><strong class="sector-cell__value">${value}</strong><span class="sector-cell__status">${label}</span></div>`).join('');
  const strip = (state, current = false) => `<div class="sector-delta" style="--sector-delta-fill: ${state.fill || '0%'}" data-delta-tone="${state.tone}"${current ? ' data-sector-preview' : ''} aria-label="Illustrative Delta with sector results"><div class="sector-delta__topline"><strong class="sector-delta__lap" aria-label="Illustrative current lap time">${state.lap}</strong><div class="sector-delta__best"><span>BEST</span><strong>${state.best}</strong></div></div><strong class="sector-delta__value">${state.delta}</strong><div class="sector-delta__bar" aria-hidden="true"><i></i></div><div class="sector-delta__sectors">${cells(state.sectors)}</div></div>`;
  const example = (title, state, caption) => `<figure class="sector-example"><figcaption>${title}</figcaption><div class="sector-example__stage">${strip(state)}</div><p>${caption}</p></figure>`;
  // Reuse the established book HUD specimen without changing its board or runtime.
  const hud = window.FDC_SCREENS.find(board => board.id === 'hud-live').html;
  const grouped = hud.slice(hud.indexOf('<div class="hud-spec-grouped"'), hud.indexOf('<div class="hud-spec-anatomy">')).replace(/<\/div>\s*<\/div>\s*$/, '');
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-sectors', title: 'Delta · Sector indicators', section: 'FOUNDATIONS', status: 'proposal',
    proposalLabel: 'FDC SECTORS / PROPOSAL', proposalKicker: 'HUD STUDY / ISSUE #40',
    description: 'A compact S1 / S2 / S3 row beneath the existing Delta bar. Signed sector differences and quiet status labels; interactive fixture states only.',
    html: `<div class="sector-study">
      <div class="sector-study__intro"><div><h2>The lap, sector by sector.</h2><p>Current Delta leads. Three small results underneath show where the lap got better, worse, or best — as each sector finishes.</p></div><a href="https://github.com/kv199/forza-horizon-6-suite/issues/40" target="_blank" rel="noreferrer">Issue #40 ↗</a></div>
      <section class="sector-workbench" aria-label="Sector design demonstration">
        <div class="sector-workbench__caption"><span>DELTA / HUD DESIGN STUDY · BASE SCALE</span><span>SYNTHETIC DATA / NO LIVE CONNECTION</span></div>
        <div class="sector-workbench__stage"><div class="sector-workbench__stack">${strip(states.finish, true)}${grouped}</div></div>
        <div class="sector-workbench__controls"><div class="sector-state-picker" role="group" aria-label="Preview lap states">${[['start', 'Lap start'], ['s1', 'S1 finish'], ['s2', 'S2 finish'], ['finish', 'Lap finish'], ['next', 'Next lap']].map(([id, label]) => `<button type="button" data-sector-state="${id}" aria-pressed="${id === 'finish'}">${label}</button>`).join('')}</div><div class="sector-state-picker" role="group" aria-label="Preview edge states">${[['missing', 'No reference'], ['equal', 'Equal sector'], ['offline', 'No telemetry']].map(([id, label]) => `<button type="button" data-sector-state="${id}" aria-pressed="false">${label}</button>`).join('')}</div></div>
        <div class="sector-workbench__reading" aria-live="polite" aria-atomic="true"><strong data-sector-state-label>${states.finish.label}</strong><p data-sector-state-note>${states.finish.note}</p></div>
      </section>
      <dl class="sector-key"><div data-sector-tone="better"><dt><i></i>BETTER</dt><dd>Faster than the reference.<br>Signed difference in seconds.</dd></div><div data-sector-tone="worse"><dt><i></i>WORSE</dt><dd>Slower than the reference.<br>Yellow, without a full-cell fill.</dd></div><div data-sector-tone="best"><dt><i></i>BEST</dt><dd>Best in the agreed context.<br>Purple takes priority over green.</dd></div><div data-sector-tone="pending"><dt><i></i>NEUTRAL</dt><dd>Unfinished or unavailable.<br>A dash is never a timed result.</dd></div></dl>
      <section class="sector-study__states"><h2>Only completed sectors earn a color.</h2><div class="sector-examples">${example('After S2 · the lap is ahead', states.s2, 'A green main Delta can sit above a yellow sector. The headline compares the lap; each cell describes just that sector.')}${example('No reference · no false result', states.missing, 'The completed sector says NO REF. Current and waiting sectors keep neutral labels and dashes.')}</div></section>
      <div class="sector-study__notes"><section><h3>One surface. One glance.</h3><p>The row belongs to Delta, directly below its existing bar. It shares the dark translucent surface and 7 px outer cuts. Three equal columns use small labels, 16 px tabular readouts, and restrained color marks. The main Delta keeps its 20 px readout and full-width bar.</p><a href="?board=hud-live">Current HUD & Delta specimen ↗</a></section><section><h3>Reference stays a product decision.</h3><p>These are authored Better / Worse / Best examples, not a comparison engine. The reference source, best-result scope, first-lap behavior and car context remain open in issue #40. The proposed neutral reset and equal state are design suggestions for review.</p><p class="sector-study__boundary">Design book only. No FDC runtime, telemetry, persistence or release version changes.</p></section></div>
    </div>`
  });

  if (typeof document === 'undefined') return;
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-sector-state]');
    if (!button) return;
    const study = button.closest('.sector-study');
    const state = states[button.dataset.sectorState];
    if (!study || !state) return;
    // Keep the book's generic preview toast from handling this working control.
    event.stopImmediatePropagation();
    const preview = study.querySelector('[data-sector-preview]');
    preview.dataset.deltaTone = state.tone;
    preview.style.setProperty('--sector-delta-fill', state.fill || '0%');
    preview.querySelector('.sector-delta__value').textContent = state.delta;
    preview.querySelector('.sector-delta__lap').textContent = state.lap;
    preview.querySelector('.sector-delta__best strong').textContent = state.best;
    preview.querySelector('.sector-delta__sectors').innerHTML = cells(state.sectors);
    study.querySelector('[data-sector-state-label]').textContent = state.label;
    study.querySelector('[data-sector-state-note]').textContent = state.note;
    study.querySelectorAll('[data-sector-state]').forEach(control => control.setAttribute('aria-pressed', String(control === button)));
  }, true);
})();
