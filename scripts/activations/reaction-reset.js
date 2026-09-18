
/*global console, window */

import { ReactionManager } from "./reaction-manager.js";
import { localize } from "../tools/string-utils.js";
export class ReactionReset extends FormApplication
{
    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            id: "reaction-checker-reset",
            title: localize('LA.dialogTitle.resetReactionChecker'),
            template: "modules/lancer-automations/templates/reset-confirm.html",
            width: 400,
            height: "auto"
        });
    }

    async _updateObject(_event, _formData)
    {}

    render(force = false, options = {})
    {
        new Dialog({
            title: localize('LA.dialogTitle.resetModuleDefaults'),
            content: `
                <div style="margin-bottom: 20px;">
                    <p style="text-align: center; font-size: 1.2em; color: var(--color-text-dark-primary);">
                        <i class="fas fa-exclamation-triangle" style="color: #ffcc00;"></i> <strong>Warning</strong>
                    </p>
                    <p>Are you sure you want to reset all module settings and reactions to default values? <strong>This cannot be undone.</strong></p>
                    <ul style="list-style: disc; margin-left: 20px;">
                        <li>Clears all custom reactions</li>
                        <li>Resets configuration preferences</li>
                    </ul>
                </div>
            `,
            buttons: {
                yes: {
                    icon: '<i class="fas fa-trash"></i>',
                    label: localize("LA.activationManager.resetEverything"),
                    callback: async () =>
                    {
                        try
                        {
                            for (const [key, setting] of game.settings.settings.entries())
                            {
                                if (setting.namespace === ReactionManager.ID)
                                {
                                    await game.settings.set(ReactionManager.ID, setting.key, setting.default);
                                    console.log(`lancer-automations | Resetting ${setting.key}`);
                                }
                            }

                            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, {});
                            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, {});

                            ui.notifications.info(localize('LA.notify.lancerReactionCheckerModuleResetToDefaults'));

                            globalThis.location.reload();
                        }
                        catch (err)
                        {
                            ui.notifications.error(localize('LA.notify.errorResettingModule') + err.message);
                            console.error(err);
                        }
                    }
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: localize("LA.common.cancel")
                }
            },
            default: "no"
        }, { classes: ['lancer-dialog-base'] }).render(true);
        return this;
    }
}
