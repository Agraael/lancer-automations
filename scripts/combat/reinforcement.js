/* global Sequence, Sequencer, canvas, game, ui, Hooks, Dialog, ChatMessage, CONST */

export async function delayedTokenAppearance()
{
    if (!game.combat)
    {
        ui.notifications.warn("You must be in combat to use this reinforcement system!");
        return;
    }

    const selectedTokens = canvas.tokens.controlled;

    if (selectedTokens.length === 0)
    {
        ui.notifications.warn("Please select at least one token!");
        return;
    }

    const getSizeName = (size) =>
    {
        if (size === 0.5)
            return "Size 0.5";
        return `Size ${size}`;
    };

    const rounds = await new Promise((resolve) =>
    {
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
                    callback: (html) =>
                    {
                        const roundsRaw = html.find('[name="rounds"]').val();
                        const parsedRounds = typeof roundsRaw === 'string' ? Number.parseInt(roundsRaw) : 1;
                        resolve(parsedRounds);
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

    const currentRound = game.combat.round;
    const targetRound = currentRound + rounds;

    const placeholderData = [];

    for (let token of selectedTokens)
    {
        const size = token.actor?.system?.size ?? 1;
        const sizeName = getSizeName(size);

        let placeholderActor = game.actors.find(actor => actor.name === sizeName);
        let placeholderTokenId = null;

        if (placeholderActor)
        {
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

        await token.document.update({ hidden: true });

        placeholderData.push({
            placeholderId: placeholderTokenId,
            originalTokenId: token.id,
            originalName: token.name,
            targetRound: targetRound
        });
    }

    const currentFlags = (game.combat.getFlag("lancer-automations", "delayedAppearances")) || [];
    await game.combat.setFlag("lancer-automations", "delayedAppearances", [...(Array.isArray(currentFlags) ? currentFlags : []), ...placeholderData]);

    // Synchronize video playback for all clients
    if (placeholderData.length > 0)
    {
        game.socket.emit("module.lancer-automations", {
            action: "syncPlaceholderVideos",
            payload: {
                placeholderIds: placeholderData.map(entry => entry.placeholderId).filter(id => id !== null)
            }
        });

        // Also sync locally
        setTimeout(() =>
        {
            for (let appearance of placeholderData)
            {
                if (appearance.placeholderId)
                {
                    const token = canvas.tokens.get(appearance.placeholderId);
                    const resource = /** @type {any} */ (token?.mesh?.texture?.baseTexture?.resource);
                    const video = resource?.["source"];
                    if (video instanceof HTMLVideoElement)
                    {
                        video.currentTime = 0;
                        video.play().catch(() =>
                        {});
                    }
                }
            }
        }, 200);
    }

    ui.notifications.info(`${placeholderData.length} token(s) will appear at round ${targetRound}`);
}

export function initDelayedAppearanceHook()
{
    Hooks.on("updateCombat", async (combat, changed, _options, _userId) =>
    {
        // Only for GM and when round changes
        if (!game.user.isGM)
            return;
        if (!changed.round)
            return;

        let delayedAppearances = (combat.getFlag("lancer-automations", "delayedAppearances")) || [];
        const currentRound = combat.round;

        const validAppearances = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(appearance =>
        {
            const originalToken = canvas.scene.tokens.get(appearance.originalTokenId);
            if (!originalToken)
            {
                if (appearance.placeholderId)
                {
                    const placeholder = canvas.scene.tokens.get(appearance.placeholderId);
                    if (placeholder)
                        placeholder.delete();
                }
                return false;
            }
            return true;
        });

        if (validAppearances.length !== (Array.isArray(delayedAppearances) ? delayedAppearances.length : 0))
        {
            await combat.setFlag("lancer-automations", "delayedAppearances", validAppearances);
            delayedAppearances = validAppearances;
        }

        for (let appearance of (Array.isArray(delayedAppearances) ? delayedAppearances : []))
        {
            if (appearance.placeholderId)
            {
                const placeholder = canvas.scene.tokens.get(appearance.placeholderId);
                const remainingRounds = appearance.targetRound - currentRound;
                if (placeholder && remainingRounds > 0)
                    await placeholder.update(/**@type {any}*/({ name: `[${remainingRounds}]` }));
            }
        }

        const appearing = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(entry => entry.targetRound === currentRound);

        if (appearing.length === 0)
            return;

        // Show grouped selection dialog
        const selectedToAppear = await new Promise((resolve) =>
        {
            const checkboxes = appearing.map((appearance, index) => `
        <div class="form-group">
          <label>
            <input type="checkbox" name="npc-${index}" value="${index}" checked />
            <strong>${appearance.originalName}</strong>
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
                        callback: (html) =>
                        {
                            const selected = [];
                            appearing.forEach((appearance, index) =>
                            {
                                if (html.find(`[name="npc-${index}"]`).is(':checked'))
                                    selected.push(appearance);
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

        if (typeof Sequencer !== "undefined")
        {
            await Sequencer.Preloader.preloadForClients([
                "jb2a.extras.tmfx.inpulse.circle.01.normal"
            ]);
        }

        for (let appearance of (Array.isArray(selectedToAppear) ? selectedToAppear : []))
        {
            if (appearance.placeholderId)
            {
                const placeholder = canvas.scene.tokens.get(appearance.placeholderId);
                if (placeholder)
                {
                    await placeholder.delete();
                    const tokenObject = canvas.tokens.get(appearance.originalTokenId);
                    if (tokenObject && typeof Sequence !== "undefined")
                    {
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

            const originalToken = canvas.scene.tokens.get(appearance.originalTokenId);
            if (originalToken)
                await originalToken.update({ hidden: false });
        }

        // Process NPCs that were NOT selected - delete both placeholder and original token
        const notSelected = appearing.filter(appearance => !(Array.isArray(selectedToAppear) ? selectedToAppear : []).includes(appearance));
        for (let appearance of notSelected)
        {
            // Delete placeholder if it exists
            if (appearance.placeholderId)
            {
                const placeholder = canvas.scene.tokens.get(appearance.placeholderId);
                if (placeholder)
                    await placeholder.delete();
            }

            const originalToken = canvas.scene.tokens.get(appearance.originalTokenId);
            if (originalToken)
                await originalToken.delete();
        }

        if (Array.isArray(selectedToAppear) && selectedToAppear.length > 0)
        {
            ChatMessage.create({
                content: `<h3>🎭 ${selectedToAppear.length} NEW NPC${selectedToAppear.length > 1 ? 'S' : ''} HAS ARRIVED</h3>`,
                speaker: { alias: "Combat System" }
            });
        }

        // Clean up ALL processed appearances (both confirmed and cancelled)
        const remaining = (Array.isArray(delayedAppearances) ? delayedAppearances : []).filter(appearance => appearance.targetRound !== currentRound);
        await combat.setFlag("lancer-automations", "delayedAppearances", remaining);
    });
}

export const DelayedReinforcementAPI = {
    delayedTokenAppearance
};
