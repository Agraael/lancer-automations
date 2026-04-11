/**
 * Compatibility Checker
 *
 * Detects conflicting settings between lancer-automations and other modules
 * (csm-lancer-qol, lancer-alt-structure) and offers a one-click autofix
 * that disables the conflicting settings and reloads.
 */

const MODULE_ID = 'lancer-automations';

/**
 * Check if the Engagement reaction is enabled in lancer-automations.
 * Registry default has no `enabled` field → defaults to true (line 420 in reaction-manager.js).
 * Users can disable it via the reactions UI, which stores { enabled: false } in generalReactions.
 */
function isEngagementReactionEnabled() {
    try {
        const general = game.settings.get(MODULE_ID, 'generalReactions') || {};
        const entry = general['Engagement'];
        // No saved entry = using registry default = enabled (true)
        if (!entry)
            return true;
        // Saved entry with enabled explicitly set
        if (entry.enabled !== undefined)
            return entry.enabled;
        // Saved entry without enabled field = default = true
        return true;
    } catch {
        return false;
    }
}

/**
 * Each rule:
 *   - id: unique identifier
 *   - label: description shown in the dialog
 *   - check(): returns true if conflict exists
 *   - fix(): resolves the conflict
 */
function getConflictRules() {
    return [
        // ── StatusFX vs csm-lancer-qol Auto-Status ──
        {
            id: 'statusfx-vs-qol-auto',
            label: '<b>StatusFX</b> auto-status conflicts with csm-lancer-qol <i>"Enable Status & Condition Automation"</i>',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                const laConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!laConfig.master)
                    return false;
                try {
                    return game.settings.get('csm-lancer-qol', 'enableAutomation') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableAutomation', false);
            }
        },

        // ── StatusFX TokenMagic vs csm-lancer-qol Condition Effects ──
        {
            id: 'statusfx-vs-qol-fx',
            label: '<b>StatusFX</b> TokenMagic effects conflict with csm-lancer-qol <i>"Enable Status & Condition Token Effects"</i>',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                const laConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!laConfig.master)
                    return false;
                try {
                    return game.settings.get('csm-lancer-qol', 'enableConditionEffects') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableConditionEffects', false);
            }
        },

        // ── Alt Structure vs csm-lancer-qol One Structure NPC Automation ──
        {
            id: 'altstruct-vs-qol-onestruct',
            label: '<b>Alt Structure</b> rules conflict with csm-lancer-qol <i>"One Structure NPC Automation"</i>',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try {
                    if (!game.settings.get(MODULE_ID, 'enableAltStruct'))
                        return false;
                    return game.settings.get('csm-lancer-qol', 'oneStructNPCAutomation') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'oneStructNPCAutomation', false);
            }
        },

        // ── Alt Structure vs lancer-alt-structure standalone module ──
        {
            id: 'altstruct-vs-standalone',
            label: '<b>Alt Structure</b> (built-in) conflicts with standalone <i>lancer-alt-structure</i> module',
            check() {
                if (!game.modules.get('lancer-alt-structure')?.active)
                    return false;
                try {
                    return game.settings.get(MODULE_ID, 'enableAltStruct') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                // Can't disable a module via settings — disable our setting instead
                await game.settings.set(MODULE_ID, 'enableAltStruct', false);
            }
        },

        // ── Engagement: lancer-automations reaction vs csm-lancer-qol ──
        {
            id: 'engagement-vs-qol',
            label: '<b>Engagement</b> reaction conflicts with csm-lancer-qol <i>"Enable Engaged Automation"</i>',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                if (!isEngagementReactionEnabled())
                    return false;
                try {
                    return game.settings.get('csm-lancer-qol', 'enableEngageAutomation') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableEngageAutomation', false);
            }
        },

        // ── Remove Statuses on Death: lancer-automations vs csm-lancer-qol ──
        {
            id: 'wipondeath-vs-qol',
            label: '<b>Remove Statuses on Death</b> conflicts with csm-lancer-qol <i>"Remove Statuses on Death"</i>',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try {
                    const laConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                    if (!laConfig.removeStatusesOnDeath)
                        return false;
                    return game.settings.get('csm-lancer-qol', 'enableWipOnDeath') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableWipOnDeath', false);
            }
        },
        // ── Movement Cap / Boost work best with ER movement history ──
        {
            id: 'movement-cap-no-history',
            label: 'Movement Cap and Boost Detection need <b>Combat Movement History</b> enabled in Elevation Ruler. Auto-fix will enable it.',
            check() {
                if (!game.modules.get('elevationruler')?.active)
                    return false;
                // Stock ER may not have this setting — safe check.
                try {
                    if (game.settings.get('elevationruler', 'token-ruler-combat-history'))
                        return false;
                } catch {
                    return false;
                }
                try {
                    return game.settings.get(MODULE_ID, 'enableMovementCapDetection')
                        || game.settings.get(MODULE_ID, 'experimentalBoostDetection');
                } catch {
                    return false;
                }
            },
            async fix() {
                try {
                    await game.settings.set('elevationruler', 'token-ruler-combat-history', true);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Could not enable ER combat history:`, e);
                }
            }
        },

        // ── Wreck system vs csm-lancer-qol wrecks ──
        {
            id: 'wreck-vs-qol',
            label: '<b>Wreck Automation</b> conflicts with csm-lancer-qol <i>"Wreck Automation"</i>. Auto-fix will disable csm-lancer-qol wrecks.',
            check() {
                if (!game.modules.get('csm-lancer-qol')?.active)
                    return false;
                try {
                    if (!game.settings.get(MODULE_ID, 'enableWrecks'))
                        return false;
                    return game.settings.get('csm-lancer-qol', 'enableAutomationWrecks') === true;
                } catch {
                    return false;
                }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableAutomationWrecks', false);
                // Migrate per-token wreck flags from csm-lancer-qol to lancer-automations.
                const flagKeys = [
                    'wreckImgPath', 'wreckEffectPath', 'wreckSoundPath', 'wreckScale',
                    'spawnWreckImage', 'playWreckSound', 'playWreckEffect',
                    'spawnDifficultTerrain', 'isWreck', 'isDead', 'tokenDocument',
                ];
                let patched = 0;
                for (const actor of game.actors) {
                    // Get the raw source data to reliably access flags.
                    const rawProto = actor.toObject()?.prototypeToken;
                    const qolFlags = rawProto?.flags?.['csm-lancer-qol'] ?? null;
                    if (!qolFlags || typeof qolFlags !== 'object') {
                        continue;
                    }
                    console.log(`${MODULE_ID} | Found QoL flags on ${actor.name}:`, Object.keys(qolFlags));
                    const laFlagData = {};
                    for (const key of flagKeys) {
                        if (qolFlags[key] !== undefined && qolFlags[key] !== null) {
                            laFlagData[key] = qolFlags[key];
                        }
                    }
                    if (Object.keys(laFlagData).length > 0) {
                        try {
                            await actor.update({
                                prototypeToken: {
                                    flags: { [MODULE_ID]: laFlagData }
                                }
                            }, { diff: false, recursive: true });
                            patched++;
                            console.log(`${MODULE_ID} | Migrated ${Object.keys(laFlagData).length} wreck flags on ${actor.name}`);
                        } catch (e) {
                            console.warn(`${MODULE_ID} | Could not migrate wreck flags for ${actor.name}:`, e);
                        }
                    }
                }
                if (patched > 0) {
                    console.log(`${MODULE_ID} | Migrated wreck flags on ${patched} actor prototype(s)`);
                }
                // Also patch placed scene tokens.
                let scenePatched = 0;
                for (const scene of game.scenes) {
                    const tokenUpdates = [];
                    for (const tok of scene.tokens) {
                        const qolFlags = tok.toObject?.()?.flags?.['csm-lancer-qol'] ?? tok.flags?.['csm-lancer-qol'];
                        if (!qolFlags || typeof qolFlags !== 'object')
                            continue;
                        const laFlagObj = {};
                        for (const key of flagKeys) {
                            if (qolFlags[key] !== undefined && qolFlags[key] !== null) {
                                laFlagObj[key] = qolFlags[key];
                            }
                        }
                        if (Object.keys(laFlagObj).length > 0) {
                            tokenUpdates.push({
                                _id: tok.id,
                                flags: { [MODULE_ID]: laFlagObj }
                            });
                        }
                    }
                    if (tokenUpdates.length > 0) {
                        try {
                            await scene.updateEmbeddedDocuments('Token', tokenUpdates);
                            scenePatched += tokenUpdates.length;
                        } catch (e) {
                            console.warn(`${MODULE_ID} | Could not migrate scene token flags on ${scene.name}:`, e);
                        }
                    }
                }
                if (scenePatched > 0) {
                    console.log(`${MODULE_ID} | Migrated wreck flags on ${scenePatched} placed token(s)`);
                }
            }
        },
    ];
}

/**
 * Run all conflict checks. If any are found, show a dialog with details
 * and an "Auto-fix & Reload" button.
 * Call once during the `ready` hook (GM only).
 */
export function checkCompatibility() {
    if (!game.user.isGM)
        return;

    const rules = getConflictRules();
    const conflicts = rules.filter(r => r.check());

    if (conflicts.length === 0)
        return;

    const listHtml = conflicts.map(c =>
        `<li style="margin-bottom:6px;"><i class="fas fa-exclamation-triangle" style="color:#ff6400;"></i> ${c.label}</li>`
    ).join('');

    new Dialog({
        title: 'Lancer Automations — Compatibility Issues',
        content: `
            <p style="margin-bottom:8px;">The following conflicts were detected between <b>Lancer Automations</b> and other modules:</p>
            <ul style="margin:8px 0; padding-left:20px; list-style:none;">${listHtml}</ul>
            <hr>
            <p><b>Auto-fix</b> will disable the conflicting settings in the other modules and reload Foundry.</p>
            <p style="font-size:0.85em; opacity:0.7;">You can re-enable them later in the respective module settings if needed.</p>
        `,
        buttons: {
            fix: {
                icon: '<i class="fas fa-wrench"></i>',
                label: 'Auto-fix & Reload',
                callback: async () => {
                    for (const conflict of conflicts) {
                        try {
                            await conflict.fix();
                            console.log(`${MODULE_ID} | Compatibility: fixed ${conflict.id}`);
                        } catch (e) {
                            console.error(`${MODULE_ID} | Compatibility: failed to fix ${conflict.id}:`, e);
                        }
                    }
                    ui.notifications.info('Migration complete. Reloading in 1 seconds...');
                    setTimeout(() => foundry.utils.debouncedReload(), 1000);
                }
            },
            ignore: {
                icon: '<i class="fas fa-times"></i>',
                label: 'Ignore for now',
                callback: () => {}
            }
        },
        default: 'fix'
    }).render(true);
}
