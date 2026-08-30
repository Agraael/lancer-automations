// Detects setting conflicts with other modules (csm-lancer-qol, lancer-alt-structure) and offers a one-click autofix + reload.

const MODULE_ID = 'lancer-automations';

/**
 * Registry default has no `enabled` field → defaults to true (line 420 in reaction-manager.js).
 * Users can disable it via the reactions UI, which stores { enabled: false } in generalReactions.
 */
function isEngagementReactionEnabled()
{
    try
    {
        const general = game.settings.get(MODULE_ID, 'generalReactions') || {};
        const entry = general['Engagement'];
        if (!entry)
            return true;
        if (entry.enabled !== undefined)
            return entry.enabled;
        return true;
    }
    catch
    {
        return false;
    }
}

/**
 * Each rule:
 *   - id: unique identifier
 *   - label: description shown in the dialog
 *   - check(): returns true if conflict exists
 *   - fix(): resolves the conflict. Omit for a warning-only rule.
 */
function getConflictRules()
{
    return [
        // StatusFX vs csm-lancer-qol Auto-Status
        {
            id: 'statusfx-vs-qol-auto',
            label: '<b>StatusFX</b> auto-status conflicts with csm-lancer-qol <i>"Enable Status & Condition Automation"</i>',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                const statusFXConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!statusFXConfig.master)
                    return false;
                try
                {
                    return game.settings.get('csm-lancer-qol', 'enableAutomation') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'enableAutomation', false);
            }
        },

        // StatusFX TokenMagic vs csm-lancer-qol Condition Effects
        {
            id: 'statusfx-vs-qol-fx',
            label: '<b>StatusFX</b> TokenMagic effects conflict with csm-lancer-qol <i>"Enable Status & Condition Token Effects"</i>',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                const statusFXConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!statusFXConfig.master)
                    return false;
                try
                {
                    return game.settings.get('csm-lancer-qol', 'enableConditionEffects') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'enableConditionEffects', false);
            }
        },

        // Alt Structure vs csm-lancer-qol One Structure NPC Automation
        {
            id: 'altstruct-vs-qol-onestruct',
            label: '<b>Alt Structure</b> rules conflict with csm-lancer-qol <i>"One Structure NPC Automation"</i>',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try
                {
                    if (!game.settings.get(MODULE_ID, 'enableAltStruct'))
                        return false;
                    return game.settings.get('csm-lancer-qol', 'oneStructNPCAutomation') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'oneStructNPCAutomation', false);
            }
        },

        // Alt Structure vs lancer-alt-structure standalone module
        {
            id: 'altstruct-vs-standalone',
            label: '<b>Alt Structure</b> (built-in) conflicts with standalone <i>lancer-alt-structure</i> module',
            check()
            {
                if (!game.modules.get('lancer-alt-structure')?.active)
                    return false;
                try
                {
                    return game.settings.get(MODULE_ID, 'enableAltStruct') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                // Can't disable a module via settings: disable our setting instead
                await game.settings.set(MODULE_ID, 'enableAltStruct', false);
            }
        },

        // Engagement: lancer-automations reaction vs csm-lancer-qol
        {
            id: 'engagement-vs-qol',
            label: '<b>Engagement</b> reaction conflicts with csm-lancer-qol <i>"Enable Engaged Automation"</i>',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                if (!isEngagementReactionEnabled())
                    return false;
                try
                {
                    return game.settings.get('csm-lancer-qol', 'enableEngageAutomation') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'enableEngageAutomation', false);
            }
        },

        // Remove Statuses on Death: lancer-automations vs csm-lancer-qol
        {
            id: 'wipondeath-vs-qol',
            label: '<b>Remove Statuses on Death</b> conflicts with csm-lancer-qol <i>"Remove Statuses on Death"</i>',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try
                {
                    const statusFXConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                    if (!statusFXConfig.removeStatusesOnDeath)
                        return false;
                    return game.settings.get('csm-lancer-qol', 'enableWipOnDeath') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'enableWipOnDeath', false);
            }
        },
        // Built-in Speed Provider vs standalone lancer-speed-provider
        {
            id: 'speedprovider-vs-standalone',
            label: '<b>Built-in Speed Provider</b> conflicts with standalone <i>lancer-speed-provider</i> module. Auto-fix will disable the built-in provider.',
            check()
            {
                if (!game.modules.get('lancer-speed-provider')?.active)
                    return false;
                try
                {
                    return game.settings.get(MODULE_ID, 'enableBuiltinSpeedProvider') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set(MODULE_ID, 'enableBuiltinSpeedProvider', false);
            }
        },

        // Wreck system vs csm-lancer-qol wrecks
        {
            id: 'wreck-vs-qol',
            label: '<b>Wreck Automation</b> conflicts with csm-lancer-qol <i>"Wreck Automation"</i>. Auto-fix will disable csm-lancer-qol wrecks.',
            check()
            {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try
                {
                    if (!game.settings.get(MODULE_ID, 'enableWrecks'))
                        return false;
                    return game.settings.get('csm-lancer-qol', 'enableAutomationWrecks') === true;
                }
                catch
                {
                    return false;
                }
            },
            async fix()
            {
                await game.settings.set('csm-lancer-qol', 'enableAutomationWrecks', false);
                // Migrate per-token wreck flags from csm-lancer-qol to lancer-automations.
                const flagKeys = [
                    'wreckImgPath', 'wreckEffectPath', 'wreckSoundPath', 'wreckScale',
                    'spawnWreckImage', 'playWreckSound', 'playWreckEffect',
                    'spawnDifficultTerrain', 'isWreck', 'isDead', 'tokenDocument',
                ];
                let patched = 0;
                for (const actor of game.actors)
                {
                    // Get the raw source data to reliably access flags.
                    const rawProto = actor.toObject()?.prototypeToken;
                    const qolFlags = rawProto?.flags?.['csm-lancer-qol'] ?? null;
                    if (!qolFlags || typeof qolFlags !== 'object')
                        continue;
                    console.log(`${MODULE_ID} | Found QoL flags on ${actor.name}:`, Object.keys(qolFlags));
                    const flagsToMigrate = {};
                    for (const key of flagKeys)
                    {
                        if (qolFlags[key] !== undefined && qolFlags[key] !== null)
                            flagsToMigrate[key] = qolFlags[key];
                    }
                    if (Object.keys(flagsToMigrate).length > 0)
                    {
                        try
                        {
                            await actor.update({
                                prototypeToken: {
                                    flags: { [MODULE_ID]: flagsToMigrate }
                                }
                            }, { diff: false, recursive: true });
                            patched++;
                            console.log(`${MODULE_ID} | Migrated ${Object.keys(flagsToMigrate).length} wreck flags on ${actor.name}`);
                        }
                        catch (e)
                        {
                            console.warn(`${MODULE_ID} | Could not migrate wreck flags for ${actor.name}:`, e);
                        }
                    }
                }
                if (patched > 0)
                    console.log(`${MODULE_ID} | Migrated wreck flags on ${patched} actor prototype(s)`);
                let scenePatched = 0;
                for (const scene of game.scenes)
                {
                    const tokenUpdates = [];
                    for (const token of scene.tokens)
                    {
                        const qolFlags = token.toObject?.()?.flags?.['csm-lancer-qol'] ?? token.flags?.['csm-lancer-qol'];
                        if (!qolFlags || typeof qolFlags !== 'object')
                            continue;
                        const flagsToMigrate = {};
                        for (const key of flagKeys)
                        {
                            if (qolFlags[key] !== undefined && qolFlags[key] !== null)
                                flagsToMigrate[key] = qolFlags[key];
                        }
                        if (Object.keys(flagsToMigrate).length > 0)
                        {
                            tokenUpdates.push({
                                _id: token.id,
                                flags: { [MODULE_ID]: flagsToMigrate }
                            });
                        }
                    }
                    if (tokenUpdates.length > 0)
                    {
                        try
                        {
                            await scene.updateEmbeddedDocuments('Token', tokenUpdates);
                            scenePatched += tokenUpdates.length;
                        }
                        catch (e)
                        {
                            console.warn(`${MODULE_ID} | Could not migrate scene token flags on ${scene.name}:`, e);
                        }
                    }
                }
                if (scenePatched > 0)
                    console.log(`${MODULE_ID} | Migrated wreck flags on ${scenePatched} placed token(s)`);
            }
        },

        {
            id: 'jb2a-both-active',
            label: 'Both <b>JB2A</b> packs are active. The Patreon library already contains everything in the free one, so <i>JB2A_DnD5e</i> can be disabled.',
            check()
            {
                return !!game.modules.get('jb2a_patreon')?.active && !!game.modules.get('JB2A_DnD5e')?.active;
            }
        },
    ];
}

// One-time heads-up that QoL is redundant next to LA and only loosely supported.
function showQolAdvisoryOnce()
{
    if (!game.modules.get('csm-lancer-qol')?.active)
        return;
    if (game.settings.get(MODULE_ID, 'qolAdvisoryShown'))
        return;
    game.settings.set(MODULE_ID, 'qolAdvisoryShown', true);
    new Dialog({
        title: 'Lancer Automations: about Lancer QoL',
        content: `
            <p><b>Lancer QoL</b> is enabled. Lancer Automations covers all of its features, and keeping the two modules compatible gets more tedious with every release.</p>
            <p>You can keep using it, but some issues can occur when both run together. Known ones are already patched by Lancer Automations.</p>
            <p style="font-size:0.85em; opacity:0.7;">This notice is only shown once.</p>
        `,
        buttons: {
            ok: {
                icon: '<i class="fas fa-check"></i>',
                label: 'Understood',
                callback: () =>
                {}
            }
        },
        default: 'ok'
    }).render(true);
}

// Call once during the ready hook (GM only).
export function checkCompatibility()
{
    if (!game.user.isGM)
        return;

    showQolAdvisoryOnce();

    const rules = getConflictRules();
    const detected = rules.filter(rule => rule.check());

    const conflicts = detected.filter(rule => typeof rule.fix === 'function');
    const seen = /** @type {string[]} */ (game.settings.get(MODULE_ID, 'compatWarningsShown') || []);
    const warnings = detected.filter(rule => typeof rule.fix !== 'function' && !seen.includes(rule.id));

    if (conflicts.length === 0 && warnings.length === 0)
        return;

    if (warnings.length)
        game.settings.set(MODULE_ID, 'compatWarningsShown', [...seen, ...warnings.map(rule => rule.id)]);

    const listHtml = (entries, color) => entries.map(entry =>
        `<li style="margin-bottom:6px;"><i class="fas fa-exclamation-triangle" style="color:${color};"></i> ${entry.label}</li>`
    ).join('');

    const conflictHtml = conflicts.length
        ? `<p style="margin-bottom:8px;">The following conflicts were detected between <b>Lancer Automations</b> and other modules:</p>
            <ul style="margin:8px 0; padding-left:20px; list-style:none;">${listHtml(conflicts, '#ff6400')}</ul>
            <hr>
            <p><b>Auto-fix</b> will disable the conflicting settings in the other modules and reload Foundry.</p>
            <p style="font-size:0.85em; opacity:0.7;">You can re-enable them later in the respective module settings if needed.</p>`
        : '';

    const warningHtml = warnings.length
        ? `<p style="margin-bottom:8px;">Not conflicts, but worth a look:</p>
            <ul style="margin:8px 0; padding-left:20px; list-style:none;">${listHtml(warnings, '#e0b040')}</ul>`
        : '';

    const fixButtons = {
        fix: {
            icon: '<i class="fas fa-wrench"></i>',
            label: 'Auto-fix & Reload',
            callback: async () =>
            {
                for (const conflict of conflicts)
                {
                    try
                    {
                        await conflict.fix();
                        console.log(`${MODULE_ID} | Compatibility: fixed ${conflict.id}`);
                    }
                    catch (e)
                    {
                        console.error(`${MODULE_ID} | Compatibility: failed to fix ${conflict.id}:`, e);
                    }
                }
                ui.notifications.info('Migration complete. Reloading in 1 second...');
                setTimeout(() => foundry.utils.debouncedReload(), 1000);
            }
        },
        ignore: {
            icon: '<i class="fas fa-times"></i>',
            label: 'Ignore for now',
            callback: () =>
            {}
        }
    };

    const okButton = {
        ok: {
            icon: '<i class="fas fa-check"></i>',
            label: 'Understood',
            callback: () =>
            {}
        }
    };

    new Dialog({
        title: conflicts.length ? 'Lancer Automations - Compatibility Issues' : 'Lancer Automations - Compatibility Notes',
        content: conflictHtml + (conflictHtml && warningHtml ? '<hr>' : '') + warningHtml,
        buttons: conflicts.length ? fixButtons : okButton,
        default: conflicts.length ? 'fix' : 'ok'
    }).render(true);
}
