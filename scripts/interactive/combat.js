/* global canvas, PIXI, game, ui, $ */

import { startChoiceCard, startVoteCard } from "./network.js";
import { resolveDeployable, getItemDeployables, getItemActions } from "./deployables.js";
import { laPositionPopup, laRenderTags, laRenderTextSection, laRenderActions, laRenderDeployables, laRenderWeaponBody, laDetailPopup } from "./detail-renderers.js";

/**
 * Opens a dialog to select and throw a weapon.
 * @param {Actor} [actor] - The actor throwing the weapon. Defaults to the character of the first controlled token.
 */
export async function openThrowMenu(actor) {
    const controlled = canvas.tokens.controlled;
    const activeActor = actor || controlled[0]?.actor;

    if (!activeActor) {
        ui.notifications.warn("No actor found. Select a token or provide an actor.");
        return;
    }

    const token = activeActor.getActiveTokens()?.[0] || controlled[0];

    // Filter weapons with the "Throw" tag
    const throwWeapons = activeActor.items.filter(item => {
        if (item.type === 'mech_weapon') {
            const profiles = item.system?.profiles ?? [];
            const activeProfileIndex = item.system?.selected_profile_index ?? 0;
            const activeProfile = profiles[activeProfileIndex];
            if (!activeProfile)
                return false;
            const tags = activeProfile.tags ?? [];
            return tags.some(tag => tag.id === 'tg_thrown' || tag.lid === 'tg_thrown' || (typeof tag === 'string' && tag.toLowerCase().includes('throw')));
        } else if (item.type === 'npc_feature' && item.system?.type === 'Weapon') {
            const tags = item.system?.tags ?? [];
            return tags.some(tag => tag.id === 'tg_thrown' || tag.lid === 'tg_thrown' || (typeof tag === 'string' && tag.toLowerCase().includes('throw')));
        }
        return false;
    });

    if (throwWeapons.length === 0) {
        ui.notifications.warn(`No throwable weapons found for ${activeActor.name}.`);
        return;
    }

    const items = throwWeapons.map(weapon => {
        const uses = weapon.system?.uses;
        const hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
        const noUsesLeft = hasUses && uses.value <= 0;
        const isDestroyed = weapon.system?.destroyed ?? false;
        const isLoaded = weapon.type === 'mech_weapon' ? (weapon.system?.loaded ?? true) : true;

        let damageText = '';
        if (weapon.type === 'mech_weapon') {
            const profiles = weapon.system?.profiles ?? [];
            const activeProfileIndex = weapon.system?.selected_profile_index ?? 0;
            const activeProfile = profiles[activeProfileIndex];
            if (activeProfile?.damage) {
                damageText = activeProfile.damage.map(d => `${d.val} ${d.type}`).join(' + ');
            }
        } else if (weapon.type === 'npc_feature') {
            const tier = activeActor.system?.tier ?? 1;
            const tierIndex = Math.max(0, Math.min(2, tier - 1));
            const damages = weapon.system?.damage?.[tierIndex] ?? [];
            if (damages.length > 0) {
                damageText = damages.map(d => `${d.val} ${d.type}`).join(' + ');
            }
        }

        return {
            id: weapon.id,
            name: weapon.name,
            img: weapon.img,
            weaponData: weapon,
            damageText: damageText,
            usesText: hasUses ? `${uses.value}/${uses.max}` : '',
            disabled: noUsesLeft || isDestroyed || !isLoaded || weapon.system?.disabled,
        };
    });

    let selectedId = items.find(i => !i.disabled)?.id;
    const content = `
        <style>
            .lancer-items-grid { grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 10px; max-height: 60vh; overflow-y: auto; }
            .lancer-item-card { min-height: 50px; padding: 8px 10px; padding-top: 20px; position: relative; overflow: hidden; border: 1px solid #7a7971; border-radius: 4px; background: rgba(0, 0, 0, 0.1); cursor: pointer; }
            .lancer-item-card.disabled { opacity: 0.5; cursor: not-allowed; border-color: #888; background-color: #00000030; }
            .lancer-item-card.selected { border-color: #ff6400; box-shadow: 0 0 5px #ff6400; }
            .lancer-item-header { display: flex; align-items: flex-start; gap: 6px; margin-bottom: 4px; }
            .lancer-item-icon { width: 32px; height: 32px; min-width: 32px; object-fit: cover; border-radius: 3px; border: none; }
            .lancer-item-name { flex: 1; font-weight: bold; font-size: 0.95em; line-height: 1.2; }
            .lancer-item-damage { font-size: 0.85em; color: #444; margin-top: 2px; display: flex; align-items: center; gap: 3px; font-weight: bold; }
        </style>
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header" style="margin-bottom: 10px;">
                <div class="lancer-dialog-title" style="font-weight: bold; font-size: 1.2em;">THROW WEAPON</div>
                <div class="lancer-dialog-subtitle" style="font-style: italic; font-size: 0.9em; color: #ffffffff;">Select a throwable weapon to attack with.</div>
            </div>
            <div class="lancer-items-grid" style="display: grid;">
                ${items.map(item => `
                    <div class="lancer-item-card ${item.disabled ? 'disabled' : ''} ${item.id === selectedId ? 'selected' : ''}" data-item-id="${item.id}">
                        <div class="lancer-item-header">
                            <img src="${item.img}" class="lancer-item-icon" />
                            <div class="lancer-item-name">${item.name}</div>
                        </div>
                        ${item.damageText ? `<div class="lancer-item-damage"><i class="cci cci-damage"></i> ${item.damageText}</div>` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    new Dialog({
        title: "Throw Weapon",
        content: content,
        buttons: {
            throw: {
                icon: '<i class="cci cci-weapon-range"></i>',
                label: "Throw",
                callback: async () => {
                    const item = items.find(i => i.id === selectedId);
                    if (!item || item.disabled)
                        return;
                    const weapon = /** @type {any} */ (item.weaponData);
                    const api = game.modules.get('lancer-automations')?.api;
                    if (api?.beginWeaponThrowFlow) {
                        await api.beginWeaponThrowFlow(weapon);
                    } else if (weapon.beginWeaponAttackFlow) {
                        await weapon.beginWeaponAttackFlow(true);
                        if (api?.deployWeaponToken) {
                            await api.deployWeaponToken(weapon, activeActor, token);
                        }
                    }
                }
            },
            cancel: { label: "Cancel" }
        },
        default: "throw",
        render: (html) => {
            html.find('.lancer-item-card:not(.disabled)').on('click', function () {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function () {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.throw').click();
            });
        }
    }, { width: 400, classes: ['lancer-dialog-base', 'lancer-dialog-base', 'lancer-no-title'] }).render(true);
}

/**
 * Revert a token's movement to the previous position in history or a specific destination.
 * @param {Token} token - The token to revert
 * @param {Object} [destination=null] - Optional destination to move to if elevationruler is not active.
 * @returns {Promise<boolean>} - True if history is clean (0 or 1 point remain), false otherwise.
 */
export async function revertMovement(token, destination = null) {
    if (!token)
        return true;

    // Helper to calculate distance
    const getDist = (p1, p2) => {
        let d = 0;
        d = canvas.grid.measurePath([p1, p2], {}).distance;
        return Math.round(d / canvas.scene.grid.distance);
    };

    if (game.modules.get("elevationruler")?.active) {
        const history = token.elevationruler?.measurementHistory;
        if (history && history.length >= 2) {
            const currentPos = { x: token.document.x, y: token.document.y };
            const newLastPoint = history[history.length - 2];
            const updates = {};

            const topLeft = {
                x: newLastPoint.x - (token.w * 0.5),
                y: newLastPoint.y - (token.h * 0.5)
            };
            const snappedPos = token.getSnappedPosition(topLeft);
            updates.x = snappedPos.x;
            updates.y = snappedPos.y;
            updates.elevation = CONFIG.GeometryLib.utils.pixelsToGridUnits(newLastPoint.z);

            const dist = getDist(currentPos, {x: updates.x, y: updates.y});
            await token.document.update(updates, /** @type {any} */ ({ isUndo: true }));
            game.modules.get("lancer-automations")?.api?.undoMoveData(token.id, dist);

            const newHistory = token.elevationruler?.measurementHistory;
            return !newHistory || newHistory.length < 2;
        } else {
            await token.document.unsetFlag("elevationruler", "movementHistory");
            if (token.elevationruler) {
                token.elevationruler.measurementHistory = [];
            }
            ui.notifications.info("Movement history cleared.");
            return true;
        }
    } else if (destination) {
        const currentPos = { x: token.document.x, y: token.document.y };
        const dist = getDist(currentPos, destination);

        await token.document.update(destination, /** @type {any} */ ({ isUndo: true }));
        game.modules.get("lancer-automations")?.api?.undoMoveData(token.id, dist);
        return true;
    }
    return true;
}

/**
 * Clear movement history for tokens.
 * @param {Token|Token[]} tokens - Token or list of tokens to clear
 * @param {boolean} [revert=false] - Whether to also revert movement visually
 */
export async function clearMovementHistory(tokens, revert = false) {
    const tokenList = Array.isArray(tokens) ? tokens : [tokens];
    if (tokenList.length === 0)
        return;

    const elevationRulerActive = game.modules.get("elevationruler")?.active;
    if (!elevationRulerActive) {
        ui.notifications.warn("Elevation Ruler module is not active. Movement history cannot be cleared.");
        return;
    }

    for (const token of tokenList) {
        if (revert) {
            while (true) {
                const isClean = await revertMovement(token);
                if (isClean)
                    break;
                await new Promise(r => setTimeout(r, 500));
            }
        }

        await token.document.unsetFlag("elevationruler", "movementHistory");
        if (token.elevationruler) {
            token.elevationruler.measurementHistory = [];
        }
        const lancerAutomations = game.modules.get('lancer-automations');
        if (lancerAutomations?.api?.clearMoveData) {
            lancerAutomations.api.clearMoveData(token.document.id);
        }
    }

    const tokenNames = tokenList.map(t => t.name).join(", ");
    ui.notifications.info(`Movement history cleared for: ${tokenNames}.`);
}

/**
 * Opens a dialog menu to configure and send a custom choice card to one or more active users.
 * On response, a chat message from the requester is posted showing the selection.
 * @returns {Promise<void>}
 */
export async function openChoiceMenu() {
    const activeUsers = game.users.filter(u => u.active);
    if (activeUsers.length === 0) {
        ui.notifications.warn("No active users found.");
        return;
    }

    // Initial State
    let choicesInfo = [
        { text: "Confirm" },
        { text: "Decline" }
    ];
    let selectedUserIds = []; // No pre-selection per user request
    let title = "CHOICE"; // Default title per user request
    let description = "Please select an option:";
    let mode = "vote";
    let hidden = false;

    function refresh(html) {
        // Render users grid - Compact 3-column grid
        const usersHtml = activeUsers.map(u => {
            const isSelected = selectedUserIds.includes(u.id);
            return `
            <div class="la-choice-user-card ${isSelected ? 'selected' : ''}"
                 data-user-id="${u.id}"
                 style="padding: 4px 6px; min-height: 28px; display: flex; align-items: center; border: 1px solid #7a7971; border-radius: 4px; background: rgba(0,0,0,0.1); cursor: pointer; margin: 0; gap: 4px; overflow: hidden;">
                <img src="${u.avatar || 'icons/svg/user.svg'}" style="width: 18px; height: 18px; border: none; flex-shrink: 0;" />
                <div style="font-size: 0.75em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; flex: 1;">${u.name}</div>
                ${u.isGM ? '<i class="fas fa-crown" style="font-size: 0.6em; color: #ff6400; flex-shrink: 0;"></i>' : ''}
            </div>
        `;
        }).join('');
        html.find('.la-choice-users-grid').html(usersHtml);

        // Render mode choices
        const modeHtml = `
            <div class="form-group" style="margin: 0; display: flex; align-items: center; gap: 10px;">
                <label style="font-size: 0.85em; flex: 1;">Mode</label>
                <select class="la-choice-mode" style="height: 24px; font-size: 0.85em; flex: 2; color: #fff; background: #222; border: 1px solid #7a7971; border-radius: 4px; padding: 0 4px;">
                    <option value="vote" ${mode === "vote" ? 'selected' : ''} style="background: #222; color: #fff;">Vote</option>
                    <option value="vote-hidden" ${mode === "vote-hidden" ? 'selected' : ''} style="background: #222; color: #fff;">Hidden Vote</option>
                    <option value="or" ${mode === "or" ? 'selected' : ''} style="background: #222; color: #fff;">Pick One (OR)</option>
                    <option value="and" ${mode === "and" ? 'selected' : ''} style="background: #222; color: #fff;">Pick All (AND)</option>
                </select>
            </div>
        `;
        html.find('.la-choice-mode-container').html(modeHtml);

        // Render choices list - No icons, just text with automatic numbers
        const choicesHtml = choicesInfo.map((c, idx) => `
            <div class="form-group la-choice-row" data-idx="${idx}" style="display: flex; gap: 5px; margin-bottom: 2px; align-items: center;">
                <span style="font-size: 0.9em; font-weight: bold; width: 15px; text-align: right;">${idx + 1}.</span>
                <input type="text" class="la-choice-text" value="${c.text || ''}" placeholder="Option Text" style="flex: 1; height: 24px; font-size: 0.9em;" />
                <button type="button" class="la-choice-remove" style="flex: 0 0 24px; height: 24px; padding: 0; background: none; border: none; color: #c33; cursor: pointer;"><i class="fas fa-times"></i></button>
            </div>
        `).join('');
        html.find('.la-choices-container').html(choicesHtml);

        // Event Listeners
        html.find('.la-choice-user-card').off('click').on('click', function () {
            const id = $(this).data('user-id');
            if (selectedUserIds.includes(id)) {
                selectedUserIds = selectedUserIds.filter(uid => uid !== id);
            } else {
                selectedUserIds.push(id);
            }
            refresh(html);
        });

        html.find('.la-choice-remove').off('click').on('click', function () {
            const idx = Number.parseInt($(this).closest('.la-choice-row').data('idx'));
            if (!Number.isNaN(idx)) {
                choicesInfo.splice(idx, 1);
                refresh(html);
            }
        });

        html.find('.la-choice-text').off('input').on('input', function () {
            const idx = Number.parseInt($(this).closest('.la-choice-row').data('idx'));
            if (!Number.isNaN(idx)) {
                choicesInfo[idx].text = $(this).val();
            }
        });

        html.find('.la-choice-mode').off('change').on('change', function () {
            mode = $(this).val();
            hidden = mode === "vote-hidden";
        });

        // Auto-resize the dialog window to fit content
        if (typeof this?.setPosition === "function") {
            this.setPosition({ height: "auto" });
        }
    }

    const htmlContent = `
        <style>
            .la-choice-config { display: flex; flex-direction: column; gap: 8px; }
            .la-choice-users-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; border: 1px solid #7a7971; padding: 6px; border-radius: 4px; background: rgba(0,0,0,0.15); }
            .la-choice-user-card { transition: all 0.1s ease; opacity: 0.8; }
            .la-choice-user-card:hover { opacity: 1; background: rgba(255,255,255,0.05) !important; }
            .la-choice-user-card.selected { border-color: #ff6400 !important; background: rgba(255, 100, 0, 0.25) !important; box-shadow: 0 0 4px #ff6400 inset; font-weight: bold; opacity: 1; }
            .la-choices-container { display: flex; flex-direction: column; gap: 2px; margin-top: 4px; }
            .la-choice-add { background: #333; color: #eee; border: 1px solid #666; padding: 2px 8px; border-radius: 3px; cursor: pointer; font-size: 0.8em; align-self: flex-start; margin-top: 4px; }
            .la-choice-add:hover { background: #444; border-color: #ff6400; color: #fff; }
            .la-choice-mode:focus { border-color: #ff6400; outline: none; }
        </style>
        <div class="lancer-dialog-base la-choice-config">
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">CHOICE MENU</div>
                <div class="lancer-dialog-subtitle">Configure a card to send to players.</div>
            </div>

            <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.85em;">Title</label>
                <input type="text" class="la-choice-title" value="${title}" style="height: 24px;" />
            </div>
            <div class="form-group" style="margin: 0;">
                <label style="font-size: 0.85em;">Description</label>
                <input type="text" class="la-choice-description" value="${description}" style="height: 24px;" />
            </div>

            <div class="la-choice-mode-container"></div>

            <label style="font-weight: bold; font-size: 0.85em; margin-top: 4px;">Recipients (${activeUsers.length} Active)</label>
            <div class="la-choice-users-grid"></div>

            <label style="font-weight: bold; font-size: 0.85em; margin-top: 8px;">Options</label>
            <div class="la-choices-container"></div>
            <button type="button" class="la-choice-add"><i class="fas fa-plus"></i> Add Option</button>
        </div>
    `;

    const dialogObj = new Dialog({
        title: "Choice Configuration",
        content: htmlContent,
        buttons: {
            send: {
                icon: '<i class="fas fa-paper-plane"></i>',
                label: "Send",
                callback: async (html) => {
                    const finalTitle = String(html.find('.la-choice-title').val() || "Choice");
                    const finalDesc = String(html.find('.la-choice-description').val() || "");

                    if (selectedUserIds.length === 0) {
                        ui.notifications.warn("No recipients selected.");
                        return;
                    }
                    if (choicesInfo.length === 0) {
                        ui.notifications.warn("No options provided.");
                        return;
                    }

                    if (mode === "vote" || mode === "vote-hidden") {
                        // Vote mode — one winner callback posted as chat when creator confirms
                        const voteChoices = choicesInfo.map((c, idx) => ({
                            text: `${idx + 1}. ${c.text}`,
                            data: { text: c.text, number: idx + 1 },
                            callback: async (data) => {
                                await ChatMessage.create({
                                    content: `
                                        <div>
                                            <div class="lancer-dialog-title" style="font-size: 1.1em; color: #ff6400; border-bottom: 1px solid #ff640050; padding-bottom: 4px; margin-bottom: 8px;">${finalTitle} — Vote Result</div>
                                            <div class="lancer-dialog-subtitle">The vote has concluded. Winner:</div>
                                            <div style="font-weight: bold; font-size: 1.25em; padding: 12px; background: rgba(0,0,0,0.05); border-left: 3px solid #ff6400; margin-top: 5px; display: flex; align-items: center; gap: 8px;">
                                                <span style="color: #ff6400; opacity: 0.7;">${data.number}.</span> ${data.text}
                                            </div>
                                        </div>
                                    `,
                                    speaker: ChatMessage.getSpeaker({ alias: game.user.name })
                                });
                            }
                        }));

                        startVoteCard({
                            choices: voteChoices,
                            title: finalTitle,
                            description: finalDesc,
                            userIdControl: selectedUserIds,
                            hidden
                        });
                    } else {
                        // Map choices to startChoiceCard format
                        const mappedChoices = choicesInfo.map((c, idx) => ({
                            text: `${idx + 1}. ${c.text}`,
                            data: { text: c.text, number: idx + 1 },
                            callback: async (data) => {
                                const name = data.responderName || "A user";
                                await ChatMessage.create({
                                    content: `
                                        <div>
                                            <div class="lancer-dialog-title" style="font-size: 1.1em; color: #ff6400; border-bottom: 1px solid #ff640050; padding-bottom: 4px; margin-bottom: 8px;">${finalTitle}</div>
                                            <div class="lancer-dialog-subtitle"><b>${name}</b> selected:</div>
                                            <div style="font-weight: bold; font-size: 1.25em; padding: 12px; background: rgba(0,0,0,0.05); border-left: 3px solid #ff6400; margin-top: 5px; display: flex; align-items: center; gap: 8px;">
                                                <span style="color: #ff6400; opacity: 0.7;">${data.number}.</span> ${data.text}
                                            </div>
                                        </div>
                                    `,
                                    speaker: ChatMessage.getSpeaker({ alias: game.user.name })
                                });
                            }
                        }));

                        // Use the built-in startChoiceCard with the full selection array
                        startChoiceCard(/** @type {any} */ ({
                            choices: mappedChoices,
                            title: finalTitle,
                            description: finalDesc,
                            userIdControl: selectedUserIds,
                            mode: mode,
                            forceSocket: true
                        }));
                    }

                    ui.notifications.info(`Sent card to ${selectedUserIds.length} users.`);
                }
            },
            cancel: { label: "Cancel" }
        },
        default: "send",
        render: (html) => {
            refresh.call(dialogObj, html);
            html.find('.la-choice-add').on('click', () => {
                choicesInfo.push({ text: "Option " + (choicesInfo.length + 1) });
                refresh.call(dialogObj, html);
            });
        }
    }, { width: 400, height: "auto", classes: ['lancer-dialog-base', 'lancer-no-title'] });
    dialogObj.render(true);
}

/**
 * Prompts the user to choose one or more weapon mounts (Mechs) or weapons (NPCs/Pilots).
 * @param {Actor|Token} actorOrToken
 * @param {number} numberToChoose - Maximum number of items to choose
 * @param {Function} [filterPredicate] - Optional predicate to filter weapons
 * @param {string[]} [allowedMountTypes] - Optional list of allowed mount types (Mech only)
 * @param {string} [title] - Optional custom title
 * @param {Function} [selectionValidator] - Optional (selectedItems) => { valid, message }
 * @returns {Promise<any[]|null>} Resolves to an array of selected mounts/items, or null if cancelled.
 */

/**
 * Builds and renders the standard multi-select choice dialog.
 * Used by choseMount, choseSystem, choseTrait.
 * @param {Array<{id:number,item:any,img:string,labelHtml:string,sublabel:string,selectable:boolean,destroyed:boolean}>} choices
 * @param {{title:string,titleHtml:string,subtitle:string,hint:string,numberToChoose:number,selectionValidator:Function|null,onContextMenu:Function|null,resolve:Function}} opts
 */
function _buildChoiceDialog(choices, { title, titleHtml, subtitle, hint, numberToChoose, selectionValidator, onContextMenu, resolve }) {
    const content = `
        <div class="lancer-dialog-header">
            <div class="lancer-dialog-title">${titleHtml}</div>
            <div class="lancer-dialog-subtitle">${subtitle}</div>
        </div>
        <div class="lancer-dialog-body" style="padding: 10px;">
            <div class="la-selection-validation-msg" style="color: #d97000; font-style: italic; font-size: 0.9em; margin-bottom: 4px; min-height: 18px;"></div>
            <div style="font-size: 0.72em; color: #777; font-style: italic; margin-bottom: 6px;"><i class="fas fa-mouse-pointer"></i> ${hint}</div>
            <div class="la-choice-list" style="max-height: 350px; overflow-y: auto; padding-right: 5px;">
                ${choices.map(c => `
                    <div class="la-choice-item ${c.selectable ? '' : 'unselectable'}" data-idx="${c.id}"
                         style="display: flex; align-items: center; padding: 5px 8px; border: 1px solid ${c.selectable ? '#444' : (c.destroyed ? '#b71c1c' : '#222')};
                                margin-bottom: 3px; cursor: ${c.selectable ? 'pointer' : 'not-allowed'}; border-radius: 3px;
                                background: ${c.selectable ? 'rgba(255,255,255,0.03)' : (c.destroyed ? 'rgba(183,28,28,0.08)' : 'rgba(0,0,0,0.2)')};
                                opacity: ${c.selectable ? '1' : '0.75'}; transition: all 0.15s;">
                        <img src="${c.img}" style="width: 28px; height: 28px; object-fit: contain; margin-right: 8px; border: 1px solid #333; flex-shrink: 0;">
                        <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                            <div style="margin-bottom: 1px;">${c.labelHtml}</div>
                            <span style="font-size: 0.68em; opacity: 0.45; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">${c.sublabel}</span>
                        </div>
                        <i class="fas fa-check selection-check" style="color: #ff6400; margin-left: 6px; font-size: 0.85em; visibility: hidden;"></i>
                    </div>
                `).join('')}
            </div>
        </div>
    `;
    let selectedIndices = new Set();
    const dialog = new Dialog({
        title,
        content,
        buttons: {
            confirm: {
                icon: '<i class="fas fa-check"></i>',
                label: "Confirm",
                callback: () => resolve(Array.from(selectedIndices).map(idx => choices[idx].item))
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel",
                callback: () => resolve(null)
            }
        },
        default: "confirm",
        render: (html) => {
            const listItems = html.find('.la-choice-item');
            const confirmBtn = html.parent().find('button.confirm');
            const validationMsg = html.find('.la-selection-validation-msg');
            const updateValidation = () => {
                if (selectionValidator) {
                    const selectedItems = Array.from(selectedIndices).map(i => choices[i].item);
                    const result = selectionValidator(selectedItems);
                    confirmBtn.prop('disabled', !result.valid);
                    validationMsg.text(result.message || '');
                    if (result.level === 'success') {
                        validationMsg.css('color', '#4caf50');
                    } else if (result.level === 'error') {
                        validationMsg.css('color', '#f44336');
                    } else {
                        validationMsg.css('color', '#d97000');
                    }
                } else {
                    confirmBtn.prop('disabled', selectedIndices.size === 0);
                    validationMsg.text('');
                }
            };
            updateValidation();
            if (onContextMenu) {
                listItems.on('contextmenu', function(e) {
                    e.preventDefault();
                    onContextMenu(choices[Number.parseInt($(this).data('idx'))], html);
                });
            }
            listItems.filter(':not(.unselectable)').click(function() {
                const idx = Number.parseInt($(this).data('idx'));
                if (selectedIndices.has(idx)) {
                    selectedIndices.delete(idx);
                    $(this).css({ 'border-color': '#444', 'background': 'rgba(255,255,255,0.03)' })
                        .find('.selection-check').css('visibility', 'hidden');
                } else {
                    if (numberToChoose === 1) {
                        selectedIndices.clear();
                        listItems.css({ 'border-color': '#444', 'background': 'rgba(255,255,255,0.03)' })
                            .find('.selection-check').css('visibility', 'hidden');
                    }
                    if (selectedIndices.size < numberToChoose) {
                        selectedIndices.add(idx);
                        $(this).css({ 'border-color': '#ff6400', 'background': 'rgba(255,100,0,0.05)' })
                            .find('.selection-check').css('visibility', 'visible');
                    }
                }
                updateValidation();
            });
        }
    }, {
        classes: ['lancer-dialog-base', 'lancer-no-title'],
        width: 480,
        top: 450,
        left: 150
    });
    dialog.render(true);
}

// ─────────────────────────────────────────────────────────────────────────────

export async function choseMount(actorOrToken, numberToChoose = 1, filterPredicate = null, allowedMountTypes = null, title = null, selectionValidator = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return null;

    const isMech = actor.type === 'mech' && actor.system.loadout?.weapon_mounts;
    let allItems = [];

    if (isMech) {
        allItems = actor.system.loadout.weapon_mounts.map(mount => {
            if (allowedMountTypes && !allowedMountTypes.includes(mount.type))
                return { item: mount, hidden: true };

            // Collect weapon data and their states
            const weaponData = mount.slots.map(s => {
                const w = s.weapon?.value;
                if (!w) {
                    return null;
                }
                const sys = w.system;
                const profiles = sys?.profiles || [];
                const activeProfileIndex = sys?.selected_profile_index ?? 0;
                let profileName = "";
                if (profiles.length > 1 && profiles[activeProfileIndex]) {
                    profileName = profiles[activeProfileIndex].name;
                }
                const allTags     = [...(sys?.active_profile?.tags ?? []), ...(sys?.all_base_tags ?? [])];
                const hasLoading  = allTags.some(t => t.lid === 'tg_loading'  || t.id === 'tg_loading');
                const hasRecharge = allTags.some(t => t.lid === 'tg_recharge' || t.id === 'tg_recharge');
                const hasLimited  = allTags.some(t => t.lid === 'tg_limited'  || t.id === 'tg_limited');
                const loadStatus   = hasLoading  ? (sys.loaded  === false ? 'UNLOADED'  : 'LOADED')   : '';
                const chargeStatus = hasRecharge ? (sys.charged === false ? 'UNCHARGED' : 'CHARGED')  : '';
                let usesText = '';
                if (hasLimited) {
                    const val = sys.uses == null ? 0 : typeof sys.uses === 'number' ? sys.uses : (sys.uses.value ?? 0);
                    const max = sys.uses == null ? 0 : typeof sys.uses === 'number' ? 0 : (sys.uses.max ?? 0);
                    usesText = `${val}/${max}`;
                }

                return {
                    id: w.id,
                    name: w.name,
                    img: w.img,
                    mod: s.mod?.value?.name || null,
                    modItem: s.mod?.value || null,
                    destroyed: !!sys.destroyed,
                    disabled: !!sys.disabled,
                    unloaded: loadStatus === 'UNLOADED',
                    loadStatus,
                    chargeStatus,
                    usesText,
                    fitsFilter: !filterPredicate || filterPredicate(w),
                    type: sys?.active_profile?.type || sys?.type || "",
                    size: sys?.size?.toLowerCase() === 'superheavy' ? 'Superheavy' : (sys?.size || ""),
                    profileName: profileName,
                    value: w
                };
            }).filter(Boolean);

            const hasWeapon = weaponData.length > 0;
            // A mount is destroyed only if ALL weapons are destroyed
            const allDestroyed = hasWeapon && weaponData.every(w => w.destroyed);
            // A mount is only selectable if ALL weapons pass the filter and at least one is not destroyed
            const allFitFilter = weaponData.every(w => w.fitsFilter);

            return {
                item: mount,
                weaponData,
                isMount: true,
                allDestroyed,
                selectable: allFitFilter && !allDestroyed && hasWeapon,
                hidden: false
            };
        }).filter(m => !m.hidden);
    } else {
        allItems = actor.items.filter(item => {
            const isWeapon = ['mech_weapon', 'npc_feature', 'pilot_weapon'].includes(item.type);
            if (!isWeapon)
                return false;
            if (item.type === 'npc_feature' && item.system.type !== 'Weapon')
                return false;
            return true;
        }).map(item => {
            const sys = item.system;
            const destroyed = !!sys.destroyed;
            const fitsFilter = !filterPredicate || filterPredicate(item);

            const profiles = sys?.profiles || [];
            const activeProfileIndex = sys?.selected_profile_index ?? 0;
            let profileName = "";
            if (item.type === 'npc_feature') {
                const tierOverride = sys?.tier_override ?? 0;
                const actorTier = actor.system?.tier ?? 1;
                profileName = `T${tierOverride > 0 ? tierOverride : actorTier}`;
            } else if (profiles.length > 1 && profiles[activeProfileIndex]) {
                profileName = profiles[activeProfileIndex].name;
            }
            const allTagsNonMech  = [...(sys?.active_profile?.tags ?? []), ...(sys?.tags ?? [])];
            const hasLoadingNM    = allTagsNonMech.some(t => t.lid === 'tg_loading'  || t.id === 'tg_loading');
            const hasRechargeNM   = allTagsNonMech.some(t => t.lid === 'tg_recharge' || t.id === 'tg_recharge');
            const hasLimitedNM    = allTagsNonMech.some(t => t.lid === 'tg_limited'  || t.id === 'tg_limited');
            const loadStatusNM    = hasLoadingNM  ? (sys.loaded  === false ? 'UNLOADED'  : 'LOADED')  : '';
            const chargeStatusNM  = hasRechargeNM ? (sys.charged === false ? 'UNCHARGED' : 'CHARGED') : '';
            let usesTextNM = '';
            if (hasLimitedNM) {
                const val = sys.uses == null ? 0 : typeof sys.uses === 'number' ? sys.uses : (sys.uses.value ?? 0);
                const max = sys.uses == null ? 0 : typeof sys.uses === 'number' ? 0 : (sys.uses.max ?? 0);
                usesTextNM = `${val}/${max}`;
            }

            return {
                item,
                weaponData: [{
                    id: item.id,
                    name: item.name,
                    img: item.img,
                    destroyed,
                    disabled: !!sys.disabled,
                    unloaded: loadStatusNM === 'UNLOADED',
                    loadStatus: loadStatusNM,
                    chargeStatus: chargeStatusNM,
                    usesText: usesTextNM,
                    fitsFilter,
                    type: sys?.weapon_type || sys?.active_profile?.type || "",
                    size: sys?.weapon_type ? "" : (sys?.size?.toLowerCase() === 'superheavy' ? 'Superheavy' : (sys?.size || "")),
                    profileName: profileName,
                    modItem: null,
                    value: item
                }],
                isMount: false,
                allDestroyed: destroyed,
                selectable: !destroyed && fitsFilter,
                hidden: false
            };
        });
    }

    if (allItems.length === 0) {
        ui.notifications.warn(`No ${isMech ? 'mounts' : 'weapons'} found.`);
        return [];
    }

    return new Promise((resolve) => {
        const choices = allItems.map((choice, idx) => {
            const weaponData = choice.weaponData;
            const isMount = choice.isMount;

            // Group identical weapons for display
            const counts = {};
            const uniqueWeapons = [];
            for (const w of weaponData) {
                const key = `${w.name}|${w.mod || ""}|${w.destroyed}|${w.disabled}|${w.loadStatus}|${w.chargeStatus}|${w.usesText}`;
                if (!counts[key]) {
                    counts[key] = 0;
                    uniqueWeapons.push({ ...w, key });
                }
                counts[key]++;
            }

            const labelHtml = uniqueWeapons.map(w => {
                let style = "display: block; margin-bottom: 2px;";
                let nameStyle = "font-weight: bold;";
                let statusTags = "";

                if (w.disabled) {
                    nameStyle += " color: #ff9800;";
                    statusTags += `<span style="font-size: 0.7em; background: #ff9800; color: #000; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">DISABLED</span>`;
                }

                const sizeTypeArr = [w.size, w.type].filter(Boolean);
                let typeText = "";
                if (sizeTypeArr.length > 0) {
                    typeText = `<span style="font-size: 0.8em; color: #888; margin-left: 6px; font-weight: normal;">${sizeTypeArr.join(' ')}</span>`;
                }

                if (w.profileName) {
                    typeText += `<span style="font-size: 0.8em; color: #888; margin-left: 4px;">(${w.profileName})</span>`;
                }

                const countStr = counts[w.key] > 1 ? ` <span style="font-size: 0.9em; opacity: 0.8;">x${counts[w.key]}</span>` : "";
                const S_TAG     = `font-size:0.8em;opacity:0.9;background:rgba(255,100,0,0.15);border:1px solid rgba(255,100,0,0.3);border-radius:4px;padding:1px 6px;display:inline-block;color:#ff6400;`;
                const S_TAG_RED = `font-size:0.8em;background:#b71c1c;border:1px solid #8b0000;border-radius:4px;padding:1px 6px;display:inline-block;color:#fff;`;
                const bottomParts = [];
                if (w.destroyed)    bottomParts.push(`<span style="${S_TAG_RED}">✕ DESTROYED</span>`);
                if (w.mod)          bottomParts.push(`<span style="${S_TAG}">MOD: ${w.mod}</span>`);
                if (w.loadStatus)   bottomParts.push(`<span style="${S_TAG}">${w.loadStatus}</span>`);
                if (w.chargeStatus) bottomParts.push(`<span style="${S_TAG}">${w.chargeStatus}</span>`);
                if (w.usesText)     bottomParts.push(`<span style="${S_TAG}">${w.usesText}</span>`);
                const modHtml = bottomParts.length ? `<div style="margin-top:2px;display:flex;gap:4px;flex-wrap:wrap;">${bottomParts.join('')}</div>` : "";

                return `
                    <div style="${style}">
                        <span style="${nameStyle}">${w.name}${typeText}${countStr}${statusTags}</span>
                        ${modHtml}
                    </div>
                `;
            }).join('');

            const sublabel = isMount ? `${choice.item.type} MOUNT` : (choice.item.type === 'npc_feature' ? choice.item.system.type : choice.item.type.replace('mech_', '').replace('pilot_', ''));
            const img = weaponData[0]?.img || "icons/svg/item-bag.svg";

            // Build detail data for right-click popup
            const weaponDetails = weaponData.map(wd => {
                const wItem = wd.value;
                if (!wItem?.system)
                    return null;
                const sys = wItem.system;
                let allProfiles = [];
                if (wItem.type === 'npc_feature') {
                    // NPC weapon: show only the effective tier
                    const tierOverride = sys.tier_override ?? 0;
                    const actorTier = actor.system?.tier ?? 1;
                    const effectiveTier = tierOverride > 0 ? tierOverride : actorTier;
                    const tierIndex = Math.max(0, Math.min(2, effectiveTier - 1));
                    const tierDmg = (sys.damage ?? [])[tierIndex] ?? [];
                    const _tierRegex = /\{(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\}/g;
                    const _resolveTier = s => String(s ?? '').replace(_tierRegex, (_, v1, v2, v3) => [v1, v2, v3][tierIndex] ?? v1);
                    const resolvedTags = (sys.tags ?? []).map(t => {
                        const raw = t.name ?? t.lid ?? t.id ?? '';
                        const resolvedVal = _resolveTier(t.val);
                        const resolved = _resolveTier(raw).replace(/\{VAL\}/gi, resolvedVal);
                        return { ...t, _resolvedName: resolved };
                    });
                    allProfiles.push({ name: null, damage: tierDmg, range: sys.range ?? [], tags: resolvedTags, effect: sys.effect || '', on_hit: sys.on_hit || '' });
                } else {
                    allProfiles = sys.profiles ?? [];
                }
                if (allProfiles.length === 0)
                    return null;
                return { name: wItem.name, img: wItem.img, size: wd.size, type: wd.type, mod: wd.mod || null, modItem: wd.modItem || null, profiles: allProfiles, actions: sys.actions ?? [], activeProfile: sys.selected_profile_index ?? 0 };
            }).filter(Boolean);

            return {
                item: choice.item,
                labelHtml,
                sublabel,
                img,
                id: idx,
                selectable: choice.selectable,
                destroyed: choice.allDestroyed,
                weaponDetails
            };
        });

        _buildChoiceDialog(choices, {
            title: title || `Choose ${isMech ? 'Mount' : 'Weapon'}`,
            titleHtml: title || `CHOOSE ${isMech ? 'MOUNT' : 'WEAPON'}`,
            subtitle: `Select up to ${numberToChoose} ${isMech ? 'mount(s)' : 'weapon(s)'}.`,
            hint: 'Right-click a row for weapon details',
            numberToChoose,
            selectionValidator,
            onContextMenu: (choice, html) => {
                $('.la-weapon-detail-popup').remove();
                if (!choice.weaponDetails?.length)
                    return;

                const detailHtml = choice.weaponDetails.map(wd => {
                    const wName = choice.weaponDetails.length > 1
                        ? `<div style="font-size:0.8em;font-weight:bold;color:#ff6400;margin-bottom:6px;border-bottom:1px solid #333;padding-bottom:4px;">${wd.name}</div>`
                        : '';
                    return wName + laRenderWeaponBody(wd.profiles, { actions: wd.actions, modName: wd.mod, modItem: wd.modItem, activeProfileIndex: wd.activeProfile });
                }).join('<hr style="border:0;border-top:1px solid #333;margin:6px 0;">');

                const title = choice.weaponDetails.length > 1 ? choice.sublabel : (choice.weaponDetails[0]?.name ?? '');
                const subtitle = choice.weaponDetails.length > 1
                    ? choice.weaponDetails.map(w => w.name).join(' / ')
                    : [choice.weaponDetails[0]?.size, choice.weaponDetails[0]?.type].filter(Boolean).join(' · ');
                const popup = laDetailPopup('la-weapon-detail-popup', title, subtitle, detailHtml, 'weapon');
                laPositionPopup(popup, html);
            },
            resolve
        });
    });
}

/**
 * Opens a dialog to select one or more systems from a mech or NPC actor.
 * For mechs: reads actor.system.loadout.systems[].value (mech_system items).
 * For NPCs/others: filters actor.items by npc_feature with type === 'System'.
 * @param {Actor|Token} actorOrToken
 * @param {number} [numberToChoose=1]
 * @param {Function|null} [filterPredicate=null] - (item) => boolean
 * @param {string[]|null} [allowedSystemTypes=null] - filter by item.system.type e.g. ['AI','Shield']
 * @param {string|null} [title=null]
 * @param {Function|null} [selectionValidator=null] - (items[]) => {valid, message, level}
 * @returns {Promise<Array|null>}
 */
export async function choseSystem(actorOrToken, numberToChoose = 1, filterPredicate = null, allowedSystemTypes = null, title = null, selectionValidator = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return null;

    const isMech = actor.type === 'mech';
    let allItems = [];

    if (isMech) {
        for (const s of (actor.system?.loadout?.systems ?? [])) {
            const item = s?.value;
            if (!item)
                continue;
            const sys = item.system;
            if (allowedSystemTypes && !allowedSystemTypes.includes(sys?.type))
                continue;
            const destroyed = !!sys?.destroyed;
            const disabled = !!sys?.disabled;
            const uses = (sys?.uses?.max > 0) ? sys.uses : null;
            const fitsFilter = !filterPredicate || filterPredicate(item);
            allItems.push({
                item,
                id: item.id,
                name: item.name,
                img: item.img || "systems/lancer/assets/icons/mech_system.svg",
                systemType: sys?.type || "",
                sp: sys?.sp ?? 0,
                destroyed,
                disabled,
                uses,
                fitsFilter,
                selectable: !destroyed && fitsFilter,
                effect: sys?.effect || "",
                tags: sys?.tags ?? [],
                actions: getItemActions(item),
                deployableLids: getItemDeployables(item, actor),
                deployableActors: []
            });
        }
    } else {
        for (const item of actor.items) {
            if (item.type === 'npc_feature' && item.system?.type === 'System') {
                if (allowedSystemTypes && !allowedSystemTypes.includes(item.system.type))
                    continue;
                const sys = item.system;
                const destroyed = !!sys?.destroyed;
                const disabled = !!sys?.disabled;
                const uses = (sys?.uses?.max > 0) ? sys.uses : null;
                const fitsFilter = !filterPredicate || filterPredicate(item);
                allItems.push({
                    item,
                    id: item.id,
                    name: item.name,
                    img: item.img || "systems/lancer/assets/icons/generic_item.svg",
                    systemType: "System",
                    sp: sys?.sp ?? 0,
                    destroyed,
                    disabled,
                    uses,
                    fitsFilter,
                    selectable: !destroyed && fitsFilter,
                    effect: sys?.effect || "",
                    tags: sys?.tags ?? [],
                    actions: getItemActions(item),
                    deployableLids: getItemDeployables(item, actor),
                    deployableActors: []
                });
            }
        }
    }

    // Resolve deployable actors (checks world then compendium)
    for (const entry of allItems) {
        if (entry.deployableLids.length > 0) {
            const resolved = await Promise.all(
                entry.deployableLids.map(lid => resolveDeployable(lid, actor))
            );
            entry.deployableActors = resolved.map(r => r.deployable).filter(Boolean);
        }
    }

    if (allItems.length === 0) {
        ui.notifications.warn(`No systems found.`);
        return [];
    }

    return new Promise((resolve) => {
        const choices = allItems.map((entry, idx) => {
            let nameStyle = "font-weight: bold;";
            let statusTags = "";

            if (entry.destroyed) {
                statusTags += `<span style="font-size: 0.7em; background: #b71c1c; color: #fff; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">✕ DESTROYED</span>`;
            } else if (entry.disabled) {
                nameStyle += " color: #ff9800;";
                statusTags += `<span style="font-size: 0.7em; background: #ff9800; color: #000; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">DISABLED</span>`;
            }

            let infoTags = "";
            if (entry.sp > 0) {
                infoTags += `<span style="font-size: 0.7em; background: #1a3a5c; color: #7ec8e3; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">SP: ${entry.sp}</span>`;
            }
            if (entry.uses) {
                const usesColor = entry.uses.value <= 0 ? '#888' : '#e6a817';
                infoTags += `<span style="font-size: 0.7em; background: rgba(230,168,23,0.15); color: ${usesColor}; border: 1px solid rgba(230,168,23,0.3); padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">${entry.uses.value}/${entry.uses.max}</span>`;
            }

            const labelHtml = `
                <div style="display: block; margin-bottom: 2px;">
                    <span style="${nameStyle}">${entry.name}${statusTags}${infoTags}</span>
                </div>
            `;

            return {
                item: entry.item,
                labelHtml,
                sublabel: entry.systemType || "SYSTEM",
                img: entry.img,
                id: idx,
                selectable: entry.selectable,
                destroyed: entry.destroyed,
                effect: entry.effect,
                tags: entry.tags,
                actions: entry.actions,
                deployableActors: entry.deployableActors,
                systemType: entry.systemType,
                sp: entry.sp
            };
        });

        _buildChoiceDialog(choices, {
            title: title || 'Choose System',
            titleHtml: title || 'CHOOSE SYSTEM',
            subtitle: `Select up to ${numberToChoose} system(s).`,
            hint: 'Right-click a row for system details',
            numberToChoose,
            selectionValidator,
            onContextMenu: (choice, html) => {
                $('.la-system-detail-popup').remove();
                if (!choice.effect && !choice.tags?.length && !choice.actions?.length && !choice.deployableActors?.length)
                    return;

                const bodyHtml = laRenderTextSection('EFFECT', choice.effect, '#e65100')
                    + laRenderTags(choice.tags)
                    + laRenderActions(choice.actions)
                    + laRenderDeployables(choice.deployableActors);
                const subtitle = [choice.systemType, choice.sp > 0 ? `${choice.sp} SP` : ''].filter(Boolean).join(' · ');
                const popup = laDetailPopup('la-system-detail-popup', choice.item.name, subtitle, bodyHtml, 'system');
                laPositionPopup(popup, html);
            },
            resolve
        });
    });
}

/**
 * Opens a dialog to select one or more traits from an NPC actor.
 * Only works with NPC actors (npc_feature items with type === 'Trait').
 * @param {Actor|Token} actorOrToken
 * @param {number} [numberToChoose=1]
 * @param {Function|null} [filterPredicate=null] - (item) => boolean
 * @param {string|null} [title=null]
 * @param {Function|null} [selectionValidator=null] - (items[]) => {valid, message, level}
 * @returns {Promise<Array|null>}
 */
export async function choseTrait(actorOrToken, numberToChoose = 1, filterPredicate = null, title = null, selectionValidator = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return null;

    if (actor.type !== 'npc') {
        ui.notifications.warn("choseTrait: only NPC actors are supported.");
        return null;
    }

    const tier = actor.system?.tier ?? 1;

    const allItems = [];
    for (const item of actor.items) {
        if (item.type !== 'npc_feature' || item.system?.type !== 'Trait')
            continue;
        const sys = item.system;
        const destroyed = !!sys?.destroyed;
        const disabled = !!sys?.disabled;
        const fitsFilter = !filterPredicate || filterPredicate(item);
        allItems.push({
            item,
            name: item.name,
            img: item.img || "systems/lancer/assets/icons/generic_item.svg",
            tier,
            destroyed,
            disabled,
            fitsFilter,
            selectable: !destroyed && fitsFilter,
            effect: sys?.effect || "",
            tags: sys?.tags ?? [],
            actions: getItemActions(item)
        });
    }

    if (allItems.length === 0) {
        ui.notifications.warn("No traits found.");
        return [];
    }

    return new Promise((resolve) => {
        const choices = allItems.map((entry, idx) => {
            let nameStyle = "font-weight: bold;";
            let statusTags = "";

            if (entry.destroyed) {
                statusTags += `<span style="font-size: 0.7em; background: #b71c1c; color: #fff; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">✕ DESTROYED</span>`;
            } else if (entry.disabled) {
                nameStyle += " color: #ff9800;";
                statusTags += `<span style="font-size: 0.7em; background: #ff9800; color: #000; padding: 1px 4px; border-radius: 3px; margin-left: 5px; vertical-align: middle;">DISABLED</span>`;
            }

            const labelHtml = `
                <div style="display: block; margin-bottom: 2px;">
                    <span style="${nameStyle}">${entry.name}${statusTags}</span>
                </div>
            `;

            return {
                item: entry.item,
                labelHtml,
                sublabel: `TRAIT · T${entry.tier}`,
                img: entry.img,
                id: idx,
                selectable: entry.selectable,
                destroyed: entry.destroyed,
                effect: entry.effect,
                tags: entry.tags,
                actions: entry.actions
            };
        });

        _buildChoiceDialog(choices, {
            title: title || 'Choose Trait',
            titleHtml: title || 'CHOOSE TRAIT',
            subtitle: `Select up to ${numberToChoose} trait(s).`,
            hint: 'Right-click a row for trait details',
            numberToChoose,
            selectionValidator,
            onContextMenu: (choice, html) => {
                $('.la-trait-detail-popup').remove();
                if (!choice.effect && !choice.tags?.length && !choice.actions?.length)
                    return;

                const _resolveTierStr = (s) => {
                    const tierIndex = Math.max(0, Math.min(2, (choice.item.system?.tier_override > 0 ? choice.item.system.tier_override : tier) - 1));
                    return String(s ?? '').replaceAll(/\{(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\/(\d+(?:\.\d+)?)\}/g, (_, v1, v2, v3) => [v1, v2, v3][tierIndex] ?? v1);
                };

                const bodyHtml = laRenderTextSection('EFFECT', choice.effect, '#e65100', _resolveTierStr)
                    + laRenderTags(choice.tags, _resolveTierStr)
                    + laRenderActions(choice.actions, _resolveTierStr);
                const popup = laDetailPopup('la-trait-detail-popup', choice.item.name, `TRAIT · T${tier}`, bodyHtml, 'trait');
                laPositionPopup(popup, html);
            },
            resolve
        });
    });
}

/**
 * Prompts the user to choose an invade option for a tech attack.
 * Always includes the built-in Fragment Signal. Collects item-based invades
 * from mech loadout systems (and frame core) or NPC/other actor items.
 * @param {Actor|Token} actorOrToken
 * @returns {Promise<Object|null>} Selected invade entry or null if cancelled.
 */
export async function chooseInvade(actorOrToken) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return null;

    const isNPC = actor.type === 'npc';

    // --- Collect invades ---
    const invades = [];

    // Built-in Fragment Signal
    const fragDetail = isNPC
        ? "Target becomes IMPAIRED until the end of their next turn."
        : "Target becomes IMPAIRED and SLOWED until the end of their next turn.";
    invades.push({
        name: "Fragment Signal",
        detail: fragDetail,
        item: null,
        action: null,
        tags: [],
        isFragmentSignal: true,
        sourceItemName: "Built-in",
        img: "systems/lancer/assets/icons/tech_quick.svg"
    });

    if (actor.type === 'mech') {
        // Mech loadout systems
        for (const s of (actor.system?.loadout?.systems ?? [])) {
            const item = s?.value;
            if (!item)
                continue;
            for (const action of (item.system?.actions ?? [])) {
                if (action.activation === "Invade") {
                    invades.push({
                        name: action.name,
                        detail: action.detail || '',
                        item,
                        action,
                        tags: item.system?.tags ?? [],
                        isFragmentSignal: false,
                        sourceItemName: item.name,
                        img: item.img || "systems/lancer/assets/icons/mech_system.svg"
                    });
                }
            }
        }
        // Frame core system passive actions
        const frame = actor.system?.loadout?.frame?.value;
        if (frame) {
            for (const action of (frame.system?.core_system?.passive_actions ?? [])) {
                if (action.activation === "Invade") {
                    invades.push({
                        name: action.name,
                        detail: action.detail || '',
                        item: frame,
                        action,
                        tags: [],
                        isFragmentSignal: false,
                        sourceItemName: `${frame.name} (Core)`,
                        img: frame.img || "systems/lancer/assets/icons/frame.svg"
                    });
                }
            }
        }
    } else {
        // NPC and others: check all items
        for (const item of actor.items) {
            for (const action of (item.system?.actions ?? [])) {
                if (action.activation === "Invade") {
                    invades.push({
                        name: action.name,
                        detail: action.detail || '',
                        item,
                        action,
                        tags: item.system?.tags ?? [],
                        isFragmentSignal: false,
                        sourceItemName: item.name,
                        img: item.img || "systems/lancer/assets/icons/generic_item.svg"
                    });
                }
            }
        }
    }

    return new Promise((resolve) => {
        const content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">CHOOSE INVADE</div>
                <div class="lancer-dialog-subtitle">Select an invade option.</div>
            </div>
            <div class="lancer-dialog-body" style="padding: 10px;">
                <div style="font-size: 0.72em; color: #777; font-style: italic; margin-bottom: 6px;"><i class="fas fa-mouse-pointer"></i> Right-click a row for details</div>
                <div class="la-invade-list" style="max-height: 350px; overflow-y: auto; padding-right: 5px;">
                    ${invades.map((inv, idx) => `
                        <div class="la-invade-item" data-idx="${idx}"
                             style="display: flex; align-items: flex-start; padding: 10px; border: 1px solid #444;
                                    margin-bottom: 6px; cursor: pointer; border-radius: 4px;
                                    background: rgba(255,255,255,0.03); transition: all 0.2s;">
                            <img src="${inv.img}" style="width: 40px; height: 40px; object-fit: contain; margin-right: 12px; border: 1px solid #222; flex-shrink: 0;">
                            <div style="flex: 1; display: flex; flex-direction: column; min-width: 0;">
                                <div style="margin-bottom: 4px;">
                                    <span style="font-weight: bold;">${inv.name}</span>
                                    <span style="font-size: 0.8em; color: #888; margin-left: 6px; font-weight: normal;">${inv.sourceItemName}</span>
                                </div>
                                <span style="font-size: 0.75em; opacity: 0.5; text-transform: uppercase; font-weight: bold; letter-spacing: 0.5px;">INVADE</span>
                            </div>
                            <i class="fas fa-check la-invade-check" style="color: #ff6400; margin-left: 8px; margin-top: 14px; visibility: hidden;"></i>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;

        let selectedIdx = -1;

        const dialog = new Dialog({
            title: "Choose Invade",
            content,
            buttons: {
                confirm: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Confirm",
                    callback: () => {
                        if (selectedIdx >= 0)
                            resolve(invades[selectedIdx]);
                        else
                            resolve(null);
                    }
                },
                cancel: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Cancel",
                    callback: () => resolve(null)
                }
            },
            default: "confirm",
            render: (html) => {
                const listItems = html.find('.la-invade-item');
                const confirmBtn = html.parent().find('button.confirm');
                confirmBtn.prop('disabled', true);

                const _showInvadeDetailPopup = (inv) => {
                    $('.la-invade-detail-popup').remove();
                    const bodyHtml = laRenderTextSection('EFFECT', inv.detail, '#e65100')
                        + laRenderTags(inv.tags);
                    const popup = laDetailPopup('la-invade-detail-popup', inv.name, inv.sourceItemName, bodyHtml, 'weapon');
                    laPositionPopup(popup, html);
                };

                listItems.on('contextmenu', function(e) {
                    e.preventDefault();
                    const idx = Number.parseInt($(this).data('idx'));
                    _showInvadeDetailPopup(invades[idx]);
                });

                listItems.on('click', function() {
                    const idx = Number.parseInt($(this).data('idx'));
                    listItems.css({ 'border-color': '#444', 'background': 'rgba(255,255,255,0.03)' })
                        .find('.la-invade-check').css('visibility', 'hidden');
                    selectedIdx = idx;
                    $(this).css({ 'border-color': '#ff6400', 'background': 'rgba(255,100,0,0.05)' })
                        .find('.la-invade-check').css('visibility', 'visible');
                    confirmBtn.prop('disabled', false);
                });
            }
        }, {
            classes: ['lancer-dialog-base', 'lancer-no-title'],
            width: 480,
            top: 450,
            left: 150
        });
        dialog.render(true);
    });
}

/**
 * Prompts the user to choose an invade then fires TechAttackFlow.
 * @param {Actor|Token} actorOrToken
 * @returns {Promise<void>}
 */
export async function executeInvade(actorOrToken, bypassChoice = null) {
    const actor = /** @type {Actor} */ ((/** @type {Token} */ (actorOrToken))?.actor || actorOrToken);
    if (!actor)
        return;

    const selected = bypassChoice ?? await chooseInvade(actor);
    if (!selected)
        return;

    const TechAttackFlow = game.lancer?.flows?.get("TechAttackFlow");
    if (!TechAttackFlow) {
        ui.notifications.error("TechAttackFlow not found in game.lancer.flows.");
        return;
    }

    if (selected.isFragmentSignal) {
        const flow = new TechAttackFlow(actor.uuid, {
            title: "Fragment Signal",
            invade: true,
            effect: selected.detail,
            attack_type: "Tech"
        });
        await flow.begin();
    } else {
        const uuid = selected.item?.uuid ?? actor.uuid;
        const flow = new TechAttackFlow(uuid, {
            title: selected.name,
            invade: true,
            attack_type: "Tech",
            action: selected.action,
            effect: selected.detail,
            tags: selected.tags
        });
        await flow.begin();
    }
}
