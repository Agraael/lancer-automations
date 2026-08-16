const _queue = [];

// Every flow lancer-weapon-fx binds. Stat/damage rolls stay out: automations nest those
// inside the outer flow, and their postFlow would drain the queue early.
const FX_FLOWS = [
    'WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow',
    'ActivationFlow', 'SystemFlow', 'CoreActiveFlow', 'OverchargeFlow', 'FullRepairFlow',
    'StructureFlow', 'SecondaryStructureFlow', 'OverheatFlow', 'CascadeFlow',
];

/**
 * Queue work for the current flow's postFlow hook, after lancer-weapon-fx has started its
 * sequence. For trigger code whose printed cards should land after the FX; runs at flow end
 * regardless of whether any FX exists.
 * @param {() => void|Promise<void>} callback
 */
export function afterFx(callback)
{
    _queue.push(callback);
}

// Called one tick after ready so our listeners register behind lancer-weapon-fx's
// (hooks fire in registration order).
export function bindAfterFxDrain()
{
    for (const name of FX_FLOWS)
    {
        Hooks.on(`lancer.postFlow.${name}`, () =>
        {
            for (const job of _queue.splice(0))
            {
                Promise.resolve()
                    .then(job)
                    .catch(error => console.error('lancer-automations | afterFx job failed:', error));
            }
        });
    }
}
