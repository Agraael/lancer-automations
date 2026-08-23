/* global game, Sequence, Sequencer, Hooks, canvas, foundry */

import { isActionFXEnabled, isRollResultFXEnabled, isDamageImpactFXEnabled } from './statusFX.js';
import { playStatsSound, playStatusSfxSound } from '../tah/sound.js';

// Action FX sequences; every one no-ops unless Sequencer and lancer-weapon-fx are active and Action FX is enabled.

function _weaponFx()
{
    const mod = game.modules.get('lancer-weapon-fx');
    return mod?.active ? mod.api : null;
}

function _canPlay()
{
    return isActionFXEnabled() && typeof Sequencer !== 'undefined';
}

// weapon-fx volume × master, 0 if the per-action toggle is off. scale read from ACTION_FX_PREVIEW.
function _vol(fx, action)
{
    const scale = ACTION_FX_PREVIEW[action]?.scale ?? 0.5;
    try
    {
        if (game.settings.get('lancer-automations', `tah.actionFxSound.${action}`) === false)
            return 0;
        const master = Number(game.settings.get('lancer-automations', 'tah.actionFxVolume'));
        return fx.getEffectVolume(scale) * (Number.isFinite(master) ? master : 1);
    }
    catch
    {
        return fx.getEffectVolume(scale);
    }
}

const ACTION_FX_PREVIEW = {
    skirmish:    { src: () => `modules/lancer-automations/FX/audio/skirmish_${1 + Math.floor(Math.random() * 3)}.wav`, scale: 0.35 },
    barrage:     { src: 'modules/lancer-automations/FX/audio/barrage.wav', scale: 0.35 },
    eject:        { src: 'modules/lancer-automations/FX/audio/eject.wav', scale: 0.5 },
    selfDestruct: { src: 'modules/lancer-weapon-fx/soundfx/Annihilator.ogg', scale: 0.5 },
    bootUp:       { src: 'modules/lancer-automations/FX/audio/bootup.wav', scale: 0.5 },
    dismount:     { src: 'modules/lancer-automations/FX/audio/liftoff.wav', scale: 0.5 },
    mount:        { src: 'modules/lancer-automations/FX/audio/mount.ogg', scale: 0.5 },
    reload:       { src: 'modules/lancer-automations/FX/audio/reload.wav', scale: 0.5 },
    fight:        { src: 'modules/lancer-automations/FX/audio/fight.wav', scale: 0.35 },
    jockey:       { src: 'modules/lancer-automations/FX/audio/jockey.wav', scale: 0.5 },
    disengage:    { src: 'modules/lancer-automations/FX/audio/disengage.wav', scale: 0.5 },
    deployable:   { src: 'modules/lancer-automations/FX/audio/deploy.wav', scale: 0.35 },
    freeAction:   { src: 'modules/lancer-automations/FX/audio/free.wav', scale: 0.35 },
    corePower:    { src: 'modules/lancer-automations/FX/audio/corepower.wav', scale: 0.5 },
    protocol:     { src: 'modules/lancer-automations/FX/audio/protocol.wav', scale: 0.35 },
    activation:   { src: 'modules/lancer-automations/FX/audio/activation.wav', scale: 0.35 },
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
    grapple:      { src: 'modules/lancer-automations/FX/audio/grapple.wav', scale: 0.5 },
    ram:          { src: 'modules/lancer-automations/FX/audio/ram.wav', scale: 0.5 },
    boost:        { src: 'modules/lancer-automations/FX/audio/boost.wav', scale: 0.3 },
    overchargeNpc:{ src: 'modules/lancer-weapon-fx/soundfx/Overcharge.ogg', scale: 0.5 },
    shutDown:     { src: 'modules/lancer-automations/FX/audio/shutdown.wav', scale: 0.7 },
    fall:         { src: 'modules/lancer-automations/FX/audio/fall.mp3', scale: 0.7 },
    fallImpact:   { src: 'modules/lancer-automations/FX/audio/fallImpact.mp3', scale: 0.5 },
    search:       { src: 'modules/lancer-automations/FX/audio/search.wav', scale: 0.5 },
    scan:         { src: 'modules/lancer-automations/FX/audio/scan.mp3', scale: 0.7 },
    targetSuccess:{ src: 'modules/lancer-automations/FX/audio/targetSuccess.mp3', scale: 0.5 },
    targetFail:   { src: 'modules/lancer-automations/FX/audio/targetFail.wav', scale: 0.5 },
    hide:         { src: 'modules/lancer-automations/FX/audio/hide.wav', scale: 0.7 },
    defaultThrow: { src: 'modules/lancer-weapon-fx/soundfx/bladeswing.ogg', scale: 0.2 },
    teleport:     { src: 'modules/lancer-automations/FX/audio/teleport.wav', scale: 0.2 },
    mineDetonation: { src: 'modules/lancer-automations/FX/audio/extra/mineDetonation.wav', scale: 0.5 },
};

/**
 * Read the Lancer size off whatever `.atLocation()` was handed. Deployables keep it under
 * `system.stats`, everything else under `system`.
 * @param {any} source  Token, TokenDocument or Actor
 * @returns {number}
 */
function _lancerSize(source)
{
    const actor = source?.actor ?? source?.document?.actor ?? source;
    return actor?.system?.size ?? actor?.system?.stats?.size ?? 1;
}

let _LwfxSequence = null;

/**
 * Sequence factory stamping `moduleName`; shadows the global inside lwfx macros.
 * @returns {any}
 */
export function _lwfxTaggedSequence()
{
    if (_LwfxSequence)
        return _LwfxSequence;
    if (typeof Sequence === 'undefined')
        return null;
    _LwfxSequence = function (options = {}, softFail = false)
    {
        return new Sequence(typeof options === 'string' ? options : { moduleName: 'Lancer Weapon FX', ...options }, softFail);
    };
    return _LwfxSequence;
}

/**
 * Lift lwfx effects above token art (Sequencer 4 started honoring `.belowTokens()` on v13).
 * @returns {void}
 */
export function registerWeaponFxAboveTokens()
{
    Hooks.on('preCreateSequencerEffect', (data) =>
    {
        if (data?.moduleName !== 'Lancer Weapon FX')
            return;
        try
        {
            if (!game.settings.get('lancer-automations', 'weaponFxAboveTokens'))
                return;
        }
        catch
        {
            return;
        }
        if (data.screenSpace || data.screenSpaceAboveUI || data.aboveInterface)
            return;
        data.aboveLighting = true;
    });
}

/**
 * `la_scaleToBurst` preset: sizes an effect to a Burst around its source, in grid units.
 * Reads the source from the section, so `.atLocation()` must come first.
 * @returns {void}
 */
export function registerSequencerPresets()
{
    if (typeof Sequencer === 'undefined')
        return;
    Sequencer.Presets.add('la_scaleToBurst', (effect, burst = 1, source = null) =>
    {
        const span = _lancerSize(source ?? effect._source) * 2 * (burst + 1);
        return effect.size({ width: span, height: span }, { gridUnits: true });
    }, true);
}

/** @param {string} action */
export function previewActionFxSound(action)
{
    const entry = ACTION_FX_PREVIEW[action];
    if (!entry)
    {
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
 * Shared "action badge" effect: the animated SVG corner icon + glow.
 * @param {any} seq  Existing Sequence to chain onto
 * @param {any} token
 * @param {string} svgFile
 * @param {number} [duration=3000]
 */
function _appendActionBadge(seq, token, svgFile, duration = 3000)
{
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

export async function playSkirmishFX(token)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const soundFile = `modules/lancer-automations/FX/audio/skirmish_${1 + Math.floor(Math.random() * 3)}.wav`;
    await Sequencer.Preloader.preloadForClients([
        soundFile,
        'modules/lancer-automations/FX/svg/Skirmish.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    await new Sequence()
        .sound()
        .file(soundFile)
        .volume(_vol(fx, 'skirmish'))
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

export async function playFightFX(token)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay() || !token)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/fight.wav',
        'modules/lancer-automations/FX/svg/Fight.svg',
        'jb2a.ui.heartbeat.01.red',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/fight.wav')
        .volume(_vol(fx, 'fight'))
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
        .spriteAnchor({ y: 0.1 });
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Fight.svg').play();
}

export async function playEjectFX(source, dest)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = source.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = source.document?.flags?.['hex-size-support']?.pivoty || 0;
    const negPivotX = -pivotx;
    const negPivotY = -pivoty;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/eject.wav',
        'modules/lancer-automations/FX/audio/ejectImpact.wav',
        'modules/lancer-automations/FX/svg/Eject.svg',
        'jb2a.pack_hound_missile',
        'jb2a.smoke.puff.ring.01.white',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const sourceSeq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/eject.wav')
        .volume(_vol(fx, 'eject'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(source, { offset: { x: negPivotX, y: negPivotY } })
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

    if (dest)
    {
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
            .file('modules/lancer-automations/FX/audio/ejectImpact.wav')
            .volume(_vol(fx, 'eject'))
            .play();
    }
}

export async function playSelfDestructFX(token)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = token.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = token.document?.flags?.['hex-size-support']?.pivoty || 0;
    const negPivotX = -pivotx;
    const negPivotY = -pivoty;
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
        .volume(_vol(fx, 'selfDestruct'))
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/ReactorWarning.ogg')
        .volume(_vol(fx, 'selfDestruct'))
        .repeats(3, 1000)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.moonbeam.01.loop')
        .attachTo(token, { offset: { x: negPivotX, y: negPivotY } })
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
        .atLocation(token, { offset: { x: negPivotX, y: negPivotY } })
        .scaleToObject(1)
        .opacity(0.8)
        .repeats(3, 300)
        .delay(500)
        .mask(token)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(token, { offset: { x: negPivotX, y: negPivotY } })
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
        .volume(_vol(fx, 'selfDestruct'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.breath_weapons02.burst.line.fire.orange.01')
        .playbackRate(2.8)
        .tint(0xff2020)
        .filter('Glow', { distance: 10, color: 0xff2020, innerStrength: 10 })
        .opacity(0.5)
        .attachTo(token, { offset: { x: negPivotX, y: negPivotY } })
        .randomRotation()
        .spriteOffset({ x: 0.5 }, { gridUnits: true })
        .scaleToObject()
        .repeats(2)
        .belowTokens()
        .waitUntilFinished(-2000)
        .sound()
        .file('modules/lancer-weapon-fx/soundfx/Annihilator.ogg')
        .volume(_vol(fx, 'selfDestruct'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.breath_weapons02.burst.line.fire.orange.01')
        .playbackRate(2.8)
        .tint(0xff2020)
        .filter('Glow', { distance: 3, color: 0xff2020, innerStrength: 4 })
        .opacity(0.5)
        .attachTo(token, { offset: { x: negPivotX, y: negPivotY } })
        .randomRotation()
        .spriteOffset({ x: 0.5 }, { gridUnits: true })
        .scaleToObject(0.9)
        .repeats(2)
        .belowTokens()
        .play();
}

export async function playTeleportFX(caster)
{
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/svg/Teleport.svg',
    ]);
    await _appendActionBadge(new Sequence(), caster, 'modules/lancer-automations/FX/svg/Teleport.svg').play();
}

export async function playTeleportSoundFX()
{
    if (!_canPlay())
        return;
    const fx = _weaponFx();
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/teleport.wav',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/teleport.wav')
        .volume(fx ? _vol(fx, 'teleport') : (ACTION_FX_PREVIEW.teleport?.scale ?? 0.7))
        .play();
}

export async function playBootUpFX(caster)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/bootup.wav',
        'modules/lancer-automations/FX/svg/BootUp.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.energy_strands.in.yellow',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/bootup.wav')
        .volume(_vol(fx, 'bootUp'))
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

export async function playDismountFX(caster)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const pivotx = caster.document?.flags?.['hex-size-support']?.pivotx || 0;
    const pivoty = caster.document?.flags?.['hex-size-support']?.pivoty || 0;
    const negPivotX = -pivotx;
    const negPivotY = -pivoty;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/liftoff.wav',
        'modules/lancer-automations/FX/svg/Dismount.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.smoke.plumes.01.grey',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/liftoff.wav')
        .volume(_vol(fx, 'dismount'))
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
        .atLocation(caster, { offset: { x: negPivotX, y: negPivotY } })
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

export async function playMountFX(source, dest)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay() || !dest)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/mount.ogg',
        'modules/lancer-automations/FX/svg/Mount.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.ui.heartbeat.01.blue',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/mount.ogg')
        .volume(_vol(fx, 'mount'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(dest)
        .scaleToObject(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(dest, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x4a9eff)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.blue')
        .attachTo(dest, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0x4a9eff)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .rotate(180)
        .spriteAnchor({ y: 0.1 });
    await _appendActionBadge(seq, dest, 'modules/lancer-automations/FX/svg/Mount.svg').play();
}

export async function playReloadFX(token)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay() || !token)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/reload.wav',
        'modules/lancer-automations/FX/svg/Reload.svg',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
        'jb2a.zoning.inward.circle.once.bluegreen.01.02',
        'jb2a.ui.heartbeat.01.green',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/reload.wav')
        .volume(_vol(fx, 'reload'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(token)
        .scaleToObject(2)
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.zoning.inward.circle.once.bluegreen.01.02')
        .atLocation(token)
        .scaleToObject(2)
        .belowTokens()
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xb8e6b8)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .spriteAnchor({ y: 1.05 })
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.ui.heartbeat.01.green')
        .attachTo(token, { align: 'bottom', edge: 'outer' })
        .scale(0.4)
        .tint(0xb8e6b8)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .playbackRate(1.8)
        .rotate(180)
        .spriteAnchor({ y: 0.1 });
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Reload.svg').play();
}

export async function playDisengageFX(caster)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/disengage.wav',
        'modules/lancer-automations/FX/svg/Disengage.svg',
        'jb2a.extras.tmfx.outpulse.line.02.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/disengage.wav')
        .volume(_vol(fx, 'disengage'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.outpulse.line.02.normal')
        .atLocation(caster)
        .scaleToObject(2);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Disengage.svg').play();
}

export async function playDeployableFX(deployedToken)
{
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
        .volume(_vol(fx, 'deployable'))
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

// Per-action deltas for the shared action-badge chain; audio comes from ACTION_FX_PREVIEW (paths verified identical).
const BADGE_FX = {
    freeAction: {
        svg: 'modules/lancer-automations/FX/svg/FreeAction.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0xdcffdc,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0xdcffdc }],
    },
    corePower: {
        svg: 'modules/lancer-automations/FX/svg/CorePower.svg',
        duration: 4500,
        // kept verbatim: preloads the blue heartbeat although the yellow one plays
        preload: [
            'modules/lancer-automations/FX/audio/corepower.wav',
            'modules/lancer-automations/FX/svg/CorePower.svg',
            'jb2a.on_token_buff.002.002.orangeyellow',
            'jb2a.template_circle.out_pulse.02.burst.greenorange',
            'jb2a.static_electricity.01.yellow',
            'jb2a.ui.heartbeat.01.blue',
        ],
        heartbeat: 'jb2a.ui.heartbeat.01.yellow',
        heartbeatTint: 0xff9930,
        mid: [
            { file: 'jb2a.template_circle.out_pulse.02.burst.greenorange', scaleToObject: 2.5, belowTokens: true },
            { file: 'jb2a.on_token_buff.002.002.orangeyellow', scaleToObject: 2 },
            { file: 'jb2a.static_electricity.01.yellow', scaleToObject: 1.4, opacity: 0.85, mask: true },
        ],
    },
    protocol: {
        svg: 'modules/lancer-automations/FX/svg/Protocol.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0x20dfff,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0x20dfff }],
    },
    activation: {
        svg: 'modules/lancer-automations/FX/svg/Activate.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0x3fe6b8,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0x3fe6b8 }],
    },
    reaction: {
        svg: 'modules/lancer-automations/FX/svg/Reaction.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.purple',
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0xb070ff }],
    },
    fullAction: {
        svg: 'modules/lancer-automations/FX/svg/FullAction.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.blue',
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0x4a9eff }],
    },
    quickAction: {
        svg: 'modules/lancer-automations/FX/svg/QuickAction.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.blue',
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 1.8, tint: 0x4a9eff }],
    },
    standingUp: {
        svg: 'modules/lancer-automations/FX/svg/Standing.svg',
        short: true,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2 }],
    },
    prepare: {
        svg: 'modules/lancer-automations/FX/svg/Prepare.svg',
        short: true,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2 }],
    },
    interact: {
        svg: 'modules/lancer-automations/FX/svg/Interact.svg',
        short: true,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2 }],
    },
    handle: {
        svg: 'modules/lancer-automations/FX/svg/Handle.svg',
        short: true,
        mid: [{ file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2 }],
    },
    fullTech: {
        svg: 'modules/lancer-automations/FX/svg/FullTech.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0x148a14,
        mid: [
            { file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2.5, tint: 0x3a7fff },
            { file: 'jb2a.static_electricity.03.blue02', scaleToObject: 2, playbackRate: 1.5 },
        ],
    },
    quickTech: {
        svg: 'modules/lancer-automations/FX/svg/QuickTech.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0x148a14,
        mid: [
            { file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2, tint: 0x66aaff },
            { file: 'jb2a.static_electricity.03.blue02', scaleToObject: 1.5, playbackRate: 2 },
        ],
    },
    invade: {
        svg: 'modules/lancer-automations/FX/svg/Invade.svg',
        heartbeat: 'jb2a.ui.heartbeat.01.green',
        heartbeatTint: 0x148a14,
        mid: [
            { file: 'jb2a.extras.tmfx.inpulse.circle.01.normal', scaleToObject: 2, tint: 0x66ff66 },
            { file: 'jb2a.static_electricity.03.green02', scaleToObject: 1.5, playbackRate: 2 },
        ],
    },
};

function badgeItemNameOn()
{
    try
    {
        return game.settings.get('lancer-automations', 'actionBadgeItemName') === true;
    }
    catch
    {
        return false;
    }
}

const _svgTextCache = new Map();
const _svgLabelCache = new Map();
const _svgAdvanceCache = new Map();

// Rendered advance of each tspan, in the text's local units.
function _measureTspanAdvances(svgMarkup)
{
    try
    {
        const holder = document.createElement('div');
        holder.style.cssText = 'position:absolute;left:-10000px;top:-10000px;visibility:hidden;';
        holder.innerHTML = svgMarkup.slice(svgMarkup.indexOf('<svg'));
        document.body.appendChild(holder);
        try
        {
            return [...holder.querySelectorAll('text tspan')].map(el => el.getComputedTextLength?.() ?? 0);
        }
        finally
        {
            holder.remove();
        }
    }
    catch
    {
        return null;
    }
}

function _measureOriginalAdvance(svgPath, raw)
{
    if (_svgAdvanceCache.has(svgPath))
        return _svgAdvanceCache.get(svgPath);
    const advance = _measureTspanAdvances(raw)?.[0] ?? null;
    _svgAdvanceCache.set(svgPath, advance);
    return advance;
}

function _escapeXml(text)
{
    return String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

// Swap the banner's baked tspan text for a custom label; two lines + font shrink when it overflows.
async function _badgeSvgWithLabel(svgPath, label)
{
    const key = `${svgPath}|${label}`;
    const cached = _svgLabelCache.get(key);
    if (cached)
        return cached;
    let raw = _svgTextCache.get(svgPath);
    if (!raw)
    {
        const response = await fetch(svgPath);
        if (!response.ok)
            return null;
        raw = await response.text();
        _svgTextCache.set(svgPath, raw);
    }
    const tspanMatch = raw.match(/(<tspan\b[^>]*>)([^<]+)(<\/tspan>)/);
    if (!tspanMatch)
        return null;
    const [full, open, original] = tspanMatch;
    const fontMatch = raw.match(/font-size:([\d.]+)px/);
    const fontSize = fontMatch ? Number(fontMatch[1]) : 74;
    const fitLen = Math.max(original.length, 12);
    const maxAdvance = Math.round(_measureOriginalAdvance(svgPath, raw) ?? (original.length * 0.62 * fontSize));
    const yMatch = open.match(/\by="([\d.-]+)"/);

    let lines;
    let initialScale;
    if (label.length > 20 && label.includes(' ') && yMatch)
    {
        // two small lines inside the strip: line 2 keeps the baked baseline, line 1 fills the vacated cap space
        initialScale = 0.44;
        const mid = Math.floor(label.length / 2);
        let split = -1;
        for (let pos = 0; pos < label.length; pos++)
        {
            if (label[pos] === ' ' && (split === -1 || Math.abs(pos - mid) < Math.abs(split - mid)))
                split = pos;
        }
        lines = [label.slice(0, split), label.slice(split + 1)];
    }
    else
    {
        initialScale = 1;
        lines = [label];
    }

    const buildSvg = (scaleValue) =>
    {
        const line1Y = yMatch ? (Number(yMatch[1]) - 0.72 * fontSize * (1 - scaleValue) + 1).toFixed(2) : null;
        const opens = lines.map((line, index) =>
        {
            let openTag = open;
            if (lines.length === 2 && index === 0)
                openTag = openTag.replace(/\by="[\d.-]+"/, `y="${line1Y}"`);
            if (index > 0)
                openTag = openTag.replace(/\bid="[^"]*"\s*/, '');
            return openTag;
        });
        let out = raw.replace(full, opens.map((openTag, index) => `${openTag}${_escapeXml(lines[index])}</tspan>`).join(''));
        if (scaleValue < 1)
            out = out.replace(/font-size:[\d.]+px/, `font-size:${(fontSize * scaleValue).toFixed(2)}px`);
        return out;
    };

    // shrink-only fit: measure the candidate, scale the font down if a line overflows the baked span
    let svg = buildSvg(initialScale);
    const advances = _measureTspanAdvances(svg);
    if (advances)
    {
        const worst = Math.max(...lines.map((line, index) => advances[index] ?? 0));
        if (worst > maxAdvance)
            svg = buildSvg(initialScale * (maxAdvance / worst));
    }
    else if (lines.length === 1 && label.length > fitLen)
        svg = buildSvg(Math.max(0.5, fitLen / label.length));
    const uri = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
    _svgLabelCache.set(key, uri);
    return uri;
}

// Shared chain: sound, badge, mid effects, heartbeat pair; short rows use the _appendActionBadge form instead.
async function _playBadgeFX(caster, action, svgOverride, label = null)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    const entry = BADGE_FX[action];
    let svg = svgOverride ?? entry.svg;
    const audio = ACTION_FX_PREVIEW[action].src;
    let preload = entry.preload;
    if (!preload)
    {
        preload = [audio, svg, ...entry.mid.map(part => part.file)];
        if (entry.heartbeat)
            preload.push(entry.heartbeat);
    }
    await Sequencer.Preloader.preloadForClients(preload);
    if (label && badgeItemNameOn())
    {
        try
        {
            svg = (await _badgeSvgWithLabel(svg, label)) ?? svg;
        }
        catch
        { /* stock banner */ }
    }
    const seq = new Sequence()
        .sound()
        .file(audio)
        .volume(_vol(fx, action));
    if (!entry.short)
    {
        seq.effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file(svg)
            .attachTo(caster, { align: 'bottom', edge: 'outer', offset: { y: -0.2 }, gridUnits: true })
            .scale(0.09)
            .filter('Glow', { distance: 2, color: 0x000000 })
            .aboveInterface()
            .duration(entry.duration ?? 4000)
            .fadeIn(400)
            .fadeOut(800, { delay: -1200 });
    }
    for (const part of entry.mid)
    {
        const effect = seq.effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file(part.file)
            .atLocation(caster)
            .scaleToObject(part.scaleToObject);
        if (part.tint !== undefined)
            effect.tint(part.tint);
        if (part.belowTokens)
            effect.belowTokens();
        if (part.opacity !== undefined)
            effect.opacity(part.opacity);
        if (part.mask)
            effect.mask(caster);
        if (part.playbackRate !== undefined)
            effect.playbackRate(part.playbackRate);
    }
    if (entry.short)
    {
        await _appendActionBadge(seq, caster, svg).play();
        return;
    }
    for (const flipped of [false, true])
    {
        const beat = seq.effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file(entry.heartbeat)
            .attachTo(caster, { align: 'bottom', edge: 'outer' })
            .scale(0.4);
        if (flipped)
            beat.rotate(180);
        if (entry.heartbeatTint !== undefined)
            beat.tint(entry.heartbeatTint);
        beat.filter('Glow', { distance: 2, color: 0x000000 })
            .aboveInterface()
            .playbackRate(1.8)
            .spriteAnchor({ y: flipped ? 0.1 : 1.05 });
    }
    await seq.play();
}

export async function playFreeActionFX(caster, svg = 'modules/lancer-automations/FX/svg/FreeAction.svg', label = null)
{
    await _playBadgeFX(caster, 'freeAction', svg, label);
}

export async function playCorePowerFX(caster, label = null)
{
    await _playBadgeFX(caster, 'corePower', undefined, label);
}

export async function playProtocolFX(caster, label = null)
{
    await _playBadgeFX(caster, 'protocol', undefined, label);
}

export async function playActivationFX(caster, svg = 'modules/lancer-automations/FX/svg/Activate.svg', label = null)
{
    await _playBadgeFX(caster, 'activation', svg, label);
}

export async function playReactionFX(caster, svg = 'modules/lancer-automations/FX/svg/Reaction.svg', label = null)
{
    await _playBadgeFX(caster, 'reaction', svg, label);
}

export async function playFullActionFX(caster, label = null)
{
    await _playBadgeFX(caster, 'fullAction', undefined, label);
}

export async function playQuickActionFX(caster, label = null)
{
    await _playBadgeFX(caster, 'quickAction', undefined, label);
}

export async function playStandingUpFX(caster)
{
    await _playBadgeFX(caster, 'standingUp');
}

export async function playPrepareFX(caster)
{
    await _playBadgeFX(caster, 'prepare');
}

export async function playInteractFX(caster)
{
    await _playBadgeFX(caster, 'interact');
}

export async function playHandleFX(caster)
{
    await _playBadgeFX(caster, 'handle');
}

export async function playFullTechFX(caster, label = null)
{
    await _playBadgeFX(caster, 'fullTech', undefined, label);
}

export async function playQuickTechFX(caster, label = null)
{
    await _playBadgeFX(caster, 'quickTech', undefined, label);
}

export async function playInvadeFX(caster, label = null)
{
    await _playBadgeFX(caster, 'invade', undefined, label);
}

export async function playGrappleFX(caster)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/grapple.wav',
        'modules/lancer-automations/FX/svg/Grapple.svg',
        'jb2a.extras.tmfx.inpulse.circle.04.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/grapple.wav')
        .volume(_vol(fx, 'grapple'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.04.normal')
        .atLocation(caster)
        .preset('la_scaleToBurst', 0);
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Grapple.svg').play();
}

export async function playMineDetonationFX(mineToken)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay() || !mineToken)
        return;
    const position = { x: mineToken.center?.x ?? mineToken.x, y: mineToken.center?.y ?? mineToken.y };
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/extra/mineDetonation.wav',
        'modules/lancer-automations/FX/svg/Mine.svg',
        'jb2a.explosion.01.orange',
    ]);
    await new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/extra/mineDetonation.wav')
        .volume(_vol(fx, 'mineDetonation'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.explosion.01.orange')
        .atLocation(position)
        .size(5, { gridUnits: true })
        .effect()
        .file('modules/lancer-automations/FX/svg/Mine.svg')
        .atLocation(position)
        .scaleIn(0.01, 500)
        .scale(0.09)
        .scaleOut(0.01, 900)
        .filter('Glow', { distance: 2, color: 0x000000 })
        .aboveInterface()
        .duration(3000)
        .fadeIn(400)
        .fadeOut(800)
        .play();
}

export async function playRamFX(caster, target)
{
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
        .volume(_vol(fx, 'ram'));
    if (target)
    {
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

export async function playJockeyFX(caster, target)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay() || !caster)
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/jockey.wav',
        'modules/lancer-automations/FX/svg/Jockey.svg',
        'jb2a.zoning.directional.once.redyellow.line200.01',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/jockey.wav')
        .volume(_vol(fx, 'jockey'))
        .effect()
        .xray(fx.isEffectIgnoreFogOfWar())
        .aboveInterface(fx.isEffectIgnoreLightingColoration())
        .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
        .atLocation(caster)
        .preset('la_scaleToBurst', 0);
    if (target)
    {
        seq.effect()
            .xray(fx.isEffectIgnoreFogOfWar())
            .aboveInterface(fx.isEffectIgnoreLightingColoration())
            .file('jb2a.zoning.directional.once.redyellow.line200.01')
            .atLocation(caster)
            .rotateTowards(target)
            .scaleToObject(1.5)
            .playbackRate(1.5);
    }
    await _appendActionBadge(seq, caster, 'modules/lancer-automations/FX/svg/Jockey.svg').play();
}

export async function playBarrageFX(token)
{
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
        .volume(_vol(fx, 'barrage'))
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

export async function playBoostFX(token)
{
    const fx = _weaponFx();
    if (!fx || !_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/boost.wav',
        'modules/lancer-automations/FX/svg/Boost.svg',
        'jb2a.zoning.directional.once.redyellow.line200.01',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/boost.wav')
        .volume(_vol(fx, 'boost'))
        .effect()
        .file('jb2a.zoning.directional.once.redyellow.line200.01')
        .scaleToObject(1.5)
        .filter('Glow', { color: 0x00CED1 })
        .atLocation(token);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Boost.svg').play();
}

export async function playOverchargeNpcFX(token)
{
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
        .volume(_vol(fx, 'overchargeNpc'))
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
        .preset("la_scaleToBurst", 0)
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

export async function playHideFX(token)
{
    if (!_canPlay())
        return;
    const fx = _weaponFx();
    const seq = new Sequence()
        .effect()
        .file('jb2a.smoke.puff.centered.grey')
        .atLocation(token)
        .scale(1.1)
        .sound()
        .file('modules/lancer-automations/FX/audio/hide.wav')
        .volume(fx ? _vol(fx, 'hide') : 0.7);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Hide.svg').play();
}

export async function playShutDownFX(token)
{
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
        .volume(_vol(fx, 'shutDown'))
        .atLocation(token)
        .effect()
        .file('jb2a.extras.tmfx.inpulse.circle.02.normal')
        .atLocation(token)
        .preset('la_scaleToBurst', 0)
        .effect()
        .file('jb2a.smoke.plumes.01.grey')
        .atLocation(token, { offset: { x: 0, y: -0.5 }, gridUnits: true })
        .scaleToObject(2)
        .opacity(0.5)
        .fadeIn(500)
        .fadeOut(1500);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Shutdown.svg').play();
}

export async function playFallFX(token)
{
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
        .volume(_vol(fx, 'fall'))
        .atLocation(token);
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Falling.svg').play();
}

export async function playFallImpactFX(token)
{
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.impact.boulder.02',
        'jb2a.impact.ground_crack.white.01',
        'modules/lancer-automations/FX/audio/fallImpact.mp3',
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
        .file('modules/lancer-automations/FX/audio/fallImpact.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.7) ?? 0.7)
        .waitUntilFinished()
        .play();
}

export async function playSearchFX(token, target = null)
{
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'modules/lancer-automations/FX/audio/search.wav',
        'modules/lancer-automations/FX/svg/Search.svg',
        'jb2a.soundwave.01.blue',
        'jb2a.extras.tmfx.inpulse.circle.01.normal',
    ]);
    const seq = new Sequence()
        .sound()
        .file('modules/lancer-automations/FX/audio/search.wav')
        .volume(_weaponFx()?.getEffectVolume(0.5) ?? 0.5)
        .effect()
        .file('jb2a.soundwave.01.blue')
        .atLocation(token)
        .scaleToObject(6);
    if (target)
    {
        seq.effect()
            .file('jb2a.extras.tmfx.inpulse.circle.01.normal')
            .atLocation(target)
            .preset('la_scaleToBurst', 0)
            .tint(0x4a9eff)
            .belowTokens();
    }
    await _appendActionBadge(seq, token, 'modules/lancer-automations/FX/svg/Search.svg').play();
}

export async function playSearchFoundFX(target)
{
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

export async function playSearchFailFX(target)
{
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
        .preset("la_scaleToBurst", 0)
        .play();
}

export async function playScanFX(caster, target)
{
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
    if (target)
    {
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

/** Success ping on a target: blue circle inpulse + confirm sound. */
export async function playTargetSuccessFX(token)
{
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.inpulse.circle.03.fast',
        'modules/lancer-automations/FX/audio/targetSuccess.mp3',
    ]);
    await new Sequence()
        .effect()
        .file('jb2a.extras.tmfx.inpulse.circle.03.fast')
        .atLocation(token)
        .preset("la_scaleToBurst", 0)
        .tint(0x4a9eff)
        .sound()
        .file('modules/lancer-automations/FX/audio/targetSuccess.mp3')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .play();
}

/** Builds attack context (source, targets, miss/crit sets) from a BasicAttackFlow state; used by the inline-FX map below. */
function _buildAttackContext(state)
{
    const sourceToken = state.actor?.getActiveTokens?.()[0] ?? state.actor?.token?.object ?? null;
    const hitResults = state.data?.hit_results ?? [];
    const accDiffTargets = state.data?.acc_diff?.targets ?? [];
    const targetTokens = [];
    for (let i = 0; i < Math.max(hitResults.length, accDiffTargets.length); i++)
    {
        const target = hitResults[i]?.target ?? accDiffTargets[i]?.target ?? null;
        if (target)
            targetTokens.push(target);
    }
    const targetsMissed = new Set(hitResults.filter(hitResult => !hitResult.hit).map(hitResult => hitResult.target?.id).filter(Boolean));
    const targetsCrit = new Set(hitResults.filter(hitResult => hitResult.crit).map(hitResult => hitResult.target?.id).filter(Boolean));
    return { sourceToken, targetTokens, targetsMissed, targetsCrit };
}

export async function playDefaultThrowFX(state)
{
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
    for (const target of targetTokens)
    {
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
        if (!targetsMissed.has(target.id))
        {
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

/** Inline attack FX keyed by BasicAttackFlow state.data.title; main.js dispatches here after printAttackCard. */
export const LA_INLINE_ATTACK_FX = {
    'Ram': async (state) =>
    {
        if (!_canPlay())
            return;
        const { targetTokens, targetsMissed, targetsCrit } = _buildAttackContext(state);
        if (targetTokens.length === 0)
            return;
        const fx = _weaponFx();
        const volume = fx?.getEffectVolume(0.7) ?? 0.7;
        if (isRollResultFXEnabled())
            fx?.preloadMissAndCrit?.();
        const seq = new Sequence();
        for (const target of targetTokens)
        {
            seq.sound()
                .file('modules/lancer-automations/FX/audio/ramImpact.wav')
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
            if (isRollResultFXEnabled())
            {
                if (targetsMissed.has(target.id) && fx?.addMissToSequence)
                    fx.addMissToSequence(seq, target.id);
                if (targetsCrit.has(target.id) && fx?.addCritToSequence)
                    fx.addCritToSequence(seq, target.id);
            }
        }
        await seq.play();
    },

    'Grapple': async (state) =>
    {
        if (!_canPlay())
            return;
        const { sourceToken, targetTokens, targetsMissed, targetsCrit } = _buildAttackContext(state);
        if (targetTokens.length === 0)
            return;
        const fx = _weaponFx();
        const volume = fx?.getEffectVolume(0.7) ?? 0.7;
        if (isRollResultFXEnabled())
            fx?.preloadMissAndCrit?.();
        const seq = new Sequence();
        seq.sound()
            .file('modules/lancer-automations/FX/audio/grappleShot.wav')
            .volume(volume);
        for (const target of targetTokens)
        {
            if (sourceToken)
            {
                seq.effect()
                    .xray(fx?.isEffectIgnoreFogOfWar() ?? false)
                    .aboveInterface(fx?.isEffectIgnoreLightingColoration() ?? false)
                    .file('jb2a.template_line_piercing.generic.01.orange')
                    .atLocation(sourceToken)
                    .stretchTo(target);
            }
            seq.sound()
                .file('modules/lancer-automations/FX/audio/grapplePull.wav')
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
            if (isRollResultFXEnabled())
            {
                if (targetsMissed.has(target.id) && fx?.addMissToSequence)
                    fx.addMissToSequence(seq, target.id);
                if (targetsCrit.has(target.id) && fx?.addCritToSequence)
                    fx.addCritToSequence(seq, target.id);
            }
        }
        await seq.play();
    }
};

/**
 * Resolve a placeable token for an actor, preferring one on the current scene.
 */
function _tokenForActor(actor)
{
    if (!actor)
        return null;
    if (actor.token?.object)
        return actor.token.object;
    const sceneId = canvas?.scene?.id;
    const tokens = actor.getActiveTokens() || [];
    return tokens.find(token => token?.scene?.id === sceneId) || tokens[0] || null;
}

export function _flowSourceToken(flow)
{
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
 * preFlow hooks fire BEFORE initActivationData, so state.data.action/title are null;
 * fall back to state.data.action_path (Lancer's key) or the default "system.actions.0".
 */
function _flowAction(flow)
{
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
function _flowTitle(flow)
{
    const title = flow?.state?.data?.title;
    if (title)
        return title;
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
 */
export function _flowResolveActivationLabel(flow)
{
    const item = flow?.state?.item;
    if (item?.type === 'npc_feature')
    {
        if (item.system?.type === 'Tech')
        {
            const techType = item.system.tech_type;
            if (techType === 'Quick')
                return 'Quick Tech';
            if (techType === 'Full')
                return 'Full Tech';
        }
        for (const tag of (item.system?.tags ?? []))
        {
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

/** Titles of actions that already play their own specific FX; skip generic Quick/Full dispatch for these. */
const _TITLES_WITH_SPECIFIC_FX = new Set([
    'Skirmish', 'Barrage', 'Ram', 'Grapple', 'End Grapple', 'Break Free',
    'Boost', 'Hide', 'Search', 'Scan', 'Handle', 'Interact', 'Prepare',
    'Disengage', 'Dismount', 'Eject', 'Boot Up', 'Shut Down', 'Standing Up',
    'Fall', 'Teleport', 'Reactor Meltdown', 'Fight', 'Fragment Signal',
    'Overcharge', 'Overcharge (NPC)', 'Stabilize', 'Full Repair', 'Mount', 'Jockey',
    'Lock On', 'Bolster', 'Aid', 'Brace',
]);

/** Dispatch a tech-tier or generic-tier action FX based on activation + title. */
// two action FX launched close together: the second waits for the first;
// Sequencer's play() resolves early for effects, so each entry also holds a minimum time
const FX_MIN_HOLD_MS = 1500;
let _actionFxChain = Promise.resolve();
export function queueActionFx(fn)
{
    _actionFxChain = _actionFxChain.then(() => Promise.all([
        Promise.resolve().then(fn),
        new Promise(resolve => setTimeout(resolve, FX_MIN_HOLD_MS))
    ])).catch(err => console.error('lancer-automations | action FX failed:', err));
}
const _queueActionFx = queueActionFx;

export function playActionFxByActivation(activation, token, title, { nameOnBadge = true } = {})
{
    _queueActionFx(() => _playActionFxForActivation(activation, token, title, nameOnBadge));
}
function _playActionFxForActivation(activation, token, title, nameOnBadge = true)
{
    const actor = token?.actor;
    if (actor?.type === 'deployable' && actor.system?.type === 'Mine' && title === actor.name)
    {
        if (!actor.getFlag?.('lancer-automations', 'mineFxDisabled'))
            return playMineDetonationFX(token);
        return undefined;
    }
    const label = nameOnBadge ? title : null;
    if (title === 'Boost')
        return playBoostFX(token);
    if (activation === 'Quick Tech')
        return playQuickTechFX(token, label);
    if (activation === 'Full Tech')
        return playFullTechFX(token, label);
    if (!_TITLES_WITH_SPECIFIC_FX.has(title))
    {
        if (activation === 'Quick')
            return playQuickActionFX(token, label);
        if (activation === 'Full')
            return playFullActionFX(token, label);
        if (activation === 'Protocol')
            return playProtocolFX(token, label);
        if (activation === 'Free')
        {
            const svg = title === 'Squeeze'
                ? 'modules/lancer-automations/FX/svg/Squeeze.svg'
                : 'modules/lancer-automations/FX/svg/FreeAction.svg';
            return playFreeActionFX(token, svg, title === 'Squeeze' ? null : label);
        }
        if (activation === 'Reaction')
        {
            const svg = title === 'Overwatch'
                ? 'modules/lancer-automations/FX/svg/Overwatch.svg'
                : 'modules/lancer-automations/FX/svg/Reaction.svg';
            return playReactionFX(token, svg, title === 'Overwatch' ? null : label);
        }
        return playActivationFX(token, undefined, label);
    }
    return undefined;
}

/** Fires invade FX when TechAttackFlow starts with `invade: true`, else dispatches by activation. */
Hooks.on('lancer.preFlow.TechAttackFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    if (flow.state.data?.invade)
    {
        const title = _flowTitle(flow);
        _queueActionFx(() => playInvadeFX(token, title && title !== 'Invade' ? title : null));
        return;
    }
    _queueActionFx(() => _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow)));
});

/** Fires Core Power FX when a CoreActiveFlow starts. Skipped when no core energy remains (Lancer aborts at checkCorePower). */
Hooks.on('lancer.preFlow.CoreActiveFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    if (token.actor?.system?.core_energy === 0)
        return;
    _queueActionFx(() => playCorePowerFX(token, _flowTitle(flow)));
});

/** Fires Quick/Full Tech or generic Quick FX when ActivationFlow/SystemFlow starts. */
Hooks.on('lancer.preFlow.ActivationFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (token)
        _queueActionFx(() => _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow)));
});
Hooks.on('lancer.preFlow.SystemFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (token)
        _queueActionFx(() => _playActionFxForActivation(_flowResolveActivationLabel(flow), token, _flowTitle(flow)));
});

/** Fires the generic activation FX when a BondPowerFlow starts. */
Hooks.on('lancer.preFlow.BondPowerFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (token)
        _queueActionFx(() => playActivationFX(token, undefined, _flowTitle(flow)));
});

/** Fires the generic activation FX when a TalentFlow prints a rank card. */
Hooks.on('lancer.preFlow.TalentFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (token)
        _queueActionFx(() => playActivationFX(token, undefined, _flowTitle(flow)));
});

/** Fires named action FX when a SimpleActivationFlow starts with a matching title. */
Hooks.on('lancer.preFlow.SimpleActivationFlow', (flow) =>
{
    const token = _flowSourceToken(flow);
    if (!token)
        return;
    const title = _flowTitle(flow);
    _queueActionFx(() =>
    {
        if (title === 'Handle')
            return playHandleFX(token);
        if (title === 'Interact')
            return playInteractFX(token);
        if (title === 'Prepare')
            return playPrepareFX(token);
        return _playActionFxForActivation(_flowResolveActivationLabel(flow), token, title);
    });
});

function _playGenericPrintActivationFX(flow)
{
    if (!game.settings.get('lancer-automations', 'treatGenericPrintAsActivation'))
        return;
    const token = _flowSourceToken(flow);
    if (token)
        _queueActionFx(() => playActivationFX(token));
}
Hooks.on('lancer.preFlow.SimpleHTMLFlow', _playGenericPrintActivationFX);
Hooks.on('lancer.preFlow.SendUnknownToChat', _playGenericPrintActivationFX);

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

export const DAMAGE_IMPACT_DELAY_MS = 250;

export function damageImpactHits(amount)
{
    return Math.max(1, Math.floor((Number(amount) || 0) / 3));
}

/** Damage-type impact at the target token: one hit per 3 damage inflicted, staggered, each at a random offset. */
export async function playDamageImpactFX(type, target, amount = null)
{
    if (!isDamageImpactFXEnabled() || typeof Sequencer === 'undefined' || !target)
        return;
    const key = String(type ?? '').toLowerCase().trim();
    const file = DAMAGE_IMPACT_FX[key];
    if (!file)
        return;
    const tokenSize = Number(target?.document?.width ?? target?.w ?? 1);
    const gridSize = canvas?.grid?.size ?? 100;
    const radius = (tokenSize * gridSize) / 2;
    const randomOffset = () =>
    {
        const angle = Math.random() * Math.PI * 2;
        const randomRadius = Math.random() * radius;
        return { x: Math.cos(angle) * randomRadius, y: Math.sin(angle) * randomRadius };
    };
    const hits = damageImpactHits(amount);
    await Sequencer.Preloader.preloadForClients([file]);
    const seq = new Sequence();
    for (let hit = 0; hit < hits; hit++)
    {
        const effect = seq.effect()
            .file(file)
            .atLocation(target, { offset: randomOffset() })
            .scaleToObject(2.5)
            .aboveInterface()
            .playbackRate(0.8)
            .delay(hit * DAMAGE_IMPACT_DELAY_MS);
        if (key === 'hit_overshield')
            effect.filter('ColorMatrix', { saturate: -1, brightness: 1.3 });
    }
    seq.play();
}

function _isFriendlyTo(origin, target)
{
    const tokenFactions = game.modules.get('token-factions');
    if (tokenFactions?.active && typeof tokenFactions.api?.getDisposition === 'function')
    {
        try
        {
            return tokenFactions.api.getDisposition(origin, target) === CONST.TOKEN_DISPOSITIONS.FRIENDLY;
        }
        catch
        { /* fall through */ }
    }
    const originDisp = origin?.document?.disposition ?? 0;
    const targetDisp = target?.document?.disposition ?? 0;
    const HOSTILE = CONST.TOKEN_DISPOSITIONS.HOSTILE;
    const SECRET = CONST.TOKEN_DISPOSITIONS.SECRET;
    const isBad = (d) => d === HOSTILE || d === SECRET;
    return isBad(originDisp) === isBad(targetDisp);
}

export async function playBonusAddedFX(token, origin = null)
{
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
    if (arrow && origin && origin.id !== token.id)
    {
        seq.effect()
            .file(arrow)
            .atLocation(origin)
            .stretchTo(token)
            .playbackRate(2.5);
    }
    seq.effect()
        .file('jb2a.extras.tmfx.inpulse.circle.04')
        .atLocation(token)
        .preset('la_scaleToBurst', 0);
    seq.play();
    playStatusSfxSound('bonus');
}

/** Failure ping on a target: red miss + border inpulse + deny sound. */
export async function playTargetFailFX(token)
{
    if (!_canPlay())
        return;
    await Sequencer.Preloader.preloadForClients([
        'jb2a.extras.tmfx.border.circle.inpulse.01.normal',
        'jb2a.ui.miss.red',
        'modules/lancer-automations/FX/audio/targetFail.wav',
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
        .aboveInterface()
        .sound()
        .file('modules/lancer-automations/FX/audio/targetFail.wav')
        .volume(_weaponFx()?.getEffectVolume(0.6) ?? 0.6)
        .play();
}

const _activeSeqBySource = new Map();
const _effectIdToSource = new Map();
const _sourceKey = (src) => src?.id ?? src?.uuid ?? (typeof src === 'string' ? src : null);
const _bumpSource = (key, delta) =>
{
    if (!key)
        return;
    const count = (_activeSeqBySource.get(key) ?? 0) + delta;
    if (count <= 0)
        _activeSeqBySource.delete(key);
    else
        _activeSeqBySource.set(key, count);
};
Hooks.on('createSequencerEffect', data =>
{
    const key = _sourceKey(data?.source);
    if (!key)
        return;
    const effectId = data?.id ?? data?.effectData?.id;
    if (effectId)
        _effectIdToSource.set(effectId, key);
    _bumpSource(key, +1);
});
Hooks.on('endedSequencerEffect', data =>
{
    const effectId = data?.id ?? data?.effectData?.id;
    if (effectId && _effectIdToSource.has(effectId))
    {
        const key = _effectIdToSource.get(effectId);
        _effectIdToSource.delete(effectId);
        _bumpSource(key, -1);
        return;
    }
    _bumpSource(_sourceKey(data?.source), -1);
});

async function _waitForSourceEffectsToEnd(sourceToken, { initialMs = 200, pollMs = 100, timeoutMs = 10000 } = {})
{
    if (!sourceToken)
        return;
    const id = sourceToken.id ?? sourceToken.uuid;
    const baseline = _activeSeqBySource.get(id) ?? 0;
    await new Promise(resolve => setTimeout(resolve, initialMs));
    const start = Date.now();
    while (Date.now() - start < timeoutMs)
    {
        if ((_activeSeqBySource.get(id) ?? 0) <= baseline)
            return;
        await new Promise(resolve => setTimeout(resolve, pollMs));
    }
}

const _missCritOverlayHandler = async (flow) =>
{
    if (!isActionFXEnabled() || typeof Sequencer === 'undefined')
        return;
    try
    {
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
        for (const hitResult of hitResults)
        {
            const tokenObj = hitResult?.target?.object ?? hitResult?.target;
            if (!tokenObj)
                continue;
            let file;
            let soundKey;
            if (hitResult.crit)
            {
                file = 'jb2a.ui.critical.yellow';
                soundKey = 'crit';
            }
            else if (hitResult.hit)
            {
                file = 'jb2a.ui.hit.blue';
                soundKey = 'hit';
            }
            else
            {
                file = 'jb2a.ui.miss.red';
                soundKey = 'miss';
            }
            const delay = i++ * 250;
            seq.effect()
                .file(file)
                .attachTo(tokenObj)
                .scale(0.5)
                .aboveInterface()
                .delay(delay);
            setTimeout(() => playStatsSound(soundKey), delay);
        }
        seq.play();
    }
    catch (e)
    {
        console.error('lancer-automations | miss/crit overlay failed:', e);
    }
};
Hooks.on('lancer.postFlow.BasicAttackFlow', _missCritOverlayHandler);
Hooks.on('lancer.postFlow.WeaponAttackFlow', _missCritOverlayHandler);
Hooks.on('lancer.postFlow.TechAttackFlow', _missCritOverlayHandler);

const STAT_PULSE_SUCCESS = 'jb2a.template_circle.radar.loop.800px.001.pulse.greenpurple';
const STAT_PULSE_FAIL    = 'jb2a.template_circle.radar.loop.800px.001.pulse.purplered';

export async function playContestedOutcomeFX(winnerToken, loserToken)
{
    if (!isRollResultFXEnabled() || typeof Sequencer === 'undefined')
        return;
    try
    {
        await Sequencer.Preloader.preloadForClients([
            'jb2a.ui.success.green', 'jb2a.ui.failure.red',
            STAT_PULSE_SUCCESS, STAT_PULSE_FAIL
        ]);
        if (winnerToken)
        {
            new Sequence()
                .effect()
                .file(STAT_PULSE_SUCCESS)
                .atLocation(winnerToken)
                .scaleToObject(3)
                .belowTokens()
                .duration(1500)
                .fadeIn(200)
                .fadeOut(400)
                .play();
            new Sequence()
                .effect()
                .file('jb2a.ui.success.green')
                .attachTo(winnerToken)
                .scale(0.5)
                .aboveInterface()
                .play();
            playStatsSound('success');
        }
        if (loserToken)
        {
            new Sequence()
                .effect()
                .file(STAT_PULSE_FAIL)
                .atLocation(loserToken)
                .scaleToObject(3)
                .belowTokens()
                .duration(1500)
                .fadeIn(200)
                .fadeOut(400)
                .play();
            new Sequence()
                .effect()
                .file('jb2a.ui.failure.red')
                .attachTo(loserToken)
                .scale(0.5)
                .aboveInterface()
                .play();
            playStatsSound('fail');
        }
    }
    catch (e)
    {
        console.error('lancer-automations | contested outcome FX failed:', e);
    }
}

export async function playStatRollOutcomeFX(token, success, { waitForActiveFX = true } = {})
{
    if (!isRollResultFXEnabled() || typeof Sequencer === 'undefined' || !token)
        return;
    try
    {
        const file = success ? 'jb2a.ui.success.green' : 'jb2a.ui.failure.red';
        const pulse = success ? STAT_PULSE_SUCCESS : STAT_PULSE_FAIL;
        const soundKey = success ? 'success' : 'fail';
        await Sequencer.Preloader.preloadForClients([file, pulse]);
        if (waitForActiveFX)
        {
            await _waitForSourceEffectsToEnd(token);
            await new Promise((resolve) => setTimeout(resolve, 600));
        }
        new Sequence()
            .effect()
            .file(pulse)
            .atLocation(token)
            .scaleToObject(3)
            .belowTokens()
            .duration(1500)
            .fadeIn(200)
            .fadeOut(400)
            .play();
        new Sequence()
            .effect()
            .file(file)
            .attachTo(token)
            .scale(0.5)
            .aboveInterface()
            .play();
        playStatsSound(soundKey);
    }
    catch (e)
    {
        console.error('lancer-automations | stat roll overlay failed:', e);
    }
}

const _statRollOverlayHandler = async (flow) =>
{
    if (flow?.state?.la_extraData?.suppressStatFX)
        return;
    const total = flow?.state?.data?.result?.roll?.total;
    if (typeof total !== 'number')
        return;
    const sourceToken = flow?.state?.actor?.getActiveTokens?.()?.[0];
    if (!sourceToken)
        return;
    const targetVal = flow?.state?.la_extraData?.targetVal ?? 10;
    await playStatRollOutcomeFX(sourceToken, total >= targetVal);
};
Hooks.on('lancer.postFlow.StatRollFlow', _statRollOverlayHandler);
