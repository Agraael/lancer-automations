/* global game, Hooks, canvas, libWrapper, foundry */

const MODULE_ID = 'lancer-automations';
const SETTING_CLEAR_ON_TURN = 'historyClearOnTurn';
const SETTING_CLEAR_ON_ROUND = 'historyClearOnRound';

function asTokenDoc(tokenLike) {
    if (!tokenLike)
        return null;
    return tokenLike.document ?? tokenLike;
}

function laDebug() {
    try {
        return !!game.settings.get(MODULE_ID, 'debugMovement');
    } catch {
        return false;
    }
}

export function getLastMoveDistance(tokenLike) {
    const doc = asTokenDoc(tokenLike);
    return doc?.movement?.history?.recorded?.cost ?? 0;
}

export function getRecordedWaypoints(tokenLike) {
    const doc = asTokenDoc(tokenLike);
    return doc?.movement?.history?.recorded?.waypoints ?? [];
}

export async function clearTokenMovementHistory(tokenLike) {
    const doc = asTokenDoc(tokenLike);
    if (!doc?.clearMovementHistory)
        return false;
    if (!doc.isOwner)
        return false;
    await doc.clearMovementHistory();
    return true;
}

// Native undo() without args reverts the OLDEST move; we want the latest.
export async function revertLastMovement(tokenLike) {
    const doc = asTokenDoc(tokenLike);
    if (!doc)
        return true;
    if (!doc.isOwner)
        return false;
    const history = doc._source?._movementHistory ?? [];
    if (history.length === 0)
        return true;

    const lastMovementId = history.at(-1).movementId;
    const startIdx = history.findIndex(w => w.movementId === lastMovementId);
    const priorIdx = Math.max(startIdx - 1, 0);
    const prior = history[priorIdx];

    const trimmedHistory = history.slice(0, startIdx).map(w => ({
        ...w,
        cost: w.cost === Infinity ? null : w.cost
    }));

    const update = {
        x: prior.x,
        y: prior.y,
        elevation: prior.elevation,
        width: prior.width ?? doc.width,
        height: prior.height ?? doc.height,
        shape: prior.shape ?? doc.shape,
        _movementHistory: trimmedHistory
    };

    const before = history.length;
    await doc.update(update, { isUndo: true, diff: false, animate: true });
    const after = doc._source?._movementHistory?.length ?? 0;
    if (laDebug())
        console.log('lancer-automations | revertLastMovement', {
            tokenId: doc.id,
            lastMovementId,
            before,
            after,
            prior: { x: prior.x, y: prior.y, elevation: prior.elevation }
        });
    return after === 0;
}

async function clearCombatantsHistory(combat) {
    if (!game.user?.isGM)
        return;
    for (const c of combat?.combatants ?? []) {
        const doc = c.token;
        if (!doc)
            continue;
        if ((doc._source?._movementHistory?.length ?? 0) === 0)
            continue;
        try {
            await doc.clearMovementHistory();
        } catch { /* ignore */ }
    }
}

// Native requires combat.started; relax to any combatant so pre-combat setup records.
Hooks.once('setup', () => {
    const proto = foundry.documents.TokenDocument.prototype;
    proto._shouldRecordMovementHistory = function() {
        return !!this.combatant;
    };
});

Hooks.on('recordToken', (tokenDoc) => {
    const len = tokenDoc?._source?._movementHistory?.length ?? 0;
    if (laDebug())
        console.log('lancer-automations | recordToken fired', { tokenId: tokenDoc?.id, historyLen: len });
});

Hooks.once('init', () => {
    game.settings.register(MODULE_ID, SETTING_CLEAR_ON_TURN, {
        name: 'Clear movement history on turn change',
        hint: 'When a combatant\'s turn ends, wipe their recorded movement trail.',
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
    game.settings.register(MODULE_ID, SETTING_CLEAR_ON_ROUND, {
        name: 'Clear movement history on round change',
        hint: 'At the start of each new round, wipe every combatant\'s recorded movement trail.',
        scope: 'world',
        type: Boolean,
        default: false,
        config: false
    });
});


Hooks.on('combatStart', async (combat) => {
    await clearCombatantsHistory(combat);
});

Hooks.on('combatRound', async (combat, _changed, opts) => {
    if (opts?.direction !== 1)
        return;
    if (!game.settings.get(MODULE_ID, SETTING_CLEAR_ON_ROUND))
        return;
    await clearCombatantsHistory(combat);
});

Hooks.on('combatTurnChange', async (combat, prior, _current) => {
    if (!game.user?.isGM)
        return;
    if (!game.settings.get(MODULE_ID, SETTING_CLEAR_ON_TURN))
        return;
    const priorToken = prior?.tokenId ? canvas.scene?.tokens?.get(prior.tokenId) : null;
    if (priorToken) {
        try {
            await priorToken.clearMovementHistory();
        } catch { /* ignore */ }
    }
});

Hooks.on('deleteCombat', async (combat) => {
    await clearCombatantsHistory(combat);
});

Hooks.on('deleteCombatant', async (combatant) => {
    if (!game.user?.isGM)
        return;
    const doc = combatant?.token;
    if (!doc)
        return;
    if ((doc._source?._movementHistory?.length ?? 0) === 0)
        return;
    try {
        await doc.clearMovementHistory();
    } catch { /* ignore */ }
});
