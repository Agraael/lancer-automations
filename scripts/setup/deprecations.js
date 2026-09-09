// Deprecation scans over saved world data. A world that upgrades gets told what stopped working
// instead of finding out mid-session.
import { ReactionManager } from "../activations/reaction-manager.js";

/**
 * @typedef {Object} DeprecationCheck
 * @property {string} id
 * @property {string} message - Headline shown before the list of affected entries.
 * @property {() => string[]} scan - Labels of the entries that need migrating.
 */

/** Every saved reaction, labelled by where it lives. Defaults are skipped, they ship already migrated. */
function* savedReactions()
{
    const items = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_REACTIONS) || {};
    for (const [lid, entry] of Object.entries(items))
        for (const reaction of (Array.isArray(entry?.reactions) ? entry.reactions : []))
            yield { label: `item ${lid} / ${reaction?.name || 'unnamed'}`, reaction };

    const general = game.settings.get(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS) || {};
    for (const [name, entry] of Object.entries(general))
        for (const reaction of (Array.isArray(entry?.reactions) ? entry.reactions : [entry]))
            yield { label: `general ${name}`, reaction };
}

/** True when any user-authored code field on the reaction mentions the token. */
function reactionCodeMentions(reaction, token)
{
    return !!reaction && typeof reaction === 'object'
        && Object.values(reaction).some(value => typeof value === 'string' && value.includes(token));
}

/** @type {DeprecationCheck} */
const endActivationCheck = {
    id: 'endActivation',
    message: 'triggerData.endActivation is deprecated and these activations no longer receive the end of an '
        + 'activation. Add "onEndActivation" (or "onInitEndActivation") to their triggers:',
    scan()
    {
        const endTriggers = ['onEndActivation', 'onInitEndActivation'];
        const hits = [];

        for (const { label, reaction } of savedReactions())
        {
            if (!reactionCodeMentions(reaction, 'endActivation'))
                continue;
            const triggers = Array.isArray(reaction.triggers) ? reaction.triggers : [];
            if (!triggers.some(trigger => endTriggers.includes(trigger)))
                hits.push(label);
        }

        for (const script of ReactionManager.getStartupScripts())
        {
            const code = typeof script?.code === 'string' ? script.code : '';
            if (code.includes('endActivation') && !endTriggers.some(trigger => code.includes(trigger)))
                hits.push(`startup script ${script?.name || 'unnamed'}`);
        }

        return hits;
    }
};

/** @type {DeprecationCheck[]} */
const CHECKS = [endActivationCheck];

/**
 * Run every deprecation check and report the results. GM only, the fixes are world-level.
 * @returns {Record<string, string[]>} Affected entry labels keyed by check id.
 */
export function runDeprecationScans()
{
    /** @type {Record<string, string[]>} */
    const results = {};
    if (!game.user?.isGM)
        return results;

    let total = 0;
    for (const check of CHECKS)
    {
        let hits = [];
        try
        {
            hits = check.scan() ?? [];
        }
        catch (error)
        {
            console.error(`lancer-automations | Deprecation check "${check.id}" failed:`, error);
            continue;
        }
        if (!hits.length)
            continue;
        results[check.id] = hits;
        total += hits.length;
        console.warn(`lancer-automations | ${check.message}\n  ${hits.join('\n  ')}`);
    }

    if (total)
        ui.notifications.warn(`${total} saved activation(s) use a deprecated pattern. See the console for details.`);
    return results;
}
