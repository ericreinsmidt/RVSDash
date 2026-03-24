// admin.js
/*
==============================================================================
File: app/web/js/admin.js
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

Purpose:
- Admin page behavior: send allowlisted admin API requests.
- Shows result JSON including reply_b64 and reply_text.

Notes:
- This JS does not send arbitrary admin commands; it only calls allowlisted
  backend endpoints.
==============================================================================
*/

/**
 * Admin page JS:
 * - Sends allowlisted admin commands via JSON endpoints.
 * - Shows result JSON including reply_b64 and reply_text.
 */
const cmdOut = document.getElementById('cmdOut');

const btnSetRT = document.getElementById('btnSetRT');
const btnSetMOTD = document.getElementById('btnSetMOTD');
const btnLoadINI = document.getElementById('btnLoadINI');

const rtSeconds = document.getElementById('rtSeconds');
const motdText = document.getElementById('motdText');
const iniName = document.getElementById('iniName');

const btnCheckStatus = document.getElementById('btnCheckStatus');
const statusOut = document.getElementById('statusOut');

const btnFetchMaps = document.getElementById('btnFetchMaps');
const mapsOut = document.getElementById('mapsOut');
const mapsTableWrap = document.getElementById('mapsTableWrap');

const mapsDetails = document.getElementById('mapsDetails');
const mapsSummary = document.getElementById('mapsSummary');

const btnSay = document.getElementById('btnSay');
const sayText = document.getElementById('sayText');

const btnSetDiff = document.getElementById('btnSetDiff');
const diffLevel = document.getElementById('diffLevel');

function escapeHtml(s){
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\\\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

async function postJson(url, body){
  if (cmdOut){
    cmdOut.textContent = JSON.stringify({sending:true, url, body}, null, 2);
  }
  try{
    const r = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify(body),
    });
    const j = await r.json();
    if (cmdOut){
      cmdOut.textContent = JSON.stringify(j, null, 2);
    }
  } catch (e){
    if (cmdOut){
      cmdOut.textContent = JSON.stringify({ok:false, error:String(e)}, null, 2);
    }
  }
}

// NOTE: btnRestart is used below; make sure it exists.
const btnRestart = document.getElementById('btnRestart');

btnRestart?.addEventListener('click', () => {
  postJson('/api/admin/restart', {});
});

btnSetRT?.addEventListener('click', () => {
  postJson('/api/admin/set_rt', { seconds: Number(rtSeconds.value) });
});

btnSetMOTD?.addEventListener('click', () => {
  postJson('/api/admin/set_motd', { motd: motdText.value });
});

btnLoadINI?.addEventListener('click', () => {
  postJson('/api/admin/load_ini', { inifile: iniName.value });
});

btnSay?.addEventListener('click', () => {
  postJson('/api/admin/say', { msg: (sayText?.value || '') });
});

btnSetDiff?.addEventListener('click', () => {
  const lvl = Number(diffLevel?.value ?? 0);
  postJson('/api/admin/set_diff_level', { level: lvl });
});

// Optional status check from admin page (useful for deployments)
btnCheckStatus?.addEventListener('click', async () => {
  if (statusOut){
    statusOut.textContent = JSON.stringify({sending:true, url:'/api/query'}, null, 2);
  }
  try{
    const r = await fetch('/api/query', { cache:'no-store' });
    const j = await r.json();
    if (statusOut){
      statusOut.textContent = JSON.stringify(j, null, 2);
    }
  } catch (e){
    if (statusOut){
      statusOut.textContent = JSON.stringify({ok:false, error:String(e)}, null, 2);
    }
  }
});

function renderAvailableMapsTable(payload){
  if (!mapsTableWrap) return;

  const maps = payload?.available_maps?.maps || [];
  const mapCount = Array.isArray(maps) ? maps.length : 0;

  if (mapsSummary){
    mapsSummary.textContent = `Map list (${mapCount} maps) — click to show/hide`;
  }

  if (!maps || maps.length === 0){
    mapsTableWrap.innerHTML =
      `<div class="mapsCount"><b>Total maps:</b> 0</div>` +
      `<div class="small" style="padding:0 10px 10px;">No maps returned.</div>`;
    return;
  }

  if (mapsDetails){
    mapsDetails.open = true;
  }

  let html = `<div class="mapsCount"><b>Total maps:</b> ${escapeHtml(String(mapCount))}</div>`;

  html += `<table><thead><tr><th>Map</th><th>Gamemodes</th></tr></thead><tbody>`;
  for (const row of maps){
    const mapName = escapeHtml(row?.map || '');
    const modes = (row?.modes || []).map(m => `<span class="tag">${escapeHtml(m)}</span>`).join(' ');
    html += `<tr><td class="mono">${mapName}</td><td>${modes}</td></tr>`;
  }
  html += `</tbody></table>`;

  mapsTableWrap.innerHTML = html;
}

btnFetchMaps?.addEventListener('click', async () => {
  if (mapsOut) mapsOut.textContent = JSON.stringify({sending:true, url:'/api/admin/available_maps'}, null, 2);

  if (mapsDetails) mapsDetails.open = true;
  if (mapsSummary) mapsSummary.textContent = 'Map list (loading…) — click to show/hide';
  if (mapsTableWrap) mapsTableWrap.innerHTML = `<div class="small" style="padding:10px;">Loading…</div>`;

  try{
    const r = await fetch('/api/admin/available_maps', { cache:'no-store' });
    const j = await r.json();
    if (mapsOut) mapsOut.textContent = JSON.stringify(j, null, 2);
    renderAvailableMapsTable(j);
  } catch (e){
    const err = {ok:false, error:String(e)};
    if (mapsOut) mapsOut.textContent = JSON.stringify(err, null, 2);
    if (mapsSummary) mapsSummary.textContent = 'Map list (error) — click to show/hide';
    if (mapsTableWrap) mapsTableWrap.innerHTML = `<div class="small" style="padding:10px;">Error: ${escapeHtml(String(e))}</div>`;
  }
});