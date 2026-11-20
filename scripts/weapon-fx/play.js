import { CLIPS } from './clips.js';
import { cueEvents, weaponFxVolume } from './sounds.js';
import { _lwfxTaggedSequence } from '../fx/actionFX.js';

function applyFilter(effect, css)
{
    const color = {};
    const hue = /hue-rotate\(([-\d.]+)deg\)/.exec(css);
    const brightness = /brightness\(([-\d.]+)\)/.exec(css);
    const blur = /blur\(([-\d.]+)px\)/.exec(css);

    if (hue)
        color.hue = Number(hue[1]);
    if (brightness)
        color.brightness = Number(brightness[1]);
    if (Object.keys(color).length)
        effect.filter('ColorMatrix', color);
    if (blur)
        effect.filter('Blur', { strength: Number(blur[1]) });
}

function staticFile(key)
{
    const range = /\.(\d+ft)(?:\.\d+)?$/.exec(key);
    if (!range)
        return key;

    const entry = /** @type {any} */ (globalThis.Sequencer).Database.getEntry(key, { softFail: true });
    const file = entry?.getFile?.(range[1]);
    return typeof file === 'string' ? file : key;
}

function addStep(sequence, step, layering)
{
    const key = CLIPS[step.src].key;
    const effect = sequence.effect().xray(layering.xray).aboveInterface(layering.aboveInterface).file(step.from ? key : staticFile(key)).delay(step.at);

    if (step.from)
    {
        effect.atLocation(step.from).stretchTo(step.to);
        if (step.scale && step.scale !== 1)
            effect.scale(step.scale);
    }
    else
    {
        const spot = step.place;
        effect.atLocation({ x: spot.left + spot.ox, y: spot.top + spot.oy })
            .anchor({ x: spot.ox / spot.width, y: spot.oy / spot.height })
            .size({ width: spot.width, height: spot.height })
            .rotate(-spot.angle);
    }

    if (step.skip)
        effect.startTime(step.skip);
    if (step.rate)
        effect.playbackRate(step.rate);
    if (step.fade)
        effect.duration(step.ms).fadeOut(step.fade);
    if (step.opacity !== 1)
        effect.opacity(step.opacity);
    if (step.filter)
        applyFilter(effect, step.filter);
    if (step.layer === 'decal')
        effect.belowTokens();
}

export async function playRecipe(recipe, sequenceIds)
{
    const makeSequence = _lwfxTaggedSequence();
    if (!makeSequence || !recipe.steps.length)
        return;

    const volume = weaponFxVolume();
    const sounds = volume > 0 ? sequenceIds.flatMap(id => cueEvents(id, recipe)) : [];
    const files = [...new Set([...recipe.steps.map(step => CLIPS[step.src].key), ...sounds.map(event => event.src)])];
    await globalThis.Sequencer.Preloader.preloadForClients(files);
    const sequence = makeSequence();
    const api = /** @type {any} */ (game.modules.get('lancer-weapon-fx'))?.api;
    const layering = { xray: !!api?.isEffectIgnoreFogOfWar?.(), aboveInterface: !!api?.isEffectIgnoreLightingColoration?.() };

    for (const step of recipe.steps)
        addStep(sequence, step, layering);
    for (const event of sounds)
        sequence.sound().file(event.src).delay(event.at).volume(volume);
    await sequence.play();
}
