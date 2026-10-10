/* Configuration map study. All point values below are illustrative fixtures. */
(() => {
  const route = 'M92 286 C142 289 169 243 178 208 S246 173 301 169 S330 114 381 92 S483 67 521 103 S572 163 632 168 S739 195 711 245 S645 297 580 278 S500 243 454 268 S331 310 289 272 S211 251 180 282 S121 310 92 286';
  const point = (x, y, distance, time, speed, gear, rpm, throttle, brake, steer, lat, long, vert, yaw, combined, angle, ratio, tire, susp, curb = 'NONE', problem = null) => ({ x, y, distance, time, speed, gear, rpm, throttle, brake, steer, lat, long, vert, yaw, combined, angle, ratio, tire, susp, curb, problem });
  const samples = {
    events: [
      point(178, 208, '0.8 km', '00:12.104', '92 km/h', '3', '4,870', '18%', '74%', '+32%', '0.62 g', '−0.71 g', '−0.03 g', '−8 °/s', ['74%', '81%', '31%', '29%'], ['32%', '38%', '16%', '15%'], ['12%', '11%', '7%', '6%'], ['61°C', '63°C', '58°C', '59°C'], ['44%', '48%', '38%', '41%']),
      point(381, 92, '2.4 km', '00:31.820', '184 km/h', '4', '6,240', '86%', '0%', '+9%', '0.31 g', '+0.28 g', '+0.02 g', '+3 °/s', ['42%', '45%', '55%', '57%'], ['18%', '21%', '12%', '13%'], ['29%', '31%', '48%', '50%'], ['64°C', '65°C', '72°C', '73°C'], ['46%', '44%', '52%', '50%']),
      point(632, 168, '4.1 km', '00:54.206', '143 km/h', '4', '5,310', '100%', '0%', '−21%', '0.78 g', '+0.34 g', '−0.01 g', '−6 °/s', ['68%', '72%', '91%', '94%'], ['31%', '34%', '38%', '40%'], ['29%', '30%', '72%', '75%'], ['68°C', '70°C', '76°C', '77°C'], ['52%', '48%', '61%', '57%'], 'RL')
    ],
    driver: [
      point(240, 180, '2.13 km', '00:49.172', '106 km/h', '3', '5,870', '16%', '0%', '+44%', '0.84 g', '−0.18 g', '−0.05 g', '+6 °/s', ['95%', '93%', '41%', '44%'], ['48%', '46%', '19%', '20%'], ['39%', '38%', '17%', '16%'], ['68°C', '67°C', '61°C', '62°C'], ['48%', '44%', '47%', '44%'], 'NONE', ['FRONT SCRUB', '1.8 s', 'Steering +44% · front slip 95%', 'Response yaw −6 °/s', 'Reduce steering and let the front recover']),
      point(679, 190, '4.72 km', '01:46.008', '118 km/h', '3', '6,110', '100%', '0%', '−17%', '0.49 g', '+0.12 g', '+0.01 g', '−4 °/s', ['48%', '51%', '112%', '116%'], ['22%', '24%', '39%', '41%'], ['18%', '19%', '107%', '110%'], ['67°C', '68°C', '79°C', '80°C'], ['43%', '46%', '51%', '54%'], 'NONE', ['EXIT WHEELSPIN', '1.4 s', 'Throttle 100% · rear slip 116%', 'Acceleration response +0.12 g', 'Build throttle after the car is settled']),
      point(550, 151, '3.65 km', '01:20.514', '132 km/h', '4', '5,420', '58%', '0%', '+12%', '0.46 g', '+0.16 g', '0.00 g', '+3 °/s', ['53%', '56%', '61%', '63%'], ['22%', '24%', '25%', '27%'], ['19%', '20%', '28%', '29%'], ['65°C', '66°C', '69°C', '70°C'], ['46%', '44%', '49%', '47%'])
    ]
  };
  const svg = kind => `<svg viewBox="0 0 820 360" role="img" aria-label="Schematic ${kind === 'events' ? 'lap' : 'drive'} route with three illustrative saved points">
    <rect class="map-study__surface" width="820" height="360"/>
    ${kind === 'events' ? '<path class="map-study__slip" data-map-layer="slip" d="M381 92 Q483 67 521 103"/>' : ''}
    <path class="map-study__route ${kind === 'driver' ? 'map-study__route--driver' : ''}" d="${route}"/>
    ${kind === 'events' ? `<path class="map-study__trace map-study__trace--throttle" data-map-layer="throttle" d="${route}" stroke-dasharray="150 31 70 19 136 34 100 22"/><path class="map-study__trace map-study__trace--brake" data-map-layer="brake" d="M178 208 Q227 173 301 169 M632 168 Q716 177 711 245"/><path class="map-study__trace map-study__trace--coast" data-map-layer="coast" d="M301 169 Q338 123 381 92"/><g aria-hidden="true"><path class="map-study__sector-tick" d="M310 145l-8 18 M531 111l-7 19 M685 264l13 10"/><text class="map-study__sector" x="284" y="137">S1</text><text class="map-study__sector" x="530" y="105">S2</text><text class="map-study__sector" x="690" y="260">S3</text></g>` : `<g data-map-layer="scrub"><path class="map-study__problem-halo" d="M178 208 Q227 173 301 169"/><path class="map-study__problem map-study__problem--scrub" d="M178 208 Q227 173 301 169"/></g><path class="map-study__problem map-study__problem--wheelspin" data-map-layer="wheelspin" d="M632 168 Q716 177 711 245"/><path class="map-study__problem map-study__problem--overload" data-map-layer="overload" d="M381 92 Q483 67 521 103"/><g data-map-layer="clean"><circle class="map-study__clean" cx="127" cy="271" r="8"/><circle class="map-study__clean" cx="331" cy="139" r="8"/><circle class="map-study__clean" cx="550" cy="151" r="8"/></g>`}
    <circle class="map-study__start" cx="92" cy="286" r="8"/><circle class="map-study__cursor" cx="${samples[kind][kind === 'events' ? 1 : 0].x}" cy="${samples[kind][kind === 'events' ? 1 : 0].y}" r="12"/>
  </svg>`;
  const layers = { events: [['throttle', 'THROTTLE 85%'], ['brake', 'BRAKE 13%'], ['coast', 'COAST 2%'], ['slip', 'SLIP 4%']], driver: [['scrub', 'SCRUB 1'], ['wheelspin', 'WHEELSPIN 1'], ['overload', 'BRAKE + STEERING 1'], ['clean', 'CLEAN 3']] };
  const legend = kind => `<div class="map-study__legend" aria-label="${kind === 'events' ? 'Lap' : 'Drive'} map layers">${layers[kind].map(([key, label]) => `<button type="button" data-map-study-layer="${key}" aria-pressed="true"><i class="map-study__swatch map-study__swatch--${key}" aria-hidden="true"></i>${label}</button>`).join('')}</div>`;
  const inspector = (kind, index) => {
    const p = samples[kind][index];
    const finding = kind === 'driver' ? `<section class="map-study__finding"><span>DRIVER CHECK</span><strong>${p.problem?.[0] || 'NO PROBLEM AT THIS POINT'}</strong>${p.problem ? `<small>${p.problem[1]} · ${p.problem[2]}<br>${p.problem[3]}</small><p>${p.problem[4]}</p>` : '<small>Recorded values only; no finding is attached to this sample.</small>'}</section>` : '';
    const metrics = [['SPEED', p.speed], ['GEAR', p.gear], ['RPM', p.rpm], ['THROTTLE', p.throttle], ['BRAKE', p.brake], ['STEER', p.steer], ['LAT', p.lat], ['LONG', p.long], ['VERT', p.vert], ['YAW', p.yaw]];
    const wheels = [['COMBINED', p.combined], ['SLIP ANGLE', p.angle], ['SLIP RATIO', p.ratio], ['TIRE', p.tire], ['SUSP', p.susp]];
    return `<div class="map-study__inspector-inner"><div class="map-study__inspector-head"><span>POINT DATA</span><strong>${String(index + 1).padStart(2, '0')} / 03</strong></div><div class="map-study__point-lead"><strong>${p.distance}</strong><span>${p.time}</span></div>${finding}<dl class="map-study__metrics">${metrics.map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join('')}</dl><div class="map-study__wheel-title">PER WHEEL <span>FL / FR / RL / RR</span></div><table class="map-study__wheels"><thead><tr><th scope="col"></th><th scope="col">FL</th><th scope="col">FR</th><th scope="col">RL</th><th scope="col">RR</th></tr></thead><tbody>${wheels.map(([label, values]) => `<tr><th scope="row">${label}</th>${values.map(value => `<td>${value}</td>`).join('')}</tr>`).join('')}</tbody></table><div class="map-study__conditions"><span>CURB <strong>${p.curb}</strong></span><span>PUDDLE <strong>NONE</strong></span></div></div>`;
  };
  const sampleNav = kind => `<div class="map-study__sample-nav" aria-label="Illustrative saved points">${samples[kind].map((p, index) => `<button type="button" data-map-sample="${index}" aria-pressed="${index === (kind === 'events' ? 1 : 0)}" aria-label="Show saved point ${index + 1}, ${p.distance}">${String(index + 1).padStart(2, '0')}</button>`).join('')}</div>`;
  const card = (kind, tone) => `<article class="map-study__card map-study__card--${tone}" data-map-tone="${tone}" data-map-active="${kind === 'events' ? 1 : 0}"><div class="map-study__caption"><strong>${tone === 'dark' ? 'Current dark' : 'Light proposal'}</strong><span>${kind === 'events' ? 'LAP 7' : 'DRIVE #2'}</span></div><div class="map-study__body"><div class="map-study__plot">${svg(kind)}</div><aside class="map-study__inspector" aria-label="Selected map point details">${inspector(kind, kind === 'events' ? 1 : 0)}</aside></div><div class="map-study__footer">${legend(kind)}${sampleNav(kind)}</div></article>`;
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-light-maps', title: 'Light theme · Events and Driver maps', section: 'FOUNDATIONS', status: 'proposal', theme: 'light', proposalLabel: 'FDC LIGHT MAPS / PROPOSAL', proposalKicker: 'CONFIGURATION MAPS / HUD UNCHANGED',
    description: 'Dark and light map studies for Events and Driver with a full-height point inspector beside each map.',
    html: `<h2>Maps as measured traces</h2><p class="map-study__intro">The route is recorded geometry, not a named track. Each map keeps point data in a fixed panel on the right. Move over the route or choose a numbered sample below it; the panel stays visible when the pointer leaves. The light map uses a neutral rail from the FDC palette so throttle green reads clearly. The in-game HUD stays as it is.</p><section class="map-study__section" data-map-study="events"><div class="map-study__section-head"><h3>Events · Lap 7</h3><span>THROTTLE / BRAKE / COAST / SLIP · SECTOR TICKS</span></div><div class="map-study__pair">${card('events', 'dark')}${card('events', 'light')}</div><p class="map-study__note">Illustrative saved-point data. Hover either route or use 01–03; both inspectors update together. Layer buttons remain synchronized.</p></section><section class="map-study__section" data-map-study="driver"><div class="map-study__section-head"><h3>Driver · Drive #2</h3><span>PROBLEM SEGMENTS / CLEAN CHECKS</span></div><div class="map-study__pair">${card('driver', 'dark')}${card('driver', 'light')}</div><p class="map-study__note">Problem details appear above point telemetry when a sample belongs to a check. The inspector never covers the route.</p></section><section class="panel map-study__rules"><h3>Map rules for the light theme</h3><ul><li>The light route uses the existing neutral line value; throttle green keeps its established meaning in a darker map-only ink.</li><li>A visible, full-height inspector replaces cursor-following tooltips. It starts on a saved point, follows hover or keyboard selection, and retains the last point after pointer exit.</li><li>Events and Driver share the same panel layout; Driver adds check details. The real app should bind it to every saved trace point, including missing-field states.</li></ul><p class="muted">Schematic fixture for design review. No FDC runtime map, data, or HUD is changed.</p><a href="LIGHT_THEME.md">Light theme token notes ↗</a></section>`
  });
  window.FDC_MAP_STUDY = { samples, inspector };
})();

if (typeof document !== 'undefined') {
  const selectSample = (section, index) => {
    const kind = section.dataset.mapStudy;
    const sample = window.FDC_MAP_STUDY.samples[kind][index];
    if (!sample) return;
    section.querySelectorAll('.map-study__card').forEach(card => {
      if (card.dataset.mapActive === String(index)) return;
      card.dataset.mapActive = String(index);
      card.querySelector('.map-study__inspector').innerHTML = window.FDC_MAP_STUDY.inspector(kind, index);
      const cursor = card.querySelector('.map-study__cursor');
      cursor.setAttribute('cx', sample.x);
      cursor.setAttribute('cy', sample.y);
      card.querySelectorAll('[data-map-sample]').forEach(button => button.setAttribute('aria-pressed', String(Number(button.dataset.mapSample) === index)));
    });
  };
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-map-study-layer], [data-map-sample]');
    if (!button) return;
    event.stopImmediatePropagation();
    const section = button.closest('[data-map-study]');
    if (button.hasAttribute('data-map-sample')) return selectSample(section, Number(button.dataset.mapSample));
    const key = button.dataset.mapStudyLayer;
    const active = button.getAttribute('aria-pressed') !== 'true';
    section.querySelectorAll(`[data-map-study-layer="${key}"]`).forEach(item => item.setAttribute('aria-pressed', String(active)));
    section.querySelectorAll(`[data-map-layer="${key}"]`).forEach(item => item.classList.toggle('map-study__is-hidden', !active));
  }, true);
  document.addEventListener('pointermove', event => {
    const plot = event.target.closest('.map-study__plot');
    if (!plot) return;
    if (!event.target.closest('.map-study__route, .map-study__trace, .map-study__problem, .map-study__slip, .map-study__clean')) return;
    const svg = plot.querySelector('svg');
    const matrix = svg.getScreenCTM();
    if (!matrix) return;
    const position = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    const section = plot.closest('[data-map-study]');
    const points = window.FDC_MAP_STUDY.samples[section.dataset.mapStudy];
    let nearest = 0;
    for (let i = 1; i < points.length; i++) if (Math.hypot(position.x - points[i].x, position.y - points[i].y) < Math.hypot(position.x - points[nearest].x, position.y - points[nearest].y)) nearest = i;
    selectSample(section, nearest);
  });
}
