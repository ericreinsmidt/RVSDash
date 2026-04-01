// stats.js
/*
==============================================================================
File: app/web/js/stats.js
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Purpose:
- Read-only stats page behavior.
- Keeps a familiar UX: dot + "last update" + refresh button.
- Fetches stats APIs and renders tables with score column for players.
- Clickable player names link to per-player detail page.
- Sortable columns on the players table.
==============================================================================
*/

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

/*
  Column header display names.
  Keys not listed here display as-is.
*/
// NOTE: COL_LABEL_MAP also defined in player.js — keep in sync
const COL_LABEL_MAP = {
  server_ident: 'Server',
  ubi: 'Player',
  kills: 'Kills',
  deaths: 'Deaths',
  fired: 'Fired',
  hits: 'Hits',
  rounds_played: 'Rounds',
  score: 'Score',
  map: 'Map',
  game_mode: 'Game Mode',
};

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

    // Raw debug blob
    if (rawOut) rawOut.textContent = JSON.stringify({ servers:srvJ, players:plyJ, maps:mapJ, modes:modeJ }, null, 2);

    renderTable(serversWrap, ['server_ident','kills','deaths','fired','hits','rounds_played'], srvJ?.rows || []);
    renderPlayersTable(playersTotalsWrap, plyJ?.rows || [], ident);
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

// NOTE: renderTable also defined in player.js — keep in sync
function renderTable(wrap, cols, rows){
  if (!wrap) return;
  if (!rows || rows.length === 0){
    wrap.innerHTML = `<div class="small">(none)</div>`;
    return;
  }
  let html = `<div class="tableClip"><table><thead><tr>`;
  html += cols.map(c => `<th>${escapeHtml(COL_LABEL_MAP[c] || c)}</th>`).join('');
  html += `</tr></thead><tbody>`;
  for (const r of rows){
    html += `<tr>`;
    html += cols.map(c => {
      const isNum = ['kills','deaths','fired','hits','rounds_played','score'].includes(c);
      const val = r?.[c];
      let display = isNum && val != null ? Number(val).toLocaleString() : val;
      if (c === 'game_mode' && val) display = gameModeName(val) || val;
      const cls = (isNum ? 'mono num' : 'mono');
      return `<td class="${cls}">${escapeHtml(display)}</td>`;
    }).join('');
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

/*
  Players table state for sorting.
*/
let playersSortCol = 'score';
let playersSortAsc = false;
let lastPlayersRows = [];
let lastPlayersServerIdent = '';

function sortPlayersRows(rows, col, asc){
  const numCols = ['kills','deaths','fired','hits','rounds_played','score'];
  const isNum = numCols.includes(col);
  const sorted = [...rows];
  sorted.sort((a, b) => {
    let va = a?.[col] ?? '';
    let vb = b?.[col] ?? '';
    if (isNum){
      va = Number(va) || 0;
      vb = Number(vb) || 0;
    } else {
      va = String(va).toLowerCase();
      vb = String(vb).toLowerCase();
    }
    if (va < vb) return asc ? -1 : 1;
    if (va > vb) return asc ? 1 : -1;
    return 0;
  });
  return sorted;
}

function renderPlayersTable(wrap, rows, currentServerIdent){
  if (!wrap) return;

  lastPlayersRows = rows;
  lastPlayersServerIdent = currentServerIdent;

  if (!rows || rows.length === 0){
    wrap.innerHTML = `<div class="small">(none)</div>`;
    return;
  }

  const cols = ['ubi','kills','deaths','fired','hits','rounds_played','score'];
  const numCols = ['kills','deaths','fired','hits','rounds_played','score'];

  const sorted = sortPlayersRows(rows, playersSortCol, playersSortAsc);

  let html = `<div class="tableClip"><table><thead><tr>`;
  for (const c of cols){
    const label = COL_LABEL_MAP[c] || c;
    const arrow = (c === playersSortCol) ? (playersSortAsc ? ' ▲' : ' ▼') : '';
    const cls = (c === playersSortCol) ? 'sortTh sortActive' : 'sortTh';
    html += `<th class="${cls}" data-sort-col="${escapeHtml(c)}">${escapeHtml(label)}${arrow}</th>`;
  }
  html += `</tr></thead><tbody>`;

  for (const r of sorted){
    html += `<tr>`;
    for (const c of cols){
      const val = r?.[c];
      if (c === 'ubi'){
        const ubi = val ?? '';
        const si = r?.server_ident ?? currentServerIdent ?? '';
        const href = `/player?ubi=${encodeURIComponent(ubi)}` + (si ? `&server_ident=${encodeURIComponent(si)}` : '');
        html += `<td class="mono"><a class="playerLink" href="${escapeHtml(href)}">${escapeHtml(ubi)}</a></td>`;
      } else {
        const isNum = numCols.includes(c);
        const display = isNum && val != null ? Number(val).toLocaleString() : val;
        const cls = isNum ? 'mono num' : 'mono';
        html += `<td class="${cls}">${escapeHtml(display)}</td>`;
      }
    }
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  wrap.innerHTML = html;

  // Attach sort click handlers to headers
  wrap.querySelectorAll('.sortTh').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-sort-col');
      if (playersSortCol === col){
        playersSortAsc = !playersSortAsc;
      } else {
        playersSortCol = col;
        playersSortAsc = (col === 'ubi');
      }
      renderPlayersTable(wrap, lastPlayersRows, lastPlayersServerIdent);
    });
  });
}

refreshBtn?.addEventListener('click', refresh);
serverIdent?.addEventListener('keydown', (e) => { if (e.key === 'Enter') refresh(); });

// Auto-load once
refresh();