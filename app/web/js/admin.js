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
const mapsTableWrap = document.getElementById('mapsTableWrap');

const mapsDetails = document.getElementById('mapsDetails');
const mapsSummary = document.getElementById('mapsSummary');

const btnSay = document.getElementById('btnSay');
const sayText = document.getElementById('sayText');

const btnSetDiff = document.getElementById('btnSetDiff');
const diffLevel = document.getElementById('diffLevel');

function escapeHtml(s){
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\\\"/g, '&quot;').replace(/'/g, '&#039;');
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
    if (j.ok){
      showToast(`✓ ${url.split('/').pop()} — command sent`, 'ok');
    } else {
      showToast(`✗ ${url.split('/').pop()} — ${j.error || 'failed'}`, 'err', 5000);
    }
  } catch (e){
    if (cmdOut){
      cmdOut.textContent = JSON.stringify({ok:false, error:String(e)}, null, 2);
    }
    showToast(`✗ ${url.split('/').pop()} — ${String(e)}`, 'err', 5000);
  }
}

/*
  ============================================================================
  Basic admin commands
  ============================================================================
*/

const btnRestart = document.getElementById('btnRestart');

btnRestart?.addEventListener('click', async () => {
  const ok = await confirmModal('Restart Server?', 'This will perform a full server restart.', { danger: true, confirmText: 'Restart' });
  if (!ok) return;
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

/*
  ============================================================================
  Available Maps
  ============================================================================
*/

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
  if (mapsDetails) mapsDetails.open = true;
  if (mapsSummary) mapsSummary.textContent = 'Map list (loading…) — click to show/hide';
  if (mapsTableWrap) mapsTableWrap.innerHTML = `<div class="small" style="padding:10px;">Loading…</div>`;

  try{
    const r = await fetch('/api/admin/available_maps', { cache:'no-store' });
    const j = await r.json();
    renderAvailableMapsTable(j);

    // Populate the Add Map dropdown
    const addMapSelect = document.getElementById('addMapName');
    if (addMapSelect && j.ok && j.available_maps?.map_to_modes) {
      window._availableMaps = j.available_maps.map_to_modes;
      addMapSelect.innerHTML = '<option value="">— select a map —</option>';
      const mapNames = Object.keys(j.available_maps.map_to_modes).sort();
      for (const name of mapNames) {
        const opt = document.createElement('option');
        opt.value = name;
        opt.textContent = name;
        addMapSelect.appendChild(opt);
      }
      // Reset mode dropdown
      const modeSelect = document.getElementById('addMapMode');
      if (modeSelect) modeSelect.innerHTML = '<option value="">— select map first —</option>';
    }
  } catch (e){
    if (mapsSummary) mapsSummary.textContent = 'Map list (error) — click to show/hide';
    if (mapsTableWrap) mapsTableWrap.innerHTML = `<div class="small" style="padding:10px;">Error: ${escapeHtml(String(e))}</div>`;
  }
});

/*
  ============================================================================
  Server Control + Map Management
  ============================================================================
*/

// Restart match
document.getElementById('btnRestartMatch')?.addEventListener('click', async () => {
  const ok = await confirmModal('Restart Match?', 'This will restart the current match and apply any pending setting changes.', { confirmText: 'Restart Match' });
  if (!ok) return;
  postJson('/api/admin/restart_match', {});
});

// Restart round
document.getElementById('btnRestartRound')?.addEventListener('click', async () => {
  const ok = await confirmModal('Restart Round?', 'This will restart the current round.', { confirmText: 'Restart Round' });
  if (!ok) return;
  postJson('/api/admin/restart_round', {});
});

// Messenger toggle
document.getElementById('btnMessengerToggle')?.addEventListener('click', () => {
  postJson('/api/admin/messenger_toggle', {});
});

// Set max players
document.getElementById('btnSetMaxPlayers')?.addEventListener('click', () => {
  const val = parseInt(document.getElementById('maxPlayers')?.value, 10);
  if (isNaN(val)) return;
  postJson('/api/admin/set_max_players', { max_players: val });
});

// Lock/unlock server (game password)
document.getElementById('btnLockServer')?.addEventListener('click', async () => {
  const pw = document.getElementById('gamePassword')?.value || '';
  if (pw) {
    const ok = await confirmModal('Set Game Password?', `Set the game password to "<b>${escapeHtml(pw)}</b>"?<br>Players will need this password to join.`, { confirmText: 'Set Password' });
    if (!ok) return;
  } else {
    const ok = await confirmModal('Disable Game Password?', 'This will remove the game password. Anyone can join.', { confirmText: 'Disable' });
    if (!ok) return;
  }
  postJson('/api/admin/lock_server', { password: pw });
});

// Save INI
document.getElementById('btnSaveINI')?.addEventListener('click', () => {
  const val = document.getElementById('saveIniName')?.value?.trim();
  if (!val) { showToast('Enter a filename', 'err'); return; }
  postJson('/api/admin/save_ini', { inifile: val });
});

// Go to map
document.getElementById('btnGoMap')?.addEventListener('click', async () => {
  const val = parseInt(document.getElementById('goMapIndex')?.value, 10);
  if (isNaN(val)) return;
  const ok = await confirmModal('Change Map?', `Switch to map <b>#${val}</b> in the rotation?`, { confirmText: 'Change Map' });
  if (!ok) return;
  postJson('/api/admin/change_map', { index: val });
});

// Remove map
document.getElementById('btnRemoveMap')?.addEventListener('click', async () => {
  const val = parseInt(document.getElementById('removeMapIndex')?.value, 10);
  if (isNaN(val)) return;
  const ok = await confirmModal('Remove Map?', `Remove map <b>#${val}</b> from the rotation?`, { danger: true, confirmText: 'Remove' });
  if (!ok) return;
  postJson('/api/admin/remove_map', { index: val });
});

// Add map — populate mode dropdown when map is selected
document.getElementById('addMapName')?.addEventListener('change', () => {
  const mapSelect = document.getElementById('addMapName');
  const modeSelect = document.getElementById('addMapMode');
  if (!mapSelect || !modeSelect) return;

  const mapName = mapSelect.value;
  modeSelect.innerHTML = '';

  if (!mapName || !window._availableMaps) {
    modeSelect.innerHTML = '<option value="">— select map —</option>';
    return;
  }

  const modes = window._availableMaps[mapName] || [];
  if (modes.length === 0) {
    modeSelect.innerHTML = '<option value="">— no modes —</option>';
    return;
  }

  for (const m of modes) {
    const opt = document.createElement('option');
    opt.value = m;
    opt.textContent = m;
    modeSelect.appendChild(opt);
  }
});

// Add map — send
document.getElementById('btnAddMap')?.addEventListener('click', () => {
  const mapName = document.getElementById('addMapName')?.value;
  const gameType = document.getElementById('addMapMode')?.value;
  const position = parseInt(document.getElementById('addMapPos')?.value, 10);

  if (!mapName) { showToast('Select a map', 'err'); return; }
  if (!gameType) { showToast('Select a game mode', 'err'); return; }
  if (isNaN(position)) { showToast('Enter a position', 'err'); return; }

  postJson('/api/admin/add_map', { map_name: mapName, game_type: gameType, position: position });
});

/*
  ============================================================================
  Messenger Text
  ============================================================================
*/

function sendMessText(slot){
  const input = document.getElementById(`messtext${slot}`);
  if (!input) return;
  const text = input.value;
  postJson('/api/admin/messtext', { slot, text });
}

function sendAllMessText(){
  for (let i = 0; i < 3; i++){
    sendMessText(i);
  }
}

/*
  ============================================================================
  Live Players panel
  ============================================================================
*/

const adminPlayersWrap = document.getElementById('adminPlayersWrap');

function renderAdminPlayers(players){
  if (!adminPlayersWrap) return;

  if (!players || players.length === 0){
    adminPlayersWrap.innerHTML = `<div class="small">No players online.</div>`;
    return;
  }

  let html = `<table><thead><tr>`;
  html += `<th>Nickname</th><th>Ubi Name</th><th>Ping</th><th>Kills</th><th>Deaths</th><th></th>`;
  html += `</tr></thead><tbody>`;

  for (const p of players){
    const name = p.name || '—';
    const ubi = p.ubi || '—';
    const ping = p.ping != null ? p.ping : '—';
    const kills = p.kills != null ? p.kills : '—';
    const deaths = p.deaths != null ? p.deaths : '—';

    html += `<tr>`;
    html += `<td class="mono">${escapeHtml(name)}</td>`;
    html += `<td class="mono">${escapeHtml(ubi)}</td>`;
    html += `<td class="mono">${escapeHtml(ping)}</td>`;
    html += `<td class="mono">${escapeHtml(kills)}</td>`;
    html += `<td class="mono">${escapeHtml(deaths)}</td>`;
    if (p.ubi){
      html += `<td class="playerActions">`;
      html += `<button class="kickBtn" data-ubi="${escapeHtml(p.ubi)}" data-name="${escapeHtml(name)}">Kick</button>`;
      html += `<button class="banBtn" data-ubi="${escapeHtml(p.ubi)}" data-name="${escapeHtml(name)}">Ban</button>`;
      html += `</td>`;
    } else {
      html += `<td></td>`;
    }
    html += `</tr>`;
  }

  html += `</tbody></table>`;
  adminPlayersWrap.innerHTML = `<div class="tableClip">${html}</div>`;

  // Attach kick handlers
  adminPlayersWrap.querySelectorAll('.kickBtn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ubi = btn.getAttribute('data-ubi');
      const name = btn.getAttribute('data-name');
      const ok = await confirmModal('Kick Player?', `Kick <b>${escapeHtml(name)}</b> (${escapeHtml(ubi)})?`, { danger: true, confirmText: 'Kick' });
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '…';
      postJson('/api/admin/kick', { ubi });
    });
  });

  // Attach ban handlers
  adminPlayersWrap.querySelectorAll('.banBtn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const ubi = btn.getAttribute('data-ubi');
      const name = btn.getAttribute('data-name');
      const ok = await confirmModal(
        '⚠️ Ban Player?',
        `Permanently ban <b>${escapeHtml(name)}</b> (${escapeHtml(ubi)})?<br><br>This persists across server restarts and will REALLY piss off the server admin if you want to undo it later.`,
        { danger: true, confirmText: 'Ban Permanently' }
      );
      if (!ok) return;
      btn.disabled = true;
      btn.textContent = '…';
      postJson('/api/admin/ban', { ubi });
    });
  });
}

async function refreshAdminPlayers(){
  if (!adminPlayersWrap) return;

  try{
    const r = await fetch('/api/query', { cache: 'no-store' });
    const data = await r.json();

    if (!data.ok){
      adminPlayersWrap.innerHTML = `<div class="small">Error: ${escapeHtml(data.error || 'unknown')}</div>`;
      return;
    }

    renderAdminPlayers(data.players || []);
  } catch(e){
    adminPlayersWrap.innerHTML = `<div class="small">Fetch error: ${escapeHtml(String(e))}</div>`;
  }
}

/*
  ============================================================================
  Player Merge UI
  ============================================================================
*/

const candidatesWrap = document.getElementById('candidatesWrap');
const aliasesWrap = document.getElementById('aliasesWrap');
const btnFetchCandidates = document.getElementById('btnFetchCandidates');
const btnFetchAliases = document.getElementById('btnFetchAliases');

function ensureMergeStyles(){
  if (document.getElementById('mergeStyles')) return;
  const style = document.createElement('style');
  style.id = 'mergeStyles';
  style.textContent = `.mergeGroup{
      margin-bottom: 14px;
      background: var(--card2, rgba(255,255,255,0.08));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 14px;
    }.mergeGroup:last-child{
      margin-bottom: 0;
    }.mergeGroupHeader{
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: baseline;
      margin-bottom: 10px;
    }.mergeGroupName{
      font-weight: 800;
      font-size: 14px;
      color: rgba(255,255,255,0.92);
    }.mergeGroupMeta{
      font-size: 11px;
      color: rgba(255,255,255,0.5);
    }.mergeTable{
      width: 100%;
      border-collapse: collapse;
    }.mergeTable th,.mergeTable td{
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 11px;
    }.mergeTable th{
      color: rgba(255,255,255,0.5);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing:.2px;
      font-size: 10px;
    }.mergeTable tr:hover td{
      background: rgba(255,255,255,0.03);
    }.mergeCheck{
      width: 16px;
      height: 16px;
      cursor: pointer;
    }.mergeBtnWrap{
      margin-top: 10px;
      display: flex;
      gap: 8px;
      align-items: center;
    }.mergeBtn{
      padding: 6px 14px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 8px;
      background: rgba(53, 208, 127, 0.15);
      color: #35d07f;
      cursor: pointer;
      font-size: 11px;
      font-weight: 700;
    }.mergeBtn:hover{
      background: rgba(53, 208, 127, 0.25);
    }.mergeBtn:disabled{
      opacity: 0.4;
      cursor: not-allowed;
    }.mergeSelectAll{
      font-size: 11px;
      color: var(--link, #8ab4ff);
      cursor: pointer;
      border: none;
      background: none;
      padding: 0;
      text-decoration: underline;
    }.mergeStatus{
      font-size: 11px;
      margin-left: 8px;
    }.mergeStatusOk{ color: #35d07f; }.mergeStatusErr{ color: #ff6b6b; }.aliasRow{
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 12px;
    }.aliasRow:last-child{
      border-bottom: none;
    }.aliasUbi{
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      font-size: 11px;
    }.aliasArrow{
      color: rgba(255,255,255,0.35);
      font-size: 11px;
    }.aliasRemoveBtn{
      padding: 3px 10px;
      border: 1px solid rgba(255,107,107,0.3);
      border-radius: 6px;
      background: rgba(255,107,107,0.1);
      color: #ff6b6b;
      cursor: pointer;
      font-size: 10px;
      font-weight: 700;
      margin-left: auto;
    }.aliasRemoveBtn:hover{
      background: rgba(255,107,107,0.2);
    }
  `;
  document.head.appendChild(style);
}

async function fetchCandidates(){
  if (!candidatesWrap) return;
  candidatesWrap.innerHTML = `<div class="small">Loading…</div>`;

  try{
    const r = await fetch('/api/admin/merge_candidates', { cache: 'no-store' });
    const j = await r.json();

    if (!j.ok){
      candidatesWrap.innerHTML = `<div class="small">Error: ${escapeHtml(j.error || 'unknown')}</div>`;
      return;
    }

    const candidates = j.candidates || [];
    if (candidates.length === 0){
      candidatesWrap.innerHTML = `<div class="small">No merge candidates detected. All accounts look clean.</div>`;
      return;
    }

    ensureMergeStyles();

    let html = '';
    for (let gi = 0; gi < candidates.length; gi++){
      const g = candidates[gi];
      const canon = g.canonical || {};
      const aliases = g.aliases || [];
      const groupId = `mergeGroup_${gi}`;

      html += `<div class="mergeGroup" id="${groupId}">`;
      html += `<div class="mergeGroupHeader">`;
      html += `<span class="mergeGroupName">${escapeHtml(g.base_name)}</span>`;
      html += `<span class="mergeGroupMeta">server: ${escapeHtml(g.server_ident)}</span>`;
      html += `<span class="mergeGroupMeta">canonical: <b>${escapeHtml(canon.ubi)}</b> (id ${canon.player_id}, ${canon.rounds} rounds)</span>`;
      html += `</div>`;

      html += `<table class="mergeTable">`;
      html += `<thead><tr>`;
      html += `<th style="width:30px;"><input type="checkbox" class="mergeCheck mergeSelectAllCheck" data-group="${gi}" title="Select all"></th>`;
      html += `<th>Alias Ubi</th><th>Player ID</th><th>Rounds</th>`;
      html += `</tr></thead><tbody>`;

      for (const a of aliases){
        html += `<tr>`;
        html += `<td><input type="checkbox" class="mergeCheck mergeAliasCheck" data-group="${gi}" data-player-id="${a.player_id}" data-canonical-id="${canon.player_id}"></td>`;
        html += `<td class="mono">${escapeHtml(a.ubi)}</td>`;
        html += `<td class="mono">${a.player_id}</td>`;
        html += `<td class="mono">${a.rounds}</td>`;
        html += `</tr>`;
      }

      html += `</tbody></table>`;

      html += `<div class="mergeBtnWrap">`;
      html += `<button class="mergeBtn" data-group="${gi}" data-canonical-id="${canon.player_id}">Merge selected</button>`;
      html += `<span class="mergeStatus" id="mergeStatus_${gi}"></span>`;
      html += `</div>`;

      html += `</div>`;
    }

    candidatesWrap.innerHTML = html;

    // Select-all checkboxes
    candidatesWrap.querySelectorAll('.mergeSelectAllCheck').forEach(el => {
      el.addEventListener('change', () => {
        const group = el.getAttribute('data-group');
        const checked = el.checked;
        candidatesWrap.querySelectorAll(`.mergeAliasCheck[data-group="${group}"]`).forEach(cb => {
          cb.checked = checked;
        });
      });
    });

    // Merge buttons
    candidatesWrap.querySelectorAll('.mergeBtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const group = btn.getAttribute('data-group');
        const canonicalId = parseInt(btn.getAttribute('data-canonical-id'), 10);
        const statusEl = document.getElementById(`mergeStatus_${group}`);

        const checked = candidatesWrap.querySelectorAll(`.mergeAliasCheck[data-group="${group}"]:checked`);
        const aliasIds = Array.from(checked).map(cb => parseInt(cb.getAttribute('data-player-id'), 10));

        if (aliasIds.length === 0){
          if (statusEl){
            statusEl.className = 'mergeStatus mergeStatusErr';
            statusEl.textContent = 'No aliases selected.';
          }
          return;
        }

        btn.disabled = true;
        if (statusEl){
          statusEl.className = 'mergeStatus';
          statusEl.textContent = 'Merging…';
        }

        try{
          const r = await fetch('/api/admin/merge_apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              canonical_player_id: canonicalId,
              alias_player_ids: aliasIds,
            }),
          });
          const j = await r.json();

          if (j.ok){
            if (statusEl){
              statusEl.className = 'mergeStatus mergeStatusOk';
              statusEl.textContent = `✓ Merged ${j.created} alias(es).`;
            }
            // Disable merged checkboxes
            checked.forEach(cb => {
              cb.checked = false;
              cb.disabled = true;
              const row = cb.closest('tr');
              if (row) row.style.opacity = '0.4';
            });
          } else {
            if (statusEl){
              statusEl.className = 'mergeStatus mergeStatusErr';
              statusEl.textContent = `Error: ${j.error || 'unknown'}`;
            }
          }
        } catch(e){
          if (statusEl){
            statusEl.className = 'mergeStatus mergeStatusErr';
            statusEl.textContent = `Fetch error: ${String(e)}`;
          }
        } finally {
          btn.disabled = false;
        }
      });
    });

  } catch(e){
    candidatesWrap.innerHTML = `<div class="small">Fetch error: ${escapeHtml(String(e))}</div>`;
  }
}

async function fetchAliases(){
  if (!aliasesWrap) return;
  aliasesWrap.innerHTML = `<div class="small">Loading…</div>`;

  try{
    const r = await fetch('/api/admin/aliases', { cache: 'no-store' });
    const j = await r.json();

    if (!j.ok){
      aliasesWrap.innerHTML = `<div class="small">Error: ${escapeHtml(j.error || 'unknown')}</div>`;
      return;
    }

    const aliases = j.aliases || [];
    if (aliases.length === 0){
      aliasesWrap.innerHTML = `<div class="small">No active aliases. Merge some candidates above to create them.</div>`;
      return;
    }

    ensureMergeStyles();

    let html = '';
    for (const a of aliases){
      const aliasUbi = a.alias_ubi || a.alias_player_id || '?';
      const canonUbi = a.canonical_ubi || a.canonical_player_id || '?';
      const aliasId = a.alias_player_id;

      html += `<div class="aliasRow">`;
      html += `<span class="aliasUbi">${escapeHtml(aliasUbi)}</span>`;
      html += `<span class="aliasArrow">→</span>`;
      html += `<span class="aliasUbi">${escapeHtml(canonUbi)}</span>`;
      html += `<button class="aliasRemoveBtn" data-alias-id="${aliasId}">Remove</button>`;
      html += `</div>`;
    }

    aliasesWrap.innerHTML = html;

    // Remove buttons
    aliasesWrap.querySelectorAll('.aliasRemoveBtn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const aliasId = parseInt(btn.getAttribute('data-alias-id'), 10);
        btn.disabled = true;
        btn.textContent = '…';

        try{
          const r = await fetch('/api/admin/merge_remove', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alias_player_id: aliasId }),
          });
          const j = await r.json();

          if (j.ok){
            const row = btn.closest('.aliasRow');
            if (row){
              row.style.opacity = '0.3';
              row.style.pointerEvents = 'none';
            }
            btn.textContent = '✓ Removed';
          } else {
            btn.textContent = 'Error';
            btn.disabled = false;
          }
        } catch(e){
          btn.textContent = 'Error';
          btn.disabled = false;
        }
      });
    });

  } catch(e){
    aliasesWrap.innerHTML = `<div class="small">Fetch error: ${escapeHtml(String(e))}</div>`;
  }
}

/*
  ============================================================================
  Ban List UI
  ============================================================================
*/

const banListWrap = document.getElementById('banListWrap');
const btnFetchBanList = document.getElementById('btnFetchBanList');

function renderBanList(banlist){
  if (!banListWrap) return;

  const bans = banlist?.bans || [];
  const count = banlist?.count || 0;

  if (bans.length === 0){
    banListWrap.innerHTML = `<div class="small">No bans found on the server.</div>`;
    return;
  }

  let html = `<div class="small" style="margin-bottom:8px; color: rgba(255,255,255,0.5);">${count} ban(s) on server</div>`;
  html += `<div class="tableClip"><table><thead><tr>`;
  html += `<th>#</th><th>Type</th><th>Value</th>`;
  html += `</tr></thead><tbody>`;

  for (const b of bans){
    const typeLabel = b.type === 'guid' ? 'GUID' : b.type === 'ip' ? 'IP' : '?';
    const typeClass = b.type === 'guid' ? '' : b.type === 'ip' ? ' style="color: orange;"' : '';

    html += `<tr>`;
    html += `<td class="mono">${b.index}</td>`;
    html += `<td class="mono"${typeClass}>${escapeHtml(typeLabel)}</td>`;
    html += `<td class="mono">${escapeHtml(b.value)}</td>`;
    html += `</tr>`;
  }

  html += `</tbody></table></div>`;
  banListWrap.innerHTML = html;
}

btnFetchBanList?.addEventListener('click', async () => {
  if (!banListWrap) return;
  banListWrap.innerHTML = `<div class="small">Loading…</div>`;

  try{
    const r = await fetch('/api/admin/banlist', { cache: 'no-store' });
    const j = await r.json();

    if (!j.ok){
      banListWrap.innerHTML = `<div class="small">Error: ${escapeHtml(j.error || 'unknown')}</div>`;
      return;
    }

    renderBanList(j.banlist || {});
  } catch(e){
    banListWrap.innerHTML = `<div class="small">Fetch error: ${escapeHtml(String(e))}</div>`;
  }
});

/*
  ============================================================================
  Init
  ============================================================================
*/

btnFetchCandidates?.addEventListener('click', fetchCandidates);
btnFetchAliases?.addEventListener('click', fetchAliases);

// Initial fetch + auto-refresh every 5 seconds
refreshAdminPlayers();
setInterval(refreshAdminPlayers, 5000);