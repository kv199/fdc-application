/* Proposal 04 adds the post-September-23 pages and preserves the agreed HUD specimen.
   All numbers and paths below are illustrative fixtures, never live telemetry. */
(() => {
  const screens = window.FDC_SCREENS;
  const byId = id => screens.find(board => board.id === id);
  const data = 'DEMO DATA / NO LIVE CONNECTION';

  const historySvg = `<svg class="hud-spec-history" viewBox="0 0 320 52" preserveAspectRatio="none" role="img" aria-label="Eight-second throttle and brake history example"><path d="M0 5 H28 V42 H56 V13 H82 V8 H111 V33 H136 V44 H163 V12 H197 V8 H224 V25 H252 V6 H279 V5 H320" fill="none" stroke="#69e83f" stroke-width="2"/><path d="M0 48 H28 V45 H58 V47 H83 V40 H109 V46 H134 V49 H163 V31 H190 V48 H227 V42 H252 V47 H280 V49 H320" fill="none" stroke="#ff312b" stroke-width="2"/></svg>`;
  const widget = (type, glass) => `<section class="hud-spec-widget hud-spec-widget--${type}" aria-label="${type === 'gear' ? 'Speed, gear and RPM' : type}"><div class="hud-spec-widget__glass">${glass}</div></section>`;
  const tires = widget('tires', `<span class="hud-spec-tire-value">10°</span><span class="hud-spec-tire-value">9°</span><i class="hud-spec-tire"></i><i class="hud-spec-tire"></i><i class="hud-spec-tire"></i><i class="hud-spec-tire"></i><span class="hud-spec-tire-value">25°</span><span class="hud-spec-tire-value">25°</span>`);
  const pedals = widget('pedals', `<span class="hud-spec-pedal hud-spec-pedal--brake" aria-label="Vertical brake meter"></span><span class="hud-spec-pedal hud-spec-pedal--gas" aria-label="Vertical throttle meter"></span>`);
  const steering = widget('steering', `<span class="hud-spec-wheel" aria-hidden="true"></span>`);
  const gearGlass = `<span class="hud-spec-speed">144 km/h</span><strong class="hud-spec-gear">5</strong><span class="hud-spec-rpm">8,796 RPM</span>`;
  const gear = widget('gear', gearGlass);
  const engine = widget('engine', `<div class="hud-spec-engine-row"><span>BOOST</span><b>0.76 BAR</b></div><div class="hud-spec-engine-row"><span>POWER</span><b>376 HP</b></div><div class="hud-spec-engine-row"><span>TORQUE</span><b>305 NM</b></div>`);
  const history = widget('history', historySvg);
  const delta = `<div class="hud-spec-delta" aria-label="Independent Delta strip"><div class="hud-spec-delta__glass"><div class="hud-spec-delta__topline"><span>01:24.680</span><span><small>BEST</small> 01:23.900</span></div><strong class="hud-spec-delta__value">−0.214</strong><span class="hud-spec-delta__bar"><i></i></span></div></div>`;
  const grouped = `<div class="hud-spec-grouped" aria-label="Grouped HUD: one dark surface with two outer chamfers and six joined data areas"><div class="hud-spec-grid">${tires}${pedals}${steering}${gear}${engine}${history}</div></div>`;
  const opacityControl = `<label class="hud-spec-opacity-control">HUD OPACITY <input type="range" min="1" max="100" value="80" data-hud-opacity aria-label="Preview HUD opacity"><output>80%</output></label>`;

  byId('hud-live').title = 'HUD · Grouped and Delta';
  byId('hud-live').description = 'One dark, texture-free Grouped surface joins the six current data areas. Only its outer top-left and bottom-right corners are cut; Delta stays separate.';
  byId('hud-live').html = `
    <div class="row"><div><h2>One strip. Six readings.</h2><p class="muted">The six telemetry areas join into one dark surface. Delta stays separate.</p></div><span class="badge green">${data}</span></div>
    ${opacityControl}
    <div class="hud-spec-field hud-spec-field--grouped"><div class="hud-spec-stage">${delta}${grouped}</div></div>
    <div class="hud-spec-anatomy">
      <article><h3>One drive-train block</h3><p>Speed above, gear in the center, RPM below. The redline and learned purple shift cue still color this one block.</p></article>
      <article><h3>Vertical pedal input</h3><p>Brake remains the left upright meter and throttle the right upright meter. No horizontal bar or new labels enter the in-game HUD.</p></article>
      <article><h3>Two cuts on the whole strip</h3><p>Grouped has no inner cuts or gaps. Only the top-left and bottom-right outer corners are clipped. Its dark background and readings fade together with HUD opacity.</p></article>
    </div>`;

  const hudFreeform = {
    id: 'hud-freeform', title: 'HUD · Individual widgets', section: 'HUD',
    description: 'Freeform specimen: each of the six current telemetry blocks is independently positioned and chamfered; Delta is a seventh independent surface.',
    html: `<div class="row"><div><h2>Independent dark widgets</h2><p class="muted">Freeform moves and resizes each existing block. Each keeps its own two cuts and the current data composition.</p></div><span class="badge green">${data}</span></div>
      ${opacityControl}
      <div class="hud-spec-freeform">
        <div class="hud-spec-freeform__item"><strong>TIRES</strong>${tires}<small>Four temperatures and tire shapes</small></div>
        <div class="hud-spec-freeform__item"><strong>THROTTLE & BRAKE</strong>${pedals}<small>Two vertical meters</small></div>
        <div class="hud-spec-freeform__item"><strong>STEERING</strong>${steering}<small>Rotating wheel indicator</small></div>
        <div class="hud-spec-freeform__item"><strong>GEAR / SPEED / RPM</strong>${gear}<small>One indivisible shift-cue block</small></div>
        <div class="hud-spec-freeform__item"><strong>ENGINE / BOOST</strong>${engine}<small>Boost, power and torque</small></div>
        <div class="hud-spec-freeform__item"><strong>INPUT GRAPH</strong>${history}<small>Eight seconds of pedal history</small></div>
      </div>
      <div class="panel" style="margin-top:18px"><div class="row"><div><h3>DELTA / SEPARATE TARGET</h3><p class="muted">Independent in Grouped and Freeform. It shares the casing language without joining the six-block grid.</p></div>${delta}</div></div>`
  };
  const hudStates = {
    id: 'hud-states', title: 'HUD · Geometry and shift states', section: 'HUD',
    description: 'A close study of individual widget cuts, the two outer Grouped cuts, and the existing shift cue states of the combined Gear / Speed / RPM block.',
    html: `<h2>Two outer cuts per target</h2><p class="muted">In-game HUD surfaces are flat dark panels without paint texture. Freeform cuts each widget; Grouped cuts the joined strip only.</p>
      <div class="hud-spec-state-row">
        <div class="hud-spec-state">${gear}<p class="hud-spec-label">NORMAL / CLEAN READOUT</p></div>
        <div class="hud-spec-state">${gear.replace('hud-spec-widget--gear', 'hud-spec-widget--gear is-redline')}<p class="hud-spec-label">REDLINE / RED BACKGROUND</p></div>
        <div class="hud-spec-state">${gear.replace('hud-spec-widget--gear', 'hud-spec-widget--gear is-shift')}<p class="hud-spec-label">LEARNED SHIFT / PURPLE BACKGROUND</p></div>
        <div class="hud-spec-state">${delta}<p class="hud-spec-label">DELTA / INDEPENDENT</p></div>
      </div>
      <div class="grid2" style="margin-top:20px"><section class="panel"><h3>Grouped</h3><p>One 736 × 69 px strip, with no gutters or inner chamfers. The whole surface has only a 14 px top-left and bottom-right cut.</p></section><section class="panel"><h3>Freeform</h3><p>Each target has a 7 px cut at the same base scale. Scaling the target scales its dark background and keeps the existing reading arrangement.</p></section></div>
      <section class="panel"><div class="row"><div><h3>FREEFORM EDIT / NO LIVE DATA</h3><p class="muted">The selected target stays visible for the entire edit even when telemetry or a visibility switch would otherwise hide it. Save keeps the placement; Cancel or Escape restores it.</p></div><div class="hud-spec-edit-target">${gear}</div></div></section>`
  };
  screens.splice(screens.findIndex(board => board.id === 'hud-live') + 1, 0, hudFreeform, hudStates);

  const mapSvg = `<svg viewBox="0 0 820 360" role="img" aria-label="Schematic drive and lap map; no track identity"><rect width="820" height="360" fill="#0d1211"/><path d="M92 286 C142 289 169 243 178 208 S246 173 301 169 S330 114 381 92 S483 67 521 103 S572 163 632 168 S739 195 711 245 S645 297 580 278 S500 243 454 268 S331 310 289 272 S211 251 180 282 S121 310 92 286" fill="none" stroke="#edf0df" stroke-width="14" opacity=".8"/><path d="M92 286 C142 289 169 243 178 208 S246 173 301 169 S330 114 381 92 S483 67 521 103 S572 163 632 168 S739 195 711 245 S645 297 580 278 S500 243 454 268 S331 310 289 272 S211 251 180 282 S121 310 92 286" fill="none" stroke="#69e83f" stroke-width="8" stroke-dasharray="150 31 70 19 136 34 100 22"/><path d="M178 208 Q227 173 301 169 M632 168 Q716 177 711 245" fill="none" stroke="#ff312b" stroke-width="9"/><path d="M381 92 Q483 67 521 103" fill="none" stroke="#7dd3fc" opacity=".45" stroke-width="21"/><circle cx="92" cy="286" r="8" fill="#fff"/><g fill="#edf0df" font-family="Barlow" font-size="14" font-weight="600"><text x="302" y="150">S1</text><text x="531" y="111">S2</text><text x="682" y="271">S3</text></g></svg>`;
  const driveMapSvg = `<svg viewBox="0 0 820 360" role="img" aria-label="Schematic drive map with problem segments and clean checks; no track identity"><rect width="820" height="360" fill="#0d1211"/><path d="M92 286 C142 289 169 243 178 208 S246 173 301 169 S330 114 381 92 S483 67 521 103 S572 163 632 168 S739 195 711 245 S645 297 580 278 S500 243 454 268 S331 310 289 272 S211 251 180 282 S121 310 92 286" fill="none" stroke="#edf0df" stroke-width="8" opacity=".78"/><path d="M178 208 Q227 173 301 169" fill="none" stroke="#edf0df" stroke-width="22"/><path d="M178 208 Q227 173 301 169" fill="none" style="stroke:var(--problem-scrub)" stroke-width="15"/><path d="M632 168 Q716 177 711 245" fill="none" style="stroke:var(--problem-wheelspin)" stroke-width="15"/><path d="M381 92 Q483 67 521 103" fill="none" style="stroke:var(--problem-brake-steering)" stroke-width="15"/><g style="fill:var(--problem-clean)" stroke="#0d1211" stroke-width="3"><circle cx="127" cy="271" r="8"/><circle cx="331" cy="139" r="8"/><circle cx="550" cy="267" r="8"/></g><circle cx="92" cy="286" r="8" fill="#fff"/></svg>`;
  const legend = items => `<div class="map-legend" aria-label="Map layers">${items.map(([label, color, pressed]) => `<button type="button" data-map-layer="${label}" aria-pressed="${pressed}"><i class="map-swatch" style="--swatch:${color}"></i>${label}</button>`).join('')}</div>`;
  const eventLegend = legend([['THROTTLE 85%', 'var(--telemetry-throttle)', true], ['BRAKE 13%', 'var(--telemetry-brake)', true], ['COAST 2%', 'var(--coast)', true], ['SLIP 4%', 'var(--cyan)', true], ['ALL', 'var(--text)', true]]);
  const driveLegend = legend([['SCRUB 1', 'var(--problem-scrub)', true], ['WHEELSPIN 1', 'var(--problem-wheelspin)', true], ['BRAKE + STEERING 1', 'var(--problem-brake-steering)', true], ['CLEAN 3', 'var(--problem-clean)', true], ['THROTTLE', 'var(--telemetry-throttle)', false], ['BRAKE', 'var(--telemetry-brake)', false], ['COAST', 'var(--coast)', false], ['SLIP', 'var(--cyan)', false]]);

  byId('driver-list').description = 'Updated recording history shows car and drive counts, a headline per car, and a one-car summary only when meaningful.';
  byId('driver-list').html = `<div class="callout amber"><strong>EXPERIMENTAL / ASPHALT ONLY</strong><p>Recordings remain local. Findings describe repeated checks and can be inaccurate.</p></div>
    <section class="panel plate"><div class="row"><div><h3>DRIVER ANALYSIS</h3><p class="muted">Enabled for this example. One recording may include several cars and drives.</p></div><button class="toggle" type="button" role="switch" aria-checked="true" aria-label="Driver Analysis"></button></div><div class="row"><div><strong>RECORD A SESSION</strong><p class="muted">Asphalt only · local recording</p></div><span class="label green">READY</span><button class="button primary" data-demo="button">RECORD</button></div><div class="row"><div><strong>GLOBAL RECORD HOTKEY</strong><p class="muted">Works while Forza is in focus.</p></div><kbd>Ctrl + Shift + F9</kbd><button class="button" data-demo="button">CHANGE</button></div></section>
    <section class="panel"><div class="row"><h3>HISTORY</h3><span class="badge">2 RECORDINGS</span></div>
      <article class="history-row"><div class="history-meta"><strong>09/28/2026 · 07:26 PM</strong><span>33m 20s</span><span>2 CARS · 3 DRIVES</span><span>54 MB</span></div><div><p><strong>CAR #1429</strong> — <strong class="amber">MOST FREQUENT: FRONT SCRUB</strong></p><p><strong>CAR #289</strong> — <strong class="green">NO RECURRING PROBLEM DETECTED</strong></p><a class="button" href="?board=driver-recording">DETAILS →</a></div><button class="button danger" data-demo="button">DELETE</button></article>
      <article class="history-row"><div class="history-meta"><strong>09/27/2026 · 06:37 PM</strong><span>11m 37s</span><span>1 CAR · 1 DRIVE</span><span>20 MB</span></div><div><strong class="green">NO RECURRING PROBLEM DETECTED</strong><p class="muted">5.9 km · average 150 km/h · top 256 km/h · 31 corners</p><button class="button" data-demo="button">DETAILS</button></div><button class="button danger" data-demo="button">DELETE</button></article>
    </section>`;

  const driverRecording = {
    id: 'driver-recording', title: 'Driver · Recording', section: 'DRIVER',
    description: 'New multi-car recording page: date, duration, car and drive counts, storage, and the selectable Cars table.',
    html: `<div class="journey-head"><div><span class="label">RECORDING / MULTI-CAR EXAMPLE</span><h2>09/28/2026 · 07:26 PM</h2></div><span class="badge green">${data}</span></div>
      <div class="journey-summary">${[['DURATION','33m 20s'],['CARS','2'],['DRIVES','3'],['STORAGE','54 MB']].map(([k,v]) => `<div class="panel"><span class="label">${k}</span><strong class="metric">${v}</strong></div>`).join('')}</div>
      <section class="panel"><div class="row"><h3>CARS</h3><span class="label">SELECT A CAR</span></div><div class="table-wrap"><table class="table journey-table"><thead><tr><th>CAR</th><th>PI</th><th>DRIVETRAIN</th><th>DRIVES</th><th>DURATION</th><th>RESULT</th></tr></thead><tbody><tr><th scope="row"><a href="?board=driver-detail">CAR #1429 →</a></th><td>800</td><td>RWD</td><td>2</td><td>22m 06s</td><td>MOST FREQUENT: FRONT SCRUB</td></tr><tr><th scope="row">CAR #289</th><td>600</td><td>AWD</td><td>1</td><td>11m 14s</td><td>NO RECURRING PROBLEM</td></tr></tbody></table></div></section>`
  };

  byId('driver-detail').title = 'Driver · Car and drives';
  byId('driver-detail').description = 'Current car page: headline, one-car summary, expandable statistics and a table of drives. Values remain illustrative.';
  byId('driver-detail').html = `<div class="journey-head"><div><span class="label">CAR / LOCAL RECORDING</span><h2>CAR #1429</h2></div><div class="journey-badges"><span class="badge">PI 800</span><span class="badge">RWD</span><span class="badge">2 DRIVES</span><span class="badge">22m 06s</span></div></div>
    <section class="panel plate"><span class="label">RESULT</span><strong class="num amber">MOST FREQUENT: FRONT SCRUB</strong><p>Front scrub — steering more than the front tires can take — in 18 of 133 checks (14%). Becomes a reported problem above 40%.</p></section>
    <div class="journey-summary">${[['DISTANCE','5.9 km'],['AVERAGE','150 km/h'],['TOP','256 km/h'],['CORNERS','31']].map(([k,v]) => `<div class="panel"><span class="label">${k}</span><strong class="metric">${v}</strong></div>`).join('')}</div>
    <details><summary>STATS · CHECKS AND VEHICLE RESPONSE</summary><div class="details-body"><div class="table-wrap"><table><tbody><tr><th scope="row">FRONT SCRUB</th><td>18 problems / 133 checks</td></tr><tr><th scope="row">BRAKE + STEERING</th><td>4 problems / 22 checks</td></tr><tr><th scope="row">CORNERS</th><td>31 observed</td></tr></tbody></table></div></div></details>
    <section class="panel"><div class="row"><h3>DRIVES</h3><span class="label">SELECT A DRIVE TO OPEN ITS MAP</span></div><div class="table-wrap"><table class="table journey-table"><thead><tr><th>ID</th><th>TYPE</th><th>DURATION</th><th>START</th><th>ERRORS</th></tr></thead><tbody><tr><th scope="row"><a href="?board=driver-drive">#2 →</a></th><td>CIRCUIT · 3 LAPS</td><td>12m 06s</td><td>19:38</td><td>3</td></tr><tr><th scope="row">#1</th><td>SPRINT</td><td>10m 00s</td><td>19:26</td><td>—</td></tr></tbody></table></div></section><details><summary>OLDER RECORDINGS / EMPTY DRIVE STATES</summary><p>Older car records may show <strong>RECORDED BEFORE DRIVES</strong>; a car without races shows <strong>NO RACES IN THIS RECORDING</strong>.</p></details>`;

  const driverDrive = {
    id: 'driver-drive', title: 'Driver · Drive map', section: 'DRIVER',
    description: 'New full-width drive map with problem segments, clean checks, layer legend and a selected problem. The path is schematic and has no track identity.',
    html: `<div class="journey-head"><div><span class="label">DRIVE / CIRCUIT · 3 LAPS</span><h2>DRIVE #2</h2><p class="muted">CAR #1429 · 19:38 start</p></div><span class="badge green">${data}</span></div>
      <div class="grid2"><div class="panel"><span class="label">DURATION</span><strong class="metric">12m 06s</strong></div><div class="panel"><span class="label">ERRORS</span><strong class="metric">3</strong></div></div>
      <div class="map-figure">${driveMapSvg}${driveLegend}<p class="map-statline">Problem segments and clean checks shown by default. Pedal and Slip layers are optional.</p></div>
      <section class="panel"><h3>SELECTED PROBLEM · FRONT SCRUB</h3><div class="map-hover-sample"><div><span>DISTANCE</span><strong>2.4 km</strong></div><div><span>DURATION</span><strong>0.8 s</strong></div><div><span>STEERING</span><strong>+18%</strong></div><div><span>FRONT SLIP</span><strong>112%</strong></div></div><p class="muted">Response lateral −0.6 m/s² · yaw −5 °/s. Reduce steering and let the front recover.</p></section>
      <div class="problem-list"><div class="problem-list__row" style="--swatch:var(--problem-scrub)"><i></i>FRONT SCRUB · 2.4 km · 0.8 s</div><div class="problem-list__row" style="--swatch:var(--problem-wheelspin)"><i></i>EXIT WHEELSPIN · 3.1 km · 1.2 s</div><div class="problem-list__row" style="--swatch:var(--problem-brake-steering)"><i></i>BRAKE + STEERING · 4.7 km · 0.6 s</div></div><details><summary>OLDER DRIVE / NO MAP</summary><p>NO POSITION DATA WAS SAVED FOR THIS DRIVE</p></details>`
  };
  const driverDetailIndex = screens.findIndex(board => board.id === 'driver-detail');
  screens.splice(driverDetailIndex, 0, driverRecording);
  screens.splice(screens.findIndex(board => board.id === 'driver-detail') + 1, 0, driverDrive);

  const eventsRun = byId('events-run');
  eventsRun.description = 'Updated run and lap detail. The expanded lap leads to a full-width map, selectable layers and recorded-value hover specimen.';
  eventsRun.html = `<div class="row event-identity"><h2>Luta do Estadio</h2><span class="badge">#2</span><span class="badge blue">RIVALS</span><span class="badge">RALLY</span><span class="badge class-s1">S1</span></div><div class="best-time purple"><span class="label">BEST HYPOTHETICAL TIME</span><strong class="num large">01:08.316</strong></div>
    <section class="panel"><div class="row"><h3>LAP BREAKDOWN</h3><span class="label">SECTOR TIMES / RUN #8</span></div><div class="table-wrap"><table><thead><tr><th>LAP ↓</th><th>LAP TIME</th><th>SECTOR 1</th><th>SECTOR 2</th><th>SECTOR 3</th></tr></thead><tbody><tr><th scope="row"><a href="?board=events-map">7 →</a></th><td class="green">01:09.436</td><td class="green">00:27.289</td><td>00:22.064</td><td>00:20.083</td></tr><tr><th scope="row">6</th><td>01:09.854</td><td>00:27.463</td><td>00:21.983</td><td>00:20.408</td></tr><tr><th scope="row">5</th><td>01:10.679</td><td>00:29.330</td><td class="purple">00:21.341</td><td class="green">00:20.009</td></tr><tr><th scope="row">4</th><td class="purple">01:08.953</td><td class="purple">00:26.989</td><td class="green">00:21.978</td><td class="purple">00:19.986</td></tr></tbody></table></div></section>
    <div class="map-figure">${mapSvg}${eventLegend}</div><p class="muted">The map is schematic. Open the <a href="?board=events-map">full map and hover detail board →</a> for layer and telemetry states.</p>`;

  const eventMap = {
    id: 'events-map', title: 'Events · Lap map and layers', section: 'EVENTS',
    description: 'Current Events expanded-lap map pattern: full-width track outline, pedal and Slip layers, sector ticks, legend and recorded values on hover.',
    html: `<div class="journey-head"><div><span class="label">LAP 7 / EXPANDED MAP</span><h2>01:09.436</h2><p class="muted">Schematic shape. This board does not identify a track or claim a recorded route.</p></div><span class="badge green">${data}</span></div>
      <div class="map-figure">${mapSvg}${eventLegend}<div class="map-statline"><span>White outline stays visible when a layer is hidden.</span><span>Sector ticks: S1 / S2 / S3.</span></div></div>
      <section class="panel"><div class="row"><h3>POINT UNDER CURSOR</h3><span class="label">RECORDED VALUES / FIXTURE</span></div><div class="map-hover-sample"><div><span>DISTANCE</span><strong>2.4 km</strong></div><div><span>LAP TIME</span><strong>00:31.820</strong></div><div><span>SPEED</span><strong>184 km/h</strong></div><div><span>GEAR / RPM</span><strong>4 / 6,240</strong></div><div><span>THROTTLE</span><strong>85%</strong></div><div><span>BRAKE</span><strong>13%</strong></div><div><span>STEERING</span><strong>−24%</strong></div><div><span>YAW</span><strong>−5°/s</strong></div></div></section>
      <section class="panel"><h3>EXTENDED POINT DATA</h3><div class="map-hover-sample"><div><span>LATERAL</span><strong>−0.6 g</strong></div><div><span>LONGITUDINAL</span><strong>0.3 g</strong></div><div><span>VERTICAL</span><strong>0.1 g</strong></div><div><span>CURB CONTACT</span><strong>FR</strong></div></div><div class="table-wrap"><table><thead><tr><th>WHEEL</th><th>SLIP</th><th>ANGLE</th><th>RATIO</th><th>TEMP</th><th>SUSPENSION</th></tr></thead><tbody><tr><th scope="row">FL</th><td>82%</td><td>24%</td><td>18%</td><td>84°C</td><td>42%</td></tr><tr><th scope="row">FR</th><td>112%</td><td>31%</td><td>22%</td><td>82°C</td><td>48%</td></tr><tr><th scope="row">RL</th><td>67%</td><td>17%</td><td>26%</td><td>79°C</td><td>37%</td></tr><tr><th scope="row">RR</th><td>71%</td><td>19%</td><td>28%</td><td>80°C</td><td>40%</td></tr></tbody></table></div><p class="muted">Puddle contact appears only where recorded; none applies to this fixture.</p></section><details><summary>OLDER LAP / UNAVAILABLE TRACE</summary><p>A lap saved before trace capture keeps its timing row and shows an unavailable trace state when expanded.</p></details>`
  };
  screens.splice(screens.findIndex(board => board.id === 'events-run') + 1, 0, eventMap);
})();
