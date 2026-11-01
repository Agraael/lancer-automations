/* global canvas, PIXI, game, ui, $, Dialog, fromUuid */

import {
    placeToken, chooseToken, gridLineWidth
} from "./canvas.js";

import { pickItem } from "./item-picker.js";
import { getModuleSetting } from "../tools/settings-utils.js";
import { tfGetTeam } from "../tools/token-factions-utils.js";
import { getLAFlag, setLAFlag, unsetLAFlag, getLAFlags } from "../tools/flag-utils.js";
import { MODULE_ID } from "../tools/constants.js";
import { getItemFlags } from "./document-flags.js";
import { playActionFxByActivation, playDeployableFX } from "../fx/actionFX.js";
import { stripDeployOwner } from "./detail-renderers.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { cancelButton } from "../tools/dialog-utils.js";
import { getOrCreateTemplateActor } from "../tools/template-actors.js";
import { deployableArtEnabled } from "../tools/deployable-art.js";

import {
    isHexGrid, getOccupiedOffsets, drawHexAt
} from "../combat/grid-helpers.js";

export {
    isGrantStale, resolveGrant, findGrantedAction, resolveActionGate, gateActions, getItemActions,
    addExtraActions, getActorActions, removeExtraActions, sweepStaleGrants, consumeExtraAction, reloadExtraAction,
    isPrimaryActionHidden, setHidePrimaryAction,
    rechargeExtraActionsForActor, resetPerRoundExtraActionsForActor, resetPerTurnExtraActionsForActor,
    getLinkedActions,
} from "./extra-actions.js";
export { getWeapons, findItemByLid, hasItem, reloadOneWeapon, rechargeSystem } from "./actor-items.js";
export {
    lockActorAction, lockActorActionTypes, unlockActorActionTypes, unlockActorAction,
    disableActorAction, enableActorAction, disableActorActionTypes, enableActorActionTypes,
    destroyItem, disableItem, restoreItem, isActionLocked, getLockedActions,
} from "./action-locks.js";
import { resolvePilot } from "../utils/lancer-token.js";
export { setItemAsActivated, getActivatedItems, endItemActivation, openEndActivationMenu } from "./item-activation.js";
import { getExtraDeployableOpts, getActorDeployables, getAllItemDeployables, getItemDeployables } from "./extra-deployables.js";
export {
    getExtraDeployableOpts, setExtraDeployableOpts, resolveDeployRangeCount,
    addExtraDeploymentLids, addExtraDeploymentActor, removeExtraDeploymentActor,
    getActorDeployables, getLinkedDeployables, sliceDeployablesForTier, getAllItemDeployables, getItemDeployables,
} from "./extra-deployables.js";
import { resolveDeployable, stampDeployableSource, getDeployableInfoSync } from "./deployable-lookup.js";
export { resolveDeployable, findDeployableInCompendium, resolveDeployableSourceItem, getDeployableInfoSync, getDeployableInfo } from "./deployable-lookup.js";
export { openDeployablePicker, openDocumentPicker } from "./document-pickers.js";
export { getOwnerTier, linkTierGate } from "./tier-gate.js";
export { pickItem };
export {
    addItemFlags, removeItemFlags, addActorFlags, removeActorFlags, addTokenFlags, removeTokenFlags, getTokenFlags,
    getItemFlags, getActorFlags,
} from "./document-flags.js";

function ownerDisplayName(actor)
{
    const pilot = actor.is_mech?.() ? resolvePilot(actor) : null;
    return pilot ? (pilot.system.callsign || pilot.name) : (actor.name || '');
}

/**
 * Deploy a weapon as a token on the ground using interactive placement.
 * Creates a "Template Throw" deployable actor if it doesn't exist, then uses placeToken for placement.
 * @param {Item} weapon - The weapon item to deploy
 * @param {Actor} ownerActor - The actor who owns the weapon
 * @param {Token} [originToken=null] - The token placing the weapon (used for range origin)
 * @param {Object} [options={}] - Extra options
 * @param {number|null} [options.range=1] - Placement range in grid units (null for unlimited)
 * @param {Token|Object|null} [options.at=null] - Origin override for range measurement
 * @param {string} [options.title] - Card title override
 * @param {string} [options.description] - Card description override
 * @returns {Promise<Array<TokenDocument>|null>} Spawned token documents, or null if cancelled
 */
export async function deployWeaponToken(weapon, ownerActor, originToken = null, options = {})
{
    const {
        range = 1,
        title = "DEPLOY WEAPON",
        description = "",
        at = null
    } = options;

    const templateActor = await getOrCreateTemplateActor('throw');

    if (!templateActor)
    {
        ui.notifications.error(localize('LA.notify.failedToCreateTemplateThrowActor'));
        return null;
    }

    const ownerName = ownerDisplayName(ownerActor);

    const extraData = {
        name: weapon.name,
        actorData: { name: `${weapon.name} [${ownerName}]` },
        flags: {
            [MODULE_ID]: {
                thrownWeapon: true,
                weaponName: weapon.name,
                weaponId: weapon.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName: ownerName
            }
        }
    };
    const result = await placeToken({
        actor: /** @type {Actor} */(templateActor),
        range,
        count: 1,
        origin: at || originToken,
        title,
        description,
        icon: "fas fa-hammer",
        extraData,
        onSpawn: async () =>
        {
            await weapon.update(/** @type {any} */({ 'system.disabled': true }));
        }
    });

    if (result)
    {
        await stampDeployableSource(result, weapon);
        const api = game.modules.get(MODULE_ID)?.api;
        if (api?.handleTrigger)
        {
            await api.handleTrigger('onDeploy', {
                triggeringToken: originToken || ownerActor.getActiveTokens()?.[0] || null,
                item: weapon,
                deployedTokens: Array.isArray(result) ? result : [result],
                deployType: "throw"
            });
        }
    }

    return result;
}

/**
 * Spawn one or more Hard Cover tokens on the canvas.
 * @param {Token|null} originToken - Origin token for range measurement
 * @param {Object} [options]
 * @param {number|null} [options.range=null] - Max placement range in grid units (null = unlimited)
 * @param {number} [options.count=1] - Number of cover pieces to place
 * @param {number} [options.size=1] - Token size (1 or 2). HP scales with size (10 × size).
 * @param {string} [options.name="Hard Cover"] - Name for the placed token(s)
 * @param {string} [options.title="PLACE HARD COVER"] - Card title
 * @param {string} [options.description=""] - Card description
 * @returns {Promise<Array<TokenDocument>|null>}
 */
export async function spawnHardCover(originToken, options = {})
{
    const {
        range = null,
        count = 1,
        size = 1,
        name = "Hard Cover",
        title = "PLACE HARD COVER",
        description = ""
    } = options;

    const templateActor = await getOrCreateTemplateActor('hardCover');

    if (!templateActor)
    {
        ui.notifications.error(localize('LA.notify.failedToCreateTemplateHardCoverActor'));
        return null;
    }

    // Ensure stats.hp is correct: Lancer derives hp.max from stats.hp, not hp.max directly
    const _templateActor = /** @type {any} */ (templateActor);
    if (_templateActor.system?.stats?.hp !== 10)
        await _templateActor.update({ "system.stats.hp": 10, "system.hp.value": 10, "system.hp.max": 10 });

    const hp = 10 * size;
    const extraData = /** @type {any} */ ({
        name,
        width: size,
        height: size,
        flags: {
            [MODULE_ID]: {
                hardCover: true
            }
        }
    });
    // Override size and HP on the token's synthetic actor via delta
    if (size !== 1)
    {
        extraData.delta = {
            system: {
                stats: { hp, size },
                hp: { value: hp, max: hp, min: 0 }
            }
        };
    }

    const result = await placeToken({
        actor: /** @type {Actor} */ (templateActor),
        range,
        count,
        origin: originToken,
        title,
        description,
        icon: "fas fa-cube",
        extraData
    });
    // provoke immunity is added by the createToken hook on Template Hard Cover tokens
    return result;
}

/**
 * Pick up a thrown weapon token from the scene. Shows a chooseToken card restricted
 * to the owner's thrown weapons. Re-enables the weapon and deletes the deployed token.
 * @param {Token} ownerToken - The token whose actor owns the thrown weapons
 * @returns {Promise<Object|null>} { weaponName, weaponId } or null if cancelled/none found
 */
export async function pickupWeaponToken(ownerToken)
{
    if (!ownerToken?.actor)
    {
        ui.notifications.warn(localize('LA.notify.noValidTokenSelected'));
        return null;
    }

    const ownerActor = ownerToken.actor;
    const thrownTokens = canvas.tokens.placeables.filter(token =>
    {
        const flags = getLAFlags(token.document);
        return flags?.thrownWeapon && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (thrownTokens.length === 0)
    {
        ui.notifications.warn(localize('LA.notify.noThrownWeaponsFoundForThisCharacter'));
        return null;
    }

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: thrownTokens,
        title: localize('LA.deployables.pickUpWeaponTitle'),
        description: localizeFormat('LA.deployables.thrownAvailable', { count: thrownTokens.length }),
        icon: "fas fa-hand"
    });

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = getLAFlags(pickedToken.document);
    const weaponId = flags?.weaponId;
    const weaponName = flags?.weaponName || "Weapon";

    if (game.user.isGM)
    {
        const weapon = ownerActor.items.get(weaponId);
        if (weapon)
            await weapon.update(/** @type {any} */({ 'system.disabled': false }));
        await pickedToken.document.delete();
    }
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "pickupWeapon",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                weaponId,
                ownerActorUuid: ownerActor.uuid,
                weaponName
            }
        });
    }

    ui.notifications.info(localizeFormat('LA.notify.pickedUp', { name: weaponName }));
    return { weaponName, weaponId };
}

function _applyDeployableTypeImage(actorData)
{
    if (deployableArtEnabled())
        return;
    const type = String(actorData?.system?.type ?? '');
    const typeImg = /mine/i.test(type) ? 'systems/lancer/assets/icons/mine.svg'
        : /drone/i.test(type) ? 'systems/lancer/assets/icons/drone.svg'
            : null;
    if (!typeImg)
        return;
    actorData.img = typeImg;
    actorData.prototypeToken = actorData.prototypeToken || {};
    actorData.prototypeToken.texture = { ...(actorData.prototypeToken.texture ?? {}), src: typeImg };
    actorData.prototypeToken.img = typeImg;
}

/**
 * Place a deployable token on the scene with interactive placement.
 * @param {Object} [options={}]
 * @param {Actor|string|Array<Actor|string>} [options.deployable] - A deployable Actor, LID string, or array of them
 * @param {Actor} [options.ownerActor] - The actor that owns the deployable
 * @param {Object|null} [options.systemItem=null] - The system/item that grants the deployable (for use consumption)
 * @param {boolean} [options.consumeUse=false] - Whether to consume a use from systemItem
 * @param {boolean} [options.fromCompendium=false] - Whether the deployable is from a compendium (creates a new actor)
 * @param {number|null} [options.width=null] - Token width override (defaults to deployable.prototypeToken.width)
 * @param {number|null} [options.height=null] - Token height override (defaults to deployable.prototypeToken.height)
 * @param {number} [options.range=1] - Placement range (null for unlimited)
 * @param {number} [options.count=1] - Total number of tokens to place (-1 for unlimited)
 * @param {Token|Object|null} [options.at=null] - Origin override for range measurement
 * @param {string} [options.title="DEPLOY"] - Card title
 * @param {string} [options.description=""] - Card description
 * @param {boolean} [options.noCard=false] - Whether to skip rendering the card
 * @param {number|null} [options.disposition=null] - Token disposition override
 * @param {string|null} [options.team=null] - Token faction team override
 * @returns {Promise<Object|null>} Placement result or null
 */
export async function placeDeployable(options = /** @type {any} */({}))
{
    const {
        deployable: deployableOrLid,
        ownerActor,
        systemItem = null,
        consumeUse = false,
        fromCompendium = false,
        width = null,
        height = null,
        range: rangeOpt = null,
        at = null,
        count: countOpt = null,
        title = "DEPLOY",
        description = "",
        noCard = false,
        disposition: dispositionOpt = null,
        team: teamOpt = null
    } = /** @type {any} */(options);

    const itemFlags = systemItem ? getItemFlags(systemItem) : {};
    const range = rangeOpt ?? itemFlags.deployRange ?? 1;
    const count = countOpt ?? itemFlags.deployCount ?? 1;
    const elevationOffset = options.elevationOffset ?? itemFlags.deployElevationOffset ?? 0;

    if (!ownerActor)
    {
        ui.notifications.error(localize('LA.notify.noOwnerActorSpecified'));
        return null;
    }

    const ownerName = ownerDisplayName(ownerActor);

    const disposition = dispositionOpt ?? ownerActor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
    let team = teamOpt;
    if (team === null || team === undefined)
        team = tfGetTeam(ownerActor.token ?? ownerActor);
    team = team ?? null;

    const originToken = at || ownerActor.getActiveTokens()?.[0] || null;

    const deployableInputs = Array.isArray(deployableOrLid) ? deployableOrLid : [deployableOrLid];

    const isDrone = (actor, item) =>
    {
        if (actor?.system?.type === 'Drone')
            return true;
        const tagHas = (tags) => Array.isArray(tags)
            && tags.some(tag => /drone/i.test(tag?.lid ?? '') || /drone/i.test(tag?.id ?? ''));
        return tagHas(actor?.system?.tags) || tagHas(item?.system?.tags);
    };

    const actorEntries = [];
    let anyDrone = false;
    for (const input of deployableInputs)
    {
        const resolved = await resolveDeployable(input, ownerActor);
        let actualDeployable = resolved.deployable;
        const isFromCompendium = fromCompendium || resolved.source === 'compendium';

        if (!actualDeployable)
        {
            ui.notifications.warn(localizeFormat('LA.notify.deployableNotFound', { input }));
            continue;
        }

        if (isFromCompendium)
        {
            const actorData = /** @type {any} */(actualDeployable.toObject());
            const ownerBaseActor = /** @type {Actor} */(ownerActor.token?.baseActor ?? ownerActor);
            actorData.system.owner = ownerBaseActor.uuid;
            actorData.name = `${actualDeployable.name} [${ownerName}]`;
            actorData.folder = ownerActor.folder?.id;
            actorData.ownership = foundry.utils.duplicate(ownerActor.ownership);

            actorData.prototypeToken = actorData.prototypeToken || {};
            actorData.prototypeToken.disposition = disposition;
            if (team !== null)
            {
                actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                actorData.prototypeToken.flags['token-factions'].team = team;
            }
            actorData.flags = actorData.flags || {};
            _applyDeployableTypeImage(actorData);
            const LancerActor = game.lancer?.LancerActor || Actor;
            actualDeployable = await LancerActor.create(actorData);
            if (!actualDeployable)
            {
                ui.notifications.error(localizeFormat('LA.notify.deployableCreateFailed', { input }));
                continue;
            }
            ui.notifications.info(localizeFormat('LA.notify.created', { name: actorData.name }));
        }

        if (isDrone(actualDeployable, systemItem))
            anyDrone = true;

        const tokenWidth = width ?? actualDeployable.prototypeToken?.width ?? 1;
        const tokenHeight = height ?? actualDeployable.prototypeToken?.height ?? 1;

        actorEntries.push({
            actor: actualDeployable,
            extraData: {
                width: tokenWidth,
                height: tokenHeight,
                actorData: { name: `${actualDeployable.name}` },
                flags: {
                    [MODULE_ID]: {
                        deployedItem: true,
                        deployableName: actualDeployable.name,
                        deployableId: actualDeployable.id,
                        ownerActorUuid: ownerActor.uuid,
                        ownerName: ownerName,
                        systemItemId: systemItem?.id || null
                    }
                }
            }
        });
    }

    if (actorEntries.length === 0)
    {
        ui.notifications.error(localize('LA.notify.noValidDeployablesFound'));
        return null;
    }

    // One deployable passes the actor directly, several pass the array so placeToken shows the actor selector.
    const actorParam = actorEntries.length === 1
        ? actorEntries[0].actor
        : actorEntries;

    const extraDataParam = actorEntries.length === 1
        ? actorEntries[0].extraData
        : {};

    const baseElevation = originToken?.document?.elevation ?? 0;
    const noExplicitRange = rangeOpt == null && itemFlags.deployRange == null;
    const finalRange = (noExplicitRange && anyDrone)
        ? (ownerActor.type === 'pilot' ? 5 : (game.modules.get(MODULE_ID)?.api?.getSensorRange_WithBonus?.(ownerActor) ?? ownerActor.system?.sensor_range ?? 10))
        : range;
    const result = await placeToken({
        actor: actorParam,
        range: finalRange,
        count,
        origin: originToken,
        title,
        description,
        icon: "cci cci-deployable",
        extraData: extraDataParam,
        noCard: noCard,
        disposition,
        team,
        elevation: baseElevation + elevationOffset
    });

    if (result && systemItem)
    {
        const updates = {};

        if (consumeUse)
        {
            let disabled = new Set();
            try
            {
                const { getAutoConsumeDisabled } = await import('./extra-config.js');
                disabled = getAutoConsumeDisabled(systemItem);
            }
            catch (err)
            {
                console.warn('lancer-automations | consume opt-out check failed:', err);
            }
            const uses = systemItem.system?.uses;
            if (uses && typeof uses.value === 'number' && !disabled.has('uses'))
            {
                // Match Lancer 3.1.2+ behaviour: deduct the deploy action's cost (defaults to 1).
                const actions = systemItem.system?.actions ?? [];
                const deployAction = actions.find(/** @type {any} */ act => Array.isArray(act?.deployables) && act.deployables.length);
                const cost = Math.max(1, Number(deployAction?.cost) || 1);
                const minUses = uses.min ?? 0;
                updates["system.uses.value"] = Math.max(uses.value - cost, minUses);
            }
            if (systemItem.system?.charged && !disabled.has('charged'))
                updates["system.charged"] = false;
            if (Object.keys(updates).length > 0)
                await systemItem.update(updates);
        }
    }

    // Play per-deployable FX on each deployed token (requires a source token).
    if (result && originToken)
    {
        const deployedTokens = Array.isArray(result) ? result : [result];
        for (const deployedToken of deployedTokens)
        {
            if (deployedToken)
                playDeployableFX(deployedToken);
        }
    }

    if (result)
    {
        await stampDeployableSource(result, systemItem);
        const api = game.modules.get(MODULE_ID)?.api;
        if (api?.handleTrigger)
        {
            await api.handleTrigger('onDeploy', {
                triggeringToken: originToken,
                item: systemItem,
                deployedTokens: Array.isArray(result) ? result : [result],
                deployType: "deployable"
            });
        }
    }

    return result;
}

/**
 * Find a deployable by LID and place it interactively using placeDeployable.
 * @param {Actor} actor - The owner actor
 * @param {string} deployableLid - The LID of the deployable
 * @param {Object|null} parentItem - The item that grants the deployable (for use consumption)
 * @param {boolean} consumeUse - Whether to consume a use from parentItem
 * @returns {Promise<void>}
 */
export async function deployDeployable(actor, deployableLid, parentItem, consumeUse)
{
    const depInfo = getDeployableInfoSync(deployableLid, actor);
    const sceneId = canvas?.scene?.id;
    const tokens = actor.getActiveTokens?.() || [];
    const sourceToken = tokens.find(token => token?.scene?.id === sceneId) || tokens[0] || null;
    if (sourceToken && depInfo?.activation)
        playActionFxByActivation(depInfo.activation, sourceToken, stripDeployOwner(depInfo.name));
    await _printDeployableCard(parentItem);
    const extraOpts = getExtraDeployableOpts(parentItem ?? actor, deployableLid) || {};
    await placeDeployable({
        deployable: deployableLid,
        ownerActor: actor,
        systemItem: parentItem,
        consumeUse: (consumeUse ?? false) && !_printFlowConsumedUses(parentItem),
        range: extraOpts.range ?? null,
        count: extraOpts.count ?? null,
    });
}

// The card printed above already spends the use when treatGenericPrintAsActivation is on (tg_limited), so don't double-consume here.
function _printFlowConsumedUses(item)
{
    const tags = item?.system?.all_base_tags ?? item?.system?.tags ?? [];
    if (!Array.isArray(tags) || !tags.some(tag => tag?.lid === 'tg_limited'))
        return false;
    return !!getModuleSetting('treatGenericPrintAsActivation');
}

async function _printDeployableCard(parentItem)
{
    if (!parentItem)
        return;
    const begin = game.lancer?.beginItemChatFlow;
    if (typeof begin !== 'function')
        return;
    try
    {
        await begin(parentItem, {});
    }
    catch (error)
    {
        console.warn('lancer-automations | Could not print deployable card:', error);
    }
}

/**
 * Pick a token on the canvas to toggle its owner-link to `ownerToken.actor`.
 * Sets/removes the `lancer-automations.ownerActorUuid` (+ ownerName) flag on the picked token's
 * document, the same flag `placeDeployable` writes and `recallDeployable` reads.
 * Already-linked tokens are marked invalid in the picker (with a "click to UNLINK" warning).
 * @param {Token} ownerToken
 * @returns {Promise<void>}
 */
export async function promptLinkOrUnlinkActor(ownerToken)
{
    const owner = ownerToken?.actor;
    if (!owner)
    {
        ui.notifications.warn(localize('LA.notify.promptLinkNoActor'));
        return;
    }
    const ownerUuid = owner.uuid;
    const isLinkedToOwner = (/** @type {any} */ token) =>
        getLAFlag(token?.document,'ownerActorUuid') === ownerUuid;

    const picked = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        title: localize('LA.deployables.linkUnlinkActorTitle'),
        description: localize('LA.deployables.pickATokenToLinkAlready'),
        icon: 'cci cci-deployable',
        filter: (/** @type {any} */ token) => !isLinkedToOwner(token),
        filterWarning: 'Already linked, click to UNLINK',
    });
    const target = picked?.[0];
    if (!target?.document)
        return;
    if (isLinkedToOwner(target))
    {
        await unsetLAFlag(target.document,'ownerActorUuid');
        await unsetLAFlag(target.document,'ownerName');
        ui.notifications.info(localizeFormat('LA.notify.unlinkedFrom', { target: target.actor?.name ?? target.name, owner: owner.name }));
    }
    else
    {
        await setLAFlag(target.document,'ownerActorUuid', ownerUuid);
        await setLAFlag(target.document,'ownerName', owner.name ?? '');
        ui.notifications.info(localizeFormat('LA.notify.linkedTo', { target: target.actor?.name ?? target.name, owner: owner.name }));
    }
}

/**
 * Show a deployment card for a specific item's deployables. Resolves all deployable LIDs and
 * opens a single placeDeployable session with the actor selector for multi-deployable placement.
 * @param {Object} [options={}]
 * @param {Actor} [options.actor] - The owner actor
 * @param {Object} [options.item] - The system/frame item that has deployables
 * @param {Array} [options.deployableOptions=[]] - Per-index options overrides for placeDeployable. e.g. [{ range: 3, count: 2 }, { range: 1 }]
 * @returns {Promise<boolean>} true if confirmed, null if cancelled
 */
export async function beginDeploymentCard(options = /** @type {any} */({}))
{
    const {
        actor,
        item,
        deployableOptions = []
    } = options;

    if (!actor || !item)
    {
        ui.notifications.warn(localize('LA.notify.actorAndItemAreRequired'));
        return null;
    }

    const deployablesArray = getItemDeployables(item, actor);

    if (deployablesArray.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noDeployablesOn', { name: item.name }));
        return null;
    }

    const isFrameCore = item.type === 'frame';
    let hasUses = false;
    let hasRechargeTag = false;
    let isUncharged = false;

    if (!isFrameCore)
    {
        const uses = item.system?.uses;
        hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
        if (hasUses && uses.value <= 0)
        {
            ui.notifications.warn(localizeFormat('LA.notify.noUsesRemaining', { name: item.name }));
            return null;
        }

        hasRechargeTag = item.system?.tags?.some(tag => tag.lid === "tg_recharge");
        isUncharged = hasRechargeTag && item.system?.charged === false;
        if (isUncharged)
        {
            ui.notifications.warn(localizeFormat('LA.notify.unchargedDeploy', { name: item.name }));
            return null;
        }
    }

    const allLids = [];
    let totalCount = 0;
    let hasCountOverride = false;

    // First range wins, counts sum. Per-deployable extra opts are the next fallback.
    let rangeOpt = null;
    for (let lidIdx = 0; lidIdx < deployablesArray.length; lidIdx++)
    {
        const lid = deployablesArray[lidIdx];
        const idxOpts = deployableOptions[lidIdx] || {};
        const extraOpts = getExtraDeployableOpts(item, lid) || {};
        const depCount = idxOpts.count ?? extraOpts.count;
        if (depCount !== undefined)
            hasCountOverride = true;
        totalCount += depCount ?? 1;
        const effectiveRange = idxOpts.range !== undefined ? idxOpts.range : extraOpts.range;
        if (effectiveRange !== undefined && rangeOpt === null)
            rangeOpt = effectiveRange;
        allLids.push(lid);
    }

    const result = await placeDeployable({
        deployable: allLids,
        ownerActor: actor,
        systemItem: item,
        consumeUse: hasUses,
        range: rangeOpt,
        count: hasCountOverride ? totalCount : undefined,
        title: item.name,
        description: ""
    });

    return result ? true : null;
}

/**
 * Open a dialog menu showing all deployables available to an actor.
 * Allows selecting and deploying them with unlimited range.
 * @param {Actor} actor - The actor whose deployables to show
 * @returns {Promise<void>}
 */
export async function openDeployableMenu(actor)
{
    if (!actor)
    {
        ui.notifications.warn(localize('LA.notify.noActorSpecified'));
        return;
    }

    const allSystemsWithDeployables = actor.items.filter(item =>
        getItemDeployables(item, actor).length > 0
    );
    const actorLevelDeployables = getActorDeployables(actor);

    if (allSystemsWithDeployables.length === 0 && actorLevelDeployables.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noDeployablesFor', { name: actor.name }));
        return;
    }

    const items = [];

    for (const system of allSystemsWithDeployables)
    {
        const isFrameCore = system.type === 'frame';
        const deployablesArray = getItemDeployables(system, actor);

        let uses, hasUses, noUsesLeft, hasRechargeTag, needsRecharge;
        if (isFrameCore)
        {
            uses = null;
            hasUses = false;
            noUsesLeft = false;
            hasRechargeTag = false;
            needsRecharge = false;
        }
        else
        {
            uses = system.system.uses;
            hasUses = uses && typeof uses.max === 'number' && uses.max > 0;
            noUsesLeft = hasUses && uses.value <= 0;
            hasRechargeTag = system.system.tags?.some(tag => tag.lid === "tg_recharge");
            needsRecharge = hasRechargeTag && system.system.charged === false;
        }

        for (const lid of deployablesArray)
        {
            const { deployable, source } = await resolveDeployable(lid, actor);

            if (deployable)
            {
                const usesText = hasUses ? `${uses.value}/${uses.max}` : '';
                const chargesText = hasRechargeTag ? (needsRecharge ? "Uncharged" : "Charged") : "";
                const isFromCompendium = source === 'compendium';
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: deployable.id,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: deployable.name,
                    deployableImg: deployable.img,
                    deployableData: deployable,
                    usesText: usesText,
                    chargesText: chargesText,
                    disabled: noUsesLeft || needsRecharge,
                    needsRecharge: needsRecharge,
                    hasUses: hasUses,
                    fromCompendium: isFromCompendium,
                    tokenWidth: deployable.prototypeToken?.width || 1,
                    tokenHeight: deployable.prototypeToken?.height || 1
                });
            }
            else
            {
                const systemDisplayName = isFrameCore ? `${system.name} - Core System` : system.name;
                items.push({
                    id: `${system.id}_${lid}`,
                    systemId: system.id,
                    deployableId: null,
                    deployableLid: lid,
                    systemName: systemDisplayName,
                    deployableName: `Not found: ${lid}`,
                    deployableImg: 'icons/svg/hazard.svg',
                    usesText: '',
                    chargesText: '',
                    disabled: true,
                    needsRecharge: false,
                    hasUses: false,
                    notFound: true,
                    fromCompendium: false,
                    tokenWidth: 1,
                    tokenHeight: 1
                });
            }
        }
    }

    for (const lid of actorLevelDeployables)
    {
        const { deployable, source } = await resolveDeployable(lid, actor);
        if (deployable)
        {
            const isFromCompendium = source === 'compendium';
            items.push({
                id: `__actor_${lid}`,
                systemId: null,
                deployableId: deployable.id,
                deployableLid: lid,
                systemName: 'Extra Deployables',
                deployableName: deployable.name,
                deployableImg: deployable.img,
                deployableData: deployable,
                usesText: '',
                chargesText: '',
                disabled: false,
                needsRecharge: false,
                hasUses: false,
                fromCompendium: isFromCompendium,
                tokenWidth: deployable.prototypeToken?.width || 1,
                tokenHeight: deployable.prototypeToken?.height || 1
            });
        }
        else
        {
            items.push({
                id: `__actor_${lid}`,
                systemId: null,
                deployableId: null,
                deployableLid: lid,
                systemName: 'Extra Deployables',
                deployableName: `Not found: ${lid}`,
                deployableImg: 'icons/svg/hazard.svg',
                usesText: '',
                chargesText: '',
                disabled: true,
                needsRecharge: false,
                hasUses: false,
                notFound: true,
                fromCompendium: false,
                tokenWidth: 1,
                tokenHeight: 1
            });
        }
    }

    if (items.length === 0)
    {
        ui.notifications.warn(localizeFormat('LA.notify.noDeployablesAvailable', { name: actor.name }));
        return;
    }

    let selectedId = items.find(item => !item.disabled)?.id;
    const isGM = game.user.isGM;
    const content = `
        <style>
            .lancer-items-grid {
                grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
                gap: 10px;
                max-height: 60vh;
                overflow-y: auto;
            }
            .lancer-item-card {
                min-height: 50px;
                padding: 8px 10px;
                padding-top: 20px;
                position: relative;
                overflow: hidden;
            }
            .lancer-item-card.disabled {
                opacity: 0.5;
                cursor: not-allowed;
                border-color: #888;
                background-color: #00000030;
            }
            .lancer-item-card.disabled:hover {
                border-color: #888;
                box-shadow: none;
            }
            .lancer-item-header {
                display: flex;
                align-items: flex-start;
                gap: 6px;
                margin-bottom: 4px;
            }
            .lancer-item-icon {
                width: 32px;
                height: 32px;
                min-width: 32px;
                object-fit: cover;
                border-radius: 3px;
                flex-shrink: 0;
            }
            .lancer-item-name {
                flex: 1;
                font-weight: bold;
                word-wrap: break-word;
                overflow-wrap: break-word;
                line-height: 1.1;
                font-size: 0.95em;
            }
            .lancer-item-system {
                font-size: 0.8em;
                opacity: 0.7;
                margin-top: 1px;
                font-style: italic;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-uses {
                font-size: 0.8em;
                color: #ff6400;
                margin-top: 1px;
                display: flex;
                align-items: center;
                gap: 3px;
            }
            .lancer-item-not-found {
                color: #ff4444;
                font-style: italic;
            }
            .lancer-item-badge {
                position: absolute;
                top: 6px;
                right: 6px;
                background: #ff6400;
                color: white;
                padding: 2px 6px;
                border-radius: 3px;
                font-size: 0.7em;
                font-weight: bold;
                text-transform: uppercase;
            }
            .lancer-item-generate {
                margin-top: 3px;
                padding: 2px 6px;
                background: var(--primary-color);
                color: white;
                border: none;
                border-radius: 2px;
                cursor: pointer;
                font-size: 0.7em;
                width: 100%;
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 2px;
            }
            .lancer-item-generate:hover:not(:disabled) {
                background: #b5242f;
            }
            .lancer-item-generate:disabled {
                opacity: 0.5;
                cursor: not-allowed;
                background: #555;
            }
            .lancer-item-note {
                font-size: 0.65em;
                color: #aaa;
                font-style: italic;
                margin-top: 1px;
            }
        </style>
        <div class="lancer-dialog-base">
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">DEPLOY ACTORS</div>
                <div class="lancer-dialog-subtitle">Select an actor to place on the battlefield.</div>
            </div>
            <div class="lancer-items-grid">
                ${items.map(item => `
                    <div class="lancer-item-card ${item.disabled ? 'disabled' : ''} ${item.id === selectedId ? 'selected' : ''}"
                         data-item-id="${item.id}"
                         title="${item.disabled ? (item.notFound ? 'Deployable not found' : (item.needsRecharge ? 'Uncharged' : 'No uses remaining')) : item.deployableName}">
                        ${item.fromCompendium ? '<div class="lancer-item-badge">Compendium</div>' : ''}
                        <div class="lancer-item-header">
                            <img src="${item.deployableImg}" class="lancer-item-icon" />
                            <div class="lancer-item-name ${item.notFound ? 'lancer-item-not-found' : ''}">
                                ${item.deployableName}
                            </div>
                        </div>
                        <div class="lancer-item-system">
                            <i class="cci cci-system i--sm"></i> ${item.systemName}
                        </div>
                        ${item.usesText ? `<div class="lancer-item-uses"><i class="fas fa-battery-three-quarters"></i> ${item.usesText}</div>` : ''}
                        ${item.chargesText ? `<div class="lancer-item-uses" style="color:#4488ff"><i class="fas fa-bolt"></i> ${item.chargesText}</div>` : ''}
                        ${item.fromCompendium ? `
                            <button class="lancer-item-generate" data-item-id="${item.id}" ${!isGM ? 'disabled' : ''}>
                                ${isGM ? '<i class="fas fa-plus"></i> Generate' : '<i class="fas fa-lock"></i> GM Only'}
                            </button>
                            ${!isGM ? '<div class="lancer-item-note">GM must create</div>' : ''}
                        ` : ''}
                    </div>
                `).join('')}
            </div>
        </div>
    `;

    const dialog = new Dialog({
        title: localize("LA.deployables.deployTitle"),
        content: content,
        buttons: {
            deploy: {
                icon: '<i class="cci cci-deployable"></i>',
                label: localize("LA.deployables.deploy"),
                callback: async () =>
                {
                    const item = items.find(candidate => candidate.id === selectedId);
                    if (!item || item.disabled || !item.deployableId)
                        return;
                    const system = item.systemId ? actor.items.get(item.systemId) : null;
                    const holder = system ?? actor;
                    const extraOpts = getExtraDeployableOpts(holder, item.deployableLid) || {};

                    await placeDeployable({
                        deployable: item.fromCompendium ? item.deployableData : game.actors.get(item.deployableId),
                        ownerActor: actor,
                        systemItem: system,
                        consumeUse: item.hasUses,
                        fromCompendium: item.fromCompendium,
                        width: item.tokenWidth,
                        height: item.tokenHeight,
                        range: extraOpts.range ?? null,
                        count: extraOpts.count ?? null,
                        at: null,
                        title: localizeFormat('LA.deployables.deployTitleFor', { name: item.deployableName }),
                        description: ""
                    });
                }
            },
            cancel: cancelButton()
        },
        default: "deploy",
        render: (html) =>
        {
            html.find('.lancer-item-card:not(.disabled)').on('click', function ()
            {
                html.find('.lancer-item-card').removeClass('selected');
                $(this).addClass('selected');
                selectedId = $(this).data('item-id');
            });
            html.find('.lancer-item-card:not(.disabled)').on('dblclick', function ()
            {
                selectedId = $(this).data('item-id');
                html.closest('.dialog').find('.dialog-button.deploy').click();
            });

            html.find('.lancer-item-generate').on('click', async function (event)
            {
                event.stopPropagation();
                const itemId = $(this).data('item-id');
                const item = items.find(candidate => candidate.id === itemId);

                if (!item?.deployableData || !game.user.isGM)
                    return;

                const actorData = item.deployableData.toObject();

                const ownerName = ownerDisplayName(actor);

                const ownerBaseActor = actor.token?.baseActor ?? actor;
                actorData.system.owner = ownerBaseActor.uuid;
                actorData.name = `${item.deployableName} [${ownerName}]`;
                actorData.folder = actor.folder?.id;
                actorData.ownership = foundry.utils.duplicate(actor.ownership);

                actorData.prototypeToken = actorData.prototypeToken || {};
                actorData.prototypeToken.disposition = actor.prototypeToken?.disposition ?? CONST.TOKEN_DISPOSITIONS.NEUTRAL;
                const actorTeam = tfGetTeam(actor.token ?? actor);
                if (actorTeam !== null)
                {
                    actorData.prototypeToken.flags = actorData.prototypeToken.flags || {};
                    actorData.prototypeToken.flags['token-factions'] = actorData.prototypeToken.flags['token-factions'] || {};
                    actorData.prototypeToken.flags['token-factions'].team = actorTeam;
                }
                actorData.flags = actorData.flags || {};
                _applyDeployableTypeImage(actorData);
                const LancerActor = game.lancer?.LancerActor || Actor;
                const newActor = await LancerActor.create(actorData);
                if (newActor)
                {
                    ui.notifications.info(localizeFormat('LA.notify.created', { name: actorData.name }));
                    item.deployableId = newActor.id;
                    item.deployableData = newActor;
                    item.fromCompendium = false;

                    const card = html.find(`.lancer-item-card[data-item-id="${itemId}"]`);
                    card.find('.lancer-item-badge').remove();
                    card.find('.lancer-item-generate').remove();
                    card.find('.lancer-item-note').remove();
                }
            });
        }
    }, {
        width: 680,
        height: "auto",
        classes: ['lancer-dialog-base', 'lancer-dialog-base', 'lancer-no-title']
    });

    dialog.render(true);
}

/**
 * Recall (pick up) a deployed deployable from the scene. Shows a chooseToken card
 * restricted to tokens deployed by the owner. Deployables WITHOUT system.recall are
 * highlighted in red as a warning. Deletes the token on recall.
 * @param {Token} ownerToken - The token whose actor owns the deployables
 * @returns {Promise<Object|null>} { deployableName, deployableId } or null if cancelled/none found
 */
export async function recallDeployable(ownerToken)
{
    if (!ownerToken?.actor)
    {
        ui.notifications.warn(localize('LA.notify.noValidTokenSelected'));
        return null;
    }

    const ownerActor = ownerToken.actor;
    const deployedTokens = canvas.tokens.placeables.filter(token =>
    {
        const flags = getLAFlags(token.document);
        return flags?.deployedItem && flags?.ownerActorUuid === ownerActor.uuid;
    });

    if (deployedTokens.length === 0)
    {
        ui.notifications.warn(localize('LA.notify.noDeployedItemsFoundForThisCharacter'));
        return null;
    }

    // Highlight tokens that lack system.recall in red as a warning.
    const recallHighlights = [];
    for (const token of deployedTokens)
    {
        const tokenActor = token.actor;
        if (!tokenActor?.system?.recall)
        {
            const hl = new PIXI.Graphics();
            hl.lineStyle(gridLineWidth(2), 0xff4444, 0.8);
            hl.beginFill(0xff4444, 0.25);
            if (isHexGrid())
            {
                const offsets = getOccupiedOffsets(token);
                for (const offset of offsets)
                    drawHexAt(hl, offset.col, offset.row);
            }
            else
            {
                const gridSize = canvas.grid.size;
                hl.drawRect(token.document.x, token.document.y,
                    token.document.width * gridSize, token.document.height * gridSize);
            }
            hl.endFill();
            if (canvas.tokens?.parent)
                canvas.tokens.parent.addChildAt(hl, canvas.tokens.parent.getChildIndex(canvas.tokens));
            else
                canvas.stage.addChild(hl).eventMode = 'none';
            recallHighlights.push(hl);
        }
    }

    const selected = await chooseToken(ownerToken, {
        count: 1,
        includeSelf: false,
        selection: deployedTokens,
        title: localize('LA.deployables.recallDeployableTitle'),
        description: localizeFormat('LA.deployables.deployedAvailable', { count: deployedTokens.length }),
        icon: "fas fa-hand"
    });

    for (const hl of recallHighlights)
        hl.destroy({ children: true });

    if (!selected || selected.length === 0)
        return null;

    const pickedToken = selected[0];
    const flags = getLAFlags(pickedToken.document);
    const deployableName = flags?.deployableName || "Deployable";
    const deployableId = flags?.deployableId;

    if (game.user.isGM)
        await pickedToken.document.delete();
    else
    {
        game.socket.emit('module.lancer-automations', {
            action: "recallDeployable",
            payload: {
                sceneId: canvas.scene.id,
                tokenId: pickedToken.document?.id || pickedToken.id,
                ownerActorUuid: ownerActor.uuid,
                deployableName
            }
        });
    }

    ui.notifications.info(localizeFormat('LA.notify.recalled', { name: deployableName }));
    return { deployableName, deployableId };
}

/**
 * createToken hook handler. With the linkManualDeploy setting on, links a hand-placed
 * deployable token to its owner (auto with one candidate, chooseToken prompt otherwise),
 * then fires onDeploy.
 * @param {TokenDocument} tokenDocument
 */
export async function handleManualDeployLink(tokenDocument, { force = false } = {})
{
    if (!force && !getModuleSetting('linkManualDeploy'))
        return;
    if (tokenDocument.actor?.type !== 'deployable')
        return;
    // Skip if already linked by placeDeployable
    if (getLAFlags(tokenDocument)?.deployedItem)
        return;

    const deployableActor = tokenDocument.actor;
    const deployableLid = deployableActor?.system?.lid;
    if (!deployableLid)
        return;

    const allTokens = canvas.tokens?.placeables ?? [];
    let ownerToken = null;
    let ownerActor = null;

    // Mech/pilot deployables carry their owner in system.owner.
    const ownerUuidRaw = deployableActor.system?.owner;
    const ownerUuid = typeof ownerUuidRaw === 'string'
        ? ownerUuidRaw
        : (ownerUuidRaw?.id ?? null);
    const directOwner = ownerUuid ? await fromUuid(ownerUuid) : null;
    if (directOwner && (directOwner.type === 'mech' || directOwner.type === 'pilot'))
    {
        ownerActor = directOwner;
        ownerToken = allTokens.find(token => token.actor?.uuid === directOwner.uuid) ?? null;
        if (!ownerToken)
        {
            // Owner has no token on this scene, don't link
            return;
        }
    }
    else
    {
        // NPC path: filter scene tokens whose actor owns an item producing this LID
        const candidateTokens = allTokens.filter(token =>
        {
            if (token.document.id === tokenDocument.id)
                return false;
            if (!token.actor)
                return false;
            return token.actor.items.some(item => getAllItemDeployables(item).includes(deployableLid));
        });

        if (candidateTokens.length === 0)
            return;

        if (candidateTokens.length === 1)
            ownerToken = candidateTokens[0];
        else
        {
            const deployableToken = canvas.tokens.get(tokenDocument.id);
            const picked = await chooseToken(deployableToken ?? candidateTokens[0], {
                count: 1,
                includeSelf: false,
                selection: candidateTokens,
                title: localize('LA.deployables.linkDeployableTitle'),
                description: localizeFormat('LA.deployables.whichTokenOwns', { name: deployableActor.name }),
                icon: "cci cci-deployable"
            });
            if (!picked || picked.length === 0)
                return;
            ownerToken = picked[0];
        }
        ownerActor = ownerToken.actor;
    }

    const ownerName = ownerActor.name ?? "";

    const candidateItems = ownerActor.items.filter(item =>
        getAllItemDeployables(item).includes(deployableLid)
    );
    let systemItem = null;
    if (candidateItems.length === 1)
        systemItem = candidateItems[0];
    else if (candidateItems.length > 1)
    {
        systemItem = await pickItem(candidateItems, {
            title: localize('LA.deployables.linkDeployableTitle'),
            description: localizeFormat('LA.deployables.whichItemDeployed', { name: deployableActor.name }),
            icon: "cci cci-deployable",
            relatedToken: ownerToken
        });
    }

    await tokenDocument.update({
        flags: {
            [MODULE_ID]: {
                deployedItem: true,
                deployableName: deployableActor.name,
                deployableId: deployableActor.id,
                ownerActorUuid: ownerActor.uuid,
                ownerName,
                systemItemId: systemItem?.id ?? null,
                sourceItemUuid: systemItem?.uuid ?? null
            }
        }
    });

    const api = game.modules.get(MODULE_ID)?.api;
    if (api?.handleTrigger)
    {
        const deployableToken = canvas.tokens.get(tokenDocument.id);
        await api.handleTrigger('onDeploy', {
            triggeringToken: ownerToken,
            item: systemItem,
            deployedTokens: deployableToken ? [deployableToken] : [],
            deployType: "deployable"
        });
    }
}
