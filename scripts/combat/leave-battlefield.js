import { escapeHtml, localize } from '../tools/string-utils.js';
import { isExecutorGM } from '../utils/lancer-token.js';
import { departToEdge, nearestEdge } from '../fx/arrival-fx.js';
import { recordLeft } from '../Battelog/state-capture.js';

export const LEAVING_STATUS = 'leaving';
export const LEAVING_ICON = 'icons/svg/door-exit.svg';

export const isLeaving = actor => !!actor?.statuses?.has(LEAVING_STATUS);

export async function toggleLeaving(tokens)
{
    const combat = game.combat;
    if (!combat)
    {
        ui.notifications.warn(localize('LA.notify.youMustBeInCombatToUse'));
        return;
    }

    const docs = tokens.map(token => token?.document ?? token).filter(Boolean);
    const inEncounter = docs.filter(doc => combat.getCombatantsByToken(doc).length);
    if (!inEncounter.length)
    {
        ui.notifications.warn(localize('LA.leave.notInEncounter'));
        return;
    }

    const actors = [...new Set(inEncounter.map(doc => doc.actor).filter(actor => actor?.isOwner))];
    if (!actors.length)
        return;

    const active = !actors.every(isLeaving);
    for (const actor of actors)
        await actor.toggleStatusEffect(LEAVING_STATUS, { active });
}

export function leavingCombatants(combat)
{
    return combat.combatants.filter(combatant => combatant.token && isLeaving(combatant.actor));
}

export async function clearLeaving(combatants)
{
    for (const combatant of combatants)
    {
        if (isLeaving(combatant.actor))
            await combatant.actor.toggleStatusEffect(LEAVING_STATUS, { active: false });
    }
}

export function leaveRow(combatant, picked)
{
    const doc = combatant.token;
    const edge = nearestEdge(doc.parent.dimensions.sceneRect, doc.getCenterPoint());
    return {
        id: combatant.id,
        icon: doc.texture.src,
        name: escapeHtml(doc.name),
        sub: localize(`LA.leave.edge.${edge}`),
        picked,
        badge: localize(picked ? 'LA.leave.leave' : 'LA.leave.stay'),
    };
}

export async function leaveUnits(combat, combatants)
{
    const live = combatants.filter(combatant => combat.combatants.has(combatant.id) && combatant.token);
    if (!live.length)
        return;

    for (const combatant of live)
        await recordLeft(combat, combatant.tokenId ?? combatant.actorId, combatant.actor);

    const docs = live.map(combatant => combatant.token);
    await departToEdge(docs);
    await combat.deleteEmbeddedDocuments('Combatant', live.map(combatant => combatant.id));

    for (const scene of new Set(docs.map(doc => doc.parent)))
    {
        const ids = docs.filter(doc => doc.parent === scene && scene.tokens.has(doc.id)).map(doc => doc.id);
        if (ids.length)
            await scene.deleteEmbeddedDocuments('Token', ids);
    }
}

export function initLeaveBattlefield()
{
    Hooks.on('deleteCombat', async (combat) =>
    {
        if (isExecutorGM())
            await clearLeaving(leavingCombatants(combat));
    });
}
