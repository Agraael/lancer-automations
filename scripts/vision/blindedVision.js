const MODULE_ID = 'lancer-automations';
const SETTING_BLINDED_VISION = 'blindedSetsVision';
const FLAG_CLAMPED = 'blindedClampedSight';
const STATUS_ID = 'blinded';

/**
 * Is the Blinded vision rule turned on?
 * @returns {boolean}
 */
export function blindedVisionEnabled()
{
    try
    {
        return game.settings.get(MODULE_ID, SETTING_BLINDED_VISION) !== false;
    }
    catch
    {
        return false;
    }
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

function overRange(mode, target)
{
    return SIGHT_MODES.has(mode.id) && mode.enabled !== false && (mode.range === null || mode.range > target);
}

// range null is Foundry's unlimited, and the resting state for Lancer tokens.
function retunedModes(doc, range)
{
    return (doc.detectionModes ?? []).map(mode => SIGHT_MODES.has(mode.id) ? { ...mode, range } : { ...mode });
}

async function applyBlindSight(token)
{
    const doc = token?.document ?? token;
    if (!doc?.sight?.enabled)
        return;
    const target = blindRange();
    const marked = doc.getFlag(MODULE_ID, FLAG_CLAMPED) !== undefined;
    if (marked && doc.sight.range === target && !(doc.detectionModes ?? []).some(mode => overRange(mode, target)))
        return;
    await doc.update({
        [`flags.${MODULE_ID}.${FLAG_CLAMPED}`]: true,
        'sight.range': target,
        detectionModes: retunedModes(doc, target),
    });
}

async function restoreSight(token)
{
    const doc = token?.document ?? token;
    if (doc?.getFlag?.(MODULE_ID, FLAG_CLAMPED) === undefined)
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
    canvas.perception?.update?.({ initializeVision: true, refreshVision: true, refreshLighting: true }, true);
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

// GM-only writer: token documents are world data, and every client would otherwise race the same update.
function writer()
{
    return game.user?.isGM && game.users.activeGM?.id === game.user.id;
}

export function initBlindedVision()
{
    game.settings.register(MODULE_ID, SETTING_BLINDED_VISION, {
        name: 'Blinded reduces vision',
        hint: 'While Blinded, a token sees only one space.',
        scope: 'world',
        config: false,
        type: Boolean,
        default: true,
        onChange: () =>
        {
            if (writer())
                reconcileAll();
        },
    });

    const onEffectChange = (document) =>
    {
        if (!writer() || !document?.parent?.documentName)
            return;
        if (!document.statuses?.has?.(STATUS_ID))
            return;
        reconcileActor(document.parent);
    };
    Hooks.on('createActiveEffect', onEffectChange);
    Hooks.on('deleteActiveEffect', onEffectChange);

    Hooks.on('canvasReady', () =>
    {
        if (writer())
            reconcileAll();
    });
    Hooks.on('createToken', (tokenDoc) =>
    {
        if (writer())
            reconcileToken(canvas.tokens?.get(tokenDoc.id));
    });
}
