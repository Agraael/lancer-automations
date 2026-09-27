// The system hands a reaction back to every combatant on every turn; keep only the one whose turn started.
let _windowUntil = 0;

const WINDOW_MS = 2000;

export function registerReactionRefreshHooks()
{
    Hooks.on('updateCombat', (_combat, changes) =>
    {
        if (('turn' in changes) || ('round' in changes))
            _windowUntil = Date.now() + WINDOW_MS;
    });

    Hooks.on('preUpdateActor', (actor, changes) =>
    {
        if (Date.now() > _windowUntil)
            return;
        if (foundry.utils.getProperty(changes, 'system.action_tracker.reaction') !== true)
            return;
        if (game.combat?.combatant?.actor?.uuid === actor.uuid)
            return;
        const before = actor._source?.system?.action_tracker?.reaction;
        if (before === undefined || before === true)
            return;
        foundry.utils.setProperty(changes, 'system.action_tracker.reaction', before);
    });
}
