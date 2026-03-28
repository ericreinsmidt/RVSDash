// stats.js
/*
==============================================================================
File: app/web/js/stats.js
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Purpose:
- Read-only stats page behavior.
- Keeps a familiar UX: dot + "last update" + refresh button.
- For now, fetches /api/query and shows raw JSON (safe, read-only).
==============================================================================
*/

console.log('stats.js loaded');

const statsStatus = document.getElementById('statsStatus');
const dot = document.getElementById('dot');
const lastUpdate = document.getElementById('lastUpdate');
const refreshBtn = document.getElementById('refreshBtn');
const rawOut = document.getElementById('rawOut');

const localTime = document.getElementById('localTime');
const pageUptime = document.getElementById('pageUptime');
const serverIdent = document.getElementById('serverIdent');

const serversWrap = document.getElementById('serversWrap');
const playersTotalsWrap = document.getElementById('playersTotalsWrap');
const mapsWrap = document.getElementById('mapsWrap');
const modesWrap = document.getElementById('modesWrap');

const t0 = Date.now();

function setDot(ok){
  if (!dot) return;
  dot.classList.remove('good', 'bad');
  dot.classList.add(ok ? 'good' : 'bad');
}

function fmtAge(ms){
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m ${r}s`;
}

function tickClocks(){
  if (localTime) localTime.textContent = new Date().toLocaleString();
  if (pageUptime) pageUptime.textContent = fmtAge(Date.now() - t0);
}
setInterval(tickClocks, 500);
tickClocks();

async function refresh(){
  if (statsStatus) statsStatus.textContent = 'Loading…';
  if (lastUpdate) lastUpdate.textContent = 'Fetching stats…';
  setDot(false);

  try{
    const ident = String(serverIdent?.value ?? '').trim();
    const q = new URLSearchParams();
    if (ident) q.set('server_ident', ident);

    const qPlayers = new URLSearchParams(q); qPlayers.set('limit','200');
    const qMaps    = new URLSearchParams(q); qMaps.set('limit','200');
    const qModes   = new URLSearchParams(q); qModes.set('limit','200');

    const serversUrl = q.toString() ? `/api/stats/servers?${q.toString()}` : `/api/stats/servers`;

    const [srvR, plyR, mapR, modeR] = await Promise.all([
      fetch(serversUrl, { cache:'no-store' }),
      fetch(`/api/stats/players?${qPlayers.toString()}`, { cache:'no-store' }),
      fetch(`/api/stats/maps?${qMaps.toString()}`, { cache:'no-store' }),
      fetch(`/api/stats/modes?${qModes.toString()}`, { cache:'no-store' }),
    ]);

    const srvJ = await srvR.json();
    const plyJ = await plyR.json();
    const mapJ = await mapR.json();
    const modeJ = await modeR.json();

    const ok = !!(srvJ?.ok && plyJ?.ok && mapJ?.ok && modeJ?.ok);
    setDot(ok);

    if (statsStatus) statsStatus.textContent = ok ? 'OK' : 'Error';
    if (lastUpdate) lastUpdate.textContent = `Updated: ${new Date().toLocaleTimeString()}`;

    // Raw debug blob (keeps your existing "Raw payload" card useful)
    if (rawOut) rawOut.textContent = JSON.stringify({ servers:srvJ, players:plyJ, maps:mapJ, modes:modeJ }, null, 2);

    renderTable(serversWrap, ['server_ident','kills','deaths','fired','hits','rounds_played'], srvJ?.rows || []);
    renderTable(playersTotalsWrap, ['server_ident','ubi','kills','deaths','fired','hits','rounds_played'], plyJ?.rows || []);
    renderTable(mapsWrap, ['map','kills','deaths','fired','hits','rounds_played'], mapJ?.rows || []);
    renderTable(modesWrap, ['game_mode','kills','deaths','fired','hits','rounds_played'], modeJ?.rows || []);
  } catch (e){
    setDot(false);
    if (statsStatus) statsStatus.textContent = 'Error';
    if (lastUpdate) lastUpdate.textContent = `Failed: ${String(e)}`;
    if (rawOut) rawOut.textContent = JSON.stringify({ ok:false, error:String(e) }, null, 2);
    if (playersTotalsWrap) playersTotalsWrap.textContent = `Error: ${String(e)}`;
    if (mapsWrap) mapsWrap.textContent = `Error: ${String(e)}`;
    if (modesWrap) modesWrap.textContent = `Error: ${String(e)}`;

  }
}


function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g,'&amp;')
    .replace(/</g,'&lt;')
    .replace(/>/g,'&gt;')
    .replace(/"/g,'&quot;')
    .replace(/'/g,'&#039;');
}

function renderTable(wrap, cols, rows){
  if (!wrap) return;
  if (!rows || rows.length === 0){
    wrap.innerHTML = `<div class="small">(none)</div>`;
    return;
  }
  let html = `<div class="tableClip"><table><thead><tr>`;
  html += cols.map(c => `<th>${escapeHtml(c)}</th>`).join('');
  html += `</tr></thead><tbody>`;
  for (const r of rows){
    html += `<tr>`;
      html += cols.map(c => {
      const isNum = ['kills','deaths','fired','hits','rounds_played'].includes(c);
      const cls = (isNum ? 'mono num' : 'mono');
      return `<td class="${cls}">${escapeHtml(r?.[c])}</td>`;
    }).join('');
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}


refreshBtn?.addEventListener('click', refresh);

// Auto-load once
refresh();