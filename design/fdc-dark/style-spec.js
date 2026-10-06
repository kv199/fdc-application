/* Human-readable companion to overlay/tokens.css. Token names are the app's
   own; book.js fills in each value from the loaded stylesheet, so this board
   always shows what the app uses. */
(() => {
  const swatches = entries => `<div class="spec-grid">${entries.map(([name, variable]) => `<div class="spec-swatch" style="--sample:var(${variable})"><div class="spec-swatch__color"></div><strong>${name}</strong><code data-token="${variable}">${variable}</code></div>`).join('')}</div>`;
  const rule = (name, text) => `<div class="spec-rule"><strong>${name}</strong><p>${text}</p></div>`;
  window.FDC_FOUNDATIONS.unshift({
    id: 'foundation-spec',
    title: 'Exact style specification',
    section: 'FOUNDATIONS',
    description: 'FDC Dark tokens for surfaces, text, actions, the in-game HUD, and the preserved meaning colors, with the type scale and interaction rules. Values come from overlay/tokens.css.',
    html: `<div class="row"><div><h2>FDC Dark specification</h2><p class="muted">Painted app header, calm data surfaces, dark in-game HUD. Values are read from <a href="../../overlay/tokens.css">overlay/tokens.css ↗</a>; the rules are in docs/design-system.md.</p></div><span class="badge green">LIVE TOKEN VALUES</span></div>
      <section class="panel"><h3>SURFACES, LINES AND TEXT</h3>${swatches([
        ['Background','--bg'],['Deep inset','--surface-deep'],['UI surface','--surface'],['Raised plate','--panel'],['Hover surface','--surface-hover'],['Painted header','--paint'],
        ['Subtle rule','--line-subtle'],['Rule / border','--line'],['Strong edge','--line-strong'],
        ['Primary text','--text'],['Soft text','--text-soft'],['Supporting text','--text-muted'],['Metadata text','--text-subtle'],['Placeholder text','--text-faint'],['Text on lime','--text-on-accent'],['Text on red','--text-on-danger']
      ])}<p class="muted">Background, inset, surface and raised plate form visible levels. Data tables and navigation use the deep inset without paint texture.</p></section>
      <section class="panel"><h3>ACTIONS AND MEANINGS</h3>${swatches([
        ['Action hover / selected / ready','--accent'],['Ready hover','--accent-hover'],['Best / learned cue','--best'],['Danger UI','--danger'],['Danger text','--danger-text'],['Attention / reset','--caution'],['Warning','--warning'],['Advisory hint','--notice'],['Redline / alert','--alert']
      ])}<p class="muted">Color supplements a written label. Purple identifies the learned Shift Light cue and best time; the HUD colors below keep telemetry meanings.</p></section>
      <section class="panel"><h3>IN-GAME HUD</h3>${swatches([
        ['HUD surface','--hud-panel'],['HUD waiting surface','--hud-delta-panel'],['Delta surface base','--hud-shade'],['Grouped divider','--hud-divider'],['HUD text','--hud-text'],
        ['Throttle / ahead','--telemetry-throttle'],['Brake / behind','--telemetry-brake'],['Learned shift','--hud-shift-alert'],['Redline','--hud-redline-background']
      ])}<p class="muted">HUD surfaces stay translucent so the game shows through; HUD Opacity applies on top. Tire temperature colors (below 70°C, 70–&lt;82°C, 82–&lt;92°C, 92°C or above) are set by the HUD script.</p></section>
      <section class="panel"><h3>TYPOGRAPHY</h3><div class="spec-type-row"><b style="font-family:var(--font-ui);font-size:20px">Barlow · Navigation and body</b><span>Regular 400 / Semibold 600 · --font-ui</span></div><div class="spec-type-row"><b style="font-family:var(--font-readout);font-size:35px">184 km/h · 8,796 RPM</b><span>Barlow Condensed · Medium 500 / Semibold 600 · --font-readout</span></div>${rule('Scale','Top-level title 44 px · compact detail title 27 px · section 28 px · body 14 px · labels 11 px. Changing telemetry values and table columns use tabular numerals.')}${rule('Language','The UI is English. Windows fonts in the fallback stack cover glyphs Barlow lacks, such as Cyrillic in user-entered names.')}</section>
      <section class="panel"><h3>APP HIERARCHY</h3>${rule('Top-level header','Painted, textured app header with the 44 px tab title, the tab\'s one-paragraph description, and the Direct Data Out status, which opens the connection guide. Navigation stays below it.')}${rule('Detail header','Drill-down pages turn the header into one compact row: FDC, a back link that names the parent, and the 27 px page name, as in ← RECORDING / CAR.')}${rule('Texture','overlay/assets/textures/paint.jpg appears on the app header only, at --paint-texture-opacity. Cards, forms, tables, the HUD and Delta have even fills.')}</section>
      <section class="panel"><h3>ACCENT AND SURFACE USE</h3>${rule('Raised plate','One raised plate per view for the main working area or principal result; supporting data stays on ordinary panels.')}${rule('Lime','Ordinary buttons fill with lime on hover; selected navigation and choices keep a lime fill; the one next step of a screen (CREATE, DETAILS, SAVE, RECORD RUN, a dialog\'s safe answer) is filled with lime at rest. Lime text is reserved for ready, positive and timing values.')}${rule('Semantic results','Purple marks best or learned shift cues. Event modes, vehicle classes and map markers keep their established color maps.')}</section>
      <section class="panel"><h3>HUD GEOMETRY AND RHYTHM</h3><div class="spec-cut"><strong>One strip / two outside cuts</strong><p>Translucent in-game surface · no paint texture · opacity includes background and readings</p></div>${rule('Grouped HUD','One 736 × 69 px surface with six joined data areas and 0 px gutter. Only the outside top-left and bottom-right corners use a 14 px cut (--hud-cut-grouped); thin --hud-divider lines separate readings.')}${rule('Freeform + Delta','Each widget is cut 7 px at its top-left and bottom-right (--hud-cut-widget). Delta keeps its full-width strip with the same cut. The gear stays one Speed / Gear / RPM block, centered on its cap height.')}${rule('Spacing','4 / 8 / 12 / 18 / 24 / 36 px rhythm (--space-1 … --space-6). Borders are 1 px; controls are square.')}</section>
      <section class="panel"><h3>HUD BEHAVIOR</h3>${rule('Overlay opacity','Whole HUD and Delta, including their surfaces and readings: 1–100%, default 80%.')}${rule('Layout editor','The toolbar reads DRAG &lt;TARGET&gt; TO MOVE · CORNER TO RESIZE · ESC CANCELS. RESET (caution) restores the default placement and stands apart; CANCEL is neutral; SAVE is filled with lime.')}${rule('Visibility','The edited target stays visible even when telemetry or a visibility switch would hide it.')}</section>
      <section class="panel"><h3>EVENT MODES · PRESERVED COLORS</h3>${swatches([
        ['Any','--mode-any'],['Rivals','--mode-rivals'],['Online','--mode-online'],['EventLab','--mode-eventlab'],['Official','--mode-official'],['Blueprint','--mode-blueprint']
      ])}<p class="muted">Mode badges use dark text (--text-on-badge).</p></section>
      <section class="panel"><h3>VEHICLE CLASSES · PRESERVED COLORS</h3>${swatches([
        ['D','--class-d'],['C','--class-c'],['B','--class-b'],['A','--class-a'],['S1','--class-s1'],['S2','--class-s2'],['R','--class-r'],['X','--class-x']
      ])}</section>
      <section class="panel"><h3>MAP LAYERS AND DRIVER MARKERS · PRESERVED</h3>${swatches([
        ['Throttle','--trace-throttle'],['Brake','--trace-brake'],['Coast','--trace-coast'],['Slip','--trace-slip'],
        ['Front scrub','--problem-front-scrub'],['Exit wheelspin','--problem-exit-wheelspin'],['Brake + steering','--problem-brake-steering'],['Abrupt release','--problem-abrupt-release']
      ])}</section>
      <section class="panel"><h3>INTERACTION STATES</h3>${rule('Action buttons','Dark at rest with lime fill and dark text on hover or focus. Ready actions are lime at rest. Destructive actions keep red text at rest and fill red on hover.')}${rule('Focus','2 px lime outline outside the control; text fields may show focus with a lime border instead.')}${rule('Selected','Lime fill on selected navigation and segmented choices remains visible without hover; the state is exposed through ARIA or a checked input.')}${rule('Disabled','Deep inset, subtle line and placeholder text; no hover fill, also for ready and destructive buttons.')}${rule('Loading / offline','Show WAITING or a named unavailable state; never present illustrative fixtures as live telemetry.')}</section>`
  });
})();
