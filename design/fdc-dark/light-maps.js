/* Light map proposal: identical schematic data and geometry in two surface treatments. */
(() => {
  const route = 'M92 286 C142 289 169 243 178 208 S246 173 301 169 S330 114 381 92 S483 67 521 103 S572 163 632 168 S739 195 711 245 S645 297 580 278 S500 243 454 268 S331 310 289 272 S211 251 180 282 S121 310 92 286';
  const eventSvg = () => `<svg viewBox="0 0 820 360" role="img" aria-label="Schematic lap route with pedal, slip and sector layers; no track identity">
    <rect class="map-study__surface" width="820" height="360"/>
    <path class="map-study__slip" data-map-layer="slip" d="M381 92 Q483 67 521 103"/>
    <path class="map-study__route" d="${route}"/>
    <path class="map-study__trace map-study__trace--throttle" data-map-layer="throttle" d="${route}" stroke-dasharray="150 31 70 19 136 34 100 22"/>
    <path class="map-study__trace map-study__trace--brake" data-map-layer="brake" d="M178 208 Q227 173 301 169 M632 168 Q716 177 711 245"/>
    <path class="map-study__trace map-study__trace--coast" data-map-layer="coast" d="M301 169 Q338 123 381 92"/>
    <g aria-hidden="true"><path class="map-study__sector-tick" d="M310 145l-8 18 M531 111l-7 19 M685 264l13 10"/><text class="map-study__sector" x="284" y="137">S1</text><text class="map-study__sector" x="530" y="105">S2</text><text class="map-study__sector" x="690" y="260">S3</text></g>
    <circle class="map-study__start" cx="92" cy="286" r="8"/>
  </svg>`;
  const driverSvg = () => `<svg viewBox="0 0 820 360" role="img" aria-label="Schematic drive route with problem segments and clean checks; no track identity">
    <rect class="map-study__surface" width="820" height="360"/>
    <path class="map-study__route map-study__route--driver" d="${route}"/>
    <g data-map-layer="scrub"><path class="map-study__problem-halo" d="M178 208 Q227 173 301 169"/><path class="map-study__problem map-study__problem--scrub" d="M178 208 Q227 173 301 169"/></g>
    <path class="map-study__problem map-study__problem--wheelspin" data-map-layer="wheelspin" d="M632 168 Q716 177 711 245"/>
    <path class="map-study__problem map-study__problem--overload" data-map-layer="overload" d="M381 92 Q483 67 521 103"/>
    <g data-map-layer="clean"><circle class="map-study__clean" cx="127" cy="271" r="8"/><circle class="map-study__clean" cx="331" cy="139" r="8"/><circle class="map-study__clean" cx="550" cy="267" r="8"/></g>
    <circle class="map-study__start" cx="92" cy="286" r="8"/>
  </svg>`;
  const layers = {
    events: [['throttle', 'THROTTLE 85%'], ['brake', 'BRAKE 13%'], ['coast', 'COAST 2%'], ['slip', 'SLIP 4%']],
    driver: [['scrub', 'SCRUB 1'], ['wheelspin', 'WHEELSPIN 1'], ['overload', 'BRAKE + STEERING 1'], ['clean', 'CLEAN 3']]
  };
  const legend = kind => `<div class="map-study__legend" aria-label="${kind === 'events' ? 'Lap' : 'Drive'} map layers">${layers[kind].map(([key, label]) => `<button type="button" data-map-study-layer="${key}" aria-pressed="true"><i class="map-study__swatch map-study__swatch--${key}" aria-hidden="true"></i>${label}</button>`).join('')}</div>`;
  const readout = kind => `<div class="map-study__readout">${(kind === 'events'
    ? [['DISTANCE', '2.4 km'], ['SPEED', '184 km/h'], ['GEAR / RPM', '4 / 6,240'], ['LAP TIME', '00:31.820']]
    : [['SELECTED', 'FRONT SCRUB'], ['DISTANCE', '2.4 km'], ['DURATION', '0.8 s'], ['FRONT SLIP', '112%']]
  ).map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}</div>`;
  const card = (kind, tone) => `<article class="map-study__card map-study__card--${tone}" data-map-tone="${tone}">
    <div class="map-study__caption"><strong>${tone === 'dark' ? 'Current dark' : 'Light proposal'}</strong><span>${kind === 'events' ? 'LAP 7' : 'DRIVE #2'}</span></div>
    <div class="map-study__plot">${kind === 'events' ? eventSvg() : driverSvg()}</div>${legend(kind)}${readout(kind)}
  </article>`;
  window.FDC_FOUNDATIONS.push({
    id: 'foundation-light-maps',
    title: 'Light theme · Events and Driver maps',
    section: 'FOUNDATIONS',
    status: 'proposal',
    theme: 'light',
    proposalLabel: 'FDC LIGHT MAPS / PROPOSAL',
    proposalKicker: 'CONFIGURATION MAPS / HUD UNCHANGED',
    description: 'Side-by-side dark and light map studies for Events and Driver. The same schematic route, data, and layer meaning are shown on both surfaces.',
    html: `<h2>Maps as measured traces</h2><p class="map-study__intro">The route is recorded geometry, not a road map or named track. In the light Configuration theme it sits on a matte olive inset with a dark neutral rail. Pedal and problem colors keep their meaning but use deeper map-only values so they remain visible. The painted header and in-game HUD stay as they are.</p>
      <section class="map-study__section" data-map-study="events"><div class="map-study__section-head"><h3>Events · Lap 7</h3><span>THROTTLE / BRAKE / COAST / SLIP · SECTOR TICKS</span></div><div class="map-study__pair">${card('events', 'dark')}${card('events', 'light')}</div><p class="map-study__note">Toggle a layer in either legend: both maps change together. The neutral route and sector markers remain visible.</p></section>
      <section class="map-study__section" data-map-study="driver"><div class="map-study__section-head"><h3>Driver · Drive #2</h3><span>PROBLEM SEGMENTS / CLEAN CHECKS</span></div><div class="map-study__pair">${card('driver', 'dark')}${card('driver', 'light')}</div><p class="map-study__note">The selected front-scrub segment uses a contour and weight, not another lime fill. Color names and recorded values remain in the legend and readout.</p></section>
      <section class="panel map-study__rules"><h3>Map rules for the light theme</h3><ul><li>Use the Configuration light surface roles for the card and inset. Map-only color roles adjust contrast; telemetry and HUD tokens stay unchanged.</li><li>Base route, start, sector labels, and clean checks work without a color layer. The data path has no basemap, road names, or claimed track identity.</li><li>Events and Driver share the same surface, geometry treatment, focus and legend behavior; only their data layers differ.</li></ul><p class="muted">Schematic fixture for design review. No FDC data or app preference is changed.</p><a href="LIGHT_THEME.md">Light theme token notes ↗</a></section>`
  });
})();

if (typeof document !== 'undefined') document.addEventListener('click', event => {
  const button = event.target.closest('[data-map-study-layer]');
  if (!button) return;
  event.stopImmediatePropagation();
  const section = button.closest('[data-map-study]');
  const key = button.dataset.mapStudyLayer;
  const active = button.getAttribute('aria-pressed') !== 'true';
  section.querySelectorAll(`[data-map-study-layer="${key}"]`).forEach(item => item.setAttribute('aria-pressed', String(active)));
  section.querySelectorAll(`[data-map-layer="${key}"]`).forEach(item => item.classList.toggle('map-study__is-hidden', !active));
}, true);

