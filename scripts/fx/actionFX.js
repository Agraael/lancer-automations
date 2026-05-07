/* global game, Sequence, Sequencer, Hooks, canvas, foundry */

import { isActionFXEnabled } from './statusFX.js';
import { playStatsSound, playStatusSfxSound } from '../tah/sound.js';

/**
 * Action FX sequences for built-in general reactions.
 * Centralised so reactions-registry.js stays focused on reaction logic.
 *
 * Each function is a no-op if Sequencer isn't active, if lancer-weapon-fx isn't
 * active, or if the "Enable Action FX" toggle in Effects Configuration is off.
 */

function _weaponFx() {
    const mod = game.modules.get('lancer-weapon-fx');
    return mod?.active ? mod.api : null;
}

function _canPlay() {
    return isActionFXEnabled() && typeof Sequencer !== 'undefined';
}

// weapon-fx volume × master, 0 if the per-action toggle is off.
/** @param {any} fx @param {string} action @param {number} scale */
function _vol(fx, action, scale) {
    try {
        if (game.settings.get('lancer-automations', `tah.actionFxSound.${action}`) === false)
            return 0;
        const master = Number(game.settings.get('lancer-automations', 'tah.actionFxVolume'));
        return fx.getEffectVolume(scale) * (Number.isFinite(master) ? master : 1);
    } catch {
        return fx.getEffectVolume(scale);
    }
}

const ACTION_FX_PREVIEW = {
    skirmish:    { src: () => `modules/lancer-automations/FX/audio/Skirmish${1 + Math.floor(Math.random() * 3)}.wav`, scale: 0.35 },
    barrage:     { src: 'modules/lancer-automations/FX/audio/barrage.wav', scale: 0.35 },
    eject:        { src: 'modules/lancer-automations/FX/audio/jetpack_unpack_1.wav', scale: 0.5 },
    selfDestruct: { src: 'modules/lancer-weapon-fx/soundfx/Annihilator.ogg', scale: 0.5 },
    bootUp:       { src: 'modules/lancer-automations/FX/audio/bootup.wav', scale: 0.5 },
    dismount:     { src: 'modules/lancer-automations/FX/audio/liftoff.wav', scale: 0.5 },
    disengage:    { src: 'modules/lancer-automations/FX/audio/742717__artix0__dash-sound-effect.wav', scale: 0.5 },
    deployable:   { src: 'modules/lancer-automations/FX/audio/deploy.wav', scale: 0.35 },
    freeAction:   { src: 'modules/lancer-automations/FX/audio/free.wav', scale: 0.35 },
    corePower:    { src: 'modules/lancer-automations/FX/audio/corepower.wav', scale: 0.5 },
    protocol:     { src: 'modules/lancer-automations/FX/audio/protocol.wav', scale: 0.35 },
    reaction:     { src: 'modules/lancer-automations/FX/audio/reaction.wav', scale: 0.35 },
    fullAction:   { src: 'modules/lancer-automations/FX/audio/fullaction.wav', scale: 0.6 },
    quickAction:  { src: 'modules/lancer-automations/FX/audio/quickaction.wav', scale: 0.6 },
    standingUp:   { src: 'modules/lancer-automations/FX/audio/standingup.mp3', scale: 0.5 },
    prepare:      { src: 'modules/lancer-automations/FX/audio/prepare.wav', scale: 0.5 },
    interact:     { src: 'modules/lancer-automations/FX/audio/interact.wav', scale: 0.5 },
    handle:       { src: 'modules/lancer-automations/FX/audio/handle.wav', scale: 0.5 },
    fullTech:     { src: 'modules/lancer-automations/FX/audio/fulltech.wav', scale: 0.3 },
    quickTech:    { src: 'modules/lancer-automations/FX/audio/quicktech.wav', scale: 0.3 },
    invade:       { src: 'modules/lancer-automations/FX/audio/invade.wav', scale: 0.3 },
    grapple:      { src: 'modules/lancer-automations/FX/audio/harpoon-deploy-swoosh.wav', scale: 0.5 },
    ram:          { src: 'modules/lancer-automations/FX/audio/ram.wav', scale: 0.5 },
    boost:        { src: 'modules/lancer-automations/FX/audio/boost.wav', scale: 0.3 },
    overchargeNpc:{ src: 'modules/lancer-weapon-fx/soundfx/Overcharge.ogg', scale: 0.5 },
    shutDown:     { src: 'modules/lancer-automations/FX/audio/shutdown.wav', scale: 0.4 },
    fall:         { src: 'modules/lancer-automations/FX/audio/fall.mp3', scale: 0.7 },
    fallImpact:   { src: 'modules/lancer-automations/FX/audio/IMPACT.mp3', scale: 0.5 },
    search:       { src: 'modules/lancer-automations/FX/audio/radar-4.wav', scale: 0.5 },
    scan:         { src: 'modules/lancer-automations/FX/audio/scan.mp3', scale: 0.7 },
    targetSuccess:{ src: 'modules/lancer-automations/FX/audio/750428__rescopicsound__ui-alert-menu-modern-interface-confirm-small.mp3', scale: 0.5 },
    targetFail:   { src: 'modules/lancer-automations/FX/audio/denyerror-sound.wav', scale: 0.5 },
    hide:         { src: 'modules/lancer-automations/FX/audio/PuffSmoke.wav', scale: 0.7 },
    defaultThrow: { src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', scale: 0.2 },
    teleport:     { src: 'modules/lancer-automations/FX/audio/laser_shot_mark_02_10052025.wav', scale: 0.5 },
};

/** @param {string} action */
export function previewActionFxSound(action) {
    const entry = ACTION_FX_PREVIEW[action];
    if (!entry) {
        ui.notifications.info(`No audio preview for "${action}".`);
        return;
    }
    const src = typeof entry.src === 'function' ? entry.src() : entry.src;
    const fx = _weaponFx();
    const base = fx ? fx.getEffectVolume(entry.scale) : entry.scale;
    const masterRaw = Number(game.settings.get('lancer-automations', 'tah.actionFxVolume'));
    const master = Number.isFinite(masterRaw) ? masterRaw : 1;
    foundry.audio.AudioHelper.play(/** @type {any} */ ({ src, volume: base * master, autoplay: true, loop: false }), false);
}

/**
 * Shared "action badge" effect — the animated SVG corner icon + glow.
 * @param {any} seq  Existing Sequence to chain onto
 * @param {any} token
 * @param {string} svgFile
 * @param {number} [duration=3000]
 */
function _appendActionBadge(seq, token, svgFile, duration = 3000) {
    return seq.effect()
        .file(svgFile)
        .attachTo(token, { align: 'bottom-left', edge: 'inner', offset: { x: -0.07, y: -0.07 }, gridUnits: true })
        .scaleIn(0.01, 500)
        .scale(0.09)
        .scaleOut(0.01, 900)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(duration)
        .fadeIn(400)
        .fadeOut(800);
}

export async function playSkirmishFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const soundFile = `modules/lancer-automations/FX/audio/Skirmish${1 + Math.floor(Math.random() * 3)}.wav`;
    await Sequencer.Preloader.preloadForClients([
        soundFile,
        'modules/lancer-automations/FX/svg/Skirmish.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    await new Sequence()
        .sound()
        .file(soundFile)
        .volume(_vol(fx, 'skirmish', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Skirmish.svg')
        .attachTo(token, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(token)
        .scaleToObject(1.8)
        .tint(0xff3030)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.red')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xff1e1e)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.red')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0xff1e1e)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playEjectFX(source, dest) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = source.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = source.document?.flags?.['hex-size-support']?.pivoty || 0;
    const ipivotx = -pivotx;
    const ipivoty = -pivoty;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/jetpack_unpack_1.wav',
        'modules/lancer-automations/FX/audio/smokeimpact.wav',
        'modules/lancer-automations/FX/svg/Eject.svg',
        'jb2a.pack_hound_missile',
        'jb2a.smoke.puff.ring.01.white',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const sourceSeq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/jetpack_unpack_1.wav')
        .volume(_vol(fx, 'eject', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(source, { offset: { x: ipivotx, y: ipivoty } })
        .opacity(0.34)
        .tint(0xcccccc)
        .filter('Blur', { blur: 1 })
        .scaleToObject(2)
        .fadeIn(1000)
        .fadeOut(3500, { delay: -800 })
        .rotate(-35)
        .belowTokens();
    _appendActionBadge(sourceSeq, source, 'modules/lancer-automations/FX/svg/Eject.svg');
    sourceSeq.play();

    if (dest) {
        await new Sequence()
            .effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file('jb2a.pack_hound_missile')
            .atLocation(source)
            .stretchTo(dest)
            .scale(1.6)
            .playbackRate(0.6)
            .waitUntilFinished(-5500)
            .effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file('jb2a.smoke.puff.ring.01.white')
            .playbackRate(0.6)
            .atLocation(dest)
            .scaleToObject(5)
            .sound()
            .file('modules/lancer-automations/FX/audio/smokeimpact.wav')
            .volume(_vol(fx, 'eject', 0.5))
            .play();
    }
}

export async function playSelfDestructFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = token.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = token.document?.flags?.['hex-size-support']?.pivoty || 0;
    const ipivotx = -pivotx;
    const ipivoty = -pivoty;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-weapon-fx/soundfx/dramaticSparkles.ogg',
        'modules/lancer-weapon-fx/soundfx/ReactorWarning.ogg',
        'modules/lancer-weapon-fx/soundfx/Annihilator.ogg',
        'modules/lancer-automations/FX/svg/Selfdead.svg',
        'jb2a.static_electricity.03.dark_red',
        'jb2a.smoke.plumes.01.grey',
        'jb2a.breath_weapons02.burst.line.fire.orange.01',
        'jb2a.moonbeam.01.loop',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/dramaticSparkles.ogg')
        .volume(_vol(fx, 'selfDestruct', 0.2))
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/ReactorWarning.ogg')
        .volume(_vol(fx, 'selfDestruct', 0.5))
        .repeats(3, 1000)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.moonbeam.01.loop')
        .attachTo(token, { offset: { x: ipivotx, y: ipivoty } })
        .tint('#ff2a2a')
        .scaleToObject(2.4)
        .fadeIn(1700)
        .fadeOut(1000)
        .playbackRate(0.7)
        .opacity(0.5)
        .mask(token)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Selfdead.svg')
        .attachTo(token, { align: 'bottom-left', edge: 'inner', offset: { y: 0.1 }, gridUnits: true })
        .animateProperty('sprite', 'position.y', { from: 0, to: 1, duration: 3500, gridUnits: true, fromEnd: true })
        .scaleIn(0.01, 500)
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(5000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .waitUntilFinished(-2500)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.03.dark_red')
        .atLocation(token, { offset: { x: ipivotx, y: ipivoty } })
        .scaleToObject(1)
        .opacity(0.8)
        .repeats(3, 300)
        .delay(500)
        .mask(token)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(token, { offset: { x: ipivotx, y: ipivoty } })
        .opacity(0.34)
        .tint(0x33ddff)
        .filter('Glow', { color: 0x00a1e6 })
        .filter('Blur', { blur: 1 })
        .scaleToObject(2)
        .fadeIn(1500)
        .fadeOut(4700, { delay: -800 })
        .rotate(-35)
        .belowTokens()
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/Annihilator.ogg')
        .volume(_vol(fx, 'selfDestruct', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.breath_weapons02.burst.line.fire.orange.01')
        .playbackRate(2.8)
        .tint(0xff2020)
        .filter('Glow', { distance: 10, color: 0xff2020, innerStrength: 10 })
        .opacity(0.5)
        .attachTo(token, { offset: { x: ipivotx, y: ipivoty } })
        .randomRotation()
        .spriteOffset({ x: 0.5 }, { gridUnits: true })
        .scaleToObject()
        .repeats(2)
        .belowTokens()
        .waitUntilFinished(-2000)
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/Annihilator.ogg')
        .volume(_vol(fx, 'selfDestruct', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.breath_weapons02.burst.line.fire.orange.01')
        .playbackRate(2.8)
        .tint(0xff2020)
        .filter('Glow', { distance: 3, color: 0xff2020, innerStrength: 4 })
        .opacity(0.5)
        .attachTo(token, { offset: { x: ipivotx, y: ipivoty } })
        .randomRotation()
        .spriteOffset({ x: 0.5 }, { gridUnits: true })
        .scaleToObject(0.9)
        .repeats(2)
        .belowTokens()
        .play();
}

export async function playTeleportFX(caster) {
    if (!_canPlay())
        return;
    const fx = _weaponFx();
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/svg/Teleport.svg',
        'modules/lancer-automations/FX/audio/laser_shot_mark_02_10052025.wav',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/laser_shot_mark_02_10052025.wav')
        .volume(fx ? _vol(fx, 'teleport', 0.7) : 0.7);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Teleport.svg').play();
}

export async function playBootUpFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/bootup.wav',
        'modules/lancer-automations/FX/svg/BootUp.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.energy_strands.in.yellow',
        'jb2a.ui.heartbeat.01.yellow',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/bootup.wav')
        .volume(_vol(fx, 'bootUp', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/BootUp.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.energy_strands.in.yellow')
        .atLocation(caster)
        .scaleToObject(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2)
        .tint(0xffcc33)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.yellow')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.yellow')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playDismountFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = caster.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = caster.document?.flags?.['hex-size-support']?.pivoty || 0;
    const ipivotx = -pivotx;
    const ipivoty = -pivoty;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/liftoff.wav',
        'modules/lancer-automations/FX/svg/Dismount.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/liftoff.wav')
        .volume(_vol(fx, 'dismount', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(caster, { offset: { x: ipivotx, y: ipivoty } })
        .opacity(0.34)
        .tint(0xcccccc)
        .filter('Blur', { blur: 1 })
        .scaleToObject(2)
        .fadeIn(1000)
        .fadeOut(3500, { delay: -800 })
        .rotate(-35)
        .belowTokens();
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Dismount.svg').play();
}

export async function playDisengageFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/742717__artix0__dash-sound-effect.wav',
        'modules/lancer-automations/FX/svg/Disengage.svg',
        'jb2a.extras.tmfx.outpulse.line.02.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/742717__artix0__dash-sound-effect.wav')
        .volume(_vol(fx, 'disengage', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.outpulse.line.02.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Disengage.svg').play();
}

export async function playDeployableFX(deployedToken) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/deploy.wav',
        'modules/lancer-automations/FX/svg/Deployable.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/deploy.wav')
        .volume(_vol(fx, 'deployable', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Deployable.svg')
        .attachTo(deployedToken, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(deployedToken)
        .scaleToObject(1.8)
        .tint(0x4a9eff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(deployedToken, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(deployedToken, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playFreeActionFX(caster, svg = 'modules/lancer-automations/FX/svg/FreeAction.svg') {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/free.wav',
        svg,
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.green',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/free.wav')
        .volume(_vol(fx, 'freeAction', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file(svg)
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(1.8)
        .tint(0xdcffdc)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xdcffdc)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0xdcffdc)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playCorePowerFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/corepower.wav',
        'modules/lancer-automations/FX/svg/CorePower.svg',
        'jb2a.on_token_buff.002.002.orangeyellow',
        'jb2a.template_circle.out_pulse.02.burst.greenorange',
        'jb2a.static_electricity.01.yellow',
        'jb2a.ui.heartbeat.01.yellow',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/corepower.wav')
        .volume(_vol(fx, 'corePower', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/CorePower.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4500)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.template_circle.out_pulse.02.burst.greenorange')
        .atLocation(caster)
        .scaleToObject(2.5)
        .belowTokens()
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.on_token_buff.002.002.orangeyellow')
        .atLocation(caster)
        .scaleToObject(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.01.yellow')
        .atLocation(caster)
        .scaleToObject(1.4)
        .opacity(0.85)
        .mask(caster)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.yellow')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xff9930)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.yellow')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0xff9930)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playProtocolFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/protocol.wav',
        'modules/lancer-automations/FX/svg/Protocol.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.green',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/protocol.wav')
        .volume(_vol(fx, 'protocol', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Protocol.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(1.8)
        .tint(0x20dfff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x20dfff)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0x20dfff)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playReactionFX(caster, svg = 'modules/lancer-automations/FX/svg/Reaction.svg') {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/reaction.wav',
        svg,
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.purple',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/reaction.wav')
        .volume(_vol(fx, 'reaction', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file(svg)
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(1.8)
        .tint(0xb070ff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.purple')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.purple')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playFullActionFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/fullaction.wav',
        'modules/lancer-automations/FX/svg/FullAction.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/fullaction.wav')
        .volume(_vol(fx, 'fullAction', 0.6))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/FullAction.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(1.8)
        .tint(0x4a9eff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playQuickActionFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/quickaction.wav',
        'modules/lancer-automations/FX/svg/QuickAction.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/quickaction.wav')
        .volume(_vol(fx, 'quickAction', 0.6))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/QuickAction.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(1.8)
        .tint(0x4a9eff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playStandingUpFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/standingup.mp3',
        'modules/lancer-automations/FX/svg/Standing.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/standingup.mp3')
        .volume(_vol(fx, 'standingUp', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Standing.svg').play();
}

export async function playPrepareFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/prepare.wav',
        'modules/lancer-automations/FX/svg/Prepare.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/prepare.wav')
        .volume(_vol(fx, 'prepare', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Prepare.svg').play();
}

export async function playInteractFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/interact.wav',
        'modules/lancer-automations/FX/svg/Interact.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/interact.wav')
        .volume(_vol(fx, 'interact', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Interact.svg').play();
}

export async function playHandleFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/handle.wav',
        'modules/lancer-automations/FX/svg/Handle.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/handle.wav')
        .volume(_vol(fx, 'handle', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Handle.svg').play();
}

export async function playFullTechFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/fulltech.wav',
        'modules/lancer-automations/FX/svg/FullTech.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.static_electricity.03.blue02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/fulltech.wav')
        .volume(_vol(fx, 'fullTech', 0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/FullTech.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2.5)
        .tint(0x3a7fff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.03.blue02')
        .atLocation(caster)
        .scaleToObject(2)
        .playbackRate(1.5)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playQuickTechFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/quicktech.wav',
        'modules/lancer-automations/FX/svg/QuickTech.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.static_electricity.03.blue02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/quicktech.wav')
        .volume(_vol(fx, 'quickTech', 0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/QuickTech.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2)
        .tint(0x66aaff)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.03.blue02')
        .atLocation(caster)
        .scaleToObject(1.5)
        .playbackRate(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playInvadeFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/invade.wav',
        'modules/lancer-automations/FX/svg/Invade.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.static_electricity.03.green02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/invade.wav')
        .volume(_vol(fx, 'invade', 0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Invade.svg')
        .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .scaleToObject(2)
        .tint(0x66ff66)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.03.green02')
        .atLocation(caster)
        .scaleToObject(1.5)
        .playbackRate(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(caster, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0x148a14)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playGrappleFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/harpoon-deploy-swoosh.wav',
        'modules/lancer-automations/FX/svg/Grapple.svg',
        'jb2a.extras.tmfx.inpulse.circle.04.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/harpoon-deploy-swoosh.wav')
        .volume(_vol(fx, 'grapple', 0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.04.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Grapple.svg').play();
}

export async function playRamFX(caster, target) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/ram.wav',
        'modules/lancer-automations/FX/svg/Ram.svg',
        'jb2a.zoning.directional.once.redyellow.line200.01',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/ram.wav')
        .volume(_vol(fx, 'ram', 0.5));
    if (target) {
        seq.effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file('jb2a.zoning.directional.once.redyellow.line200.01')
            .atLocation(caster)
            .rotateTowards(target)
            .scaleToObject(1.5)
            .playbackRate(1.5);
    }
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Ram.svg').play();
}

export async function playBarrageFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/barrage.wav',
        'modules/lancer-automations/FX/svg/Barrage.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/barrage.wav')
        .volume(_vol(fx, 'barrage', 0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/FX/svg/Barrage.svg')
        .attachTo(token, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
        .scale(0.09)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800, { delay: -1200 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(token)
        .scaleToObject(1.8)
        .tint(0xff3030)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.red')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xff1e1e)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.red')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .rotate(180)
        .tint(0xff1e1e)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 0.1 })
        .play();
}

export async function playBoostFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/boost.wav',
        'modules/lancer-automations/FX/svg/Boost.svg',
        'jb2a.zoning.directional.once.bluegreen.line200.02',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/boost.wav')
        .volume(_vol(fx, 'boost', 0.3))
        .effect()
        .file('jb2a.zoning.directional.once.bluegreen.line200.02')
        .scaleToObject(1.5)
        .filter('Glow', { color: 0x00CED1 })
        .atLocation(token);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Boost.svg').play();
}

export async function playOverchargeNpcFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = token.document.flags['hex-size-support']?.pivotx || 0;
    const pivoty = token.document.flags['hex-size-support']?.pivoty || 0;
    const svgFile = 'modules/lancer-weapon-fx/advisories/OverchargeYellow.svg';
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-weapon-fx/soundfx/Overcharge.ogg',
        'jb2a.static_electricity.02.blue',
        'jb2a.template_circle.out_pulse.02.burst.bluewhite',
        'jb2a.static_electricity.03.red',
        'jb2a.smoke.plumes.01.grey',
        svgFile,
    ]);
    const seq = new Sequence()
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file(svgFile)
        .attachTo(token, { align: 'bottom-left', edge: 'inner', offset: { x: -0.07, y: -0.07 }, gridUnits: true })
        .scaleIn(0.01, 500)
        .scale(0.09)
        .scaleOut(0.01, 900)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(4000)
        .fadeIn(400)
        .fadeOut(800)
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/Overcharge.ogg')
        .volume(_vol(fx, 'overchargeNpc', 0.5))
        .waitUntilFinished(-2700)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.02.blue')
        .atLocation(token, { offset: { x: -pivotx, y: -pivoty } })
        .scaleToObject(1.2)
        .randomSpriteRotation()
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.template_circle.out_pulse.02.burst.bluewhite')
        .atLocation(token, { offset: { x: -pivotx, y: -pivoty } })
        .belowTokens()
        .playbackRate(1.3)
        .scaleToObject(2.0)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.static_electricity.03.red')
        .atLocation(token, { offset: { x: -pivotx, y: -pivoty } })
        .scaleToObject(1)
        .opacity(0.8)
        .mask(token)
        .delay(1500)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(token, { offset: { x: -pivotx, y: -pivoty } })
        .opacity(0.29)
        .tint(0x33ddff)
        .filter('Glow', { color: 0x00a1e6 })
        .filter('Blur', { blur: 5 })
        .scaleToObject(2)
        .fadeIn(1500)
        .fadeOut(4700, { delay: -800 })
        .rotate(-35)
        .belowTokens();
    await seq.play();
}

export async function playHideFX(token) {
    if (!_canPlay())
        return;
    const fx = _weaponFx();
    const seq = new Sequence()
        .effect()
        .file('jb2a.smoke.puff.centered.grey')
        .atLocation(token)
        .scale(1.1)
        .sound()
        .file('modules/lancer-automations/FX/audio/PuffSmoke.wav')
        .volume(fx ? _vol(fx, 'hide', 0.7) : 0.7);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Hide.svg').play();
}

export async function playShutDownFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/shutdown.wav',
        'modules/lancer-automations/FX/svg/Shutdown.svg',
        'jb2a.extras.tmfx.inpulse.circle.02.normal',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/shutdown.wav')
        .volume(_vol(fx, 'shutDown', 0.7))
        .atLocation(token)
        .effect()
        .file('jb2a.extras.tmfx.inpulse.circle.02.normal')
        .atLocation(token)
        .scaleToObject(2)
        .effect()
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(token, { offset: { x: 0, y: -0.5 }, gridUnits: true })
        .scaleToObject(2)
        .opacity(0.5)
        .fadeIn(500)
        .fadeOut(1500);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Shutdown.svg').play();
}

export async function playFallFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/fall.mp3',
        'modules/lancer-automations/FX/svg/Falling.svg',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/fall.mp3')
        .volume(_vol(fx, 'fall', 0.7))
        .atLocation(token);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Falling.svg').play();
}

export async function playFallImpactFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.impact.boulder.02',
        'jb2a.impact.ground_crack.white.01',
        'modules/lancer-automations/FX/audio/IMPACT.mp3',
    ]);
    const scale = Math.floor(token.actor?.system?.size || 1);
    await new Sequence()
        .effect()
        .file('jb2a.impact.boulder.02')
        .atLocation(token)
        .scale(scale / 2)
        .effect()
        .file('jb2a.impact.ground_crack.white.01')
        .atLocation(token)
        .scale(scale / 2)
        .belowTokens()
        .sound()
        .file('modules/lancer-automations/FX/audio/IMPACT.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.7) ?? 0.7)
        .waitUntilFinished()
        .play();
}

export async function playSearchFX(token, target = null) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/radar-4.wav',
        'modules/lancer-automations/FX/svg/Search.svg',
        'jb2a.soundwave.01.blue',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/radar-4.wav')
        .volume(_weaponFx()?.getEffectVolume(0.5) ?? 0.5)
        .effect()
        .file('jb2a.soundwave.01.blue')
        .atLocation(token)
        .scaleToObject(6);
    if (target) {
        seq.effect()
            .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
            .atLocation(target)
            .scaleToObject(2)
            .tint(0x4a9eff)
            .belowTokens();
    }
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Search.svg').play();
}

export async function playSearchFoundFX(target) {
    if (!_canPlay() || !target)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/found.wav',
        'jb2a.ui.indicator.bluegreen.02.03',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/found.wav')
        .volume(_weaponFx()?.getEffectVolume(0.5) ?? 0.5)
        .effect()
        .file('jb2a.ui.indicator.bluegreen.02.03')
        .atLocation(target)
        .scaleToObject(1.6)
        .duration(360)
        .fadeIn(90)
        .fadeOut(140)
        .repeats(5, 200)
        .play();
}

export async function playSearchFailFX(target) {
    if (!_canPlay() || !target)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/foundfail.wav',
        'jb2a.extras.tmfx.outpulse.circle.01.normal',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/foundfail.wav')
        .volume(_weaponFx()?.getEffectVolume(0.5) ?? 0.5)
        .effect()
        .file('jb2a.extras.tmfx.outpulse.circle.01.normal')
        .atLocation(target)
        .scaleToObject(2)
        .play();
}

export async function playScanFX(caster, target) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/scan.mp3',
        'modules/lancer-automations/FX/svg/Scan.svg',
        'jb2a.markers_scifi.001.complete.003.white',
        'jb2a.zoning.outward.cone.once.bluegreen.01.02',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/scan.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6);
    if (target) {
        seq.effect()
            .file('jb2a.zoning.outward.cone.once.bluegreen.01.02')
            .atLocation(caster)
            .rotateTowards(target)
            .scaleToObject(3)
            .effect()
            .file('jb2a.markers_scifi.001.complete.003.white')
            .atLocation(target)
            .scaleToObject(2.5)
            .belowTokens();
    }
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Scan.svg').play();
}

/** Success ping on a target — blue circle inpulse + confirm sound. */
export async function playTargetSuccessFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.inpulse.circle.03.fast',
        'modules/lancer-automations/FX/audio/750428__rescopicsound__ui-alert-menu-modern-interface-confirm-small.mp3',
    ]);
    await new Sequence()
        .effect()
        .file('jb2a.extras.tmfx.inpulse.circle.03.fast')
        .atLocation(token)
        .scaleToObject(2)
        .tint(0x4a9eff)
        .sound()
        .file('modules/lancer-automations/FX/audio/750428__rescopicsound__ui-alert-menu-modern-interface-confirm-small.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .play();
}

/**
 * Build the attack-context variables (source, targets, miss/crit sets) from a
 * BasicAttackFlow state. Used by the inline-FX map below for LA-owned basic attacks.
 */
function _buildAttackContext(state) {
    const sourceToken = state.actor?.getActiveTokens?.()[0] ?? state.actor?.token?.object ?? null;
    const hitResults = state.data?.hit_results ?? [];
    const accDiffTargets = state.data?.acc_diff?.targets ?? [];
    const targetTokens = [];
    for (let i = 0; i < Math.max(hitResults.length, accDiffTargets.length); i++) {
        const t = hitResults[i]?.target ?? accDiffTargets[i]?.target ?? null;
        if (t)
            targetTokens.push(t);
    }
    const targetsMissed = new Set(hitResults.filter(hr => !hr.hit).map(hr => hr.target?.id).filter(Boolean));
    const targetsCrit = new Set(hitResults.filter(hr => hr.crit).map(hr => hr.target?.id).filter(Boolean));
    return { sourceToken, targetTokens, targetsMissed, targetsCrit };
}

export async function playDefaultThrowFX(state) {
    if (!_canPlay())
        return;
    const { sourceToken, targetTokens, targetsMissed } = _buildAttackContext(state);
    if (!sourceToken || targetTokens.length === 0)
        return;
    const fx = _weaponFx();
    await Sequencer.Preloader.preloadForClients([
        "modules/lancer-weapon-fx/soundfx/bladeswing.ogg",
        "modules/lancer-weapon-fx/soundfx/bladehit.ogg",
        "jb2a.ranged.02.projectile.01.yellow",
        "jb2a.impact.001.blue",
    ]);
    const volume = fx?.getEffectVolume(0.2) ?? 0.2;
    const launchDelay = 500;
    let i = 0;
    for (const target of targetTokens) {
        const seq = new Sequence();
        const isFacingLeft = target.x < sourceToken.x;
        seq.sound()
            .file("modules/lancer-weapon-fx/soundfx/bladeswing.ogg")
            .volume(volume)
            .delay(750);
        seq.effect()
            .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
            .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
            .file("jb2a.ranged.02.projectile.01.yellow")
            .atLocation(sourceToken)
            .mirrorY(isFacingLeft)
            .stretchTo(target)
            .missed(targetsMissed.has(target.id))
            .waitUntilFinished(-700);
        if (!targetsMissed.has(target.id)) {
            seq.effect()
                .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
                .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
                .file("jb2a.impact.001.blue")
                .atLocation(target)
                .scale(0.5);
            seq.sound()
                .file("modules/lancer-weapon-fx/soundfx/bladehit.ogg")
                .volume(volume);
        }
        const delayMs = launchDelay * i++;
        setTimeout(() => seq.play(), delayMs);
    }
}

/**
 * Inline attack FX keyed by BasicAttackFlow state.data.title. main.js dispatches
 * into this map after printAttackCard for LA-owned standalone basic attacks.
 */
export const LA_INLINE_ATTACK_FX = {
    'Ram': async (state) => {
        if (!_canPlay())
            return;
        const { targetTokens, targetsMissed, targetsCrit } = _buildAttackContext(state);
        if (targetTokens.length === 0)
            return;
        const fx = _weaponFx();
        const volume = fx?.getEffectVolume(0.7) ?? 0.7;
        fx?.preloadMissAndCrit?.();
        const seq = new Sequence();
        for (const target of targetTokens) {
            seq.sound()
                .file('modules/lancer-automations/FX/audio/ram_impact.wav')
                .playIf(!targetsMissed.has(target.id))
                .volume(volume);
            seq.effect()
                .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
                .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
                .file('jb2a.impact.005.white')
                .playIf(!targetsMissed.has(target.id))
                .atLocation(target)
                .scaleToObject(2.5)
                .waitUntilFinished(-500);
            if (targetsMissed.has(target.id) && fx?.addMissToSequence)
                fx.addMissToSequence(seq, target.id);
            if (targetsCrit.has(target.id) && fx?.addCritToSequence)
                fx.addCritToSequence(seq, target.id);
        }
        await seq.play();
    },

    'Grapple': async (state) => {
        if (!_canPlay())
            return;
        const { sourceToken, targetTokens, targetsMissed, targetsCrit } = _buildAttackContext(state);
        if (targetTokens.length === 0)
            return;
        const fx = _weaponFx();
        const volume = fx?.getEffectVolume(0.7) ?? 0.7;
        fx?.preloadMissAndCrit?.();
        const seq = new Sequence();
        seq.sound()
            .file('modules/lancer-automations/FX/audio/grapple_gun.wav')
            .volume(volume);
        for (const target of targetTokens) {
            if (sourceToken) {
                seq.effect()
                    .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
                    .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
                    .file('jb2a.template_line_piercing.generic.01.orange')
                    .atLocation(sourceToken)
                    .stretchTo(target);
            }
            seq.sound()
                .file('modules/lancer-automations/FX/audio/rope-swinging.wav')
                .playIf(!targetsMissed.has(target.id))
                .volume(volume);
            seq.effect()
                .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
                .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
                .file('jb2a.markers.chain.standard.complete.02.grey')
                .playIf(!targetsMissed.has(target.id))
                .atLocation(target)
                .scaleToObject(1.5)
                .playbackRate(2)
                .fadeOut(500)
                .waitUntilFinished(-500);
            if (targetsMissed.has(target.id) && fx?.addMissToSequence)
                fx.addMissToSequence(seq, target.id);
            if (targetsCrit.has(target.id) && fx?.addCritToSequence)
                fx.addCritToSequence(seq, target.id);
        }
        await seq.play();
    }
};

/**
 * Resolve a placeable token for an actor, preferring one on the current scene.
 * @param {any} actor
 */
function _tokenForActor(actor) {
    if (!actor)
        return null;
    if (actor.token?.object)
        return actor.token.object;
    const sceneId = canvas?.scene?.id;
    const tokens = actor.getActiveTokens() || [];
    return tokens.find(t => t?.scene?.id === sceneId) || tokens[0] || null;
}

export function _flowSourceToken(flow) {
    const actor = flow?.state?.actor;
    if (!actor)
        return null;
    const direct = _tokenForActor(actor);
    if (direct)
        return direct;
    // Pilot actor with no on-scene token: fall back to the active mech's token.
    const activeMech = actor.system?.active_mech?.value;
    return activeMech ? _tokenForActor(activeMech) : null;
}

/**
 * Resolve the action object from a flow (TechAttackFlow, ActivationFlow, SystemFlow).
 * preFlow hooks fire BEFORE initActivationData, so state.data.action/title are null —
 * fall back to state.data.action_path (Lancer's key) or the default "system.actions.0".
 * @param {any} flow
 */
function _flowAction(flow) {
    const data = flow?.state?.data;
    if (!data)
        return null;
    if (data.action)
        return data.action;
    const item = flow.state.item;
    if (!item)
        return null;
    const path = data.action_path || data.path || 'system.actions.0';
    return foundry.utils.getProperty(item, path) || null;
}

/** Resolve the title for a flow, falling back to the resolved action's name or item name. */
function _flowTitle(flow) {
    const t = flow?.state?.data?.title;
    if (t)
        return t;
    const action = _flowAction(flow);
    return action?.name || flow?.state?.item?.name || null;
}

/** Tag LID → activation label (mirror of ACTIVATION_TAG_MAP in misc-tools.js). */
const _NPC_TAG_TO_ACTIVATION = {
    tg_quick_action: 'Quick',
    tg_full_action: 'Full',
    tg_quick_tech: 'Quick Tech',
    tg_full_tech: 'Full Tech',
    tg_protocol: 'Protocol',
    tg_reaction: 'Reaction',
    tg_free_action: 'Free',
    tg_invade: 'Invade',
};

/**
 * Resolve the activation label (Quick / Full / Quick Tech / Full Tech / Protocol / …) for a flow.
 * Handles mech/pilot actions (action.activation), NPC tech features (system.tech_type),
 * and NPC feature SystemFlows (activation tag / system.type fallback).
 * @param {any} flow
 */
export function _flowResolveActivationLabel(flow) {
    const item = flow?.state?.item;
    if (item?.type === 'npc_feature') {
        if (item.system?.type === 'Tech') {
            const t = item.system.tech_type;
            if (t === 'Quick')
                return 'Quick Tech';
            if (t === 'Full')
                return 'Full Tech';
        }
        for (const tag of (item.system?.tags ?? [])) {
            const mapped = _NPC_TAG_TO_ACTIVATION[tag?.lid];
            if (mapped)
                return mapped;
        }
        const sysType = item.system?.type;
        if (sysType === 'Quick' || sysType === 'Full' || sysType === 'Protocol'
            || sysType === 'Reaction' || sysType === 'Free')
            return sysType;
    }
    return _flowAction(flow)?.activation || null;
}

/** Titles of actions that already play their own specific FX — skip generic Quick/Full dispatch for these. */
const _TITLES_WITH_SPECIFIC_FX = new Set([
    'Skirmish', 'Barrage', 'Ram', 'Grapple', 'End Grapple', 'Break Free',
    'Boost', 'Hide', 'Search', 'Scan', 'Handle', 'Interact', 'Prepare',
    'Disengage', 'Dismount', 'Eject', 'Boot Up', 'Shut Down', 'Standing Up',
    'Fall', 'Teleport', 'Reactor Meltdown', 'Fight', 'Fragment Signal',
    'Overcharge', 'Stabilize', 'Full Repair', 'Mount', 'Jockey',
    'Lock On', 'Bolster', 'Aid', 'Brace',
]);

/** Dispatch a tech-tier or generic-tier action FX based on activation + title. */
export function playActionFxByActivation(activation, token, title) {
    _playActionFxForActivation(activation, token, title);
}
function _playActionFxForActivation(activation, token, title) {
    if (activation === 'Quick Tech')
        playQuickTechFX(token);
    else if (activation === 'Full Tech')
        playFullTechFX(token);
    else if (!_TITLES_WITH_SPECIFIC_FX.has(title)) {
        if (activation === 'Quick')
            playQuickActionFX(token);
        else if (activation === 'Full')
            playFullActionFX(token);
        else if (activation === 'Protocol')
            playProtocolFX(token);
        else if (activation === 'Free') {
            const svg = title === 'Squeeze'
                ? 'modules/lancer-automations/FX/svg/Squeeze.svg'
                : 'modules/lancer-automations/FX/svg/FreeAction.svg';
            playFreeActionFX(token, svg);
        } else if (activation === 'Reaction') {
            const svg = title === 'Overwatch'
                ? 'modules/lancer-automations/FX/svg/Overwatch.svg'
                : 'modules/lancer-automations/FX/svg/Reaction.svg';
            playReactionFX(token, svg);
        }
    }
}

/** Fires invade FX when TechAttackFlow starts with `invade: true`, else dispatches by activation. */
Hooks.on('lancer.preFlow.TechAttackFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    if (flow.state.data?.invade) {
        playInvadeFX(token);
        return;
    }
    _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow));
});

/** Fires Core Power FX when a CoreActiveFlow starts. */
Hooks.on('lancer.preFlow.CoreActiveFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (token)
        playCorePowerFX(token);
});

/** Fires Quick/Full Tech or generic Quick FX when ActivationFlow/SystemFlow starts. */
Hooks.on('lancer.preFlow.ActivationFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (token)
        _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow));
});
Hooks.on('lancer.preFlow.SystemFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (token)
        _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow));
});

/** Fires named action FX when a SimpleActivationFlow starts with a matching title. */
Hooks.on('lancer.preFlow.SimpleActivationFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    const title = _flowTitle(flow);
    if (title === 'Handle')
        playHandleFX(token);
    else if (title === 'Interact')
        playInteractFX(token);
    else if (title === 'Prepare')
        playPrepareFX(token);
    else
        _playActionFxForActivation(_flowResolveActivationLabel(flow), token, title);
});

/** Per-damage-type JB2A impact sprite played on the damaged target token. */
const DAMAGE_IMPACT_FX = {
    kinetic:   'jb2a.impact.009.white',
    energy:    'jb2a.impact.003.blue',
    explosive: 'jb2a.impact.005.orange',
    variable:  'jb2a.impact.007.purple',
    infection: 'jb2a.impact.011.green02',
    heat:      'jb2a.impact.004.orange',
    burn:      'jb2a.impact.014.002.orangeyellow',
    armor:     'jb2a.impact.008.orange',
    hit_overshield: 'jb2a.impact.010.blue',
};

/** Play a single damage-type impact effect at the target token. */
export async function playDamageImpactFX(type, target) {
    if (!_canPlay() || !target)
        return;
    const key = String(type ?? '').toLowerCase().trim();
    const file = DAMAGE_IMPACT_FX[key];
    if (!file)
        return;
    // Random offset within the token's radius, like a splash pattern.
    const tokenSize = Number(target?.document?.width ?? target?.w ?? 1);
    const gridSize = canvas?.grid?.size ?? 100;
    const radius = (tokenSize * gridSize) / 2;
    const angle = Math.random() * Math.PI * 2;
    const r = Math.random() * radius;
    const offset = { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
    await Sequencer.Preloader.preloadForClients([file]);
    const seq = new Sequence()
        .effect()
        .file(file)
        .atLocation(target, { offset })
        .scaleToObject(2.5)
        .playbackRate(0.8);
    if (key === 'hit_overshield')
        seq.filter('ColorMatrix', { saturate: -1, brightness: 1.3 });
    seq.play();
}

/** Failure ping on a target — red miss + border inpulse + deny sound. */
function _isFriendlyTo(origin, target) {
    const tf = game.modules.get('token-factions');
    if (tf?.active && typeof tf.api?.getDisposition === 'function') {
        try {
            return tf.api.getDisposition(origin, target) === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        } catch { /* fall through */ }
    }
    const oDisp = origin?.document?.disposition ?? 0;
    const tDisp = target?.document?.disposition ?? 0;
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
    const isBad = (d) => d === HOSTILE || d === SECRET;
    return isBad(oDisp) === isBad(tDisp);
}

export async function playBonusAddedFX(token, origin = null) {
    if (!_canPlay() || !token)
        return;
    const arrow = origin
        ? (_isFriendlyTo(origin, token)
            ? 'jb2a.zoning.directional.once.bluegreen.line400.03'
            : 'jb2a.zoning.directional.once.redyellow.line400.03')
        : null;
    const preload = ['jb2a.extras.tmfx.inpulse.circle.04'];
    if (arrow)
        preload.push(arrow);
    await Sequencer.Preloader.preloadForClients(preload);
    const seq = new Sequence();
    if (arrow && origin && origin.id !== token.id) {
        seq.effect()
            .file(arrow)
            .atLocation(origin)
            .stretchTo(token)
            .playbackRate(2.5);
    }
    seq.effect()
        .file('jb2a.extras.tmfx.inpulse.circle.04')
        .atLocation(token)
        .scaleToObject(2);
    seq.play();
    playStatusSfxSound('bonus');
}

export async function playTargetFailFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.border.circle.inpulse.01.normal',
        'jb2a.ui.miss.red',
        'modules/lancer-automations/FX/audio/denyerror-sound.wav',
    ]);
    await new Sequence()
        .effect()
        .file('jb2a.extras.tmfx.border.circle.inpulse.01.normal')
        .atLocation(token)
        .scaleToObject(2)
        .effect()
        .file('jb2a.ui.miss.red')
        .atLocation(token)
        .scaleToObject(1.5)
        .sound()
        .file('modules/lancer-automations/FX/audio/denyerror-sound.wav')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .play();
}

const _activeSeqBySource = new Map();
const _effectIdToSource = new Map();
const _sourceKey = (src) => src?.id ?? src?.uuid ?? (typeof src === 'string' ? src : null);
const _bumpSource = (key, delta) => {
    if (!key)
        return;
    const count = (_activeSeqBySource.get(key) ?? 0) + delta;
    if (count <= 0)
        _activeSeqBySource.delete(key);
    else
        _activeSeqBySource.set(key, count);
};
Hooks.on('createSequencerEffect', data => {
    const key = _sourceKey(data?.source);
    if (!key)
        return;
    const eid = data?.id ?? data?.effectData?.id;
    if (eid)
        _effectIdToSource.set(eid, key);
    _bumpSource(key, +1);
});
Hooks.on('endedSequencerEffect', data => {
    const eid = data?.id ?? data?.effectData?.id;
    if (eid && _effectIdToSource.has(eid)) {
        const key = _effectIdToSource.get(eid);
        _effectIdToSource.delete(eid);
        _bumpSource(key, -1);
        return;
    }
    _bumpSource(_sourceKey(data?.source), -1);
});

async function _waitForSourceEffectsToEnd(sourceToken, { initialMs = 200, pollMs = 100, timeoutMs = 10000 } = {}) {
    if (!sourceToken)
        return;
    const id = sourceToken.id ?? sourceToken.uuid;
    const baseline = _activeSeqBySource.get(id) ?? 0;
    await new Promise(r => setTimeout(r, initialMs));
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if ((_activeSeqBySource.get(id) ?? 0) <= baseline)
            return;
        await new Promise(r => setTimeout(r, pollMs));
    }
}

const _missCritOverlayHandler = async (flow) => {
    if (!isActionFXEnabled() || typeof Sequencer === 'undefined')
        return;
    try {
        const hitResults = flow?.state?.data?.hit_results ?? [];
        if (!hitResults.length)
            return;
        await Sequencer.Preloader.preloadForClients([
            'jb2a.ui.miss.red',
            'jb2a.ui.critical.yellow',
            'jb2a.ui.hit.blue',
        ]);
        const sourceToken = flow?.state?.actor?.getActiveTokens?.()?.[0];
        await _waitForSourceEffectsToEnd(sourceToken);
        const seq = new Sequence();
        let i = 0;
        for (const hr of hitResults) {
            const tokenObj = hr?.target?.object ?? hr?.target;
            if (!tokenObj)
                continue;
            let file;
            let soundKey;
            if (hr.crit) {
                file = 'jb2a.ui.critical.yellow';
                soundKey = 'crit';
            } else if (hr.hit) {
                file = 'jb2a.ui.hit.blue';
                soundKey = 'hit';
            } else {
                file = 'jb2a.ui.miss.red';
                soundKey = 'miss';
            }
            const delay = i++ * 250;
            seq.effect()
                .file(file)
                .attachTo(tokenObj)
                .scale(0.5)
                .delay(delay);
            setTimeout(() => playStatsSound(soundKey), delay);
        }
        seq.play();
    } catch (e) {
        console.error('lancer-automations | miss/crit overlay failed:', e);
    }
};
Hooks.on('lancer.postFlow.BasicAttackFlow', _missCritOverlayHandler);
Hooks.on('lancer.postFlow.WeaponAttackFlow', _missCritOverlayHandler);
Hooks.on('lancer.postFlow.TechAttackFlow', _missCritOverlayHandler);

export async function playContestedOutcomeFX(winnerToken, loserToken) {
    if (!isActionFXEnabled() || typeof Sequencer === 'undefined')
        return;
    try {
        await Sequencer.Preloader.preloadForClients(['jb2a.ui.success.green', 'jb2a.ui.failure.red']);
        if (winnerToken) {
            new Sequence()
                .effect()
                .file('jb2a.ui.success.green')
                .attachTo(winnerToken)
                .scale(0.5)
                .play();
            playStatsSound('success');
        }
        if (loserToken) {
            new Sequence()
                .effect()
                .file('jb2a.ui.failure.red')
                .attachTo(loserToken)
                .scale(0.5)
                .play();
            playStatsSound('fail');
        }
    } catch (e) {
        console.error('lancer-automations | contested outcome FX failed:', e);
    }
}

export async function playStatRollOutcomeFX(token, success, { waitForActiveFX = true } = {}) {
    if (!isActionFXEnabled() || typeof Sequencer === 'undefined' || !token)
        return;
    try {
        const file = success ? 'jb2a.ui.success.green' : 'jb2a.ui.failure.red';
        const soundKey = success ? 'success' : 'fail';
        await Sequencer.Preloader.preloadForClients([file]);
        if (waitForActiveFX) {
            await _waitForSourceEffectsToEnd(token);
            await new Promise((r) => setTimeout(r, 600));
        }
        new Sequence()
            .effect()
            .file(file)
            .attachTo(token)
            .scale(0.5)
            .play();
        playStatsSound(soundKey);
    } catch (e) {
        console.error('lancer-automations | stat roll overlay failed:', e);
    }
}

const _statRollOverlayHandler = async (flow) => {
    if (flow?.state?.la_extraData?.suppressStatFX)
        return;
    const total = flow?.state?.data?.result?.roll?.total;
    if (typeof total !== 'number')
        return;
    const sourceToken = flow?.state?.actor?.getActiveTokens?.()?.[0];
    if (!sourceToken)
        return;
    await playStatRollOutcomeFX(sourceToken, total >= 10);
};
Hooks.on('lancer.postFlow.StatRollFlow', _statRollOverlayHandler);
