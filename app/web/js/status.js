/*
==============================================================================
File: app/web/js/status.js
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

Purpose
- Client-side behavior for /status.
- Polls GET /api/query and renders:
  - server summary rows
  - players table (+ loadout overlay)
  - maplist with current-map highlight

Change:
- Add performant name remapping for weapons + gadgets using O(1) lookup tables.
- Add fallback “humanizer” so unmapped IDs still display nicely.
- Apply mappings inside the loadout panel renderer.
- Can fetch GET /api/admin/available_maps and render the same “Available maps + gametypes”
  table style used on /admin.
  - This endpoint performs an AVAILABLEMAPS UDP query; it does not send admin commands.
- Display both "Messenger" (TA/TB/TC combined) and "MotD" (MM) on the status page.
- This is purely a presentation change: backend already exposes server.message
  and server.motd (as requested previously).
- Display a more friendly "Game Mode" name by mapping known RGM_* tokens to
  human-friendly strings, similar to weapons/gadgets.
- Includes fallback humanization so unknown/rare modes still render nicely.
- Make server card labels more human-friendly (e.g., "server_name" -> "Server Name").
- Highlight the current map within the maplist (bold + green) so it stands out.
==============================================================================
*/

const serverRows = document.getElementById('serverRows');
const mapRows = document.getElementById('mapRows');
const playersWrap = document.getElementById('playersWrap');
const lastUpdate = document.getElementById('lastUpdate');
const dot = document.getElementById('dot');
const refreshBtn = document.getElementById('refreshBtn');
const rawKv = document.getElementById('rawKv');

/*
  ============================================================================
  Explicit mapping tables (fast path)
  ============================================================================
*/
const WEAPON_NAME_MAP = {
  // Requested test mapping
  "R6Description.R6DescPrimaryWeaponNone": 'Billy Badass (none)',
  BuckShotgunM1: 'M1 Shotgun (shot)',
  BuckShotgunSPAS12: 'SPAS-12 Shotgun (shot)',
  BuckShotgunUSAS12: 'SPAS-12 Shotgun (shot)',
  CMagAssaultAK47: 'AK-47 Assault Rifle',
  CMagAssaultAK74: 'AK-74 Assault Rifle',
  CMagAssaultAUG: 'AUG Assault Rifle',
  CMagAssaultFAL: 'FAL Assault Rifle',
  CMagAssaultFAMASG2: 'FAMAS G2 Assault Rifle',
  CMagAssaultFNC: 'FNC Assault Rifle',
  CMagAssaultG36K: 'G36K Assault Rifle',
  CMagAssaultG3A3: 'G3A3 Assault Rifle',
  CMagAssaultGalilARM: 'Galil ARM Assault Rifle',
  CMagAssaultL85A1: 'L85A1 Assault Rifle',
  CMagAssaultM14: 'M14 Assault Rifle',
  CMagAssaultM16A2: 'M16A2 Assault Rifle',
  CMagAssaultM4: 'M4 Assault Rifle',
  CMagAssaultM82: 'M82 Assault Rifle',
  CMagAssaultTAR21: 'TAR21 Assault Rifle',
  CMagAssaultType97: 'Type 97 Rifle',
  CMagPistol92FS: '92FS Pistol',
  CMagPistolAPArmy: 'AP Army Pistol',
  CMagPistolCZ61: 'CZ61 Pistol',
  CMagPistolDesertEagle357: 'Desert Eagle .357 Pistol',
  CMagPistolDesertEagle50: 'Desert Eagle .50 Pistol',
  CMagPistolMac119: 'Mac 119 Pistol',
  CMagPistolMicroUzi: 'Micro Uzi Pistol',
  CMagPistolMk23: 'Mk 23 Pistol',
  CMagPistolP228: 'P228 Pistol',
  CMagPistolSR2: 'SR2 Pistol',
  CMagPistolUSP: 'USP Pistol',
  CMagSubCZ61: 'CZ61 SMG',
  CMagSubM12S: 'M12 S SMG',
  CMagSubMac119: 'Mac 119 SMG',
  CMagSubMicroUzi: 'Micro Uzi SMG',
  CMagSubMP510A2: 'MP5 10A2 SMG',
  CMagSubMP5A4: 'MP4 A4 SMG',
  CMagSubMP5KPDW: 'MP5 KPDW SMG',
  CMagSubMP5SD5: 'MP5SD5  SMG',
  CMagSubMTAR21: 'MTAR21 SMG',
  CMagSubSR2: 'SR2 SMG',
  CMagSubTMP: 'TMP SMG',
  CMagSubUMP: 'UMP SMG',
  CMagSubUzi: 'Uzi SMG',
  NormalAssaultAK47: 'AK-47 Assault Rifle',
  NormalAssaultAK74: 'AK-74 Assault Rifle',
  NormalAssaultAUG: 'AUG Assault Rifle',
  NormalAssaultFAL: 'FAL Assault Rifle',
  NormalAssaultFAMASG2: 'FAMAS G2 Assault Rifle',
  NormalAssaultFNC: 'FNC Assault Rifle',
  NormalAssaultG36K: 'G36K Assault Rifle',
  NormalAssaultG3A3: 'G3A3 Assault Rifle',
  NormalAssaultGalilARM: 'Galil ARM Assault Rifle',
  NormalAssaultL85A1: 'L85A1 Assault Rifle',
  NormalAssaultM14: 'M14 Assault Rifle',
  NormalAssaultM16A2: 'M16A2 Assault Rifle',
  NormalAssaultM4: 'M4 Assault Rifle',
  NormalAssaultM82: 'M82 Assault Rifle',
  NormalAssaultTAR21: 'TAR21 Assault Rifle',
  NormalAssaultType97: 'Type 97 Rifle',
  NormalLMG21E: '21E LMG',
  NormalLMG23E: '23E LMG',
  NormalLMGM249: 'M249 LMG',
  NormalLMGM60E4: '60E4 LMG',
  NormalLMGRPD: 'RPD LMG',
  NormalPistol92FS: '92FS Pistol',
  NormalPistolAPArmy: 'AP Army Pistol',
  NormalPistolCZ61: 'CZ61 Pistol',
  NormalPistolDesertEagle357: 'Desert Eagle .357 Pistol',
  NormalPistolDesertEagle50: 'Desert Eagle .50 Pistol',
  NormalPistolMac119: 'Mac 119 Pistol',
  NormalPistolMicroUzi: 'Micro Uzi Pistol',
  NormalPistolMk23: 'Mk 23 Pistol',
  NormalPistolP228: 'P228 Pistol',
  NormalPistolSPP: 'SPP Pistol',
  NormalPistolSR2: 'SR2 Pistol',
  NormalPistolUSP: 'USP Pistol',
  NormalSniperDragunov: 'Dragunov Sniper Rifle',
  NormalSniperM82A1: 'M82A1 Sniper Rifle',
  NormalSniperPSG1: ' Sniper Rifle',
  NormalSniperSSG3000: 'SSG3000 Sniper Rifle',
  NormalSniperWA2000: 'WA2000 Sniper Rifle',
  NormalSubCZ61: 'CZ61 SMG',
  NormalSubM12S: 'M12 S SMG',
  NormalSubMac119: 'Mac 119 SMG',
  NormalSubMicroUzi: 'Micro Uzi SMG',
  NormalSubMP510A2: 'MP5 10A2 SMG',
  NormalSubMP5A4: 'MP4 A4 SMG',
  NormalSubMP5KPDW: 'MP5 KPDW SMG',
  NormalSubMTAR21: 'MTAR21 SMG',
  NormalSubP90: 'P90 SMG',
  NormalSubSR2: 'SR2 SMG',
  NormalSubTMP: 'TMP SMG',
  NormalSubUMP: 'UMP SMG',
  NormalSubUzi: 'Uzi SMG',
  SilencedAssaultAK47: 'AK-47 Assault Rifle',
  SilencedAssaultAK74: 'AK-74 Assault Rifle',
  SilencedAssaultAUG: 'AUG Assault Rifle',
  SilencedAssaultFAL: 'FAL Assault Rifle',
  SilencedAssaultFAMASG2: 'FAMAS G2 Assault Rifle',
  SilencedAssaultFNC: 'FNC Assault Rifle',
  SilencedAssaultG36K: 'G36K Assault Rifle',
  SilencedAssaultG3A3: 'G3A3 Assault Rifle',
  SilencedAssaultGalilARM: 'Galil ARM Assault Rifle',
  SilencedAssaultL85A1: 'L85A1 Assault Rifle',
  SilencedAssaultM14: 'M14 Assault Rifle',
  SilencedAssaultM16A2: 'M16A2 Assault Rifle',
  SilencedAssaultM4: 'M4 Assault Rifle',
  SilencedAssaultM82: 'M82 Assault Rifle',
  SilencedAssaultTAR21: 'TAR21 Assault Rifle',
  SilencedAssaultType97: 'Type 97 Rifle',
  SilencedPistol92FS: '92FS Pistol',
  SilencedPistolAPArmy: 'AP Army Pistol',
  SilencedPistolDesertEagle357: 'Desert Eagle .357 Pistol',
  SilencedPistolDesertEagle50: 'Desert Eagle .50 Pistol',
  SilencedPistolMk23: 'Mk 23 Pistol',
  SilencedPistolP228: 'P228 Pistol',
  SilencedPistolSPP: 'SPP Pistol',
  SilencedPistolUSP: 'USP Pistol',
  SilencedSniperAWCovert: 'AW Covert Sniper Rifle',
  SilencedSniperDragunov: 'Dragunov Sniper Rifle',
  SilencedSniperM82A1: 'M82A1 Sniper Rifle',
  SilencedSniperPSG1: ' Sniper Rifle',
  SilencedSniperSSG3000: 'SSG3000 Sniper Rifle',
  SilencedSniperVSSVintorez: 'VSS Vintorez Sniper Rifle',
  SilencedSniperWA2000: 'WA2000 Sniper Rifle',
  SilencedSubCZ61: 'CZ61 SMG',
  SilencedSubM12S: 'M12 S SMG',
  SilencedSubMac119: 'Mac 119 SMG',
  SilencedSubMicroUzi: 'Micro Uzi SMG',
  SilencedSubMP510A2: 'MP5 10A2 SMG',
  SilencedSubMP5A4: 'MP5 A4 SMG',
  SilencedSubMP5KPDW: 'MP5 KPDW SMG',
  SilencedSubMP5SD5: 'MP5SD5 SMG',
  SilencedSubMTAR21: 'MTAR SMG',
  SilencedSubP90: 'P90 SMG',
  SilencedSubSR2: 'SR2 SMG',
  SilencedSubTMP: 'TMP SMG',
  SilencedSubUMP: 'UMP SMG',
  SilencedSubUzi: 'Uzi SMG',
  SlugShotgunM1: 'M1 Shotgun (slug)',
  SlugShotgunSPAS12: 'SPAS-12 Shotgun (slug)',
  SlugShotgunUSAS12: 'USAS-12 Shotgun (slug)'
};

const GADGET_NAME_MAP = {
  // Gadgets (intelligent friendly names)
  R63rdCMAG556mm: '5.56mm Extended Mag',
  R63rdCMAG762mm: '7.62mm Extended Mag',
  R63rdCMAG9mmMP5: '9mm Extended Mag',
  R63rdCMAG9mmUMP: '9mm Extended Mag',
  R63rdDrumMAGAK: 'AK Extended Mag',
  R63rdMAG9mmHigh: '9mm Extended Mag',
  R63rdMAGCZ61High: 'CZ61 Extended Mag',
  R63rdMAGPistolHigh: 'Pistol Extended Mag',

  R6MiniScopeGadget: 'Mini Scope',
  R6SilencerGadget: 'Suppressor',
  R6ThermalScopeGadget: 'Thermal Scope',
};

/*
  Game mode mapping (fast path)

  Why this exists:
  - Backend returns server.mode from KV "F1".
  - Servers encode this as an internal token like "RGM_MissionMode".
  - This table maps expected tokens to human-friendly strings for display.
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

/*
  Why:
  - The UI previously displayed key-like labels (server_name, game_mode, motd).
  - These are correct for debugging, but not ideal for end users.
  - Keep the underlying keys stable, and only change the display label.

  Note:
  - If you ever add new rows, this map is the single place to keep labels tidy.
*/
const SERVER_LABEL_MAP = {
  server_name: 'Server Name',
  map: 'Current Map',
  game_mode: 'Game Mode',
  version: 'Version',
  players: 'Players',
  messenger: 'Messenger',
  motd: 'MotD',
  difficulty: 'Difficulty',
};

/*
  Normalize raw server values:
  - null/undefined -> ""
  - convert to string
  - trim() to remove Raven Shield trailing spaces
*/
function normId(x){
  return (x ?? '').toString().trim();
}

/*
  Humanize unknown IDs (fallback):
  - Splits CamelCase to words
  - Removes/rewrites a few common prefixes
  - Keeps it cheap (simple regex + replaces)
*/
function humanizeRvsId(raw){
  const s0 = normId(raw);
  if (!s0) return '';

  // Split CamelCase into words: FooBar99 -> Foo Bar 99
  let s = s0.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  s = s.replace(/([0-9])([A-Za-z])/g, '$1 $2');

  // Optional prefix cleanups
  s = s.replace(/^R6/i, 'R6 ');
  s = s.replace(/^R63rd/i, 'R6 3rd ');

  return s.trim();
}

function weaponName(raw){
  const id = normId(raw);
  if (!id) return '';
  return WEAPON_NAME_MAP[id] || humanizeRvsId(id);
}

function gadgetName(raw){
  const id = normId(raw);
  if (!id) return '';
  return GADGET_NAME_MAP[id] || humanizeRvsId(id);
}

/*
  Map a raw game mode token to a friendly display name.

  Behavior:
  - If it matches our explicit table (GAME_MODE_NAME_MAP), use that.
  - Otherwise, attempt to humanize it:
    - Strips "RGM_" prefix
    - Removes trailing "Mode"
    - Converts CamelCase to words
*/
function gameModeName(raw){
  const id = normId(raw);
  if (!id) return '';

  // Fast path: known modes
  if (GAME_MODE_NAME_MAP[id]) return GAME_MODE_NAME_MAP[id];

  // Fallback humanization for unknown/unexpected tokens
  let s = id;

  // Common prefix used by Raven Shield game modes
  s = s.replace(/^RGM_/, '');

  // Common suffix patterns
  s = s.replace(/Mode$/, '');              // "...Mode" -> "..."
  s = s.replace(/Adv$/, 'Adversarial');    // defensive: "...Adv" -> "...Adversarial"

  // Split CamelCase
  s = s.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  s = s.replace(/([0-9])([A-Za-z])/g, '$1 $2');

  // Cleanup
  s = s.replace(/\s+/g, ' ').trim();

  // Conservative extra normalization for display
  s = s.replace(/\bAdv\b/g, 'Adversarial');
  s = s.replace(/\bAdv Mode\b/g, 'Adversarial');

  return s;
}

/*
  - Input is server.difficulty_level (numeric or numeric-string).
  - Output is "2 (Veteran)" style.
*/
const DIFF_LABEL_MAP = {
  1: 'Recruit',
  2: 'Veteran',
  3: 'Elite',
};

function difficultyText(rawLevel){
  const n = Number(rawLevel);
  if (!Number.isFinite(n) || n <= 0) return '(unknown)';
  const label = DIFF_LABEL_MAP[n];
  return label ? `${n} (${label})` : String(n);
}

/*
  Basic HTML escape for user/server-provided strings.
*/
function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

const WEAPON_INFO_MAP = {
  // This took way too damn long to do
  BuckShotgunM1: {label: 'M1 Shotgun (shot)', url: 'https://en.wikipedia.org/wiki/Benelli_M1'},
  BuckShotgunSPAS12: {label: 'SPAS-12 Shotgun (shot)', url: 'https://en.wikipedia.org/wiki/Franchi_SPAS-12'},
  BuckShotgunUSAS12: {label: 'USAS-12 Shotgun (shot)', url: 'https://en.wikipedia.org/wiki/Daewoo_Precision_Industries_USAS-12'},
  CMagAssaultAK47: {label: 'AK-47 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-47'},
  CMagAssaultAK74: {label: 'AK-74 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-74'},
  CMagAssaultAUG: {label: 'AUG Assault Rifle', url: 'https://en.wikipedia.org/wiki/Steyr_AUG'},
  CMagAssaultFAL: {label: 'FAL Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FAL'},
  CMagAssaultFAMASG2: {label: 'FAMAS G2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/FAMAS#FAMAS_G2'},
  CMagAssaultFNC: {label: 'FNC Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FNC'},
  CMagAssaultG36K: {label: 'G36K Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G36#G36K'},
  CMagAssaultG3A3: {label: 'G3A3 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G3#Variants'},
  CMagAssaultGalilARM: {label: 'Galil ARM Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Galil#Galil_ARM'},
  CMagAssaultL85A1: {label: 'L85A1 Assault Rifle', url: 'https://en.wikipedia.org/wiki/SA80#Variants'},
  CMagAssaultM14: {label: 'M14 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M14_rifle'},
  CMagAssaultM16A2: {label: 'M16A2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M16_rifle#M16A2'},
  CMagAssaultM4: {label: 'M4 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M4_carbine'},
  CMagAssaultM82: {label: 'M82 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Valmet_M82'},
  CMagAssaultTAR21: {label: 'TAR-21 Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Tavor'},
  CMagAssaultType97: {label: 'Type 97 Rifle', url: 'https://en.wikipedia.org/wiki/QBZ-95#QBZ-97'},
  CMagPistol92FS: {label: '92FS Pistol', url: 'https://en.wikipedia.org/wiki/Beretta_M9'},
  CMagPistolAPArmy: {label: 'AP Army Pistol', url: 'https://en.wikipedia.org/wiki/FN_Five-seven'},
  CMagPistolCZ61: {label: 'CZ 61 Pistol', url: 'https://en.wikipedia.org/wiki/Škorpion#vz._61_E'},
  CMagPistolDesertEagle357: {label: 'Desert Eagle .357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  CMagPistolDesertEagle50: {label: 'Desert Eagle .50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  CMagPistolMac119: {label: 'Mac 11/9 Pistol', url: 'https://en.wikipedia.org/wiki/MAC-11'},
  CMagPistolMicroUzi: {label: 'Micro Uzi Pistol', url: 'https://en.wikipedia.org/wiki/Uzi#Military_variants'},
  CMagPistolMk23: {label: 'Mk 23 Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_Mark_23'},
  CMagPistolP228: {label: 'P228 Pistol', url: 'https://en.wikipedia.org/wiki/SIG_Sauer_P226#P228_(M11)'},
  CMagPistolSR2: {label: 'SR-2 Pistol', url: 'https://en.wikipedia.org/wiki/SR-2_Veresk'},
  CMagPistolUSP: {label: 'USP Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_USP'},
  CMagSubCZ61: {label: 'CZ-61 SMG', url: 'https://en.wikipedia.org/wiki/Škorpion#vz._61_E'},
  CMagSubM12S: {label: 'M12S SMG', url: 'https://en.wikipedia.org/wiki/Beretta_M12'},
  CMagSubMac119: {label: 'Mac 11/9 SMG', url: 'https://en.wikipedia.org/wiki/MAC-11'},
  CMagSubMicroUzi: {label: 'Micro Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi#Military_variants'},
  CMagSubMP510A2: {label: 'MP5/10A2 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  CMagSubMP5A4: {label: 'MP5A4 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  CMagSubMP5KPDW: {label: 'MP5K-PDW SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  CMagSubMP5SD5: {label: 'MP5SD5 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  CMagSubMTAR21: {label: 'MTAR-21 SMG', url: 'https://en.wikipedia.org/wiki/IWI_Tavor_X95'},
  CMagSubSR2: {label: 'SR-2 SMG', url: 'https://en.wikipedia.org/wiki/SR-2_Veresk'},
  CMagSubTMP: {label: 'TMP SMG', url: 'https://en.wikipedia.org/wiki/Steyr_TMP'},
  CMagSubUMP: {label: 'UMP SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_UMP'},
  CMagSubUzi: {label: 'Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi'},
  NormalAssaultAK47: {label: 'AK-47 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-47'},
  NormalAssaultAK74: {label: 'AK-74 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-74'},
  NormalAssaultAUG: {label: 'AUG Assault Rifle', url: 'https://en.wikipedia.org/wiki/Steyr_AUG'},
  NormalAssaultFAL: {label: 'FAL Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FAL'},
  NormalAssaultFAMASG2: {label: 'FAMAS G2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/FAMAS#FAMAS_G2'},
  NormalAssaultFNC: {label: 'FNC Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FNC'},
  NormalAssaultG36K: {label: 'G36K Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G36#G36K'},
  NormalAssaultG3A3: {label: 'G3A3 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G3#Variants'},
  NormalAssaultGalilARM: {label: 'Galil ARM Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Galil#Galil_ARM'},
  NormalAssaultL85A1: {label: 'L85A1 Assault Rifle', url: 'https://en.wikipedia.org/wiki/SA80#Variants'},
  NormalAssaultM14: {label: 'M14 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M14_rifle'},
  NormalAssaultM16A2: {label: 'M16A2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M16_rifle#M16A2'},
  NormalAssaultM4: {label: 'M4 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M4_carbine'},
  NormalAssaultM82: {label: 'M82 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Valmet_M82'},
  NormalAssaultTAR21: {label: 'TAR-21 Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Tavor'},
  NormalAssaultType97: {label: 'Type 97 Rifle', url: 'https://en.wikipedia.org/wiki/QBZ-95#QBZ-97'},
  NormalLMG21E: {label: '21E LMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_HK21#HK21E'},
  NormalLMG23E: {label: '23E LMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_HK21#HK21E'},
  NormalLMGM249: {label: 'M249 LMG', url: 'https://en.wikipedia.org/wiki/M249_Squad_Automatic_Weapon'},
  NormalLMGM60E4: {label: 'M60E4 LMG', url: 'https://en.wikipedia.org/wiki/M60_machine_gun#Variants'},
  NormalLMGRPD: {label: 'RPD LMG', url: 'https://en.wikipedia.org/wiki/RPD_machine_gun'},
  NormalPistol92FS: {label: '92FS Pistol', url: 'https://en.wikipedia.org/wiki/Beretta_M9'},
  NormalPistolAPArmy: {label: 'AP Army Pistol', url: 'https://en.wikipedia.org/wiki/FN_Five-seven'},
  NormalPistolCZ61: {label: 'CZ 61 Pistol', url: 'https://en.wikipedia.org/wiki/Škorpion#vz._61_E'},
  NormalPistolDesertEagle357: {label: 'Desert Eagle .357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  NormalPistolDesertEagle50: {label: 'Desert Eagle .50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  NormalPistolMac119: {label: 'Mac 11/9 Pistol', url: 'https://en.wikipedia.org/wiki/MAC-11'},
  NormalPistolMicroUzi: {label: 'Micro Uzi Pistol', url: 'https://en.wikipedia.org/wiki/Uzi#Military_variants'},
  NormalPistolMk23: {label: 'Mk 23 Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_Mark_23'},
  NormalPistolP228: {label: 'P228 Pistol', url: 'https://en.wikipedia.org/wiki/SIG_Sauer_P226#P228_(M11)'},
  NormalPistolSPP: {label: 'SPP Pistol', url: 'https://en.wikipedia.org/wiki/Steyr_TMP#SPP'},
  NormalPistolSR2: {label: 'SR-2 Pistol', url: 'https://en.wikipedia.org/wiki/SR-2_Veresk'},
  NormalPistolUSP: {label: 'USP Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_USP'},
  NormalSniperDragunov: {label: 'Dragunov Sniper Rifle', url: 'https://en.wikipedia.org/wiki/SVD_(rifle)'},
  NormalSniperM82A1: {label: 'M82A1 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Barrett_M82#Variants'},
  NormalSniperPSG1: {label: 'PSG1 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_PSG1'},
  NormalSniperSSG3000: {label: 'SSG 3000 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/SIG_Sauer_SSG_3000'},
  NormalSniperWA2000: {label: 'WA 2000 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Walther_WA_2000'},
  NormalSubCZ61: {label: 'CZ-61 SMG', url: 'https://en.wikipedia.org/wiki/Škorpion#vz._61_E'},
  NormalSubM12S: {label: 'M12S SMG', url: 'https://en.wikipedia.org/wiki/Beretta_M12'},
  NormalSubMac119: {label: 'Mac 11/9 SMG', url: 'https://en.wikipedia.org/wiki/MAC-11'},
  NormalSubMicroUzi: {label: 'Micro Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi#Military_variants'},
  NormalSubMP510A2: {label: 'MP5/10A2 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  NormalSubMP5A4: {label: 'MP5A4 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  NormalSubMP5KPDW: {label: 'MP5K-PDW SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  NormalSubMTAR21: {label: 'MTAR-21 SMG', url: 'https://en.wikipedia.org/wiki/IWI_Tavor_X95'},
  NormalSubP90: {label: 'P90 SMG', url: 'https://en.wikipedia.org/wiki/FN_P90'},
  NormalSubSR2: {label: 'SR-2 SMG', url: 'https://en.wikipedia.org/wiki/SR-2_Veresk'},
  NormalSubTMP: {label: 'TMP SMG', url: 'https://en.wikipedia.org/wiki/Steyr_TMP'},
  NormalSubUMP: {label: 'UMP SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_UMP'},
  NormalSubUzi: {label: 'Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi'},
  SilencedAssaultAK47: {label: 'AK-47 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-47'},
  SilencedAssaultAK74: {label: 'AK-74 Assault Rifle', url: 'https://en.wikipedia.org/wiki/AK-74'},
  SilencedAssaultAUG: {label: 'AUG Assault Rifle', url: 'https://en.wikipedia.org/wiki/Steyr_AUG'},
  SilencedAssaultFAL: {label: 'FAL Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FAL'},
  SilencedAssaultFAMASG2: {label: 'FAMAS G2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/FAMAS#FAMAS_G2'},
  SilencedAssaultFNC: {label: 'FNC Assault Rifle', url: 'https://en.wikipedia.org/wiki/FN_FNC'},
  SilencedAssaultG36K: {label: 'G36K Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G36#G36K'},
  SilencedAssaultG3A3: {label: 'G3A3 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_G3#Variants'},
  SilencedAssaultGalilARM: {label: 'Galil ARM Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Galil#Galil_ARM'},
  SilencedAssaultL85A1: {label: 'L85A1 Assault Rifle', url: 'https://en.wikipedia.org/wiki/SA80#Variants'},
  SilencedAssaultM14: {label: 'M14 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M14_rifle'},
  SilencedAssaultM16A2: {label: 'M16A2 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M16_rifle#M16A2'},
  SilencedAssaultM4: {label: 'M4 Assault Rifle', url: 'https://en.wikipedia.org/wiki/M4_carbine'},
  SilencedAssaultM82: {label: 'M82 Assault Rifle', url: 'https://en.wikipedia.org/wiki/Valmet_M82'},
  SilencedAssaultTAR21: {label: 'TAR-21 Assault Rifle', url: 'https://en.wikipedia.org/wiki/IWI_Tavor'},
  SilencedAssaultType97: {label: 'Type 97 Rifle', url: 'https://en.wikipedia.org/wiki/QBZ-95#QBZ-97'},
  SilencedPistol92FS: {label: '92FS Pistol', url: 'https://en.wikipedia.org/wiki/Beretta_M9'},
  SilencedPistolAPArmy: {label: 'AP Army Pistol', url: 'https://en.wikipedia.org/wiki/FN_Five-seven'},
  SilencedPistolDesertEagle357: {label: 'Desert Eagle .357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  SilencedPistolDesertEagle50: {label: 'Desert Eagle .50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  SilencedPistolMk23: {label: 'Mk 23 Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_Mark_23'},
  SilencedPistolP228: {label: 'P228 Pistol', url: 'https://en.wikipedia.org/wiki/SIG_Sauer_P226#P228_(M11)'},
  SilencedPistolSPP: {label: 'SPP Pistol', url: 'https://en.wikipedia.org/wiki/Steyr_TMP#SPP'},
  SilencedPistolUSP: {label: 'USP Pistol', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_USP'},
  SilencedSniperAWCovert: {label: 'AW Covert Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Accuracy_International_Arctic_Warfare#AWC_(Arctic_Warfare_Covert)'},
  SilencedSniperDragunov: {label: 'Dragunov Sniper Rifle', url: 'https://en.wikipedia.org/wiki/SVD_(rifle)'},
  SilencedSniperM82A1: {label: 'M82A1 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Barrett_M82#Variants'},
  SilencedSniperPSG1: {label: 'PSG1 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_PSG1'},
  SilencedSniperSSG3000: {label: 'SSG 3000 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/SIG_Sauer_SSG_3000'},
  SilencedSniperVSSVintorez: {label: 'VSS Vintorez Sniper Rifle', url: 'https://en.wikipedia.org/wiki/AS_Val_and_VSS_Vintorez'},
  SilencedSniperWA2000: {label: 'WA 2000 Sniper Rifle', url: 'https://en.wikipedia.org/wiki/Walther_WA_2000'},
  SilencedSubCZ61: {label: 'CZ-61 SMG', url: 'https://en.wikipedia.org/wiki/Škorpion#vz._61_E'},
  SilencedSubM12S: {label: 'M12S SMG', url: 'https://en.wikipedia.org/wiki/Beretta_M12'},
  SilencedSubMac119: {label: 'Mac 11/9 SMG', url: 'https://en.wikipedia.org/wiki/MAC-11'},
  SilencedSubMicroUzi: {label: 'Micro Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi#Military_variants'},
  SilencedSubMP510A2: {label: 'MP5/10A2 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  SilencedSubMP5A4: {label: 'MP5 A4 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  SilencedSubMP5KPDW: {label: 'MP5K-PDW SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  SilencedSubMP5SD5: {label: 'MP5SD5 SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_MP5#Variants'},
  SilencedSubMTAR21: {label: 'MTAR-21 SMG', url: 'https://en.wikipedia.org/wiki/IWI_Tavor_X95'},
  SilencedSubP90: {label: 'P90 SMG', url: 'https://en.wikipedia.org/wiki/FN_P90'},
  SilencedSubSR2: {label: 'SR-2 SMG', url: 'https://en.wikipedia.org/wiki/SR-2_Veresk'},
  SilencedSubTMP: {label: 'TMP SMG', url: 'https://en.wikipedia.org/wiki/Steyr_TMP'},
  SilencedSubUMP: {label: 'UMP SMG', url: 'https://en.wikipedia.org/wiki/Heckler_%26_Koch_UMP'},
  SilencedSubUzi: {label: 'Uzi SMG', url: 'https://en.wikipedia.org/wiki/Uzi'},
  SlugShotgunM1: {label: 'M1 Shotgun (slug)', url: 'https://en.wikipedia.org/wiki/Benelli_M1'},
  SlugShotgunSPAS12: {label: 'SPAS-12 Shotgun (slug)', url: 'https://en.wikipedia.org/wiki/Franchi_SPAS-12'},
  SlugShotgunUSAS12: {label: 'USAS-12 Shotgun (slug', url: 'https://en.wikipedia.org/wiki/Daewoo_Precision_Industries_USAS-12'},
};

// Allowlist URLs (prevents XSS via javascript: etc.)
function isAllowedWeaponUrl(url){
  const u = (url ?? '').toString().trim();
  if (!u) return false;
  // Tight allowlist example: only Wikipedia
  return /^https?:\/\/en\.wikipedia\.org\//i.test(u);
}

// Render label as safe HTML link (or plain escaped text)
function renderWeaponHtml(rawWeaponId){
  const id = (rawWeaponId ?? '').toString().trim();
  if (!id) return escapeHtml('(none)');

  const info = WEAPON_INFO_MAP[id];
  if (!info) {
    // Fallback to existing behavior (whatever your weaponName() does)
    return escapeHtml(weaponName(id));
  }

  const label = (info.label ?? id).toString();
  const url = (info.url ?? '').toString();

  if (!isAllowedWeaponUrl(url)) {
    return escapeHtml(label);
  }

  return `<a href="${escapeHtml(url)}" class="wikiLink" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}
/*
  Render helper used by server/map cards.
  - We keep the "key" argument for internal consistency, but we display a more
    human-friendly label to the user (SERVER_LABEL_MAP).
*/
function row(k, v){
  const div = document.createElement('div');
  div.className = 'row';

  const label = SERVER_LABEL_MAP[k] || k;
  div.innerHTML =
    `<div class="k">${escapeHtml(label)}</div>` +
    `<div class="v">${escapeHtml(v)}</div>`;
  return div;
}

/*
  Why:
  - The maplist card contains only maps, but highlight the currently
    active map (server.map) with emphasis.
*/
function mapRow(mapName, isCurrent){
  const div = document.createElement('div');
  div.className = 'row';

  // Use a dedicated CSS class for the value so the emphasis is obvious but
  // doesn't affect the entire row layout.
  const vClass = isCurrent ? 'v currentMap' : 'v';

  div.innerHTML =
    `<div class="k">${escapeHtml('Map')}</div>` +
    `<div class="${vClass}">${escapeHtml(mapName)}</div>`;
  return div;
}

/*
  Inject a small style block for the current-map emphasis.

  Why we do it here:
  - Avoid touching status.css by adding a scoped style tag from JS.
*/
function ensureCurrentMapStyles(){
  if (document.getElementById('currentMapStyles')) return;

  const style = document.createElement('style');
  style.id = 'currentMapStyles';
  style.textContent = `
    /* v=19: highlight current map in Maplist */
    .currentMap{
      font-weight: 800;
      color: #35d07f; /* bold green */
      text-shadow: 0 0 10px rgba(53, 208, 127, 0.20);
    }
  `;
  document.head.appendChild(style);
}

/*
  Render the loadout overlay cell.

  NOTE:
  - The backend provides: primary_weapon, secondary_weapon, primary_gadget, secondary_gadget.
  - Map weapon/gadget IDs to friendly names here so the UI stays fast and simple.
*/
function renderLoadoutCell(p){
  const pw = weaponName(p?.primary_weapon);
  const sw = weaponName(p?.secondary_weapon);
  const pg = gadgetName(p?.primary_gadget);
  const sg = gadgetName(p?.secondary_gadget);

  const pwV = renderWeaponHtml(p?.primary_weapon);
  const swV = renderWeaponHtml(p?.secondary_weapon);
  // const swV = sw ? escapeHtml(sw) : '(none)';
  const pgV = pg ? escapeHtml(pg) : '(none)';
  const sgV = sg ? escapeHtml(sg) : '(none)';

  return (
    `<td class="loadoutCell">` +
      `<details class="loadoutDetails">` +
        `<summary>Show</summary>` +
        `<div class="loadoutBox">` +
          `<div class="loadoutGrid">` +
            `<div class="loadoutK">Primary</div><div class="loadoutV mono">${pwV}</div>` +
            `<div class="loadoutK">Secondary</div><div class="loadoutV mono">${swV}</div>` +
            `<div class="loadoutK">Gadget 1</div><div class="loadoutV mono">${pgV}</div>` +
            `<div class="loadoutK">Gadget 2</div><div class="loadoutV mono">${sgV}</div>` +
          `</div>` +
        `</div>` +
      `</details>` +
    `</td>`
  );
}

function renderPlayers(players){
  if (!playersWrap) return;

  if (!players || players.length === 0){
    playersWrap.innerHTML = `<div class="small">No players.</div>`;
    return;
  }

  const cols = [
    ["name","Name"],
    ["ping","Ping"],
    ["kills","Kills"],
    ["deaths","Deaths"],
    ["hits","Hits"],
    ["rounds_fired","Fired"],
    ["accuracy","%"],
  ];


  // Adjust if you have players with long names
  let name_width = 20;

  let tableHtml =
    `<table>` +
      `<thead><tr>` +
        // Widen Name column and tighten others to give it more room
        `<th style="width:`+name_width+`%;">${escapeHtml(cols[0][1])}</th>` + // Name (wider)
        `<th>${escapeHtml(cols[1][1])}</th>` +  // Ping
        `<th>${escapeHtml(cols[2][1])}</th>` +  // Kills
        `<th>${escapeHtml(cols[3][1])}</th>` +  // Deaths
        `<th>${escapeHtml(cols[4][1])}</th>` +  // Hits
        `<th>${escapeHtml(cols[5][1])}</th>` +  // Fired
        `<th>${escapeHtml(cols[6][1])}</th>` +  // Acc
        `<th style="width:15%;">Loadout</th>` + // Loadout
      `</tr></thead>` +
      `<tbody>`;

  for (const p of players){
    tableHtml += `<tr>`;
    tableHtml += cols.map(([k]) => {
      const v = (p && p[k] !== undefined && p[k] !== null) ? String(p[k]) : '';
      return `<td class="mono">${escapeHtml(v)}</td>`;
    }).join('');
    tableHtml += renderLoadoutCell(p);
    tableHtml += `</tr>`;
  }

  tableHtml += `</tbody></table>`;

  // Keep wrapper (prevents table clipping issues and matches your current CSS)
  playersWrap.innerHTML = `<div class="tableClip">${tableHtml}</div>`;
}

let inflight = false;

async function refresh(){
  if (inflight) return;
  inflight = true;

  try{
    // Ensure small style injection exists before we render maplist rows.
    ensureCurrentMapStyles();

    const r = await fetch('/api/query', { cache: 'no-store' });
    const data = await r.json();

    serverRows.innerHTML = '';
    mapRows.innerHTML = '';
    playersWrap.innerHTML = '';
    rawKv.textContent = '{}';

    if (!data.ok){
      dot.className = 'dot bad';
      lastUpdate.textContent = `Error: ${data.error || 'unknown'}`;
      serverRows.appendChild(row('error', data.error || 'unknown'));
      return;
    }

    dot.className = 'dot good';
    lastUpdate.textContent =
      `OK • ${new Date().toLocaleTimeString()} • ` +
      `${data.meta.datagrams} datagrams • ${data.meta.elapsed_ms}ms`;

    const s = data.server || {};

    /*
      Server card rows:
      - We keep the original data fields, but improve the display labels via SERVER_LABEL_MAP.
      - We show game_mode from s.mode, mapped to a friendly display string via gameModeName().
    */
    serverRows.appendChild(row('server_name', s.name || '(unknown)'));
    serverRows.appendChild(row('map', s.map || '(unknown)'));

    const gmRaw = s.mode || '';
    const gmFriendly = gmRaw ? (gameModeName(gmRaw) || gmRaw) : '(unknown)';
    serverRows.appendChild(row('game_mode', gmFriendly));

    serverRows.appendChild(row('difficulty', difficultyText(s.difficulty_level)));

    serverRows.appendChild(row('version', s.version || '(unknown)'));
    serverRows.appendChild(row('players', `${s.players_current ?? ''} / ${s.players_max ?? ''}`));

    // Messenger + MotD
    serverRows.appendChild(row('messenger', s.message || ''));
    serverRows.appendChild(row('motd', s.motd || ''));

    renderPlayers(data.players || []);

    /*
      Maplist card:
      - Show all maps.
      - Highlight the current map (server.map) with bold green emphasis.
    */
    const currentMap = normId(s.map);
    const maps = data.maplist || [];
    if (maps.length === 0){
      mapRows.appendChild(row('maplist', '(none)'));
    } else {
      mapRows.appendChild(row('count', String(maps.length)));
      for (let i = 0; i < maps.length; i++){
        const m = maps[i];
        const isCurrent = currentMap && normId(m) === currentMap;
        // Keep existing numeric indexing for debugging, but render the map
        // value with emphasis when it matches the active server map.
        const idx = String(i + 1).padStart(2,'0');
        const div = document.createElement('div');
        div.className = 'row';
        div.innerHTML =
          `<div class="k">${escapeHtml(idx)}</div>` +
          `<div class="${isCurrent ? 'v currentMap' : 'v'}">${escapeHtml(m)}</div>`;
        mapRows.appendChild(div);
      }
    }

    rawKv.textContent = JSON.stringify(data.kv || {}, null, 2);

  } catch (e){
    dot.className = 'dot bad';
    lastUpdate.textContent = `Fetch error: ${e}`;
  } finally {
    inflight = false;
  }
}

refreshBtn.addEventListener('click', refresh);
refresh();

/* Auto-refresh every 5 seconds */
setInterval(refresh, 5000);