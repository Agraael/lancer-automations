// csm-lancer-qol's combatTracking treats every updateCombat as a turn change, so flag-only combat updates (Battle Log telemetry, reinforcements) duplicate its effects report and over-tick its timed effects. Re-register it behind the delta guard it's missing.
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
