/*
==============================================================================
File: app/web/js/common.js
Project: RVSDash - Raven Shield Dashboard
Purpose:
- Shared utility functions used across status.js, stats.js, and admin.js.
- Single source of truth for escapeHtml and other common helpers.
==============================================================================
*/

/**
 * Basic HTML escape for user/server-provided strings.
 * Prevents XSS when inserting dynamic content via innerHTML.
 */
function escapeHtml(s){
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}

/*
  Game mode friendly name mapping.
  Shared across status, stats, and player pages.
*/
const GAME_MODE_NAME_MAP = {
  RGM_MissionMode: 'Mission',
  RGM_HostageRescueCoopMode: 'Hostage Rescue (Co-op)',
  RGM_TerroristHuntCoopMode: 'Terrorist Hunt (Co-op)',
  RGM_HostageRescueAdvMode: 'Hostage Rescue (Adversarial)',
  RGM_DeathmatchMode: 'Deathmatch',
  RGM_TeamDeathmatchMode: 'Team Deathmatch',
  RGM_BombAdvMode: 'Bomb (Adversarial)',
  RGM_EscortAdvMode: 'Escort (Adversarial)',
  RGM_TerroristHuntAdvMode: 'Terrorist Hunt (Adversarial)',
  RGM_ScatteredHuntAdvMode: 'Scattered Hunt (Adversarial)',
  RGM_CaptureTheEnemyAdvMode: 'Capture the Enemy (Adversarial)',
  RGM_CountDownMode: 'Count Down',
  RGM_KamikazeMode: 'Kamikaze',
};

function gameModeName(raw){
  const id = (raw ?? '').toString().trim();
  if (!id) return '';
  if (GAME_MODE_NAME_MAP[id]) return GAME_MODE_NAME_MAP[id];
  let s = id;
  s = s.replace(/^RGM_/, '');
  s = s.replace(/Mode$/, '');
  s = s.replace(/Adv$/, 'Adversarial');
  s = s.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  s = s.replace(/([0-9])([A-Za-z])/g, '$1 $2');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/\bAdv\b/g, 'Adversarial');
  s = s.replace(/\bAdv Mode\b/g, 'Adversarial');
  return s;
}

/*
  Toast notification system.
  Usage: showToast('Command sent!', 'ok')   — green
         showToast('Failed!', 'err')        — red
*/

function _ensureToastContainer(){
  let c = document.getElementById('toastContainer');
  if (c) return c;
  c = document.createElement('div');
  c.id = 'toastContainer';
  c.className = 'toastContainer';
  document.body.appendChild(c);
  return c;
}

function showToast(message, type, durationMs){
  type = type || 'ok';
  durationMs = durationMs || 3000;

  const container = _ensureToastContainer();
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = message;

  container.appendChild(el);

  // Click to dismiss early
  el.addEventListener('click', () => {
    el.classList.add('fadeOut');
    setTimeout(() => el.remove(), 300);
  });

  // Auto-dismiss
  setTimeout(() => {
    if (!el.parentNode) return;
    el.classList.add('fadeOut');
    setTimeout(() => el.remove(), 300);
  }, durationMs);
}

/*
  ============================================================================
  Custom confirm modal — replaces browser confirm() dialogs.
  Returns a Promise<boolean>.

  Usage:
    const ok = await confirmModal('Restart Round?', 'This will restart the current round.');
    if (!ok) return;

  Options:
    confirmModal(title, message, { danger: true, confirmText: 'Ban', cancelText: 'Nevermind' })

  Note: title and message accept trusted HTML (e.g. <b>, <br>).
  Callers must escapeHtml() any user-derived content before passing it in.
  ============================================================================
*/

function confirmModal(title, message, opts = {}){
  return new Promise((resolve) => {
    const danger = opts.danger || false;
    const confirmText = opts.confirmText || 'Confirm';
    const cancelText = opts.cancelText || 'Cancel';

    const overlay = document.createElement('div');
    overlay.className = 'modalOverlay';

    overlay.innerHTML = `
      <div class="modalBox">
        <h3>${title}</h3>
        <p>${message}</p>
        <div class="modalActions">
          <button class="modalBtnCancel">${cancelText}</button>
          <button class="${danger ? 'modalBtnDanger' : 'modalBtnConfirm'}">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Trigger transition
    requestAnimationFrame(() => overlay.classList.add('active'));

    // Escape key to cancel
    function onKey(e){
      if (e.key === 'Escape') close(false);
    }
    document.addEventListener('keydown', onKey);

    function close(result){
      document.removeEventListener('keydown', onKey);
      overlay.classList.remove('active');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    }

    // Cancel button
    overlay.querySelector('.modalBtnCancel').addEventListener('click', () => close(false));

    // Confirm button
    const confirmBtn = overlay.querySelector('.modalBtnConfirm,.modalBtnDanger');
    confirmBtn.addEventListener('click', () => close(true));

    // Click outside to cancel
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) close(false);
    });
  });
}