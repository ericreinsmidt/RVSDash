/*
==============================================================================
File: app/web/js/admin.js
Project: RVSDash - Raven Shield Dashboard
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

const btnSetServerName = document.getElementById('btnSetServerName');
const serverName = document.getElementById('serverName');

const btnSetRoundsPerMatch = document.getElementById('btnSetRoundsPerMatch');
const roundsPerMatch = document.getElementById('roundsPerMatch');

const btnSetBombTime = document.getElementById('btnSetBombTime');
const bombTime = document.getElementById('bombTime');

const btnSetBetweenRoundTime = document.getElementById('btnSetBetweenRoundTime');
const betweenRoundTime = document.getElementById('betweenRoundTime');

const btnSetTerrorCount = document.getElementById('btnSetTerrorCount');
const terrorCount = document.getElementById('terrorCount');

const btnSetSpamThreshold = document.getElementById('btnSetSpamThreshold');
const spamThreshold = document.getElementById('spamThreshold');

const btnSetChatLockDuration = document.getElementById('btnSetChatLockDuration');
const chatLockDuration = document.getElementById('chatLockDuration');

const btnSetVoteBroadcastFreq = document.getElementById('btnSetVoteBroadcastFreq');
const voteBroadcastFreq = document.getElementById('voteBroadcastFreq');

const boolOptionsWrap = document.getElementById('boolOptionsWrap');
const camOptionsWrap = document.getElementById('camOptionsWrap');

async function postJson(url, body, successMsg){
  if (cmdOut){
    cmdOut.textContent = JSON.stringify({sending:true, url, body}, null, 2);
  }
  const label = url.split('/').pop();
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
      showToast(successMsg || `✓ ${label} — command sent`, 'ok');
    } else {
      showToast(`✗ ${label} — ${j.error || 'failed'}`, 'err', 5000);
    }
  } catch (e){
    if (cmdOut){
      cmdOut.textContent = JSON.stringify({ok:false, error:String(e)}, null, 2);
    }
    showToast(`✗ ${label} — ${String(e)}`, 'err', 5000);
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
  postJson('/api/admin/restart', {}, '✓ Server restart command sent');
});

btnSetRT?.addEventListener('click', () => {
  postJson('/api/admin/set_rt', { seconds: Number(rtSeconds.value) }, `✓ Round time set to ${rtSeconds.value}s`);
});

btnSetMOTD?.addEventListener('click', () => {
  postJson('/api/admin/set_motd', { motd: motdText.value }, `✓ MOTD set to "${motdText.value}"`);
});

btnLoadINI?.addEventListener('click', () => {
  postJson('/api/admin/load_ini', { inifile: iniName.value }, `✓ Loading map list: ${iniName.value}`);
});

btnSay?.addEventListener('click', () => {
  postJson('/api/admin/say', { msg: (sayText?.value || '') }, '✓ Message sent');
});

btnSetDiff?.addEventListener('click', () => {
  const lvl = Number(diffLevel?.value ?? 0);
  postJson('/api/admin/set_diff_level', { level: lvl }, `✓ Difficulty set to ${['', 'Recruit', 'Veteran', 'Elite'][lvl] || lvl}`);
});

btnSetServerName?.addEventListener('click', () => {
  postJson('/api/admin/set_server_name', { name: (serverName?.value || '') }, `✓ Server name set to "${serverName?.value}"`);
});

btnSetRoundsPerMatch?.addEventListener('click', () => {
  postJson('/api/admin/set_rounds_per_match', { rounds: Number(roundsPerMatch.value) }, `✓ Rounds per match set to ${roundsPerMatch.value}`);
});

btnSetBombTime?.addEventListener('click', () => {
  postJson('/api/admin/set_bomb_time', { seconds: Number(bombTime.value) }, `✓ Bomb time set to ${bombTime.value}s`);
});

btnSetBetweenRoundTime?.addEventListener('click', () => {
  postJson('/api/admin/set_between_round_time', { seconds: Number(betweenRoundTime.value) }, `✓ Between-round time set to ${betweenRoundTime.value}s`);
});

btnSetTerrorCount?.addEventListener('click', () => {
  postJson('/api/admin/set_terror_count', { count: Number(terrorCount.value) }, `✓ Terrorist count set to ${terrorCount.value}`);
});

btnSetSpamThreshold?.addEventListener('click', () => {
  postJson('/api/admin/set_spam_threshold', { value: Number(spamThreshold.value) }, `✓ Spam threshold set to ${spamThreshold.value}`);
});

btnSetChatLockDuration?.addEventListener('click', () => {
  postJson('/api/admin/set_chat_lock_duration', { value: Number(chatLockDuration.value) }, `✓ Chat lock duration set to ${chatLockDuration.value}`);
});

btnSetVoteBroadcastFreq?.addEventListener('click', () => {
  postJson('/api/admin/set_vote_broadcast_freq', { value: Number(voteBroadcastFreq.value) }, `✓ Vote broadcast frequency set to ${voteBroadcastFreq.value}`);
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
  postJson('/api/admin/restart_match', {}, '✓ Match restarted');
});

// Restart round
document.getElementById('btnRestartRound')?.addEventListener('click', async () => {
  const ok = await confirmModal('Restart Round?', 'This will restart the current round.', { confirmText: 'Restart Round' });
  if (!ok) return;
  postJson('/api/admin/restart_round', {}, '✓ Round restarted');
});

// Messenger toggle
document.getElementById('btnMessengerToggle')?.addEventListener('click', () => {
  postJson('/api/admin/messenger_toggle', {}, '✓ Messenger toggled');
});

// Set max players
document.getElementById('btnSetMaxPlayers')?.addEventListener('click', () => {
  const val = parseInt(document.getElementById('maxPlayers')?.value, 10);
  if (isNaN(val)) return;
  postJson('/api/admin/set_max_players', { max_players: val }, `✓ Max players set to ${val}`);
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
  postJson('/api/admin/lock_server', { password: pw }, pw ? '✓ Game password set' : '✓ Game password disabled');
});

// Save INI
document.getElementById('btnSaveINI')?.addEventListener('click', () => {
  const val = document.getElementById('saveIniName')?.value?.trim();
  if (!val) { showToast('Enter a filename', 'err'); return; }
  postJson('/api/admin/save_ini', { inifile: val }, `✓ Map list saved: ${val}`);
});

// Go to map
document.getElementById('btnGoMap')?.addEventListener('click', async () => {
  const val = parseInt(document.getElementById('goMapIndex')?.value, 10);
  if (isNaN(val)) return;
  const ok = await confirmModal('Change Map?', `Switch to map <b>#${val}</b> in the rotation?`, { confirmText: 'Change Map' });
  if (!ok) return;
  postJson('/api/admin/change_map', { index: val }, `✓ Changing to map #${val}`);
});

// Remove map
document.getElementById('btnRemoveMap')?.addEventListener('click', async () => {
  const val = parseInt(document.getElementById('removeMapIndex')?.value, 10);
  if (isNaN(val)) return;
  const ok = await confirmModal('Remove Map?', `Remove map <b>#${val}</b> from the rotation?`, { danger: true, confirmText: 'Remove' });
  if (!ok) return;
  postJson('/api/admin/remove_map', { index: val }, `✓ Removed map #${val}`);
});

// Clear rotation (remove maps 2 through N)
document.getElementById('btnClearRotation')?.addEventListener('click', async () => {
  const count = parseInt(document.getElementById('clearRotationCount')?.value, 10);
  if (isNaN(count) || count < 2) {
    showToast('Enter the total number of maps in rotation (at least 2)', 'err');
    return;
  }
  const ok = await confirmModal(
    'Clear Map Rotation?',
    `This will remove <b>${count - 1}</b> map(s), leaving only map #1 in the rotation.`,
    { danger: true, confirmText: 'Clear Rotation' }
  );
  if (!ok) return;
  postJson('/api/admin/clear_rotation', { count }, `✓ Cleared rotation (removed ${count - 1} maps)`);
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

  postJson('/api/admin/add_map', { map_name: mapName, game_type: gameType, position: position }, `✓ Added ${mapName} (${gameType}) at position ${position}`);
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
  return postJson('/api/admin/messtext', { slot, text }, `✓ Messenger line ${slot + 1} updated`);
}

async function sendAllMessText(){
  for (let i = 0; i < 3; i++){
    await sendMessText(i);
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
      postJson('/api/admin/kick', { ubi }, `✓ Kicked ${name}`);
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
      postJson('/api/admin/ban', { ubi }, `✓ Banned ${name}`);
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
  Boolean Server Options
  ============================================================================
*/

const BOOL_OPTIONS = [
  { option: 'FriendlyFire',       label: 'Friendly Fire' },
  { option: 'Autobalance',        label: 'Auto Team Balance' },
  { option: 'AllowRadar',         label: 'Allow Radar' },
  { option: 'ShowNames',          label: 'Show Team Names' },
  { option: 'TeamKillerPenalty',  label: 'Team Killer Penalty' },
  { option: 'RotateMap',          label: 'Rotate Map' },
  { option: 'AIBkp',              label: 'AI Backup' },
  { option: 'ForceFPersonWeapon', label: 'Force First Person Weapon' },
];

const CAM_OPTIONS = [
  { option: 'CamFirstPerson',     label: 'First Person' },
  { option: 'CamThirdPerson',     label: 'Third Person' },
  { option: 'CamFreeThirdP',      label: 'Free Third Person' },
  { option: 'CamGhost',           label: 'Ghost' },
  { option: 'CamFadeToBlack',     label: 'Fade to Black' },
  { option: 'CamTeamOnly',        label: 'Team Only' },
];

function renderOptionToggles(container, options, serverKv){
  if (!container) return;

  const KV_TO_OPTION = {
    Y1: 'FriendlyFire',
    Z1: 'Autobalance',
    B2: 'AllowRadar',
    W1: 'ShowNames',
    A2: 'TeamKillerPenalty',
    J2: 'RotateMap',
    I2: 'AIBkp',
    K2: 'ForceFPersonWeapon',
    C1: 'CamFirstPerson',
    C3: 'CamThirdPerson',
    CP: 'CamFreeThirdP',
    CG: 'CamGhost',
    CF: 'CamFadeToBlack',
    CT: 'CamTeamOnly',
  };

  const currentValues = {};
  if (serverKv){
    for (const [kvKey, optName] of Object.entries(KV_TO_OPTION)){
      const raw = serverKv[kvKey];
      if (raw !== undefined){
        currentValues[optName] = (String(raw) === '1');
      }
    }
  }

  let html = '';
  for (const { option, label } of options){
    const current = currentValues[option];
    const statusText = current === true ? 'ON' : current === false ? 'OFF' : '?';
    const statusClass = current === true ? 'boolOn' : current === false ? 'boolOff' : 'boolUnknown';

    html += `<div class="row">`;
    html += `<div>`;
    html += `<div class="small"><b>${escapeHtml(label)}</b></div>`;
    html += `<div class="small">Current: <span class="${statusClass}">${statusText}</span></div>`;
    html += `</div>`;
    html += `<div class="rowControls">`;
    html += `<button class="boolToggleBtn" data-option="${escapeHtml(option)}" data-set="true">On</button>`;
    html += `<button class="boolToggleBtn" data-option="${escapeHtml(option)}" data-set="false">Off</button>`;
    html += `</div>`;
    html += `</div>`;
  }

  container.innerHTML = html;

  container.querySelectorAll('.boolToggleBtn').forEach(btn => {
    btn.addEventListener('click', () => {
      const option = btn.getAttribute('data-option');
      const value = btn.getAttribute('data-set') === 'true';
      const label = btn.closest('.row')?.querySelector('b')?.textContent || option;
      postJson('/api/admin/set_server_option_bool', { option, value }, `✓ ${label} set to ${value ? 'ON' : 'OFF'}`);
    });
  });
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

// Fetch server KV data to populate boolean option current values
async function initBoolOptions(){
  try{
    const r = await fetch('/api/query', { cache: 'no-store' });
    const data = await r.json();
    const kv = data.ok ? (data.kv || {}) : null;
    renderOptionToggles(boolOptionsWrap, BOOL_OPTIONS, kv);
    renderOptionToggles(camOptionsWrap, CAM_OPTIONS, kv);
  } catch(e){
    renderOptionToggles(boolOptionsWrap, BOOL_OPTIONS, null);
    renderOptionToggles(camOptionsWrap, CAM_OPTIONS, null);
  }
}
initBoolOptions();