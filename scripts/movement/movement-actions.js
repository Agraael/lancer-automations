/* global Hooks, CONFIG, game */

const FLYING_STATUS_IDS = ['flying', 'hover'];

export const FREE_PREFIX = 'free_';

export function parseAction(action)
{
    if (typeof action === 'string' && action.startsWith(FREE_PREFIX))
        return { base: action.slice(FREE_PREFIX.length), free: true };
    return { base: action ?? null, free: false };
}

export function isFreeAction(action)
{
    return parseAction(action).free;
}

export function freeTwinOf(action)
{
    const { base, free } = parseAction(action);
    if (free)
        return action;
    return FREE_PREFIX + (base ?? 'walk');
}

function effectHasFlyingStatus(effect)
{
    const ids = effect?.statuses;
    if (!ids)
        return false;
    for (const id of FLYING_STATUS_IDS)
    {
        if (ids.has?.(id))
            return true;
    }
    return false;
}

function syncMovementActionForActor(actor, target)
{
    if (!actor)
        return;
    const tokens = actor.getActiveTokens?.() ?? [];
    for (const t of tokens)
    {
        if (t.document?.movementAction === target)
            continue;
        t.document?.update?.({ movementAction: target });
    }
}

Hooks.on('createActiveEffect', (effect, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (effect.flags?.['lancer-automations']?.isActorTemplate === true)
        return;
    if (!effectHasFlyingStatus(effect))
        return;
    if (effect.parent?.documentName !== 'Actor')
        return;
    syncMovementActionForActor(effect.parent, 'fly');
});

Hooks.on('deleteActiveEffect', (effect, _options, userId) =>
{
    if (userId !== game.userId)
        return;
    if (effect.flags?.['lancer-automations']?.isActorTemplate === true)
        return;
    if (!effectHasFlyingStatus(effect))
        return;
    if (effect.parent?.documentName !== 'Actor')
        return;
    const actor = effect.parent;
    const stillFlying = actor?.effects?.some?.(otherEffect => otherEffect.id !== effect.id && effectHasFlyingStatus(otherEffect) && otherEffect.flags?.['lancer-automations']?.isActorTemplate !== true);
    syncMovementActionForActor(actor, stillFlying ? 'fly' : 'walk');
});

Hooks.once('init', () =>
{
    const actions = CONFIG.Token?.movement?.actions;
    if (!actions)
        return;

    if (actions.fly)
        actions.fly.icon = 'fa-solid fa-fighter-jet';

    if (actions.crawl)
    {
        const baseCanSelect = actions.crawl.canSelect;
        actions.crawl.canSelect = (tokenLike) =>
        {
            const actor = tokenLike?.actor;
            const prone = !!actor?.statuses?.has?.('prone');
            if (!prone)
                return false;
            return baseCanSelect ? baseCanSelect(tokenLike) : true;
        };
    }

    if (actions.forced)
    {
        actions.forced.teleport = false;
        actions.forced.measure = true;
    }

    if (actions.teleport)
        actions.teleport.canSelect = () => false;
    if (actions.blink)
    {
        actions.blink.label = 'Teleport';
        actions.blink.teleport = true;
    }
    if (actions.ignore)
        actions.ignore.label = 'Ignore Elevation';

    for (const [key, cfg] of Object.entries(actions))
    {
        if (key.startsWith(FREE_PREFIX) || !cfg)
            continue;
        actions[FREE_PREFIX + key] = {
            ...cfg,
            canSelect: () => false,
            getCostFunction: () => () => 0,
        };
    }
});
