/* Floating screens that had no board in the original proposal: the
   connection guide and the confirmation dialogs. Texts are the app's own;
   the stage behind each card stands in for the dimmed Configuration. */
(() => {
  const stage = card => `<div class="overlay-stage">${card}</div>`;
  const guide = `<section class="overlay-card" aria-label="Connection guide specimen">
    <span class="label">FIRST SETUP</span>
    <h3>CONNECT FORZA HORIZON 6</h3>
    <p>FDC shows live data that Forza sends to this PC. Turn it on once in the game:</p>
    <ol>
      <li>Open <strong>Settings → HUD and Gameplay → Telemetry</strong>.</li>
      <li>Set <strong>Data Out</strong> to <strong>On</strong>.</li>
      <li>Set <strong>Data Out IP Address</strong> to<br><span class="value">127.0.0.1</span></li>
      <li>Set <strong>Data Out IP Port</strong> to<br><span class="value">5301</span></li>
    </ol>
    <div class="guide-status"><i></i>WAITING FOR DATA FROM FORZA…</div>
    <p>This screen updates as soon as the game sends data.</p>
    <div class="actions"><button class="button" data-demo="button">SKIP FOR NOW</button></div>
  </section>`;
  const destructive = `<section class="overlay-card" aria-label="Delete confirmation specimen">
    <h3>ARE YOU SURE?</h3>
    <p>Delete this Driver Analysis recording, all its cars, and saved telemetry?</p>
    <div class="actions"><button class="button danger-answer" data-demo="button">YES</button><button class="button ready" data-demo="button">NO</button></div>
  </section>`;
  const quit = `<section class="overlay-card" aria-label="Quit confirmation specimen">
    <h3>QUIT FDC?</h3>
    <p>The HUD closes too. To keep FDC running, minimize this window instead.</p>
    <label class="check"><input type="checkbox"> Don't ask again</label>
    <div class="actions"><button class="button danger-answer" data-demo="button">QUIT</button><button class="button ready" data-demo="button">CANCEL</button></div>
  </section>`;

  window.FDC_FOUNDATIONS.push({
    id: 'foundation-overlays',
    title: 'Connection guide & dialogs',
    section: 'FOUNDATIONS',
    description: 'Floating screens: the connection guide (opened on first setup and from the header status) and the shared confirmation dialogs. Cards sit on the raised plate; the safe answer is the lime ready action.',
    html: `<div class="row"><div><h2>Floating screens</h2><p class="muted">These open over Configuration. The header status opens the connection guide at any time; it follows the live status and offers RETRY DATA OUT when the receiver has a problem.</p></div><span class="badge">FIXTURE STATES</span></div>
      ${stage(guide)}
      <div class="grid2">${stage(destructive)}${stage(quit)}</div>`
  });
})();
