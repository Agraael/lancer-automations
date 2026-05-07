/* global game, foundry, Hooks, $, fromUuidSync, FilePicker, canvas */

import { playDamageImpactFX } from '../fx/actionFX.js';

const _lastSoundAt = new Map();

const TOKEN_FEEDBACK_VARIANTS = new Set([
    'tokenHover', 'tokenSelect', 'tokenDeselect',
    'tokenTarget', 'tokenUntarget',
    'tokenDrag', 'tokenMove', 'elevationKey'
]);

/**
 * Play a UI sound. Token/canvas feedback variants use `tah.tokenFeedbackVolume`;
 * TAH HUD sounds use `tah.uiSoundVolume`. 0 = silent.
 * @param {'hover'|'open'|'details'|'toggle'|'statusHover'|'tokenHover'|'tokenSelect'|'tokenDeselect'|'tokenTarget'|'tokenUntarget'|'tokenDrag'|'tokenMove'|'elevationKey'} [variant='open']
 */
export function playUiSound(variant = 'open', { force = false } = {}) {
    let vol = 0;
    const isTokenFeedback = TOKEN_FEEDBACK_VARIANTS.has(variant);
    const settingKey = isTokenFeedback ? 'tah.tokenFeedbackVolume' : 'tah.uiSoundVolume';
    const muteKey = isTokenFeedback ? `tah.tokenSound.${variant}` : `tah.uiSound.${variant}`;
    try {
        if (!force && game.settings.get('lancer-automations', muteKey) === false)
            return;
        vol = Number(game.settings.get('lancer-automations', settingKey)) || 0;
    } catch {
        /* not ready */
    }
    if (vol <= 0)
        return;
    const now = Date.now();
    const minGap = 60;
    const cooldownKey = (variant === 'hover' || variant === 'open') ? 'hover|open' : variant;
    if (now - (_lastSoundAt.get(cooldownKey) ?? 0) < minGap)
        return;
    _lastSoundAt.set(cooldownKey, now);
    const SFX = {
        hover:         { src: 'modules/lancer-automations/FX/audio/hover.wav',         scale: 0.3 },
        open:          { src: 'modules/lancer-automations/FX/audio/hover.wav',         scale: 0.3 },
        statusHover:   { src: 'modules/lancer-automations/FX/audio/statusHover.wav',   scale: 0.1 },
        details:       { src: 'modules/lancer-automations/FX/audio/details.wav',       scale: 2 },
        toggle:        { src: 'modules/lancer-automations/FX/audio/toggle.wav',        scale: 1.5 },
        tokenHover:    { src: 'modules/lancer-automations/FX/audio/tokenHover.mp3',    scale: 0.4 },
        tokenSelect:   { src: 'modules/lancer-automations/FX/audio/tokenSelect.wav',   scale: 0.4 },
        tokenDeselect: { src: 'modules/lancer-automations/FX/audio/tokenDeselect.wav', scale: 0.3 },
        tokenTarget:   { src: 'modules/lancer-automations/FX/audio/target.wav',        scale: 0.5 },
        tokenUntarget: { src: 'modules/lancer-automations/FX/audio/untarget.wav',      scale: 0.4 },
        tokenDrag:     { src: 'modules/lancer-automations/FX/audio/drag.wav',          scale: 0.2 },
        tokenMove:     { src: 'modules/lancer-automations/FX/audio/move2.wav',          scale: 0.3 },
        elevationKey:  { src: 'modules/lancer-automations/FX/audio/elevationKey.mp3',  scale: 0.5 },
    };
    const { src, scale } = SFX[variant] ?? SFX.open;
    // Very thin continuous pitch jitter: ±30 cents (roughly ±1.7%).
    const cents = (Math.random() * 2 - 1) * 30;
    const rate = Math.pow(2, cents / 1200);
    Promise.resolve(foundry.audio.AudioHelper.play(/** @type {any} */ ({ src, volume: vol * scale, autoplay: true, loop: false }), false)).then(/** @param {any} sound */ sound => {
        try {
            if (sound?.element)
                sound.element.playbackRate = rate;
            else if (sound?.sourceNode?.playbackRate)
                sound.sourceNode.playbackRate.value = rate;
        } catch { /* ignore */ }
    }).catch(() => { /* ignore */ });
}

// ---------------------------------------------------------------------------
// Damage / stat feedback sounds
// ---------------------------------------------------------------------------

const STATS_BASE = 'modules/lancer-automations/FX/audio/Stats';

/** Per-damage-type folder + playback scale. File list is discovered at runtime. */
const DAMAGE_SOUNDS = {
    kinetic:    { folder: `${STATS_BASE}/kinetic`,    scale: 0.1 },
    variable:   { folder: `${STATS_BASE}/variable`,   scale: 0.1 },
    explosive:  { folder: `${STATS_BASE}/explosive`,  scale: 0.1 },
    energy:     { folder: `${STATS_BASE}/energy`,     scale: 0.1 },
    heat:       { folder: `${STATS_BASE}/heat`,       scale: 0.1 },
    burn:       { folder: `${STATS_BASE}/burn`,       scale: 0.1 },
    infection:  { folder: `${STATS_BASE}/infection`,  scale: 0.4 },
    overshield: { folder: `${STATS_BASE}/overshield`, scale: 0.3 },
    armor:          { folder: `${STATS_BASE}/armor`,          scale: 0.1 },
    hit_overshield: { folder: `${STATS_BASE}/hit_overshield`, scale: 0.1 },
};

/** Single-file stat change sounds. */
const STAT_SOUNDS = {
    hp_loss:    { src: `${STATS_BASE}/hp_loss.wav`,    scale: 0.2 },
    hp_heal:    { src: `${STATS_BASE}/hp_heal.wav`,    scale: 0.2 },
    heat_clean: { src: `${STATS_BASE}/heat_clean.wav`, scale: 0.05 },
    miss:       { src: `${STATS_BASE}/miss.wav`, scale: 0.7 },
    crit:       { src: `${STATS_BASE}/crit.mp3`, scale: 0.5 },
    hit:        { src: `${STATS_BASE}/hit.mp3`,  scale: 0.2 },
    success:    { src: `${STATS_BASE}/success.wav`, scale: 0.4 },
    fail:       { src: `${STATS_BASE}/fail.mp3`,    scale: 0.4 },
};

const STATUS_SFX_SOUNDS = {
    bonus: { src: `${STATS_BASE}/bonus.wav`, scale: 0.4 },
};

/** folder path -> array of full file paths (cached after first browse). */
const _damageFileCache = new Map();

/** actorId -> captured pre-update stat values for the next `updateActor`. */
const _prevStatsByActor = new Map();

/** actorId -> timestamp of the last damage-apply click. Gates generic HP/heat/burn/infection sounds. */
const _recentDamageApply = new Map();
const DAMAGE_APPLY_WINDOW_MS = 1500;

function _damageVolume() {
    try {
        return Number(game.settings.get('lancer-automations', 'tah.damageSoundVolume')) || 0;
    } catch {
        return 0;
    }
}

function _playDamageAudio(src, scale) {
    const vol = _damageVolume();
    if (vol <= 0)
        return;
    foundry.audio.AudioHelper.play(/** @type {any} */ ({ src, volume: vol * scale, autoplay: true, loop: false }), false);
}

/** Browse and cache the audio files in a folder. Returns an array of src paths. */
async function _listFolderFiles(folder) {
    if (_damageFileCache.has(folder))
        return _damageFileCache.get(folder);
    try {
        const res = await FilePicker.browse('data', folder);
        const files = (res?.files ?? []).filter((/** @type {string} */ f) => /\.(wav|mp3|ogg|m4a|flac)$/i.test(f));
        _damageFileCache.set(folder, files);
        return files;
    } catch {
        _damageFileCache.set(folder, []);
        return [];
    }
}

/** Random file from the damage type's folder. */
export async function playDamageSound(type, { force = false } = {}) {
    const key = String(type ?? '').toLowerCase();
    const cfg = DAMAGE_SOUNDS[key];
    if (!cfg)
        return;
    if (_damageVolume() <= 0)
        return;
    if (!force) {
        try {
            if (game.settings.get('lancer-automations', `tah.damageSound.${key}`) === false)
                return;
        } catch { /* not ready */ }
    }
    const files = await _listFolderFiles(cfg.folder);
    if (!files.length)
        return;
    const src = files[Math.floor(Math.random() * files.length)];
    _playDamageAudio(src, cfg.scale);
}

export function playStatsSound(key, { force = false } = {}) {
    const cfg = STAT_SOUNDS[key];
    if (!cfg)
        return;
    if (!force) {
        try {
            if (game.settings.get('lancer-automations', `tah.statSound.${key}`) === false)
                return;
        } catch { /* not ready */ }
    }
    _playDamageAudio(cfg.src, cfg.scale);
}

export function playStatusSfxSound(key, { force = false } = {}) {
    const cfg = STATUS_SFX_SOUNDS[key];
    if (!cfg)
        return;
    if (!force) {
        try {
            if (game.settings.get('lancer-automations', `tah.statusSfx.${key}`) === false)
                return;
        } catch { /* not ready */ }
    }
    _playDamageAudio(cfg.src, cfg.scale);
}

function _markDamageApplied(actorId) {
    if (!actorId)
        return;
    _recentDamageApply.set(actorId, Date.now());
    setTimeout(() => _recentDamageApply.delete(actorId), DAMAGE_APPLY_WINDOW_MS);
}

function _wasRecentlyDamaged(actorId) {
    const t = _recentDamageApply.get(actorId);
    return !!(t && Date.now() - t < DAMAGE_APPLY_WINDOW_MS);
}

// Pre-warm the folder caches on ready so the first damage doesn't pay a browse latency hit.
Hooks.once('ready', () => {
    for (const cfg of Object.values(DAMAGE_SOUNDS))
        _listFolderFiles(cfg.folder);
});

// Lancer "Apply Damage" click: play per-target, per-damage-type sounds.
$(document).on('click', '.lancer-damage-apply', (ev) => {
    try {
        const msgEl = ev.currentTarget.closest('.chat-message.message');
        if (!msgEl)
            return;
        const msg = game.messages?.get(msgEl.dataset.messageId);
        const dmgData = msg?.flags?.lancer?.damageData;
        if (!dmgData)
            return;
        const btnGroup = ev.currentTarget.closest('.lancer-damage-button-group');
        const targetUuid = btnGroup?.dataset?.target;
        const td = dmgData.targetDamageResults?.find((t) => t.target === targetUuid);
        if (!td)
            return;
        const targetDoc = fromUuidSync(targetUuid);
        const targetTokenObj = /** @type {any} */ (targetDoc)?.object
            ?? (canvas?.tokens?.get(/** @type {any} */ (targetDoc)?.id) ?? null);
        const actor = /** @type {any} */ (targetDoc)?.actor;
        const actorId = actor?.id;
        _markDamageApplied(actorId);
        const preHp = Number(actor?.system?.hp?.value ?? 0);
        const preOvershield = Number(actor?.system?.overshield?.value ?? 0);
        const types = new Set();
        for (const d of td.damage ?? []) {
            const amt = Number(d.amount);
            if (amt > 0)
                types.add(String(d.type).toLowerCase());
        }
        const audioOn = _damageVolume() > 0;
        const PHYSICAL = new Set(['kinetic', 'energy', 'explosive', 'variable']);
        const physTypes = [...types].filter((t) => PHYSICAL.has(t));
        // Defer per-type sounds/FX until we know whether the damage was absorbed.
        setTimeout(() => {
            if (!actor)
                return;
            const postHp = Number(actor.system?.hp?.value ?? 0);
            const postOvershield = Number(actor.system?.overshield?.value ?? 0);
            const armorAbsorbed = postHp >= preHp && postOvershield >= preOvershield && physTypes.length > 0;
            const overshieldOnly = !armorAbsorbed && postOvershield < preOvershield && postHp >= preHp;
            if (armorAbsorbed) {
                if (audioOn)
                    playDamageSound('armor');
                playDamageImpactFX('armor', targetTokenObj);
            } else if (overshieldOnly) {
                if (audioOn)
                    playDamageSound('hit_overshield');
                playDamageImpactFX('hit_overshield', targetTokenObj);
            } else {
                for (const t of types) {
                    if (audioOn)
                        playDamageSound(t);
                    playDamageImpactFX(t, targetTokenObj);
                }
            }
        }, 250);
    } catch { /* ignore */ }
});

// Capture previous stat values before the update commits.
Hooks.on('preUpdateActor', (actor, change) => {
    if (!actor?.id)
        return;
    const s = actor.system ?? {};
    const prev = {};
    if (change?.system?.hp?.value !== undefined)
        prev.hp = Number(s.hp?.value ?? 0);
    if (change?.system?.heat?.value !== undefined)
        prev.heat = Number(s.heat?.value ?? 0);
    if (change?.system?.burn !== undefined)
        prev.burn = Number(s.burn ?? 0);
    if (change?.system?.infection !== undefined)
        prev.infection = Number(s.infection ?? 0);
    if (change?.system?.overshield?.value !== undefined)
        prev.overshield = Number(s.overshield?.value ?? 0);
    if (Object.keys(prev).length)
        _prevStatsByActor.set(actor.id, prev);
});

// Play stat-change sounds based on diff between prev and new values.
Hooks.on('updateActor', (actor, change) => {
    if (!actor?.id)
        return;
    if (_damageVolume() <= 0) {
        _prevStatsByActor.delete(actor.id);
        return;
    }
    const prev = _prevStatsByActor.get(actor.id) ?? {};
    _prevStatsByActor.delete(actor.id);
    const duringDamage = _wasRecentlyDamaged(actor.id);

    const newHp = change?.system?.hp?.value;
    if (newHp !== undefined && prev.hp !== undefined) {
        if (newHp < prev.hp && !duringDamage)
            playStatsSound('hp_loss');
        else if (newHp > prev.hp)
            playStatsSound('hp_heal');
    }
    const newHeat = change?.system?.heat?.value;
    if (newHeat !== undefined && prev.heat !== undefined) {
        if (newHeat > prev.heat && !duringDamage)
            playDamageSound('heat');
        else if (newHeat < prev.heat)
            playStatsSound('heat_clean');
    }
    const newBurn = change?.system?.burn;
    if (newBurn !== undefined && prev.burn !== undefined) {
        if (newBurn > prev.burn && !duringDamage)
            playDamageSound('burn');
    }
    const newInfection = change?.system?.infection;
    if (newInfection !== undefined && prev.infection !== undefined) {
        if (newInfection > prev.infection && !duringDamage)
            playDamageSound('infection');
    }
    const newOvershield = change?.system?.overshield?.value;
    if (newOvershield !== undefined && prev.overshield !== undefined) {
        if (newOvershield > prev.overshield)
            playDamageSound('overshield');
    }
});
