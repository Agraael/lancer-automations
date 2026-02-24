/**
 * THE PACKER
 * Synchronizes your source files into the Lancer Automations Macros compendium.
 */
export async function packMacros() {
    if (!game.user.isGM) {
        return ui.notifications.error("Only the GM can pack macros.");
    }

    const packKey = "lancer-automations.macros";
    const pack = game.packs.get(packKey);

    if (!pack) {
        return ui.notifications.error(`Compendium '${packKey}' not found. Ensure you updated module.json and RESTARTED Foundry.`);
    }

    const sourcePath = "modules/lancer-automations/packs_source/macros";

    try {
        // Browse the folder to find all JSON metadata files
        const browse = await FilePicker.browse("data", sourcePath);
        const jsonFiles = browse.files.filter(f => f.endsWith(".json"));

        if (jsonFiles.length === 0) {
            return ui.notifications.warn(`No .json files found in ${sourcePath}`);
        }

        ui.notifications.info(`Synchronizing ${jsonFiles.length} macros into ${pack.label}...`);

        // Clear existing entries for a clean sync
        const docs = await pack.getDocuments();
        for (let doc of docs) {
            await doc.delete();
        }

        for (const jsonPath of jsonFiles) {
            // Fetch metadata
            const response = await fetch(jsonPath);
            const metadata = await response.json();

            let command = "";
            if (metadata.command_source) {
                // Fetch actual script command from the .js file
                const jsPath = `${sourcePath}/${metadata.command_source}`;
                const jsResponse = await fetch(jsPath);
                if (jsResponse.ok) {
                    command = await jsResponse.text();
                } else {
                    console.error(`lancer-automations | Failed to fetch command source: ${jsPath}`);
                }
            }

            // Create temporary macro and import to pack
            const macro = await Macro.create({
                name: metadata.name,
                type: metadata.type || "script",
                img: metadata.img || "icons/svg/dice-target.svg",
                command: command,
                ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER }
            });

            await pack.importDocument(macro);
            await macro.delete(); // Delete the temporary world macro
            console.log(`lancer-automations | Synced macro: ${metadata.name}`);
        }

        ui.notifications.info("Macro compendium synchronization complete!");
    } catch (error) {
        console.error("lancer-automations | Error during macro packing:", error);
        ui.notifications.error("An error occurred while packing macros. Check the console for details.");
    }
}
