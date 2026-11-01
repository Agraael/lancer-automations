import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting } from '../tools/settings-utils.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';
const SETTING_BLINDED_VISION = 'blindedSetsVision';
const FLAG_CLAMPED = 'blindedClampedSight';
const STATUS_ID = 'blinded';

/**
 * Is the Blinded vision rule turned on?
 * @returns {boolean}
 */
export function blindedVisionEnabled()
{
    return getModuleSetting(SETTING_BLINDED_VISION, false) !== false;
}

const enabled = blindedVisionEnabled;

function isBlinded(actor)
{
    return !!actor?.statuses?.has?.(STATUS_ID);
}

// One space, in scene distance units.
function blindRange()
{
    return canvas?.scene?.grid?.distance ?? 1;
}

// Darkvision and light perception, alongside sight.range. Nothing else is touched.
const SIGHT_MODES = new Set(['basicSight', 'lightPerception']);

function overRange(mode, rangeLimit)
{
    return SIGHT_MODES.has(mode.id) && mode.enabled !== false && (mode.range === null || mode.range > rangeLimit);
}

// range null is Foundry's unlimited; built from source data, prepared ranges are Infinity.
function retunedModes(doc, range)
{
    const modes = (doc._source?.detectionModes ?? []).map(mode =>
        SIGHT_MODES.has(mode.id) ? { ...mode, range } : { ...mode });
    if (range !== null && !modes.some(mode => mode.id === 'lightPerception'))
        modes.push({ id: 'lightPerception', enabled: true, range });
    return modes;
}

async function applyBlindSight(token)
{
    const doc = token?.document ?? token;
    if (!doc?.sight?.enabled)
        return;
    const rangeLimit = blindRange();
    const isClamped = getLAFlag(doc,FLAG_CLAMPED) !== undefined;
    if (isClamped && doc.sight.range === rangeLimit && !(doc.detectionModes ?? []).some(mode => overRange(mode, rangeLimit)))
        return;
    await doc.update({
        [`flags.${MODULE_ID}.${FLAG_CLAMPED}`]: true,
        'sight.range': rangeLimit,
        detectionModes: retunedModes(doc, rangeLimit),
    });
}

async function restoreSight(token)
{
    const doc = token?.document ?? token;
    if (getLAFlag(doc,FLAG_CLAMPED) === undefined)
        return;
    await doc.update({
        [`flags.${MODULE_ID}.-=${FLAG_CLAMPED}`]: null,
        'sight.range': null,
        detectionModes: retunedModes(doc, null),
    });
}

async function reconcileToken(token)
{
    if (!token)
        return;
    const doc = token.document ?? token;
    const blinded = enabled() && isBlinded(doc.actor ?? token.actor);
    if (blinded)
        await applyBlindSight(token);
    else
        await restoreSight(token);
    canvas.perception?.update?.({ initializeVision: true, refreshVision: true, refreshLighting: true });
}

async function reconcileActor(actor)
{
    for (const token of actor?.getActiveTokens?.() ?? [])
        await reconcileToken(token);
}

async function reconcileAll()
{
    for (const token of canvas?.tokens?.placeables ?? [])
        await reconcileToken(token);
}

export function initBlindedVision()
{
    game.settings.register(MODULE_ID, SETTING_BLINDED_VISION, {
        name: 'LA.settings.blindedSetsVision.name',
        hint: 'LA.settings.blindedSetsVision.hint',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () =>
        {
            if (isExecutorGM())
                reconcileAll();
        },
    });

    const onEffectChange = (document) =>
    {
        if (!isExecutorGM() || !document?.parent?.documentName)
            return;
        if (!document.statuses?.has?.(STATUS_ID))
            return;
        reconcileActor(document.parent);
    };
    Hooks.on('createActiveEffect', onEffectChange);
    Hooks.on('deleteActiveEffect', onEffectChange);

    Hooks.on('canvasReady', () =>
    {
        if (isExecutorGM())
            reconcileAll();
    });
    Hooks.on('createToken', (tokenDoc) =>
    {
        if (isExecutorGM())
            reconcileToken(canvas.tokens?.get(tokenDoc.id));
    });
}
