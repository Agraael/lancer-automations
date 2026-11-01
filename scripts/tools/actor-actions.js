import { getLAFlag } from "./flag-utils.js";
import { getItemActions, linkTierGate, isPrimaryActionHidden, gateActions } from "../interactive/deployables.js";
import { resolvePilot } from "../utils/lancer-token.js";

/** Maps activation type strings to the NPC feature tag LID that signals that activation. */
export const ACTIVATION_TAG_MAP = {
    'Quick':      'tg_quick_action',
    'Full':       'tg_full_action',
    'Quick Tech': 'tg_quick_tech',
    'Full Tech':  'tg_full_tech',
    'Protocol':   'tg_protocol',
    'Reaction':   'tg_reaction',
    'Free':       'tg_free_action',
    'Deactivate': 'tg_deactivate',
    'Invade':     'tg_invade',
};

function isCoreActivationAction(coreSystem, action)
{
    const name = String(action?.name ?? '').trim().toLowerCase();
    return !!name && name === String(coreSystem?.active_name ?? '').trim().toLowerCase();
}

export function coreGrantedActions(coreSystem)
{
    return (coreSystem?.active_actions ?? []).filter(action => !isCoreActivationAction(coreSystem, action));
}

export function coreActivationAction(coreSystem)
{
    return { name: coreSystem?.active_name ?? 'Core Power', activation: coreSystem?.activation, detail: coreSystem?.active_effect ?? '', _coreActive: true };
}

/**
 * Returns all actor items (with their source item) whose activation matches `activationType`.
 * Mechs and pilots scan loadout systems, weapons, mods and frame passives through `getItemActions` (extraActions included).
 * NPCs scan npc_feature tags (e.g. tg_quick_action → "Quick") plus any explicit actions array.
 *
 * @param {Actor} actor
 * @param {string} activationType  e.g. "Quick", "Full", "Quick Tech", "Full Tech", "Invade"
 * @returns {{ action: Object, sourceItem: Item }[]}
 */
export function getActorActionItems(actor, activationType)
{
    const results = [];

    if (actor?.type === 'npc')
    {
        const tagLid = ACTIVATION_TAG_MAP[activationType];
        for (const item of (actor.items ?? []))
        {
            if (item.type !== 'npc_feature')
                continue;
            const itemTags = item.system?.tags ?? [];
            const tagMatched = tagLid ? itemTags.some(tag => tag.lid === tagLid) : false;
            const hidePrimary = isPrimaryActionHidden(item);
            const extraActions = getItemActions(item, { extraOnly: hidePrimary }).filter(action =>
                action.activation === activationType || action.activation === activationType + ' Action'
            );
            // Fallback: match by system.type when no tag and no explicit actions found
            const typeActivation = item.system?.type === 'Tech'
                ? (item.system?.tech_type === 'Full' ? 'Full Tech' : 'Quick Tech')
                : item.system?.type;
            const typeMatched = !tagMatched && !extraActions.length && typeActivation === activationType;
            if (!hidePrimary && (tagMatched || typeMatched))
            {
                results.push({
                    action: {
                        name: item.name,
                        activation: activationType,
                        detail: item.system?.effect ?? '',
                        trigger: item.system?.trigger ?? '',
                        tags: itemTags,
                        tech_attack: item.system?.tech_attack ?? false,
                        attack_bonus: item.system?.attack_bonus ?? null,
                        accuracy: item.system?.accuracy ?? null,
                        range: item.system?.range ?? [],
                        damage: item.system?.damage ?? [],
                        on_hit: item.system?.on_hit ?? '',
                    },
                    sourceItem: item,
                });
            }
            for (const action of extraActions)
                results.push({ action, sourceItem: item });
        }
    }
    else
    {
        for (const systemSlot of (actor?.system?.loadout?.systems ?? []))
        {
            const item = systemSlot?.value;
            if (!item)
                continue;
            for (const action of getItemActions(item, { extraOnly: isPrimaryActionHidden(item) }))
            {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: item });
            }
        }
        for (const mount of (actor?.system?.loadout?.weapon_mounts ?? []))
        {
            for (const slot of (mount.slots ?? []))
            {
                const weapon = slot.weapon?.value;
                if (weapon)
                {
                    for (const action of getItemActions(weapon, { extraOnly: isPrimaryActionHidden(weapon) }))
                    {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: weapon });
                    }
                }
                const mod = slot.mod?.value;
                if (mod)
                {
                    for (const action of getItemActions(mod, { extraOnly: isPrimaryActionHidden(mod) }))
                    {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: mod });
                    }
                }
            }
        }
        const frame = actor?.system?.loadout?.frame?.value;
        if (frame)
        {
            const coreSystem = frame.system?.core_system;
            if (coreSystem?.activation === activationType)
            {
                results.push({
                    action: coreActivationAction(coreSystem),
                    sourceItem: frame,
                    _coreActive: true,
                });
            }
            for (const action of (coreSystem?.active_actions ?? []))
            {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: frame, _coreGranted: !isCoreActivationAction(coreSystem, action) });
            }
            for (const action of (coreSystem?.passive_actions ?? []))
            {
                if (action.activation === activationType)
                    results.push({ action, sourceItem: frame });
            }
            for (const trait of (frame.system?.traits ?? []))
            {
                for (const action of (trait.actions ?? []))
                {
                    if (action.activation === activationType)
                        results.push({ action, sourceItem: frame });
                }
            }
        }

        if (actor?.type === 'pilot')
        {
            for (const item of (actor.items ?? []))
            {
                if (item.type === 'pilot_gear' || item.type === 'pilot_armor' || item.type === 'pilot_weapon')
                {
                    for (const action of getItemActions(item, { extraOnly: isPrimaryActionHidden(item) }))
                    {
                        if (action.activation === activationType)
                            results.push({ action, sourceItem: item });
                    }
                }
            }
        }
        else
        {
            const pilot = resolvePilot(actor);
            if (pilot)
            {
                for (const item of (pilot.items ?? []))
                {
                    if (item.type === 'talent')
                    {
                        const currRank = item.system?.curr_rank ?? 0;
                        for (let rankIndex = 0; rankIndex < currRank; rankIndex++)
                        {
                            for (const action of (item.system?.ranks?.[rankIndex]?.actions ?? []))
                            {
                                if (action.activation === activationType)
                                    results.push({ action, sourceItem: item, rankIdx: rankIndex });
                            }
                        }
                    }
                    else if (item.type === 'core_bonus')
                    {
                        for (const action of getItemActions(item, { extraOnly: isPrimaryActionHidden(item) }))
                        {
                            if (action.activation === activationType)
                                results.push({ action, sourceItem: item });
                        }
                    }
                }
            }
        }
    }

    // Actor-level extra actions (stored on actor flag via addExtraActions(actor, ...))
    const actorExtraActions = gateActions(
        (getLAFlag(actor,'extraActions') || []).filter((/** @type {any} */ action) => linkTierGate(action, actor)),
        actor
    );
    for (const action of actorExtraActions)
    {
        if (action.activation === activationType)
            results.push({ action: { ...action, _isExtra: true }, sourceItem: null });
    }

    return results;
}
