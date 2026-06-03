/* global Hooks, CONFIG, game */

const FLYING_STATUS_IDS = ['flying', 'hover'];

function effectHasFlyingStatus(effect) {
    const ids = effect?.statuses;
    if (!ids) return false;
    for (const id of FLYING_STATUS_IDS) if (ids.has?.(id)) return true;
    return false;
}

function syncMovementActionForActor(actor, target) {
    if (!actor) return;
    const tokens = actor.getActiveTokens?.() ?? [];
    for (const t of tokens) {
        if (t.document?.movementAction === target) continue;
        t.document?.update?.({ movementAction: target });
    }
}

Hooks.on('createActiveEffect', (effect, _options, userId) => {
    if (userId !== game.userId) return;
    if (!effectHasFlyingStatus(effect)) return;
    syncMovementActionForActor(effect.parent, 'fly');
});

Hooks.on('deleteActiveEffect', (effect, _options, userId) => {
    if (userId !== game.userId) return;
    if (!effectHasFlyingStatus(effect)) return;
    // Bail if another flying effect still remains on the actor.
    const actor = effect.parent;
    const stillFlying = actor?.effects?.some?.(e => e.id !== effect.id && effectHasFlyingStatus(e));
    syncMovementActionForActor(actor, stillFlying ? 'fly' : 'walk');
});

Hooks.once('init', () => {
    const actions = CONFIG.Token?.movement?.actions;
    if (!actions)
        return;

    if (actions.fly) {
        actions.fly.icon = 'fa-solid fa-fighter-jet';
    }

    if (actions.crawl) {
        const baseCanSelect = actions.crawl.canSelect;
        actions.crawl.canSelect = (tokenLike) => {
            const actor = tokenLike?.actor;
            const prone = !!actor?.statuses?.has?.('prone');
            if (!prone)
                return false;
            return baseCanSelect ? baseCanSelect(tokenLike) : true;
        };
    }

    if (actions.forced) {
        actions.forced.teleport = false;
        actions.forced.measure = true;
    }

    if (actions.teleport) {
        actions.teleport.canSelect = () => false;
    }
    if (actions.blink) {
        actions.blink.label = 'Teleport';
    }
    if (actions.ignore) {
        actions.ignore.label = 'Ignore Elevation';
    }
});
