// Build an alt-struct flow button (anchor).
// attrs holds any extra data-* pairs (e.g. { 'check-type': 'hull', 'rem-struct': 3 }).
export function altStructButton({ flowType, actorUuid, icon, label, attrs = {} })
{
    const extra = Object.entries(attrs)
        .map(([name, value]) => `data-${name}="${value}"`)
        .join(' ');
    return `<a class="alt-struct-flow-button lancer-button" data-flow-type="${flowType}" ${extra} data-actor-id="${actorUuid}">`
        + `<i class="${icon} i--sm"></i> ${label}</a>`;
}

// Only structure-card.hbs and overheat-card.hbs render embedButtons.
export function pushEmbedButton(state, opts)
{
    state.data.embedButtons = state.data.embedButtons || [];
    state.data.embedButtons.push(altStructButton(opts));
}

export function getRollCount(roll, targetFace)
{
    return roll
        ? roll.terms[0].results.filter((dieResult) => dieResult.result === targetFace).length
        : 0;
}

export async function destroyMech(actor, errorText = "The mech is DESTROYED.")
{
    try
    {
        await actor.update({
            "system.structure.value": 0,
            "system.hp.value": actor.system.hp.value - actor.system.hp.max
        });
    }
    catch (error)
    {
        console.error("lancer-automations (alt-struct): Failed to destroy mech:", error);
        ui.notifications.error(errorText);
    }
}
