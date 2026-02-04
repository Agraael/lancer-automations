/*global FormApplication, mergeObject, Dialog */

import { ReactionManager } from "./reaction-manager.js";

export class ReactionExport extends FormApplication {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "reaction-checker-export",
            title: "Export Activations",
            width: 400,
            height: "auto"
        });
    }

    render() {
        ReactionManager.exportReactions();
    }
}

export class ReactionImport extends FormApplication {
    static get defaultOptions() {
        return mergeObject(super.defaultOptions, {
            id: "reaction-checker-import",
            title: "Import Activations",
            width: 400,
            height: "auto"
        });
    }

    render() {
        new Dialog({
            title: "Import Activations",
            content: `
                <form>
                    <div class="form-group">
                        <label>Select JSON File</label>
                        <input type="file" name="importFile" accept=".json" style="width: 100%;">
                    </div>
                    <div class="form-group">
                        <label>Import Mode</label>
                        <select name="importMode" style="width: 100%;">
                            <option value="merge">Merge (add to existing)</option>
                            <option value="replace">Replace (overwrite all)</option>
                        </select>
                    </div>
                </form>
            `,
            buttons: {
                import: {
                    icon: '<i class="fas fa-file-import"></i>',
                    label: "Import",
                    callback: async (html) => {
                        const fileInput = html.find('input[name="importFile"]')[0];
                        const mode = html.find('select[name="importMode"]').val();

                        if (!fileInput.files.length) {
                            ui.notifications.warn("Please select a file to import.");
                            return;
                        }

                        await ReactionManager.importReactions(fileInput.files[0], mode);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel"
                }
            },
            default: "import"
        }, { width: 400 }).render(true);
    }
}
