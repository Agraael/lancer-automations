// Deprecation scans over saved world data. A world that upgrades gets told what stopped working
// instead of finding out mid-session.
import { AutomationManager } from "../activations/automation-manager.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { localizeFormat } from "../tools/string-utils.js";

/**
 * @typedef {Object} DeprecationCheck
 * @property {string} id
 * @property {string} message - Headline shown before the list of affected entries.
 * @property {() => string[]} scan - Labels of the entries that need migrating.
 */

/** Every saved reaction, labelled by where it lives. Defaults are skipped, they ship already migrated. */
function* savedAutomations()
{
    const items = getModuleSetting(AutomationManager.SETTING_AUTOMATIONS) || {};
    for (const [lid, entry] of Object.entries(items))
        for (const automation of (Array.isArray(entry?.reactions) ? entry.reactions : []))
            yield { label: `item ${lid} / ${automation?.name || 'unnamed'}`, automation };

    const general = getModuleSetting(AutomationManager.SETTING_GENERAL_AUTOMATIONS) || {};
    for (const [name, entry] of Object.entries(general))
        for (const automation of (Array.isArray(entry?.reactions) ? entry.reactions : [entry]))
            yield { label: `general ${name}`, automation };
}

function* savedStartupScripts()
{
    for (const script of AutomationManager.getStartupScripts())
        yield { label: `startup script ${script?.name || 'unnamed'}`, code: typeof script?.code === 'string' ? script.code : '' };
}

/** True when any user-authored code field on the reaction matches the pattern. */
function automationCodeMentions(automation, pattern)
{
    return !!automation && typeof automation === 'object'
        && Object.values(automation).some(value => typeof value === 'string' && pattern.test(value));
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

        for (const { label, automation } of savedAutomations())
        {
            if (!automationCodeMentions(automation, /endActivation/))
                continue;

            const triggers = Array.isArray(automation.triggers) ? automation.triggers : [];
            if (!triggers.some(trigger => endTriggers.includes(trigger)))
                hits.push(label);
        }

        for (const { label, code } of savedStartupScripts())
        {
            if (code.includes('endActivation') && !endTriggers.some(trigger => code.includes(trigger)))
                hits.push(label);
        }

        return hits;
    }
};

const INVOLUNTARY_TRIGGERS = ['onPreInvoluntaryMove', 'onInvoluntaryMove'];
const LEGACY_INVOLUNTARY_FIELDS = /triggerData\s*\.\s*(token|destination|distance)\b|triggerData\s*\[\s*['"](token|destination|distance)['"]|\b(token|destination|distance)\b[^{}]*\}\s*=\s*triggerData/;

const involuntaryMoveCheck = {
    id: 'involuntaryMove',
    message: 'onPreInvoluntaryMove / onInvoluntaryMove now carry the onPreMove / onMove data: triggeringToken is the moved '
        + 'token, sourceToken is the pusher, and token, destination and distance are gone. Update these activations:',
    scan()
    {
        const hits = [];

        for (const { label, automation } of savedAutomations())
        {
            const triggers = Array.isArray(automation?.triggers) ? automation.triggers : [];
            if (triggers.some(trigger => INVOLUNTARY_TRIGGERS.includes(trigger))
                && automationCodeMentions(automation, LEGACY_INVOLUNTARY_FIELDS))
                hits.push(label);
        }

        for (const { label, code } of savedStartupScripts())
        {
            if (code.includes('InvoluntaryMove') && LEGACY_INVOLUNTARY_FIELDS.test(code))
                hits.push(label);
        }

        return hits;
    }
};

const LEGACY_DEFENSE_CODE = /subtype\s*:\s*['"](resistance|vulnerability)['"]|(getImmunityBonuses|consumeImmunityUse|getApplicableImmunityBonuses|getGateImmunityBonuses|getAttackImmunityBonuses)\s*\([^)]*['"](resistance|vulnerability)['"]/;

const defenseSubtypeCheck = {
    id: 'defenseSubtypes',
    message: 'Resistance and vulnerability are now their own bonus types. Replace { type: "immunity", subtype: "resistance" } with '
        + '{ type: "resistance" }, getImmunityBonuses(actor, "resistance") with getResistanceBonuses(actor) and '
        + 'consumeImmunityUse(actor, "resistance", ...) with consumeResistanceUse(actor, ...). Same for vulnerability. Update these:',
    scan()
    {
        const hits = [];

        for (const { label, automation } of savedAutomations())
        {
            if (automationCodeMentions(automation, LEGACY_DEFENSE_CODE))
                hits.push(label);
        }

        for (const { label, code } of savedStartupScripts())
        {
            if (LEGACY_DEFENSE_CODE.test(code))
                hits.push(label);
        }

        for (const macro of game.macros ?? [])
        {
            if (macro.type === 'script' && LEGACY_DEFENSE_CODE.test(macro.command ?? ''))
                hits.push(`macro ${macro.name}`);
        }

        return hits;
    }
};

const LEGACY_MOVEMENT_CODE = /subtype\s*:\s*['"](elevation|terrain|obstacle)['"]|(getImmunityBonuses|consumeImmunityUse)\s*\([^)]*['"](elevation|terrain|obstacle)['"]/;

const movementSubtypeCheck = {
    id: 'movementSubtypes',
    message: 'Movement immunities are now the "movement" bonus type. Replace { type: "immunity", subtype: "elevation" } with '
        + '{ type: "movement", subtype: "climber" }, "terrain" with "terrain_immunity" and "obstacle" with "phasing". '
        + 'getImmunityBonuses and consumeImmunityUse become getMovementBonuses and consumeMovementUse. Update these:',
    scan()
    {
        const hits = [];

        for (const { label, automation } of savedAutomations())
        {
            if (automationCodeMentions(automation, LEGACY_MOVEMENT_CODE))
                hits.push(label);
        }

        for (const { label, code } of savedStartupScripts())
        {
            if (LEGACY_MOVEMENT_CODE.test(code))
                hits.push(label);
        }

        for (const macro of game.macros ?? [])
        {
            if (macro.type === 'script' && LEGACY_MOVEMENT_CODE.test(macro.command ?? ''))
                hits.push(`macro ${macro.name}`);
        }

        return hits;
    }
};

/** @type {DeprecationCheck[]} */
const CHECKS = [endActivationCheck, involuntaryMoveCheck, defenseSubtypeCheck, movementSubtypeCheck];

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
        ui.notifications.warn(localizeFormat('LA.notify.deprecatedActivations', { count: total }));
    return results;
}
