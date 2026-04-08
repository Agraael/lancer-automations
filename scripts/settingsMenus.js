/**
 * Additional grouped settings menus for lancer-automations.
 * Each menu surfaces a subset of settings that are otherwise registered with
 * `config: false` in main.js so they don't appear in the main settings panel.
 */

const MODULE_ID = 'lancer-automations';

/**
 * Generic helper: build a config form class for a list of setting keys.
 * Each entry: { key, type: 'boolean'|'number'|'string'|'select', label?, hint?, choices? }
 */
function makeConfigForm({ id, title, template, fields }) {
    return class extends FormApplication {
        static get defaultOptions() {
            return foundry.utils.mergeObject(super.defaultOptions, {
                id,
                title,
                template,
                width: 520,
                closeOnSubmit: true,
            });
        }

        getData() {
            const items = fields.map(f => {
                let value;
                try {
                    value = game.settings.get(MODULE_ID, f.key);
                } catch {
                    value = f.default;
                }
                const setting = game.settings.settings.get(`${MODULE_ID}.${f.key}`) || {};
                return {
                    key: f.key,
                    type: f.type,
                    label: f.label ?? setting.name ?? f.key,
                    hint: f.hint ?? setting.hint ?? '',
                    value,
                    isBoolean: f.type === 'boolean',
                    isNumber: f.type === 'number',
                    isSelect: f.type === 'select',
                    choices: f.choices ?? (setting.choices
                        ? Object.entries(setting.choices).map(([k, v]) => ({
                              value: k, label: v, selected: k === value
                          }))
                        : []),
                };
            });
            return { items };
        }

        async _updateObject(_event, formData) {
            for (const f of fields) {
                if (!(f.key in formData)) {
                    // Unchecked checkboxes are absent from formData — set them to false
                    if (f.type === 'boolean') {
                        try {
                            await game.settings.set(MODULE_ID, f.key, false);
                        } catch (e) {
                            console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
                        }
                    }
                    continue;
                }
                let val = formData[f.key];
                if (f.type === 'number') val = Number(val);
                if (f.type === 'boolean') val = !!val;
                try {
                    await game.settings.set(MODULE_ID, f.key, val);
                } catch (e) {
                    console.warn(`${MODULE_ID} | Could not save ${f.key}`, e);
                }
            }
            ui.notifications.info(`${title} saved.`);
        }
    };
}

// ---------------------------------------------------------------------------
// Activations Automations
// ---------------------------------------------------------------------------

const ActivationsConfig = makeConfigForm({
    id: 'la-activations-config',
    title: 'Lancer Automations — Activations Automations',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'reactionNotificationMode', type: 'select', label: 'Activation Notification Mode' },
        { key: 'consumeReaction', type: 'boolean' },
        { key: 'treatGenericPrintAsActivation', type: 'boolean' },
        { key: 'showBonusHudButton', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Combat & Movement
// ---------------------------------------------------------------------------

const CombatMovementConfig = makeConfigForm({
    id: 'la-combat-movement-config',
    title: 'Lancer Automations — Combat & Movement',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'enableKnockbackFlow', type: 'boolean' },
        { key: 'enableThrowFlow', type: 'boolean' },
        { key: 'statRollTargeting', type: 'boolean' },
        { key: 'enablePathHexCalculation', type: 'boolean' },
        { key: 'enableMovementCapDetection', type: 'boolean' },
        { key: 'experimentalBoostDetection', type: 'boolean' },
        { key: 'dragVisionMultiplier', type: 'number' },
        { key: 'enableAltStruct', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Deployables & Display
// ---------------------------------------------------------------------------

const DeployablesDisplayConfig = makeConfigForm({
    id: 'la-deployables-display-config',
    title: 'Lancer Automations — Deployables & Display',
    template: `modules/${MODULE_ID}/templates/grouped-settings.html`,
    fields: [
        { key: 'linkManualDeploy', type: 'boolean' },
        { key: 'showDeployableLines', type: 'boolean' },
    ],
});

// ---------------------------------------------------------------------------
// Menu registration
// ---------------------------------------------------------------------------

export function registerSettingsMenus() {
    game.settings.registerMenu(MODULE_ID, 'activationsConfigMenu', {
        name: 'Activations Automations',
        label: 'Configure Activations',
        hint: 'Settings for activation notifications, reaction consumption, and chat-card automation.',
        icon: 'fas fa-bolt',
        type: ActivationsConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'combatMovementConfigMenu', {
        name: 'Combat & Movement',
        label: 'Configure Combat & Movement',
        hint: 'Settings for knockback, throw, stat-roll targeting, path/hex calculation, boost detection, drag vision, and alternative structure rules.',
        icon: 'fas fa-running',
        type: CombatMovementConfig,
        restricted: true,
    });

    game.settings.registerMenu(MODULE_ID, 'deployablesDisplayConfigMenu', {
        name: 'Deployables & Display',
        label: 'Configure Deployables & Display',
        hint: 'Settings for manual deployable linking and on-canvas display lines.',
        icon: 'fas fa-cubes',
        type: DeployablesDisplayConfig,
        restricted: true,
    });
}
