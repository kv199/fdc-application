window.FDC_FOUNDATIONS = [
  {
    id: 'foundation-material',
    title: 'App finish & HUD surface',
    section: 'FOUNDATIONS',
    description: 'Design reference: the painted app header, calm data panels and the unchanged plain dark HUD surface.',
    html: `
      <section class="panel"><span class="label">DESIGN REFERENCE / SURFACES</span><h2>Texture marks the header</h2><p>The painted texture appears on the Configuration header. Everyday cards and tables use even dark surfaces. The HUD over the game and Delta keep their agreed flat dark surfaces and shared opacity.</p><div class="row"><a href="?board=hud-live">See Grouped HUD ↗</a><a href="?board=hud-freeform">See individual widgets ↗</a></div></section>
      <div class="grid2">
        <section class="panel">
          <div class="row"><div><div class="label">SELECTED APP FINISH</div><h2>Painted configuration header</h2></div><span class="badge green">PROPOSAL · B / 90%</span></div>
          <div class="plate material-sample" style="min-height:270px;padding:24px;background:linear-gradient(135deg,#687768,#34453b 56%,#1d2923);position:relative;overflow:hidden">
            <div class="row"><span class="label">FDC / CONFIGURATION HEADER</span><span class="label">01 — CAST ALLOY</span></div>
            <div class="grid2" style="margin-top:34px;align-items:center">
              <div class="plate" style="padding:16px;text-align:center"><div class="num condensed" style="font-size:42px;line-height:1">FDC</div><div class="label">LOCAL SETTINGS</div></div>
              <div><div class="label">HUD LAYOUT</div><div class="num condensed" style="font-size:46px;line-height:1">GROUPED</div><div class="label">FREEFORM / DELTA</div></div>
            </div>
            <div class="row" style="margin-top:30px"><span class="muted">SATIN PAINT · HARD EDGES · NO DECORATIVE MARKS</span><span class="badge">90% WEAR</span></div>
          </div>
          <p class="muted">The painted treatment gives the header its identity. Cards, controls and tables stay calm; the on-track HUD keeps its quiet, flat dark background.</p>
        </section>
        <section class="panel">
          <div class="label">PALETTE ROLES</div>
          <div class="row"><span>Body paint</span><span class="badge green">muted racing green</span></div>
          <div class="row"><span>Instrument recess</span><span class="badge">near-black</span></div>
          <div class="row"><span>Readout / primary text</span><span class="badge">warm white</span></div>
          <div class="row"><span>Primary action / live telemetry</span><span class="badge green">signal green</span></div>
          <div class="row"><span>Best lap / fastest sector</span><span class="badge purple">purple</span></div>
          <div class="row"><span>Brake / delete / critical state</span><span class="badge red">red</span></div>
          <div class="row"><span>Coast / connection attention</span><span class="badge amber">amber</span></div>
          <div class="callout"><b>Wear rule</b><p>Texture belongs on the app header only. Keep regular cards, tables, the on-track HUD and Delta texture-free; HUD backgrounds and readings share the HUD opacity setting.</p></div>
        </section>
      </div>
      <section class="panel">
        <div class="row"><div><div class="label">WEAR APPLICATION</div><h2>One expressive surface, quiet working areas</h2></div><span class="badge amber">90% EXPRESSION</span></div>
        <div class="grid3">
          <div class="plate"><span class="label">APP HEADER</span><p>Fine wear belongs to the painted header. Data panels and ordinary cards use even fills.</p></div>
          <div class="plate"><span class="label">IN-GAME HUD</span><p>Matte, even dark surface with no paint texture behind digits, charts or labels.</p></div>
          <div class="plate"><span class="label">SHAPE LANGUAGE</span><p>Square and rectangular panels with clipped corners. Circular forms appear only when they display data or serve a control.</p></div>
        </div>
      </section>`
  },
  {
    id: 'foundation-type',
    title: 'Fonts & readouts',
    section: 'FOUNDATIONS',
    description: 'Design reference: the two selected families are Barlow for the app and Barlow Condensed for headings and numeric readouts.',
    html: `
      <section class="panel"><span class="label">DESIGN REFERENCE / FONTS</span><h2>Two fonts, two jobs</h2><p>Barlow carries menus, labels and tables. Barlow Condensed carries headings, speed, gear, RPM and times. The agreed HUD typography stays the same. Exact families, weights and sizes are on the <a href="?board=foundation-spec">style specification ↗</a>.</p></section>
      <section class="panel">
        <div class="row"><div><div class="label">SELECTED FAMILIES</div><h2>UI text and instrument values</h2></div><span class="badge green">LOCAL FONT FILES</span></div>
        <p class="muted">These locally bundled open-license fonts keep controls readable and changing numbers compact. Their use does not claim the identity of another brand's instrument typeface.</p>
        <div class="grid2">
          <article class="plate">
            <div class="row"><span class="label">BARLOW</span><span class="badge green">UI FONT</span></div>
            <div class="barlow-sample"><div class="num" style="font-size:42px">N 1 4 7 0 8</div><div class="metric">84°C <span class="muted">· 82°C</span></div><div class="num">0.4 bar · 6240 RPM</div><div class="metric">01:08.953</div></div>
            <p class="muted">Balanced proportions for controls, labels and general UI text.</p>
          </article>
          <article class="plate">
            <div class="row"><span class="label">BARLOW CONDENSED</span><span class="badge green">READOUT FONT</span></div>
            <div class="num condensed" style="font-size:42px">N 1 4 7 0 8</div><div class="metric condensed">84°C <span class="muted">· 82°C</span></div><div class="num condensed">0.4 bar · 6240 RPM</div><div class="metric condensed">01:08.953</div>
            <p class="muted">Narrower footprint for speed, gear, RPM and lap time emphasis.</p>
          </article>
        </div>
      </section>
      <div class="grid2">
        <section class="panel"><div class="label">PAIRING</div><h2>Barlow UI + Barlow Condensed readouts</h2><p>Use Barlow for navigation, helper text, forms and tables. Reserve Barlow Condensed for prominent live values and lap times. Keep tabular numerals on every column of changing data.</p><div class="row"><span>Regular UI</span><span class="num">16 / 24</span></div><div class="row"><span>Section label</span><span class="label">11 · TRACKED</span></div><div class="row"><span>Primary value</span><span class="metric condensed">184 km/h</span></div></section>
        <section class="panel"><div class="label">DISTRIBUTION & SCOPE</div><p>The four font files are bundled locally under <code>overlay/assets/fonts/</code>, so FDC and this book never fetch a web font. Keep the included OFL notices with any redistribution.</p><p class="muted">These samples cover Latin letters and numerals used by the current English UI. Windows fonts in the fallback stack cover glyphs Barlow lacks, such as Cyrillic in user-entered names.</p><div class="row"><a href="https://github.com/google/fonts/tree/main/ofl/barlow">Barlow source</a><a href="../../overlay/assets/fonts/barlow-OFL.txt">OFL notice</a></div><div class="row"><a href="https://github.com/google/fonts/tree/main/ofl/barlowcondensed">Barlow Condensed source</a><a href="../../overlay/assets/fonts/barlowcondensed-OFL.txt">OFL notice</a></div></section>
      </div>`
  },
  {
    id: 'foundation-kit',
    title: 'Component & state kit',
    section: 'FOUNDATIONS',
    description: 'Shared component patterns for all proposed pages, including status colours and dense automotive data views.',
    html: `
      <div class="grid2">
        <section class="panel"><div class="label">CONTROL STATES</div><h2>Controls retain clear outlines</h2>
          <div class="row"><span>Primary action</span><button class="button primary">RECORD RUN</button></div>
          <div class="row"><span>Secondary action</span><button class="button">EDIT LAYOUT</button></div>
          <div class="row"><span>Destructive action</span><button class="button danger">DELETE</button></div>
          <div class="row"><span>Enabled preference</span><button class="toggle" aria-pressed="true"><span>HUD ENABLED</span><span class="green">● ON</span></button></div>
          <div class="row"><span>Disabled preference</span><button class="toggle" aria-pressed="false"><span>ALWAYS ON TOP</span><span class="muted">○ OFF</span></button></div>
          <div class="row"><span>Brightness</span><div class="range"><span class="green">85%</span><span class="muted">0 ━━━━━━━━━━━━━ 100</span></div></div>
          <div class="grid2"><label class="field">Speed unit<select><option>KM/H</option><option>MPH</option></select></label><label class="field">Event name<input value="Luta do Estadio" readonly></label></div>
        </section>
        <section class="panel"><div class="label">STATUS & SEMANTIC COLOURS</div><h2>Color explains meaning consistently</h2>
          <div class="row"><span>Live / ready / next distinct best</span><span class="badge green">READY · 01:09.436</span></div>
          <div class="row"><span>Best lap / tied fastest sector</span><span class="badge purple">BEST · 01:08.953</span></div>
          <div class="row"><span>Brake / destructive action</span><span class="badge red">BRAKE · DELETE</span></div>
          <div class="row"><span>Coast / attention</span><span class="badge amber">COAST · CHECK</span></div>
          <div class="row"><span>Neutral / waiting for telemetry</span><span class="badge">WAITING FOR DATA</span></div>
          <div class="callout"><b>Driver analysis</b><p>Use restrained accents for candidate findings and keep the checked counts visible. The current beta’s thresholds and wording remain the source for any screen examples.</p></div>
        </section>
      </div>
      <section class="panel"><div class="row"><div><div class="label">DENSE DATA TABLE</div><h2>Alignment makes lap comparisons faster</h2></div><span class="badge">7 LAPS · FIXTURE FROM SUPPLIED SCREEN</span></div>
        <div class="table"><div class="row"><span class="label green">LAP ↓</span><span class="label">LAP TIME</span><span class="label">SECTOR 1</span><span class="label">SECTOR 2</span><span class="label">SECTOR 3</span></div>
          <div class="row"><span class="num">7</span><span class="num green">01:09.436</span><span class="num green">00:27.289</span><span class="num">00:22.064</span><span class="num">00:20.083</span></div>
          <div class="row"><span class="num">6</span><span class="num">01:09.854</span><span class="num">00:27.463</span><span class="num">00:21.983</span><span class="num">00:20.408</span></div>
          <div class="row"><span class="num">5</span><span class="num">01:10.679</span><span class="num">00:29.330</span><span class="num purple">00:21.341</span><span class="num green">00:20.009</span></div>
          <div class="row"><span class="num">4</span><span class="num purple">01:08.953</span><span class="num purple">00:26.989</span><span class="num green">00:21.978</span><span class="num purple">00:19.986</span></div>
        </div><p class="muted">Colours follow the supplied example: purple marks the fastest time and green the next distinct value in each column. Class badges keep their existing meaning.</p>
      </section>
      <section class="panel"><div class="label">CLASS BADGES · PRESERVE CURRENT SEMANTIC MAP</div><div class="row"><span class="badge class-d">D · SKY</span><span class="badge class-c">C · YELLOW</span><span class="badge class-b">B · ORANGE</span><span class="badge class-a">A · RED</span><span class="badge class-s1">S1 · PURPLE</span><span class="badge class-s2">S2 · BLUE</span><span class="badge class-r">R · PINK</span><span class="badge class-x">X · GREEN</span></div></section>`
  },
  {
    id: 'foundation-coverage',
    title: 'Screen map & design rules',
    section: 'FOUNDATIONS',
    description: 'Design reference: a checklist of the screens in this book and the product behavior each screen must preserve when implementation begins.',
    html: `
      <section class="panel"><span class="label">DESIGN REFERENCE / SCREEN MAP</span><h2>What this book covers</h2><p>Each row below names one area of FDC, links to its screen, and lists the behavior the implementation keeps. Use this as a review checklist; it is not an extra screen in the app.</p></section>
      <section class="panel"><div class="row"><div><div class="label">SIX APP AREAS</div><h2>Screens and retained behavior</h2></div><span class="badge amber">IMPLEMENTED ON THE REDESIGN BRANCH</span></div>
        <div class="table coverage-map">
          <div class="row"><span class="label">AREA</span><span class="label">INCLUDED VIEWS</span><span class="label">BEHAVIOR TO RETAIN</span><span class="label">STATUS</span></div>
          <div class="row"><a href="?board=hud-live">HUD ↗</a><span>Grouped, six individual widgets, Delta and shift states</span><span>Current data placement, vertical pedals, one Speed / Gear / RPM block, visibility and layout modes</span><span class="badge green">REDESIGN</span></div>
          <div class="row"><a href="?board=driver-list">DRIVER ↗</a><span>History, recording, car, statistics and drive map</span><span>Asphalt-only findings, multi-car recordings, zero-reference rules and current lifecycle</span><span class="badge green">REDESIGN</span></div>
          <div class="row"><a href="?board=shift-light">SHIFT LIGHT ↗</a><span>Brightness controls, learner state, calibration and profile table</span><span>Learning states, gear values, target and local learner contract</span><span class="badge green">REDESIGN</span></div>
          <div class="row"><a href="?board=garage">GARAGE ↗</a><span>Current car, variants and saved library, without image slots</span><span>Numeric variant IDs, observed metadata, local labels and last-used ordering</span><span class="badge green">REDESIGN</span></div>
          <div class="row"><a href="?board=events-library">EVENTS ↗</a><span>Library, create, event detail, run and expanded lap map</span><span>Mode colors, sorting, laps, sectors, legend layers and recorded hover values</span><span class="badge green">REDESIGN</span></div>
          <div class="row"><a href="?board=settings">SETTINGS ↗</a><span>Always on top, telemetry HUD visibility, speed and distance units</span><span>Existing preferences and km/h / mph plus km / mi choices</span><span class="badge green">REDESIGN</span></div>
        </div>
      </section>
      <div class="grid2">
        <section class="panel"><div class="label">RULES FOR IMPLEMENTATION LATER</div><h2>Keep these behaviors when building it</h2>
          <div class="row"><span>1</span><span>Keep navigation, titles and the function of every control recognizable.</span></div>
          <div class="row"><span>2</span><span>Use a 44 px title on top-level pages and a compact header with an immediate parent link on Driver and Events detail pages.</span></div>
          <div class="row"><span>3</span><span>Use two outer cuts on the joined Grouped HUD; keep separate cuts on each Freeform widget and Delta. Keep telemetry transport unchanged.</span></div>
          <div class="row"><span>4</span><span>Preserve all data labels, units, local storage boundaries and class colours.</span></div>
          <div class="row"><span>5</span><span>Show fictional or screenshot-derived values as fixtures, never as live telemetry.</span></div>
          <div class="row"><span>6</span><span>Apply the painted texture to the app header only; keep working surfaces even and the in-game HUD and Delta flat dark with shared opacity.</span></div>
        </section>
        <section class="panel"><div class="label">SOURCES FOR THIS PLAN</div><h2>Current code is the behavior source</h2>
          <p>Page structure and controls were mapped from the current <code>overlay/settings.html</code> and <code>overlay/settings.js</code>. The HUD arrangement follows <code>overlay/index.html</code> and <code>docs/hud.md</code>. Driver and Events pages follow their current code and feature guides.</p>
          <p>The supplied screenshots provide visible examples for Driver Analysis history, Shift Light, Garage, Settings, and the Events library, event details, lap table and trace expansion. A sample table on this canvas reproduces visible lap figures as a static layout fixture.</p>
          <div class="callout"><b>Implementation boundary</b><p>The book shows the implemented design with fixture data. Current code and feature guides remain the authority for live behavior, data ownership and control flows.</p></div>
          <p class="muted">No new telemetry claims, track identity, ideal line, driving score, exact time loss, external transport or persistence behavior is proposed here.</p>
        </section>
      </div>`
  }
];
