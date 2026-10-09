const boards=[...(window.FDC_SCREENS||[]),...(window.FDC_FOUNDATIONS||[])];
const params=new URLSearchParams(location.search), selected=params.get('board'), embed=params.has('embed');
const nav=['HUD','EVENTS','DRIVER','SHIFT LIGHT','GARAGE','SETTINGS'];
const canvas=document.querySelector('#canvas');
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function sectionOf(b){return b.section==='FOUNDATIONS' ? b.section : nav.find(n=>(b.section+' '+b.title).toUpperCase().includes(n))||b.section;}
// Drill-down boards use the app's compact header path: [parent board, parent
// label, page name], as in "← RECORDING / CAR".
const detailParents={
  'driver-recording':['driver-list','HISTORY','RECORDING'],
  'driver-detail':['driver-recording','RECORDING','CAR'],
  'driver-drive':['driver-detail','CAR','DRIVE'],
  'events-detail':['events-library','EVENTS','EVENT'],
  'events-run':['events-detail','EVENT','RUN'],
  'events-map':['events-detail','EVENT','RUN']
};
// The tab description the app shows under the header title.
const intros={
  'HUD':'Live telemetry over the game that never takes your clicks. Choose which blocks to show, how they are arranged, and how see-through they are.',
  'EVENTS':'Save the races you repeat and record your runs with lap and sector times and a trace. While you record, Delta in the HUD compares your lap with your fastest saved run.',
  'DRIVER':'Record a session on asphalt and FDC points out the pattern that repeats most in your driving, together with your session stats.',
  'SHIFT LIGHT':'Learns the best shift RPM for each gear of every car and tune as you drive. In the HUD the gear turns red as the shift nears and purple at the best moment.',
  'GARAGE':'Every car you drive is saved with its class, PI, and drivetrain. Click a car\'s name to rename it everywhere in FDC.',
  'SETTINGS':'Options for the whole app. Everything FDC records stays on this PC.'
};
const status='<button class="connection" type="button" title="Opens the connection guide">● DIRECT DATA OUT · WAITING FOR DATA</button>';
function shell(b){
  const section=sectionOf(b),foundation=!nav.includes(section),parent=detailParents[b.id],proposal=b.status==='proposal';
  const mast=parent
    ? `<header class="appmast appmast--compact"><div class="mastline"><span class="brand">FDC</span><div class="appmast__path"><a href="?board=${parent[0]}" target="_top">← ${parent[1]}</a><span>/</span><h1>${parent[2]}</h1></div>${status}</div></header>`
    : `<header class="appmast"><div class="mastline"><span class="brand">FDC <small>FEEDBACK-DRIVEN COMPANION</small></span>${foundation?`<span class="connection">${proposal?'DESIGN PROPOSAL':'DESIGN REFERENCE'}</span>`:status}</div><h1>${esc(foundation?b.title:section)}</h1>${foundation?`<span class="label">${proposal?esc(b.proposalKicker||'DESIGN PROPOSAL'):'MATERIAL / GEOMETRY / FUNCTION'}</span>`:`<p class="appmast__intro">${esc(intros[section])}</p>`}</header>`;
  return `<article class="app ${foundation?'foundation':''} ${parent?'app--detail':''} ${b.theme==='light'?'app--light-proposal':''}">${mast}${foundation?'':`<nav class="appnav" aria-label="Application sections">${nav.map(n=>{const target=boards.find(x=>sectionOf(x)===n);return `<a class="${section===n?'active':''}" href="?board=${target?.id||b.id}${embed?'&embed=1':''}">${n}</a>`}).join('')}</nav>`}<div class="appcontent">${b.html}</div><footer class="appfooter"><span>FDC / ${proposal?'DESIGN PROPOSAL':foundation?'DESIGN SYSTEM':'LOCAL DEMONSTRATION'}</span><span>${proposal?b.proposalLabel||'FDC / PROPOSAL':'FDC DARK / IMPLEMENTED'}</span></footer></article>`;
}
const jump=document.querySelector('#jump');jump.innerHTML='<option value="">Jump to board…</option>'+boards.map(b=>`<option value="${esc(b.id)}">${esc(b.title)}</option>`).join('');jump.value=selected||'';jump.onchange=()=>{location.href=jump.value?'?board='+encodeURIComponent(jump.value):'index.html'};
document.querySelector('#overview').onclick=()=>location.href='index.html';
let zoom=.5;function setZoom(z){zoom=Math.max(.25,Math.min(.85,z));document.documentElement.style.setProperty('--zoom',zoom);document.querySelector('#zoomLabel').textContent=Math.round(zoom*100)+'%'}document.querySelector('#minus').onclick=()=>setZoom(zoom-.1);document.querySelector('#plus').onclick=()=>setZoom(zoom+.1);
if(selected){const b=boards.find(x=>x.id===selected);document.body.classList.add(embed?'embed':'single');canvas.innerHTML=b?`${embed?'':`<p class="boardnote"><span class="badge">${b.status==='proposal'?'PROPOSAL':'SPECIMEN'}</span> ${esc(b.description)}</p>`}${shell(b)}`:'<p>Board not found. <a href="index.html">Return to overview</a></p>';document.querySelectorAll('#plus,#minus,#zoomLabel').forEach(x=>x.hidden=true);if(b){document.title=b.title+' / FDC design book';if(b.status==='proposal')document.querySelector('.revision').textContent=b.proposalLabel||'FDC / PROPOSAL';}}
else{document.querySelector('.revision').textContent='FDC DESIGN / IMPLEMENTED + PROPOSALS';const references=(window.FDC_FOUNDATIONS||[]).filter(b=>b.status!=='proposal'),proposals=(window.FDC_FOUNDATIONS||[]).filter(b=>b.status==='proposal');const groups=[['01 / Application surfaces',window.FDC_SCREENS||[]],['02 / Design reference pages',references],['03 / Design proposals',proposals]];canvas.innerHTML=groups.map(([title,items])=>`<section class="boardgroup"><h2 class="grouphead">${title}</h2><div class="boardgrid">${items.map(b=>`<article class="boardtile"><div class="boardcaption"><a href="?board=${b.id}">${esc(b.title)} ↗</a><small>${b.status==='proposal'?'PROPOSAL':'SPECIMEN'}</small></div><div class="framewrap"><iframe loading="lazy" title="${esc(b.title)}" src="?board=${b.id}&embed=1"></iframe></div><p class="boardnote">${esc(b.description)}</p></article>`).join('')}</div></section>`).join('');setZoom(innerWidth<760?.28:.5);}
let toastTimer;function toast(message){const t=document.querySelector('#toast');t.textContent=message;t.style.display='block';clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.style.display='none',3500)}
document.addEventListener('click',e=>{const b=e.target.closest('button');if(!b||b.closest('.bookbar'))return;if(b.classList.contains('toggle')){const attr=b.hasAttribute('aria-checked')?'aria-checked':'aria-pressed';b.setAttribute(attr,String(b.getAttribute(attr)!=='true'));return;}if(b.closest('.segmented')){b.parentElement.querySelectorAll('button').forEach(x=>{x.classList.toggle('selected',x===b);x.setAttribute('aria-pressed',String(x===b))});return;}const text=b.textContent.trim();const target=text==='CREATE'?'events-create':text==='VIEW VARIANTS'?'garage':null;if(target){location.href='?board='+target+(embed?'&embed=1':'');return;}toast('Preview only — no FDC data or settings were changed.');});
document.addEventListener('input',e=>{if(e.target.matches('[data-hud-opacity]')){e.target.closest('.appcontent').style.setProperty('--hud-preview-opacity',String(Number(e.target.value)/100));e.target.closest('.hud-spec-opacity-control').querySelector('output').value=e.target.value+'%';return;}if(e.target.type==='range'){const scope=e.target.closest('.range-card,.panel,.plate,.row')||e.target.parentElement;const out=scope.querySelector('output');if(out)out.value=e.target.value+'%';const num=scope.querySelector('.num');if(num&&scope.classList.contains('range-card'))num.textContent=e.target.value+'%';}});
document.addEventListener('submit',e=>{e.preventDefault();toast('Preview only — this form does not save an event.');});
// Board links inside overview iframes open the full board rather than staying clipped.
document.querySelectorAll('.appcontent a[href^="?board="]').forEach(link=>{link.target='_top'});
// Map controls demonstrate the selection state. Map paths are schematic fixtures.
document.addEventListener('click',event=>{
  const button=event.target.closest('[data-map-layer]');
  if(!button)return;
  event.stopImmediatePropagation();
  const legend=button.closest('.map-legend');
  const buttons=[...legend.querySelectorAll('[data-map-layer]')];
  const all=buttons.find(item=>item.dataset.mapLayer==='ALL');
  if(button===all){buttons.forEach(item=>item.setAttribute('aria-pressed','true'));return;}
  button.setAttribute('aria-pressed',String(button.getAttribute('aria-pressed')!=='true'));
  const active=buttons.filter(item=>item!==all&&item.getAttribute('aria-pressed')==='true');
  if(active.length===0||(all&&active.length===buttons.length-1))buttons.forEach(item=>item.setAttribute('aria-pressed','true'));
  else if(all)all.setAttribute('aria-pressed','false');
},true);
// Token specimens show the value the page actually resolved from overlay/tokens.css.
document.querySelectorAll('[data-token]').forEach(code=>{const value=getComputedStyle(document.documentElement).getPropertyValue(code.dataset.token).trim();code.textContent=`${code.dataset.token} · ${value||'undefined'}`;});
document.querySelectorAll('[data-light-token]').forEach(code=>{const scope=code.closest('.app--light-proposal');const value=scope?getComputedStyle(scope).getPropertyValue(code.dataset.lightToken).trim():'';code.textContent=`${code.dataset.lightToken} · ${value||'undefined'}`;});
