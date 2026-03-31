/*
==============================================================================
File: app/web/js/status.js
Project: RVSDash - Raven Shield Dashboard (Status and Admin)
Author: Eric Reinsmidt

Purpose
- Client-side behavior for /status.
- Polls GET /api/query and renders:
  - server summary rows
  - players table (+ loadout popup)
  - maplist with current-map highlight
==============================================================================
*/

const serverRows = document.getElementById('serverRows');
const mapRows = document.getElementById('mapRows');
const playersWrap = document.getElementById('playersWrap');
const lastUpdate = document.getElementById('lastUpdate');
const dot = document.getElementById('dot');
const refreshBtn = document.getElementById('refreshBtn');
const rawKv = document.getElementById('rawKv');
const lastRoundsWrap = document.getElementById('lastRoundsWrap');

/*
  ============================================================================
  Explicit mapping tables (fast path)
  ============================================================================
*/
const WEAPON_NAME_MAP = {
  "R6Description.R6DescPrimaryWeaponNone": 'Billy Badass (none)',
  BuckShotgunM1: 'M1 Shotgun (shot)',
  BuckShotgunSPAS12: 'SPAS-12 Shotgun (shot)',
  BuckShotgunUSAS12: 'USAS-12 Shotgun (shot)',
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
  CMagPistolDesertEagle357: 'Desert Eagle.357 Pistol',
  CMagPistolDesertEagle50: 'Desert Eagle.50 Pistol',
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
  NormalPistolDesertEagle357: 'Desert Eagle.357 Pistol',
  NormalPistolDesertEagle50: 'Desert Eagle.50 Pistol',
  NormalPistolMac119: 'Mac 119 Pistol',
  NormalPistolMicroUzi: 'Micro Uzi Pistol',
  NormalPistolMk23: 'Mk 23 Pistol',
  NormalPistolP228: 'P228 Pistol',
  NormalPistolSPP: 'SPP Pistol',
  NormalPistolSR2: 'SR2 Pistol',
  NormalPistolUSP: 'USP Pistol',
  NormalSniperDragunov: 'Dragunov Sniper Rifle',
  NormalSniperM82A1: 'M82A1 Sniper Rifle',
  NormalSniperPSG1: ' PSG1 Sniper Rifle',
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
  SilencedPistolDesertEagle357: 'Desert Eagle.357 Pistol',
  SilencedPistolDesertEagle50: 'Desert Eagle.50 Pistol',
  SilencedPistolMk23: 'Mk 23 Pistol',
  SilencedPistolP228: 'P228 Pistol',
  SilencedPistolSPP: 'SPP Pistol',
  SilencedPistolUSP: 'USP Pistol',
  SilencedSniperAWCovert: 'AW Covert Sniper Rifle',
  SilencedSniperDragunov: 'Dragunov Sniper Rifle',
  SilencedSniperM82A1: 'M82A1 Sniper Rifle',
  SilencedSniperPSG1: ' PSG1 Sniper Rifle',
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

const DIFF_LABEL_MAP = {
  1: 'Recruit',
  2: 'Veteran',
  3: 'Elite',
};

const WEAPON_INFO_MAP = {
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
  CMagPistolDesertEagle357: {label: 'Desert Eagle.357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  CMagPistolDesertEagle50: {label: 'Desert Eagle.50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
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
  NormalPistolDesertEagle357: {label: 'Desert Eagle.357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  NormalPistolDesertEagle50: {label: 'Desert Eagle.50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
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
  SilencedPistolDesertEagle357: {label: 'Desert Eagle.357 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
  SilencedPistolDesertEagle50: {label: 'Desert Eagle.50 Pistol', url: 'https://en.wikipedia.org/wiki/Desert_Eagle'},
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
  SlugShotgunUSAS12: {label: 'USAS-12 Shotgun (slug)', url: 'https://en.wikipedia.org/wiki/Daewoo_Precision_Industries_USAS-12'},
};

/*
  ============================================================================
  Helper functions
  ============================================================================
*/

function normId(x){
  return (x ?? '').toString().trim();
}

function humanizeRvsId(raw){
  const s0 = normId(raw);
  if (!s0) return '';
  let s = s0.replace(/([a-z])([A-Z0-9])/g, '$1 $2');
  s = s.replace(/([0-9])([A-Za-z])/g, '$1 $2');
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

function difficultyText(rawLevel){
  const n = Number(rawLevel);
  if (!Number.isFinite(n) || n <= 0) return '(unknown)';
  const label = DIFF_LABEL_MAP[n];
  return label ? `${n} (${label})` : String(n);
}

function isAllowedWeaponUrl(url){
  const u = (url ?? '').toString().trim();
  if (!u) return false;
  return /^https?:\/\/en\.wikipedia\.org\//i.test(u);
}

function renderWeaponHtml(rawWeaponId){
  const id = (rawWeaponId ?? '').toString().trim();
  if (!id) return escapeHtml('(none)');
  const info = WEAPON_INFO_MAP[id];
  if (!info) return escapeHtml(weaponName(id));
  const label = (info.label ?? id).toString();
  const url = (info.url ?? '').toString();
  if (!isAllowedWeaponUrl(url)) return escapeHtml(label);
  return `<a href="${escapeHtml(url)}" class="wikiLink" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

function row(k, v){
  const div = document.createElement('div');
  div.className = 'row';
  const label = SERVER_LABEL_MAP[k] || k;
  div.innerHTML =
    `<div class="k">${escapeHtml(label)}</div>` +
    `<div class="v">${escapeHtml(v)}</div>`;
  return div;
}

function mapRow(mapName, isCurrent){
  const div = document.createElement('div');
  div.className = 'row';
  const vClass = isCurrent ? 'v currentMap' : 'v';
  div.innerHTML =
    `<div class="k">${escapeHtml('Map')}</div>` +
    `<div class="${vClass}">${escapeHtml(mapName)}</div>`;
  return div;
}

function ensureCurrentMapStyles(){
  if (document.getElementById('currentMapStyles')) return;
  const style = document.createElement('style');
  style.id = 'currentMapStyles';
  style.textContent = `.currentMap{
      font-weight: 800;
      color: #35d07f;
      text-shadow: 0 0 10px rgba(53, 208, 127, 0.20);
    }
  `;
  document.head.appendChild(style);
}

/*
  ============================================================================
  Last Rounds rendering
  ============================================================================
*/

function ensureLastRoundsStyles(){
  if (document.getElementById('lastRoundsStyles')) return;
  const style = document.createElement('style');
  style.id = 'lastRoundsStyles';
  style.textContent = `.roundBlock{
      margin-bottom: 14px;
      background: var(--card2, rgba(255,255,255,0.08));
      border: 1px solid rgba(255,255,255,0.08);
      border-radius: 12px;
      padding: 12px;
    }.roundBlock:last-child{
      margin-bottom: 0;
    }.roundHeader{
      display: flex;
      flex-wrap: wrap;
      gap: 8px 16px;
      align-items: baseline;
      margin-bottom: 10px;
    }.roundMeta{
      font-size: 11px;
      color: rgba(255,255,255,0.55);
    }.roundMeta b{
      color: rgba(255,255,255,0.85);
    }.roundTable{
      width: 100%;
      border-collapse: collapse;
    }.roundTable th,.roundTable td{
      padding: 6px 8px;
      text-align: left;
      border-bottom: 1px solid rgba(255,255,255,0.06);
      font-size: 11px;
    }.roundTable th{
      color: rgba(255,255,255,0.5);
      font-weight: 800;
      text-transform: uppercase;
      letter-spacing:.2px;
      font-size: 10px;
    }.roundTable tr:hover td{
      background: rgba(255,255,255,0.03);
    }.roundAge{
      color: #8ab4ff;
      font-weight: 700;
      font-size: 12px;
    }
  `;
  document.head.appendChild(style);
}

function fmtRoundTime(seconds){
  if (seconds == null || !Number.isFinite(seconds)) return '—';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtTimeAgo(isoTs){
  try{
    const then = new Date(isoTs);
    const now = new Date();
    const diffMs = now - then;
    if (diffMs < 0) return 'just now';

    const diffS = Math.floor(diffMs / 1000);
    if (diffS < 60) return `${diffS}s ago`;

    const diffM = Math.floor(diffS / 60);
    if (diffM < 60) return `${diffM}m ago`;

    const diffH = Math.floor(diffM / 60);
    if (diffH < 24) return `${diffH}h ${diffM % 60}m ago`;

    const diffD = Math.floor(diffH / 24);
    return `${diffD}d ${diffH % 24}h ago`;
  } catch(e){
    return '—';
  }
}

async function fetchLastRounds(){
  if (!lastRoundsWrap) return;

  const serverIdent = document.body.getAttribute('data-server-ident') || '';
  if (!serverIdent){
    lastRoundsWrap.innerHTML = `<div class="small">(no server ident configured)</div>`;
    return;
  }

  try{
    const q = new URLSearchParams();
    q.set('server_ident', serverIdent);
    q.set('limit', '5');

    const r = await fetch(`/api/stats/last_rounds?${q.toString()}`, { cache: 'no-store' });
    const j = await r.json();

    if (!j.ok){
      lastRoundsWrap.innerHTML = `<div class="small">Error: ${escapeHtml(j.error || 'unknown')}</div>`;
      return;
    }

    const rounds = j.rounds || [];
    if (rounds.length === 0){
      lastRoundsWrap.innerHTML = `<div class="small">No rounds recorded yet.</div>`;
      return;
    }

    ensureLastRoundsStyles();

    let html = '';
    for (const round of rounds){
      const modeFriendly = gameModeName(round.game_mode) || round.game_mode || '—';
      const mapName = round.map || '—';
      const rt = fmtRoundTime(round.round_time);
      const ago = fmtTimeAgo(round.ts);

      html += `<div class="roundBlock">`;
      html += `<div class="roundHeader">`;
      html += `<span class="roundAge">${escapeHtml(ago)}</span>`;
      html += `<span class="roundMeta"><b>${escapeHtml(mapName)}</b></span>`;
      html += `<span class="roundMeta">${escapeHtml(modeFriendly)}</span>`;
      html += `<span class="roundMeta">Round time: <b>${escapeHtml(rt)}</b></span>`;
      html += `</div>`;

      const players = round.players || [];
      if (players.length === 0){
        html += `<div class="small">(no players)</div>`;
      } else {
        html += `<table class="roundTable">`;
        html += `<thead><tr>`;
        html += `<th>Player</th><th>Kills</th><th>Deaths</th><th>Hits</th><th>Fired</th>`;
        html += `</tr></thead><tbody>`;
        for (const p of players){
          const name = p.name || p.ubi || '—';
          const ubi = p.ubi || '';
          const kills = p.kills != null ? p.kills : '—';
          const deaths = p.deaths != null ? p.deaths : '—';
          const hits = p.hits != null ? p.hits : '—';
          const fired = p.fired != null ? p.fired : '—';
          html += `<tr>`;
          if (ubi){
            const serverIdent = document.body.getAttribute('data-server-ident') || '';
            const href = `/player?ubi=${encodeURIComponent(ubi)}` + (serverIdent ? `&server_ident=${encodeURIComponent(serverIdent)}` : '');
            html += `<td class="mono"><a class="playerLink" href="${escapeHtml(href)}">${escapeHtml(name)}</a></td>`;
          } else {
            html += `<td class="mono">${escapeHtml(name)}</td>`;
          }
          html += `<td class="mono">${escapeHtml(kills)}</td>`;
          html += `<td class="mono">${escapeHtml(deaths)}</td>`;
          html += `<td class="mono">${escapeHtml(hits)}</td>`;
          html += `<td class="mono">${escapeHtml(fired)}</td>`;
          html += `</tr>`;
        }
        html += `</tbody></table>`;
      }

      html += `</div>`;
    }

    lastRoundsWrap.innerHTML = html;

  } catch(e){
    lastRoundsWrap.innerHTML = `<div class="small">Fetch error: ${escapeHtml(String(e))}</div>`;
  }
}

/*
  ============================================================================
  Loadout popup system (fixed-position overlay, outside the table)
  ============================================================================
*/

function ensureLoadoutStyles(){
  if (document.getElementById('loadoutPopupStyles')) return;
  const style = document.createElement('style');
  style.id = 'loadoutPopupStyles';
  style.textContent = `.loadoutLink{
      color: var(--link, #8ab4ff);
      cursor: pointer;
      font-weight: 800;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing:.2px;
      user-select: none;
      -webkit-user-select: none;
      border: none;
      background: none;
      padding: 0;
    }.loadoutLink:hover{
      color: #b8d4ff;
    }.loadoutOverlay{
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.5);
      z-index: 9998;
      display: flex;
      align-items: center;
      justify-content: center;
    }.loadoutPopup{
      background: #141c2b;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 14px;
      padding: 20px 24px;
      min-width: 300px;
      max-width: 480px;
      z-index: 9999;
      color: rgba(255,255,255,0.92);
      font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Arial;
    }.loadoutPopup h3{
      margin: 0 0 14px 0;
      font-size: 15px;
      font-weight: 700;
      color: rgba(255,255,255,0.95);
    }.loadoutPopupGrid{
      display: grid;
      grid-template-columns: 110px 1fr;
      gap: 8px 12px;
      align-items: baseline;
    }.loadoutPopupK{
      color: rgba(255,255,255,0.55);
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing:.2px;
      font-weight: 800;
    }.loadoutPopupV{
      font-size: 12px;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }.loadoutPopupV a.wikiLink{
      color: var(--link, #8ab4ff);
      text-decoration: none;
    }.loadoutPopupV a.wikiLink:hover{
      text-decoration: underline;
    }.loadoutClose{
      display: inline-block;
      margin-top: 14px;
      padding: 6px 16px;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 10px;
      background: rgba(255,255,255,0.05);
      color: rgba(255,255,255,0.85);
      cursor: pointer;
      font-size: 12px;
    }.loadoutClose:hover{
      background: rgba(255,255,255,0.1);
    }
  `;
  document.head.appendChild(style);
}

function showLoadoutPopup(playerName, p){
  ensureLoadoutStyles();

  const pwV = renderWeaponHtml(p?.primary_weapon);
  const swV = renderWeaponHtml(p?.secondary_weapon);
  const pg = gadgetName(p?.primary_gadget);
  const sg = gadgetName(p?.secondary_gadget);
  const pgV = pg ? escapeHtml(pg) : '(none)';
  const sgV = sg ? escapeHtml(sg) : '(none)';

  const overlay = document.createElement('div');
  overlay.className = 'loadoutOverlay';

  overlay.innerHTML =
    `<div class="loadoutPopup">` +
      `<h3>${escapeHtml(playerName)} — Loadout</h3>` +
      `<div class="loadoutPopupGrid">` +
        `<div class="loadoutPopupK">Primary</div><div class="loadoutPopupV">${pwV}</div>` +
        `<div class="loadoutPopupK">Secondary</div><div class="loadoutPopupV">${swV}</div>` +
        `<div class="loadoutPopupK">Gadget 1</div><div class="loadoutPopupV">${pgV}</div>` +
        `<div class="loadoutPopupK">Gadget 2</div><div class="loadoutPopupV">${sgV}</div>` +
      `</div>` +
      `<button class="loadoutClose">Close</button>` +
    `</div>`;

  document.body.appendChild(overlay);

  // Close on overlay click (outside popup)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.remove();
  });

  // Close on button click
  overlay.querySelector('.loadoutClose').addEventListener('click', () => {
    overlay.remove();
  });

  // Close on Escape
  const escHandler = (e) => {
    if (e.key === 'Escape'){ overlay.remove(); document.removeEventListener('keydown', escHandler); }
  };
  document.addEventListener('keydown', escHandler);
}

/*
  ============================================================================
  Players table renderer
  ============================================================================
*/

function renderPlayers(players){
  if (!playersWrap) return;

  if (!players || players.length === 0){
    playersWrap.innerHTML = `<div class="small">No players.</div>`;
    return;
  }

  ensureLoadoutStyles();

  const cols = [
    ["name","Name"],
    ["ping","Ping"],
    ["kills","Kills"],
    ["deaths","Deaths"],
    ["hits","Hits"],
    ["rounds_fired","Fired"],
    ["accuracy","%"],
  ];

  let name_width = 20;

  let tableHtml =
    `<table>` +
      `<thead><tr>` +
        `<th style="width:${name_width}%;">${escapeHtml(cols[0][1])}</th>` +
        `<th>${escapeHtml(cols[1][1])}</th>` +
        `<th>${escapeHtml(cols[2][1])}</th>` +
        `<th>${escapeHtml(cols[3][1])}</th>` +
        `<th>${escapeHtml(cols[4][1])}</th>` +
        `<th>${escapeHtml(cols[5][1])}</th>` +
        `<th>${escapeHtml(cols[6][1])}</th>` +
        `<th style="width:15%;">Loadout</th>` +
      `</tr></thead>` +
      `<tbody>`;

  for (let i = 0; i < players.length; i++){
    const p = players[i];
    tableHtml += `<tr>`;
    const serverIdent = document.body.getAttribute('data-server-ident') || '';
    tableHtml += cols.map(([k]) => {
      const v = (p && p[k] !== undefined && p[k] !== null) ? String(p[k]) : '';
      if (k === 'name' && p.ubi){
        const href = `/player?ubi=${encodeURIComponent(p.ubi)}` + (serverIdent ? `&server_ident=${encodeURIComponent(serverIdent)}` : '');
        return `<td class="mono"><a class="playerLink" href="${escapeHtml(href)}">${escapeHtml(v)}</a></td>`;
      }
      return `<td class="mono">${escapeHtml(v)}</td>`;
    }).join('');
    tableHtml += `<td><span class="loadoutLink" data-player-idx="${i}">Show</span></td>`;
    tableHtml += `</tr>`;
  }

  tableHtml += `</tbody></table>`;

  playersWrap.innerHTML = `<div class="tableClip">${tableHtml}</div>`;

  // Attach click handlers for loadout popups
  playersWrap.querySelectorAll('.loadoutLink').forEach(el => {
    el.addEventListener('click', () => {
      const idx = parseInt(el.getAttribute('data-player-idx'), 10);
      const p = players[idx];
      if (p) showLoadoutPopup(p.name || '(unknown)', p);
    });
  });
}

/*
  ============================================================================
  Refresh / polling
  ============================================================================
*/

let inflight = false;

async function refresh(){
  if (inflight) return;
  inflight = true;

  try{
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

    serverRows.appendChild(row('server_name', s.name || '(unknown)'));
    serverRows.appendChild(row('map', s.map || '(unknown)'));

    const gmRaw = s.mode || '';
    const gmFriendly = gmRaw ? (gameModeName(gmRaw) || gmRaw) : '(unknown)';
    serverRows.appendChild(row('game_mode', gmFriendly));

    serverRows.appendChild(row('difficulty', difficultyText(s.difficulty_level)));
    serverRows.appendChild(row('version', s.version || '(unknown)'));
    serverRows.appendChild(row('players', `${s.players_current ?? ''} / ${s.players_max ?? ''}`));

    serverRows.appendChild(row('messenger', s.message || ''));
    serverRows.appendChild(row('motd', s.motd || ''));

    renderPlayers(data.players || []);

    const currentMap = normId(s.map);
    const maps = data.maplist || [];
    if (maps.length === 0){
      mapRows.appendChild(row('maplist', '(none)'));
    } else {
      mapRows.appendChild(row('count', String(maps.length)));
      for (let i = 0; i < maps.length; i++){
        const m = maps[i];
        const isCurrent = currentMap && normId(m) === currentMap;
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

    // Fetch last rounds
    fetchLastRounds();

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