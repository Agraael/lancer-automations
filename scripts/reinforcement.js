/* global Sequence, Sequencer, canvas, game, ui, Hooks, Dialog, ChatMessage, CONST */

/**
 * Main function to manage delayed token appearance
 * Select your tokens and execute this function
 */
export async function delayedTokenAppearance() {
    // Check if in combat
    if (!game.combat) {
        ui.notifications.warn("You must be in combat to use this reinforcement system!");
        return;
    }

    // Get selected tokens
    const selectedTokens = canvas.tokens.controlled;

    if (selectedTokens.length === 0) {
        ui.notifications.warn("Please select at least one token!");
        return;
    }

    // Map sizes to placeholder actor names
    const getSizeName = (size) => {
        if (size === 0.5)
            return "Size 0.5";
        return `Size ${size}`;
    };

    // Ask how many rounds before appearance
    const rounds = await new Promise((resolve) => {
        new Dialog({
            title: "Delayed Appearance",
            content: `
        <form>
          <div class="form-group">
            <label>How many rounds until tokens appear?</label>
            <input type="number" name="rounds" min="1" value="1" autofocus />
          </div>
        </form>
      `,
            buttons: {
                ok: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Confirm",
                    callback: (html) => {
                        const val = html.find('[name="rounds"]').val();
                        const value = typeof val === 'string' ? Number.parseInt(val) : 1;
                        resolve(value);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            default: "ok"
        }, {classes: ['lancer-dialog-base'] }).render(true);
    });

    if (!rounds)
        return;

    // Calculate target round
    const currentRound = game.combat.round;
    const targetRound = currentRound + rounds;

    // Process each selected token
    const placeholderData = [];

    for (let token of selectedTokens) {
        const size = token.actor?.system?.size ?? 1;
        const sizeName = getSizeName(size);

        // Try to find corresponding placeholder actor
        let placeholderActor = game.actors.find(a => a.name === sizeName);
        let placeholderTokenId = null;

        // Create placeholder token if actor exists - just spawn the prototype at the position
        if (placeholderActor) {
            const prototypeData = placeholderActor.prototypeToken.toObject();
            const tokenData = {
                ...prototypeData,
                x: token.x,
                y: token.y,
                actorId: placeholderActor.id,
                name: `[${rounds}]`,
                displayName: CONST.TOKEN_DISPLAY_MODES.ALWAYS
            };

            const createdTokenDoc = await canvas.scene.createEmbeddedDocuments("Token", [tokenData]);
            placeholderTokenId = createdTokenDoc[0].id;
        }

        // Hide original token
        await token.document.update({ hidden: true });

        // Store information for appearance
        placeholderData.push({
            placeholderId: placeholderTokenId,
            originalTokenId: token.id,
            originalName: token.name,
            targetRound: targetRound
        });
    }

    // Save data in combat flags
    const currentFlags = (game.combat.getFlag("lancer-automations", "delayedAppearances")) || [];
    await game.combat.setFlag("lancer-automations", "delayedAppearances", [...(Array.isArray(currentFlags) ? currentFlags : []), ...placeholderData]);

    // Synchronize video playback for all clients
    if (placeholderData.length > 0) {
        game.socket.emit("module.lancer-automations", {
            action: "syncPlaceholderVideos",
            payload: {
                placeholderIds: placeholderData.map(d => d.placeholderId).filter(id => id !== null)
            }
        });

        // Also sync locally
        setTimeout(() => {
            for (let data of placeholderData) {
                if (data.placeholderId) {
                    const token = canvas.tokens.get(data.placeholderId);
                    const resource = /** @type {any} */ (token?.mesh?.texture?.baseTexture?.resource);
                    const video = resource?.["source"];
                    if (video instanceof HTMLVideoElement) {
                        video.currentTime = 0;
                        video.play().catch(() => {});
                    }
                }
            }
        }, 200);
    }

    ui.notifications.info(`${placeholderData.length} token(s) will appear at round ${targetRound}`);
}

/**
 * Initialize hook to automatically handle appearances
 */
export function initDelayedAppearanceHook() {
    Hooks.on("updateCombat", async (combat, changed, _options, _userId) => {
        // Only for GM and when round changes
        if (!game.user.isGM)
            return;
        if (!changed.round)
            return;

        let delayedAppearances = (combat.getFlag("lancer-automations", "delayedAppearances")) || [];
        const currentRound = combat.round;

        // Clean up entries where original token no longer exists
        const validAppearances = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(data => {
            const originalToken = canvas.scene.tokens.get(data.originalTokenId);
            if (!originalToken) {
                // Token was deleted, clean up placeholder if it exists
                if (data.placeholderId) {
                    const placeholder = canvas.scene.tokens.get(data.placeholderId);
                    if (placeholder) {
                        placeholder.delete();
                    }
                }
                return false; // Remove from list
            }
            return true; // Keep in list
        });

        // Update the flag with cleaned list if anything was removed
        if (validAppearances.length !== (Array.isArray(delayedAppearances) ? delayedAppearances.length : 0)) {
            await combat.setFlag("lancer-automations", "delayedAppearances", validAppearances);
            delayedAppearances = validAppearances;
        }

        // Update placeholder names for all delayed appearances
        for (let data of (Array.isArray(delayedAppearances) ? delayedAppearances : [])) {
            if (data.placeholderId) {
                const placeholder = canvas.scene.tokens.get(data.placeholderId);
                const remainingRounds = data.targetRound - currentRound;
                if (placeholder && remainingRounds > 0) {
                    await placeholder.update(/**@type {any}*/({ name: `[${remainingRounds}]` }));
                }
            }
        }

        const appearing = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(d => d.targetRound === currentRound);

        if (appearing.length === 0)
            return;

        // Show grouped selection dialog
        const selectedToAppear = await new Promise((resolve) => {
            // Build checkboxes for all NPCs
            const checkboxes = appearing.map((data, index) => `
        <div class="form-group">
          <label>
            <input type="checkbox" name="npc-${index}" value="${index}" checked />
            <strong>${data.originalName}</strong>
          </label>
        </div>
      `).join('');

            new Dialog({
                title: "NPCs Arriving",
                content: `
          <form>
            <p>Select which NPCs will appear:</p>
            ${checkboxes}
          </form>
        `,
                buttons: {
                    confirm: {
                        icon: '<i class="fas fa-check"></i>',
                        label: "Confirm",
                        callback: (html) => {
                            const selected = [];
                            appearing.forEach((data, index) => {
                                if (html.find(`[name="npc-${index}"]`).is(':checked')) {
                                    selected.push(data);
                                }
                            });
                            resolve(selected);
                        }
                    },
                    cancel: {
                        icon: '<i class="fas fa-times"></i>',
                        label: "Cancel All",
                        callback: () => resolve([])
                    }
                },
                default: "confirm"
            }).render(true);
        });

        // Preload the appearance animation for all clients
        if (typeof Sequencer !== "undefined") {
            await Sequencer.Preloader.preloadForClients([
                "jb2a.extras.tmfx.inpulse.circle.01.normal"
            ]);
        }

        // Process selected NPCs to appear
        for (let data of (Array.isArray(selectedToAppear) ? selectedToAppear : [])) {
            // Delete placeholder if it exists
            if (data.placeholderId) {
                const placeholder = canvas.scene.tokens.get(data.placeholderId);
                if (placeholder) {
                    await placeholder.delete();
                    const tokenObject = canvas.tokens.get(data.originalTokenId);
                    if (tokenObject && typeof Sequence !== "undefined") {
                        const tokenSize = tokenObject.document.width; // Grid units
                        new Sequence()
                            .effect()
                            .file("jb2a.extras.tmfx.inpulse.circle.01.normal")
                            .atLocation(tokenObject)
                            .scale(tokenSize / 2)
                            .play();
                    }
                }
            }

            // Make original token visible
            const originalToken = canvas.scene.tokens.get(data.originalTokenId);
            if (originalToken) {
                await originalToken.update({ hidden: false });
            }
        }

        // Process NPCs that were NOT selected - delete both placeholder and original token
        const notSelected = appearing.filter(data => !(Array.isArray(selectedToAppear) ? selectedToAppear : []).includes(data));
        for (let data of notSelected) {
            // Delete placeholder if it exists
            if (data.placeholderId) {
                const placeholder = canvas.scene.tokens.get(data.placeholderId);
                if (placeholder) {
                    await placeholder.delete();
                }
            }

            // Delete original token that was hidden
            const originalToken = canvas.scene.tokens.get(data.originalTokenId);
            if (originalToken) {
                await originalToken.delete();
            }
        }

        // Show chat message with number of NPCs appeared
        if (Array.isArray(selectedToAppear) && selectedToAppear.length > 0) {
            ChatMessage.create({
                content: `<h3>🎭 ${selectedToAppear.length} NEW NPC${selectedToAppear.length > 1 ? 'S' : ''} HAS ARRIVED</h3>`,
                speaker: { alias: "Combat System" }
            });
        }

        // Clean up ALL processed appearances (both confirmed and cancelled)
        const remaining = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(d => d.targetRound !== currentRound);
        await combat.setFlag("lancer-automations", "delayedAppearances", remaining);
    });
}

export const DelayedReinforcementAPI = {
    delayedTokenAppearance
};
