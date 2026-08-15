// csm-lancer-qol combatTracking lacks a delta guard, so flag-only updates duplicate effects and over-tick timers.
Hooks.once('ready', () =>
{
    if (!game.modules.get('csm-lancer-qol')?.active)
        return;
    const entry = (Hooks.events?.updateCombat ?? []).find(item => item.fn?.name === 'combatTracking');
    if (!entry)
        return;
    const original = entry.fn;
    Hooks.off('updateCombat', original);
    Hooks.on('updateCombat', (combat, changed, options, userId) =>
    {
        if (changed?.turn === undefined && changed?.round === undefined)
            return;
        return original(combat, changed, options, userId);
    });
    console.log('lancer-automations | guarded csm-lancer-qol combatTracking against flag-only combat updates');
});
