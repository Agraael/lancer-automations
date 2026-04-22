/* global game, Sequence, Sequencer, Hooks, canvas, foundry */

import { isActionFXEnabled } from './statusFX.js';

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
    const soundFile = `modules/lancer-automations/SFX/Skirmish${1 + Math.floor(Math.random() * 3)}.wav`;
    await Sequencer.Preloader.preloadForClients([
        soundFile,
        'modules/lancer-automations/SFX/Skirmish.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    new Sequence()
        .sound()
        .file(soundFile)
        .volume(fx.getEffectVolume(0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/Skirmish.svg')
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
        'modules/lancer-automations/SFX/jetpack_unpack_1.wav',
        'modules/lancer-automations/SFX/smokeimpact.wav',
        'modules/lancer-automations/SFX/Eject.svg',
        'jb2a.pack_hound_missile',
        'jb2a.smoke.puff.ring.01.white',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const sourceSeq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/jetpack_unpack_1.wav')
        .volume(fx.getEffectVolume(0.5))
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
    _appendActionBadge(sourceSeq, source, 'modules/lancer-automations/SFX/Eject.svg');
    sourceSeq.play();

    if (dest) {
        new Sequence()
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
            .file('modules/lancer-automations/SFX/smokeimpact.wav')
            .volume(fx.getEffectVolume(0.5))
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
        'modules/lancer-automations/SFX/Selfdead.svg',
        'jb2a.static_electricity.03',
        'jb2a.smoke.plumes.01.grey',
        'jb2a.breath_weapons02.burst.line.fire.orange.01',
        'jb2a.moonbeam.01.loop',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/dramaticSparkles.ogg')
        .volume(fx.getEffectVolume(0.2))
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/ReactorWarning.ogg')
        .volume(fx.getEffectVolume(0.5))
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
        .file('modules/lancer-automations/SFX/Selfdead.svg')
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
        .file('jb2a.static_electricity.03')
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
        .volume(fx.getEffectVolume(0.5))
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
        .volume(fx.getEffectVolume(0.5))
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
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/Teleport.svg',
    ]);
    _appendActionBadge(new Sequence(), caster, 'modules/lancer-automations/SFX/Teleport.svg').play();
}

export async function playBootUpFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/bootup.wav',
        'modules/lancer-automations/SFX/BootUp.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.energy_strands.in.yellow',
        'jb2a.ui.heartbeat.01.yellow',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/bootup.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/BootUp.svg')
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
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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
        'modules/lancer-automations/SFX/liftoff.wav',
        'modules/lancer-automations/SFX/Dismount.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/liftoff.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Dismount.svg').play();
}

export async function playDisengageFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/742717__artix0__dash-sound-effect.wav',
        'modules/lancer-automations/SFX/Disengage.svg',
        'jb2a.extras.tmfx.outpulse.line.02.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/742717__artix0__dash-sound-effect.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.outpulse.line.02.normal')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Disengage.svg').play();
}

export async function playDeployableFX(deployedToken) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/deploy.wav',
        'modules/lancer-automations/SFX/Deployable.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/deploy.wav')
        .volume(fx.getEffectVolume(0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/Deployable.svg')
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
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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

export async function playFreeActionFX(caster, svg = 'modules/lancer-automations/SFX/FreeAction.svg') {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/free.wav',
        svg,
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.green',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/free.wav')
        .volume(fx.getEffectVolume(0.35))
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
        'modules/lancer-automations/SFX/corepower.wav',
        'modules/lancer-automations/SFX/CorePower.svg',
        'jb2a.on_token_buff.002.002.orangeyellow',
        'jb2a.template_circle.out_pulse.02.burst.greenorange',
        'jb2a.static_electricity.01.yellow',
        'jb2a.ui.heartbeat.01.yellow',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/corepower.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/CorePower.svg')
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
        'modules/lancer-automations/SFX/protocol.wav',
        'modules/lancer-automations/SFX/Protocol.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.green',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/protocol.wav')
        .volume(fx.getEffectVolume(0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/Protocol.svg')
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

export async function playReactionFX(caster, svg = 'modules/lancer-automations/SFX/Reaction.svg') {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/reaction.wav',
        svg,
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.purple',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/reaction.wav')
        .volume(fx.getEffectVolume(0.35))
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
        'modules/lancer-automations/SFX/fullaction.wav',
        'modules/lancer-automations/SFX/FullAction.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/fullaction.wav')
        .volume(fx.getEffectVolume(0.60))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/FullAction.svg')
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
        'modules/lancer-automations/SFX/quickaction.wav',
        'modules/lancer-automations/SFX/QuickAction.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/quickaction.wav')
        .volume(fx.getEffectVolume(0.60))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/QuickAction.svg')
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
        'modules/lancer-automations/SFX/standingup.mp3',
        'modules/lancer-automations/SFX/Standing.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/standingup.mp3')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Standing.svg').play();
}

export async function playPrepareFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/prepare.wav',
        'modules/lancer-automations/SFX/Prepare.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/prepare.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Prepare.svg').play();
}

export async function playInteractFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/interact.wav',
        'modules/lancer-automations/SFX/Interact.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/interact.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Interact.svg').play();
}

export async function playHandleFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/handle.wav',
        'modules/lancer-automations/SFX/Handle.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/handle.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Handle.svg').play();
}

export async function playFullTechFX(caster) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/fulltech.wav',
        'modules/lancer-automations/SFX/FullTech.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.static_electricity.03.blue02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/fulltech.wav')
        .volume(fx.getEffectVolume(0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/FullTech.svg')
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
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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
        'modules/lancer-automations/SFX/quicktech.wav',
        'modules/lancer-automations/SFX/QuickTech.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.static_electricity.03.blue02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/quicktech.wav')
        .volume(fx.getEffectVolume(0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/QuickTech.svg')
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
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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
        'modules/lancer-automations/SFX/invade.wav',
        'modules/lancer-automations/SFX/invade.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.fast',
        'jb2a.static_electricity.03.green02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/invade.wav')
        .volume(fx.getEffectVolume(0.3))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/invade.svg')
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
        .file('jb2a.extras.tmfx.inpulse.circle.01.fast')
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
        'modules/lancer-automations/SFX/harpoon-deploy-swoosh.wav',
        'modules/lancer-automations/SFX/grapple.svg',
        'jb2a.extras.tmfx.inpulse.circle.04.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/harpoon-deploy-swoosh.wav')
        .volume(fx.getEffectVolume(0.5))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.04.normal')
        .atLocation(caster)
        .scaleToObject(2);
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/grapple.svg').play();
}

export async function playRamFX(caster, target) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/ram.wav',
        'modules/lancer-automations/SFX/Ram.svg',
        'jb2a.zoning.directional.once.redyellow.line200.01',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/ram.wav')
        .volume(fx.getEffectVolume(0.5));
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
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Ram.svg').play();
}

export async function playBarrageFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/barrage.wav',
        'modules/lancer-automations/SFX/Barrage.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/barrage.wav')
        .volume(fx.getEffectVolume(0.35))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('modules/lancer-automations/SFX/Barrage.svg')
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
        'modules/lancer-automations/SFX/boost.wav',
        'modules/lancer-automations/SFX/Boost.svg',
        'jb2a.zoning.directional.once.bluegreen.line200.02',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/boost.wav')
        .volume(fx.getEffectVolume(0.3))
        .effect()
        .file('jb2a.zoning.directional.once.bluegreen.line200.02')
        .scaleToObject(1.5)
        .filter('Glow', { color: 0x00CED1 })
        .atLocation(token);
    _appendActionBadge(seq, token, 'modules/lancer-automations/SFX/Boost.svg').play();
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
        'jb2a.static_electricity.03',
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
        .volume(fx.getEffectVolume(0.5))
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
        .file('jb2a.static_electricity.03')
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
    seq.play();
}

export async function playHideFX(token) {
    if (!_canPlay())
        return;
    const seq = new Sequence()
        .effect()
        .file('jb2a.smoke.puff.centered.grey')
        .atLocation(token)
        .scale(1.1)
        .sound()
        .file('modules/lancer-automations/SFX/PuffSmoke.wav')
        .volume(_weaponFx()?.getEffectVolume(0.7) ?? 0.7);
    _appendActionBadge(seq, token, 'modules/lancer-automations/SFX/Hide.svg').play();
}

export async function playShutDownFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/shutdown.wav',
        'modules/lancer-automations/SFX/Shutdown.svg',
        'jb2a.extras.tmfx.inpulse.circle.02.normal',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/shutdown.wav')
        .volume(fx.getEffectVolume(0.7))
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
    _appendActionBadge(seq, token, 'modules/lancer-automations/SFX/Shutdown.svg').play();
}

export async function playFallFX(token) {
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/fall.mp3',
        'modules/lancer-automations/SFX/falling.svg',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/fall.mp3')
        .volume(fx.getEffectVolume(0.7))
        .atLocation(token);
    _appendActionBadge(seq, token, 'modules/lancer-automations/SFX/falling.svg').play();
}

export async function playFallImpactFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.impact.boulder.02',
        'jb2a.impact.ground_crack.white.01',
        'modules/lancer-automations/SFX/IMPACT.mp3',
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
        .file('modules/lancer-automations/SFX/IMPACT.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.7) ?? 0.7)
        .waitUntilFinished()
        .play();
}

export async function playSearchFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/radar-4.wav',
        'modules/lancer-automations/SFX/Search.svg',
        'jb2a.soundwave.01.blue',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/radar-4.wav')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .effect()
        .file('jb2a.soundwave.01.blue')
        .atLocation(token)
        .scaleToObject(3);
    _appendActionBadge(seq, token, 'modules/lancer-automations/SFX/Search.svg').play();
}

export async function playScanFX(caster, target) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/SFX/scan.mp3',
        'modules/lancer-automations/SFX/Scan.svg',
        'jb2a.markers_scifi.001.complete.003.white',
        'jb2a.zoning.outward.cone.once.bluegreen.01.02',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/SFX/scan.mp3')
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
            .scaleToObject(2.5);
    }
    _appendActionBadge(seq, caster, 'modules/lancer-automations/SFX/Scan.svg').play();
}

/** Success ping on a target — blue circle inpulse + confirm sound. */
export async function playTargetSuccessFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.inpulse.circle.03.fast',
        'modules/lancer-automations/SFX/750428__rescopicsound__ui-alert-menu-modern-interface-confirm-small.mp3',
    ]);
    new Sequence()
        .effect()
        .file('jb2a.extras.tmfx.inpulse.circle.03.fast')
        .atLocation(token)
        .scaleToObject(2)
        .tint(0x4a9eff)
        .sound()
        .file('modules/lancer-automations/SFX/750428__rescopicsound__ui-alert-menu-modern-interface-confirm-small.mp3')
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
                .file('modules/lancer-automations/SFX/ram_impact.wav')
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
            .file('modules/lancer-automations/SFX/grapple_gun.wav')
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
                .file('modules/lancer-automations/SFX/rope-swinging.wav')
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

function _flowSourceToken(flow) {
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
function _flowTechActivation(flow) {
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
                ? 'modules/lancer-automations/SFX/Squeeze.svg'
                : 'modules/lancer-automations/SFX/FreeAction.svg';
            playFreeActionFX(token, svg);
        } else if (activation === 'Reaction') {
            const svg = title === 'Overwatch'
                ? 'modules/lancer-automations/SFX/Overwatch.svg'
                : 'modules/lancer-automations/SFX/Reaction.svg';
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
    _playActionFxForActivation(_flowTechActivation(flow), token, _flowTitle(flow));
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
        _playActionFxForActivation(_flowTechActivation(flow), token, _flowTitle(flow));
});
Hooks.on('lancer.preFlow.SystemFlow', (flow) => {
    const token = _flowSourceToken(flow);
    if (token)
        _playActionFxForActivation(_flowTechActivation(flow), token, _flowTitle(flow));
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
        _playActionFxForActivation(_flowTechActivation(flow), token, title);
});

/** Failure ping on a target — red miss + border inpulse + deny sound. */
export async function playTargetFailFX(token) {
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.border.circle.inpulse.01',
        'jb2a.ui.miss.red',
        'modules/lancer-automations/SFX/denyerror-sound.wav',
    ]);
    new Sequence()
        .effect()
        .file('jb2a.extras.tmfx.border.circle.inpulse.01')
        .atLocation(token)
        .scaleToObject(2)
        .effect()
        .file('jb2a.ui.miss.red')
        .atLocation(token)
        .scaleToObject(1.5)
        .sound()
        .file('modules/lancer-automations/SFX/denyerror-sound.wav')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .play();
}
