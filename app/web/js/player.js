/*
==============================================================================
File: app/web/js/player.js
Project: RVSDash - Raven Shield Dashboard
Purpose:
- Per-player detail page behavior.
- Reads ?ubi= from URL, fetches /api/stats/player_detail, renders breakdown.
==============================================================================
*/


const pageTitle = document.getElementById('pageTitle');
const playerStatus = document.getElementById('playerStatus');
const summaryWrap = document.getElementById('summaryWrap');
const identityWrap = document.getElementById('identityWrap');
const byMapWrap = document.getElementById('byMapWrap');
const byModeWrap = document.getElementById('byModeWrap');

// NOTE: COL_LABEL_MAP also defined in stats.js — keep in sync
const COL_LABEL_MAP = {
  map: 'Map',
  game_mode: 'Game Mode',
  kills: 'Kills',
  deaths: 'Deaths',
  fired: 'Fired',
  hits: 'Hits',
  rounds_played: 'Rounds',
};

// NOTE: renderTable also defined in stats.js — keep in sync
function renderTable(wrap, cols, rows){
  if (!wrap) return;
  if (!rows || rows.length === 0){
    wrap.innerHTML = `<div class="small">(none)</div>`;
    return;
  }
  const numCols = ['kills','deaths','fired','hits','rounds_played'];
  let html = `<div class="tableClip"><table><thead><tr>`;
  html += cols.map(c => `<th>${escapeHtml(COL_LABEL_MAP[c] || c)}</th>`).join('');
  html += `</tr></thead><tbody>`;
  for (const r of rows){
    html += `<tr>`;
    html += cols.map(c => {
      const val = r?.[c];
      const isNum = numCols.includes(c);
      let display = isNum && val != null ? Number(val).toLocaleString() : val;
      if (c === 'game_mode' && val) display = gameModeName(val) || val;
      const cls = isNum ? 'mono num' : 'mono';
      return `<td class="${cls}">${escapeHtml(display)}</td>`;
    }).join('');
    html += `</tr>`;
  }
  html += `</tbody></table></div>`;
  wrap.innerHTML = html;
}

function renderSummary(totals){
  if (!summaryWrap) return;

  const rows = [
    ['Score', Number(totals.score).toLocaleString()],
    ['Kills', Number(totals.kills).toLocaleString()],
    ['Deaths', Number(totals.deaths).toLocaleString()],
    ['K/D Ratio', String(totals.kd_ratio)],
    ['Rounds Fired', Number(totals.fired).toLocaleString()],
    ['Hits', Number(totals.hits).toLocaleString()],
    ['Accuracy', totals.accuracy + '%'],
    ['Rounds Played', Number(totals.rounds_played).toLocaleString()],
  ];

  let html = '';
  for (const [label, val] of rows){
    html +=
      `<div class="row">` +
        `<div class="k">${escapeHtml(label)}</div>` +
        `<div class="v mono">${escapeHtml(val)}</div>` +
      `</div>`;
  }
  summaryWrap.innerHTML = html;
}

function renderIdentity(data){
  if (!identityWrap) return;

  const nicks = data.nicks || [];
  const aliases = data.aliases || [];

  let html = '';

  // Nicknames
  html += `<div class="row" style="flex-direction:column;align-items:flex-start;">`;
  html += `<div class="k">Nicknames</div>`;
  if (nicks.length > 0){
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">`;
    for (const n of nicks){
      html += `<span class="tag">${escapeHtml(n)}</span>`;
    }
    html += `</div>`;
  } else {
    html += `<div class="small" style="margin-top:4px;">No nicknames recorded</div>`;
  }
  html += `</div>`;

  // Linked accounts
  if (aliases.length > 0){
    html += `<div class="row" style="flex-direction:column;align-items:flex-start;">`;
    html += `<div class="k">Linked Accounts</div>`;
    html += `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px;">`;
    for (const a of aliases){
      html += `<span class="tag mono">${escapeHtml(a)}</span>`;
    }
    html += `</div>`;
    html += `</div>`;
  }

  // Server
  if (data.server_ident){
    html += `<div class="row">`;
    html += `<div class="k">Server</div>`;
    html += `<div class="v mono">${escapeHtml(data.server_ident)}</div>`;
    html += `</div>`;
  }

  identityWrap.innerHTML = html;
}

async function loadPlayer(){
  const params = new URLSearchParams(window.location.search);
  const ubi = params.get('ubi') || '';
  const si = params.get('server_ident') || '';

  if (!ubi){
    if (pageTitle) pageTitle.textContent = 'Player Detail';
    document.title = 'Player Detail';
    if (playerStatus) playerStatus.textContent = 'No player specified';
    if (summaryWrap) summaryWrap.innerHTML = `<div class="row"><div class="k">Error</div><div class="v">No ?ubi= parameter in URL</div></div>`;
    if (identityWrap) identityWrap.innerHTML = '';
    if (byMapWrap) byMapWrap.innerHTML = '';
    if (byModeWrap) byModeWrap.innerHTML = '';
    return;
  }

  if (pageTitle) pageTitle.textContent = ubi;
  document.title = `${ubi} — Player Detail`;

  try {
    const q = new URLSearchParams();
    q.set('ubi', ubi);
    if (si) q.set('server_ident', si);

    const r = await fetch(`/api/stats/player_detail?${q.toString()}`, { cache: 'no-store' });
    const j = await r.json();

    if (!j.ok){
      if (playerStatus) playerStatus.textContent = `Error: ${j.error || 'unknown'}`;
      return;
    }

    if (!j.found){
      if (playerStatus) playerStatus.textContent = 'Player not found';
      if (summaryWrap) summaryWrap.innerHTML = `<div class="row"><div class="k">Status</div><div class="v">No data for "${escapeHtml(ubi)}"</div></div>`;
      if (identityWrap) identityWrap.innerHTML = '';
      if (byMapWrap) byMapWrap.innerHTML = `<div class="small">(none)</div>`;
      if (byModeWrap) byModeWrap.innerHTML = `<div class="small">(none)</div>`;
      return;
    }

    // Update page title to canonical ubi
    if (pageTitle) pageTitle.textContent = j.ubi;
    document.title = `${j.ubi} — Player Detail`;

    renderSummary(j.totals);
    renderIdentity(j);
    renderTable(byMapWrap, ['map','kills','deaths','fired','hits','rounds_played'], j.by_map || []);
    renderTable(byModeWrap, ['game_mode','kills','deaths','fired','hits','rounds_played'], j.by_mode || []);

  } catch (e){
    if (playerStatus) playerStatus.textContent = `Fetch error: ${String(e)}`;
  }
}

loadPlayer();