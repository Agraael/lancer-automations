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
        if (!entry) return true;
        // Saved entry with enabled explicitly set
        if (entry.enabled !== undefined) return entry.enabled;
        // Saved entry without enabled field = default = true
        return true;
    } catch { return false; }
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
                if (!game.modules.get('csm-lancer-qol')?.active) return false;
                const laConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!laConfig.master) return false;
                try { return game.settings.get('csm-lancer-qol', 'enableAutomation') === true; }
                catch { return false; }
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
                if (!game.modules.get('csm-lancer-qol')?.active) return false;
                const laConfig = game.settings.get(MODULE_ID, 'statusFXConfig') ?? {};
                if (!laConfig.master) return false;
                try { return game.settings.get('csm-lancer-qol', 'enableConditionEffects') === true; }
                catch { return false; }
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
                if (!game.modules.get('csm-lancer-qol')?.active) return false;
                try {
                    if (!game.settings.get(MODULE_ID, 'enableAltStruct')) return false;
                    return game.settings.get('csm-lancer-qol', 'oneStructNPCAutomation') === true;
                } catch { return false; }
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
                if (!game.modules.get('lancer-alt-structure')?.active) return false;
                try { return game.settings.get(MODULE_ID, 'enableAltStruct') === true; }
                catch { return false; }
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
                if (!game.modules.get('csm-lancer-qol')?.active) return false;
                if (!isEngagementReactionEnabled()) return false;
                try { return game.settings.get('csm-lancer-qol', 'enableEngageAutomation') === true; }
                catch { return false; }
            },
            async fix() {
                await game.settings.set('csm-lancer-qol', 'enableEngageAutomation', false);
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
    if (!game.user.isGM) return;

    const rules = getConflictRules();
    const conflicts = rules.filter(r => r.check());

    if (conflicts.length === 0) return;

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
                    ui.notifications.info('Compatibility issues fixed. Reloading...');
                    setTimeout(() => window.location.reload(), 500);
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
