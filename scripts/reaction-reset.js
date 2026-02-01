
import { ReactionManager } from "./reaction-manager.js";
export class ReactionReset extends FormApplication {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "reaction-checker-reset",
            title: "Reset Lancer Reaction Checker",
            template: "modules/lancer-reactionChecker/templates/reset-confirm.html", // Won't actually be used effectively as we render a Dialog
            width: 400,
            height: "auto"
        });
    }

    render() {
        new Dialog({
            title: "Reset Module Defaults",
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
                    label: "Reset Everything",
                    callback: async () => {
                        try {
                            // Clear all settings associated with this module
                            for (const [key, setting] of game.settings.settings.entries()) {
                                if (setting.namespace === ReactionManager.ID) {
                                    await game.settings.set(ReactionManager.ID, setting.key, setting.default);
                                    console.log(`lancer-reactionChecker | Resetting ${setting.key}`);
                                }
                            }

                            // Specifically ensure reaction registries are cleared
                            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_REACTIONS, {});
                            await game.settings.set(ReactionManager.ID, ReactionManager.SETTING_GENERAL_REACTIONS, {});

                            ui.notifications.info("Lancer Reaction Checker: Module reset to defaults.");

                            // Reload to apply changes cleanly
                            window.location.reload();
                        } catch (err) {
                            ui.notifications.error("Error resetting module: " + err.message);
                            console.error(err);
                        }
                    }
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "no"
        }).render(true);
    }
}
