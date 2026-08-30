import { _flowSourceToken } from '../fx/actionFX.js';

const MODULE_ID = 'lancer-automations';
const SOCKET_CHANNEL = 'module.lancer-automations';
const DEFAULT_PAN_DURATION_MS = 1000;
const ACTIVATION_DEBOUNCE_MS = 300;
const SETTING_BY_KIND = {
    cards: 'autoFocusCards',
    attack: 'autoFocusAttack',
    damage: 'autoFocusDamage',
    check: 'autoFocusCheck',
    activation: 'autoFocusActivation'
};
const lastActivationFocus = new Map();

function isFocusEnabled(focusKind)
{
    const settingKey = SETTING_BY_KIND[focusKind];
    if (!settingKey)
        return false;
    try
    {
        return game.settings.get(MODULE_ID, settingKey) === true;
    }
    catch
    {
        return false;
    }
}

function panDurationMs()
{
    try
    {
        const duration = Number(game.settings.get(MODULE_ID, 'autoFocusDuration'));
        return Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_PAN_DURATION_MS;
    }
    catch
    {
        return DEFAULT_PAN_DURATION_MS;
    }
}

// Pilot rolls have no token, _flowSourceToken falls back to the mech.
function flowActorToken(state)
{
    return _flowSourceToken({ state });
}

function entryTokens(entries)
{
    return (entries ?? []).map(entry => entry?.target?.object ?? entry?.target).filter(Boolean);
}

// Pan only, never control.
export function focusTokens(focusKind, tokens)
{
    if (!isFocusEnabled(focusKind) || !canvas?.ready)
        return;
    const placeables = [];
    for (const token of tokens ?? [])
    {
        const placeable = token?.id ? canvas.tokens.get(token.id) : null;
        if (placeable && !placeables.includes(placeable))
            placeables.push(placeable);
    }
    if (placeables.length === 0)
        return;
    const centerX = placeables.reduce((sum, placeable) => sum + placeable.center.x, 0) / placeables.length;
    const centerY = placeables.reduce((sum, placeable) => sum + placeable.center.y, 0) / placeables.length;
    canvas.animatePan({ x: centerX, y: centerY, duration: panDurationMs() });
}

export function focusTokenIds(focusKind, tokenIds)
{
    focusTokens(focusKind, (tokenIds ?? []).map(tokenId => canvas.tokens?.get(tokenId)));
}

// Rolls and action FX are seen by everyone, so everyone follows them.
export function broadcastFocus(focusKind, tokens)
{
    if (!canvas.scene)
        return;
    focusTokens(focusKind, tokens);
    const tokenIds = [...new Set((tokens ?? []).map(token => token?.id).filter(Boolean))];
    if (tokenIds.length === 0)
        return;
    game.socket.emit(SOCKET_CHANNEL, {
        action: 'autoFocus',
        payload: { kind: focusKind, sceneId: canvas.scene.id, tokenIds }
    });
}

export function handleRemoteFocus({ kind, sceneId, tokenIds } = {})
{
    if (!kind || sceneId !== canvas.scene?.id)
        return;
    focusTokenIds(kind, tokenIds);
}

// One pan per FX burst.
function focusActivationToken(token)
{
    if (!token?.id)
        return;
    const now = Date.now();
    if ((lastActivationFocus.get(token.id) ?? 0) > now - ACTIVATION_DEBOUNCE_MS)
        return;
    lastActivationFocus.set(token.id, now);
    broadcastFocus('activation', [token]);
}

const FOCUS_BY_PRINT_STEP = {
    printAttackCard: state => ({ focusKind: 'attack', tokens: [flowActorToken(state), ...entryTokens(state.data?.acc_diff?.targets)] }),
    printTechAttackCard: state => ({ focusKind: 'attack', tokens: [flowActorToken(state), ...entryTokens(state.data?.acc_diff?.targets)] }),
    printDamageCard: state => ({ focusKind: 'damage', tokens: [flowActorToken(state), ...entryTokens(state.data?.targets)] }),
    printStatRollCard: state => ({ focusKind: 'check', tokens: [flowActorToken(state), canvas.tokens.get(state.la_extraData?.targetTokenId)] })
};

// Print steps are roller-only, the message flag carries the focus to the clients that see the card.
export function registerCardFocusFlags()
{
    for (const [stepName, resolveFocus] of Object.entries(FOCUS_BY_PRINT_STEP))
    {
        const originalStep = game.lancer.flowSteps.get(stepName);
        if (!originalStep)
            continue;
        game.lancer.flowSteps.set(stepName, async function (state, options)
        {
            const { focusKind, tokens } = resolveFocus(state);
            const tokenIds = [...new Set(tokens.map(token => token?.id).filter(Boolean))];
            const hookId = tokenIds.length > 0
                ? Hooks.on('preCreateChatMessage', message => message.updateSource({ 'flags.lancer-automations.focus': { kind: focusKind, tokenIds } }))
                : null;
            try
            {
                return await originalStep(state, options);
            }
            finally
            {
                if (hookId)
                    Hooks.off('preCreateChatMessage', hookId);
            }
        });
    }
}

export function initAutoFocus()
{
    // The roller focused at the roll itself, everyone else follows the card they can see.
    Hooks.on('createChatMessage', chatMessage =>
    {
        const focus = chatMessage.flags?.[MODULE_ID]?.focus;
        if (!focus?.kind || !Array.isArray(focus.tokenIds))
            return;
        if (chatMessage.author?.id === game.user.id || !chatMessage.visible)
            return;
        focusTokenIds(focus.kind, focus.tokenIds);
    });
    Hooks.on('lancer-automations.actionFx', focusActivationToken);
}
