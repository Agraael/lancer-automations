/*global FilePicker */

import { localize, localizeFormat } from './string-utils.js';

/**
 * Looks up a macro by name in the lancer-automations compendium and executes it.
 * @returns {Promise<void>}
 */
export async function executePackMacro(macroName, scope = {})
{
    const packKey = "lancer-automations.macros";
    const pack = game.packs.get(packKey);
    if (!pack)
        return ui.notifications.error(localize('LA.notify.lancerAutomationsMacroPackNotFound'));
    const index = await pack.getIndex();
    const entry = index.find(indexEntry => indexEntry.name === macroName);
    if (!entry)
        return ui.notifications.error(localizeFormat('LA.notify.macroNotFoundInPack', { name: macroName }));
    const macro = await pack.getDocument(entry._id);
    await macro.execute({ ParamActor: null, ...scope });
}

/**
 * Synchronizes your source files into the Lancer Automations Macros compendium.
 */
export async function packMacros()
{
    if (!game.user.isGM)
        return ui.notifications.error(localize('LA.notify.onlyTheGmCanPackMacros'));

    const packKey = "lancer-automations.macros";
    const pack = game.packs.get(packKey);

    if (!pack)
        return ui.notifications.error(localizeFormat('LA.notify.compendiumNotFound', { pack: packKey }));

    const sourcePath = "modules/lancer-automations/packs_source/macros";

    try
    {
        const browse = await FilePicker.browse("data", sourcePath);
        const jsonFiles = browse.files.filter(filePath => filePath.endsWith(".json"));

        if (jsonFiles.length === 0)
            return ui.notifications.warn(localizeFormat('LA.notify.noJsonFilesFound', { path: sourcePath }));

        ui.notifications.info(localizeFormat('LA.notify.synchronizingMacros', { count: jsonFiles.length, pack: pack.label }));

        // Clear existing entries for a clean sync
        const docs = await pack.getDocuments();
        for (let doc of docs)
            await doc.delete();

        for (const jsonPath of jsonFiles)
        {
            const response = await fetch(jsonPath);
            const metadata = await response.json();

            let command = "";
            if (metadata.command_source)
            {
                // Fetch actual script command from the .js file
                const jsPath = `${sourcePath}/${metadata.command_source}`;
                const jsResponse = await fetch(jsPath);
                if (jsResponse.ok)
                    command = await jsResponse.text();
                else
                    console.error(`lancer-automations | Failed to fetch command source: ${jsPath}`);
            }

            const macro = await Macro.create({
                name: metadata.name,
                type: metadata.type || "script",
                img: metadata.img || "icons/svg/dice-target.svg",
                command: /** @type {any} */ (command),
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
            });

            await pack.importDocument(macro);
            await macro.delete();
            console.log(`lancer-automations | Synced macro: ${metadata.name}`);
        }

        ui.notifications.info(localize('LA.notify.macroCompendiumSynchronizationComplete'));
    }
    catch (error)
    {
        console.error("lancer-automations | Error during macro packing:", error);
        ui.notifications.error(localize('LA.notify.anErrorOccurredWhilePackingMacrosCheck'));
    }
}

export const CompendiumToolsAPI = {
    packMacros,
    executePackMacro
};
