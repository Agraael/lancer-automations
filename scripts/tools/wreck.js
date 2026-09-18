/* global CONST, Hooks, console, game, canvas, loadTexture, FilePicker, TokenMagic, Sequence, foundry */

import { MODULE_ID } from './constants.js';
import { getModuleSetting } from './settings-utils.js';
import { laTokenGameplayHeight } from './token-height.js';
import { getLAFlag, setLAFlag, unsetLAFlag, getLAFlags } from './flag-utils.js';
import { escapeHtml as _escapeText, localize, localizeFormat } from './string-utils.js';
import { FLAG_PORTRAIT_MODE, FLAG_PORTRAIT_IMG, FLAG_PORTRAIT_MECH_PILOT, PORTRAIT_MODES, PORTRAIT_PILOT } from '../tah/portrait.js';

function log(...args)
{
    console.log(`${MODULE_ID} | wreck |`, ...args);
}

// Deletes must wait for StructureFlow to finish; downstream steps (printStructureCard, etc.) call fromUuid on the token.

const _activeStructureFlows = new Map(); // actorUuid -> { promise, resolve }

Hooks.on('lancer.preFlow.StructureFlow', (flow) =>
{
    const uuid = flow?.state?.actor?.uuid;
    if (!uuid)
        return;
    let resolve;
    const promise = new Promise(resolver =>
    {
        resolve = resolver;
    });
    _activeStructureFlows.set(uuid, { promise, resolve });
});

Hooks.on('lancer.postFlow.StructureFlow', (flow) =>
{
    const uuid = flow?.state?.actor?.uuid;
    if (!uuid)
        return;
    const entry = _activeStructureFlows.get(uuid);
    if (entry)
    {
        entry.resolve();
        _activeStructureFlows.delete(uuid);
    }
});

async function waitForStructureFlow(actorUuid, timeoutMs = 3000)
{
    const entry = _activeStructureFlows.get(actorUuid);
    if (!entry)
        return;
    await Promise.race([
        entry.promise,
        new Promise(resolve => setTimeout(resolve, timeoutMs)),
    ]);
}

// Stop LWFX from playing the stock crush sound on the killing blow; our wreck FX already covers it.
let _lwfxStructWrapped = false;

function _shouldSuppressLwfxStructure(flow)
{
    if (!getModuleSetting('enableWrecks'))
        return false;
    return flow?.state?.data?.remStruct === 0;
}

function _wrapLwfxStructureHook()
{
    const hookName = 'lancer.postFlow.StructureFlow';
    const listeners = Hooks.events?.[hookName];
    if (!Array.isArray(listeners) || listeners.length === 0)
        return false;
    const lwfxEntry = listeners.find(listener =>
    {
        try
        {
            return /_isTriggerOnAbortedFlow/.test(listener?.fn?.toString?.() ?? '');
        }
        catch
        {
            return false;
        }
    });
    if (!lwfxEntry)
        return false;
    const originalFn = lwfxEntry.fn;
    Hooks.off(hookName, lwfxEntry.id);
    Hooks.on(hookName, async (flow, isContinue) =>
    {
        if (_shouldSuppressLwfxStructure(flow))
        {
            log(`Skipping LWFX structure FX, wreck is handling it (${flow?.state?.actor?.name ?? '?'})`);
            return;
        }
        return originalFn(flow, isContinue);
    });
    log('LWFX StructureFlow hook wrapped');
    return true;
}

Hooks.once('ready', () =>
{
    if (!getModuleSetting('enableWrecks'))
        return;
    if (!game.modules.get('lancer-weapon-fx')?.active)
        return;
    // Wait a tick so LWFX has finished registering its hook.
    setTimeout(() =>
    {
        if (_lwfxStructWrapped)
            return;
        _lwfxStructWrapped = _wrapLwfxStructureHook();
    }, 0);
});

// Macro effect throttle
let _macroThrottle = 0;
let _macroCount = 10;

async function macroEffect(name, actor, token, enable)
{
    const suffix = enable ? 'apply' : 'remove';
    const macro = game.macros.find(macroEntry => macroEntry.name === `${name}.${suffix}`);
    if (!macro)
        return;
    const now = +new Date();
    if (now - _macroThrottle > 500)
    {
        _macroCount = 10;
        _macroThrottle = now;
        await macro.execute({ token, actor });
    }
    else if (_macroCount > 0)
    {
        _macroCount--;
        await macro.execute({ token, actor });
    }
}

// Category detection

export function getTokenCategory(token)
{
    const actor = token.actor ?? game.actors.find(candidateActor => candidateActor.id === token.document?.actorId);
    if (!actor)
        return 'mech';
    if (actor.type === 'pilot')
        return 'pilot';
    const items = actor.items ?? [];
    const hasLid = (lid) => items.some(item => item.system?.lid === lid);
    if (items.some(item => item.type === 'npc_template' && /vehicle/i.test(item.system?.lid ?? '')))
        return 'vehicle';
    if (hasLid('npcc_squad'))
        return 'squad';
    if (hasLid('npcc_monstrosity'))
        return 'monstrosity';
    if (hasLid('npcc_human') || hasLid('npcc_specialist'))
        return 'human';
    // Any LCP class tagged role: "biological" (Brute, Megafauna, Parafauna, ...)
    if (items.some(item => item.system?.role === 'biological'))
        return 'biological';
    return 'mech';
}

const BIO_CATEGORIES = new Set(['biological', 'human', 'squad', 'monstrosity', 'pilot']);

export function isBiological(token)
{
    return BIO_CATEGORIES.has(getTokenCategory(token));
}

function getWreckMode(category)
{
    const settingCat = (category === 'squad' || category === 'pilot') ? 'human' : category;
    try
    {
        return getModuleSetting(`wreckMode_${settingCat}`) || 'token';
    }
    catch
    {
        return 'token';
    }
}

/** @returns {'none'|'terrain'|'aura'} */
function getWreckTerrainMode(category)
{
    const settingCat = (category === 'squad' || category === 'pilot') ? 'human' : category;
    let raw;
    try
    {
        raw = getModuleSetting(`wreckTerrain_${settingCat}`);
    }
    catch
    {
        raw = null;
    }
    // Legacy boolean storage: true=terrain, false=none.
    if (raw === true)
        return 'terrain';
    if (raw === false)
        return 'none';
    if (raw === 'terrain' || raw === 'aura' || raw === 'none')
        return raw;
    return (category === 'mech' || category === 'vehicle' || category === 'monstrosity') ? 'aura' : 'none';
}

function buildWreckAuraFlag()
{
    let color = '#8B4513';
    let fillOpacity = 0.2;
    try
    {
        color = getModuleSetting('wreckAuraColor') || color;
        const raw = Number(getModuleSetting('wreckAuraOpacity'));
        if (Number.isFinite(raw))
            fillOpacity = Math.min(1, Math.max(0, raw));
    }
    catch
    { /* settings not ready */ }

    const aura = {
        _v: 3,
        id: foundry.utils.randomID(),
        name: 'LA_Wreck_Aura',
        enabled: true,
        clientDefaultHidden: false,
        unified: false,
        onlyEnabledInCombat: false,
        keyPressMode: 'DISABLED',
        keyToPress: 'AltLeft',
        radius: 0,
        innerRadius: '',
        position: 'CENTER',
        lineType: 0,
        lineWidth: 4,
        lineColor: color,
        lineColorAnimation: null,
        lineOpacity: Math.min(1, fillOpacity * 4),
        lineDashSize: 15,
        lineGapSize: 10,
        lineDashOffsetAnimation: 0,
        radiusOffset: 0,
        fillType: 2,
        fillColor: color,
        fillColorAnimation: null,
        fillOpacity,
        fillTexture: 'modules/terrain-height-tools/textures/hatching-skullcrossbones.png',
        fillTextureOffset: { x: 0, y: 0 },
        fillTextureOffsetAnimation: { x: 5, y: 5 },
        fillTextureScale: { x: 50, y: 50 },
        ownerVisibility: { default: true, hovered: true, controlled: true, dragging: true, targeted: true, turn: true },
        nonOwnerVisibility: { default: true, hovered: true, controlled: true, dragging: true, targeted: true, turn: true },
        effects: [],
        macros: [],
        sequencerEffects: [],
        terrainHeightTools: { rulerOnDrag: 'NONE', targetTokens: '', onlyWhenAltPressed: false, onlyWhenTargeted: false },
        elevationAware: false,
        movementPenalty: 1,
        visibilityMode: 'ALWAYS',
    };
    return { 'grid-aware-auras': { auras: [aura] } };
}

const CATEGORY_FALLBACKS = {
    squad: ['squad', 'human', 'biological'],
    human: ['human', 'biological'],
    pilot: ['human', 'biological'],
    biological: ['biological'],
    monstrosity: ['monstrosity', 'biological'],
    vehicle: ['vehicle'],
    mech: [],
};

// these fall back to the bare mech pool when their own folders are empty
const BARE_FALLBACK_CATEGORIES = new Set(['mech', 'vehicle']);

function isSquad(token)
{
    return getTokenCategory(token) === 'squad';
}

// Asset resolution

async function _browseFiles(path)
{
    try
    {
        const result = await FilePicker.browse('data', path);
        return result.files ?? [];
    }
    catch
    {
        return [];
    }
}

function _randomFile(files)
{
    if (!files || files.length === 0)
        return null;
    return files[Math.floor(Math.random() * files.length)];
}

function _getWreckBasePath()
{
    try
    {
        const custom = getModuleSetting('wreckAssetsPath');
        if (custom && custom.trim())
            return custom.trim();
    }
    catch
    { /* fall through */ }
    return `modules/${MODULE_ID}/wrecks`;
}

async function _resolveAssetWithFallback(subDir, category)
{
    const basePath = _getWreckBasePath();
    const chain = CATEGORY_FALLBACKS[category] ?? [];
    for (const fallbackCategory of chain)
    {
        const files = await _browseFiles(`${basePath}/${subDir}/${fallbackCategory}`);
        if (files.length > 0)
            return _randomFile(files);
    }
    if (BARE_FALLBACK_CATEGORIES.has(category))
    {
        const fallback = await _browseFiles(`${basePath}/${subDir}`);
        return _randomFile(fallback);
    }
    return null;
}

async function _resolveMaybeFolder(path)
{
    if (!path || /\.[a-z0-9]{2,5}$/i.test(path))
        return path;
    return _randomFile(await _browseFiles(path)) || path;
}

async function getCorpseImage(category, size = 1)
{
    if (size < 1)
        size = 1;
    if (size > 3)
        size = 3;
    return _resolveAssetWithFallback(`s${size}`, category);
}
async function getCorpseEffect(category)
{
    return _resolveAssetWithFallback('effects', category);
}
async function getCorpseSound(category)
{
    return _resolveAssetWithFallback('audio', category);
}

async function getWreckImage(size)
{
    if (size < 1)
        size = 1;
    if (size > 3)
        size = 3;
    return _resolveAssetWithFallback(`s${size}`, 'mech');
}
async function getWreckEffect()
{
    return _resolveAssetWithFallback('effects', 'mech');
}
async function getWreckSound()
{
    return _resolveAssetWithFallback('audio', 'mech');
}

// Terrain

function getTokenCells(token)
{
    return game.modules.get(MODULE_ID)?.api?.getTokenCells?.(token) ?? [];
}

async function spawnDifficultTerrain(token)
{
    if (!game.modules.get('terrain-height-tools')?.active)
        return;
    const terrainTypeId = getModuleSetting('wreckTerrainType');
    if (!terrainTypeId)
        return;
    try
    {
        const terrainAPI = globalThis.terrainHeightTools;
        if (!terrainAPI)
            return;
        const rawHeight = laTokenGameplayHeight(token.document);
        const terrainHeight = Math.floor(rawHeight * 2) / 2;
        const cells = getTokenCells(token);
        if (cells.length === 0)
            return;
        const terrainTypes = terrainAPI.getTerrainTypes?.() || [];
        // Each cell gets its own elevation based on the ground below it.
        for (const [row, col] of cells)
        {
            const existing = terrainAPI.getCell(col, row) || [];
            let maxHeight = 0;
            for (const terrainEntry of existing)
            {
                const terrainType = terrainTypes.find(candidateType => candidateType.id === terrainEntry.terrainTypeId);
                if (terrainType?.usesHeight && terrainType?.isSolid)
                    maxHeight = Math.max(maxHeight, (terrainEntry.elevation || 0) + (terrainEntry.height || 0));
            }
            await terrainAPI.paintCells([[row, col]], {
                id: terrainTypeId,
                height: terrainHeight,
                elevation: maxHeight
            }, { mode: 'additiveMerge' });
        }
    }
    catch (e)
    {
        console.error(`${MODULE_ID} | wreck terrain error:`, e);
    }
}

// Template actor

async function getOrCreateWreckActor()
{
    const WRECK_NAME = 'Template Wreck';
    let actor = game.actors.find(candidateActor => candidateActor.name === WRECK_NAME && candidateActor.type === 'deployable');
    if (actor)
        return actor;
    actor = await Actor.create({
        name: WRECK_NAME,
        type: 'deployable',
        img: `modules/${MODULE_ID}/icons/tombstone.svg`,
        prototypeToken: {
            actorLink: false,
            displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
            displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
            texture: { src: `modules/${MODULE_ID}/icons/tombstone.svg` },
            flags: { [MODULE_ID]: { awarenessMode: 'simple' } },
        },
    });
    log('Created Template Wreck actor');
    return actor;
}

// Preload

export async function preLoadImageForAll(src, push = false)
{
    if (!src || !src.trim())
        return src;
    if (!/\.[a-z0-9]{2,5}$/i.test(src))
        return src;
    if (push)
        game.socket.emit(`module.${MODULE_ID}`, { action: 'preLoadImageForAll', payload: src });
    // v13 namespaced loadTexture under foundry.canvas; the bare global is deprecated.
    const load = /** @type {any} */ (foundry).canvas?.loadTexture ?? /** @type {any} */ (globalThis).loadTexture;
    try
    {
        await load(src);
    }
    catch (err)
    {
        log(`Failed to preload ${src}:`, err);
    }
    return src;
}

// Core wreck logic

export async function updateStructure(token)
{
    let response = '';
    const structure = token.actor.system.structure.value;
    if (structure <= 0)
    {
        response = `${token.name} structure is zero or less.`;
        if (game.combat && token.combatant && getModuleSetting('enableRemoveFromCombat'))
        {
            log(`${token.name} is dead, removing from combat.`);
            await game.combat.combatants.get(token.combatant._id)?.delete();
        }
        const objectHP = Math.min(4, token.actor.system.size ?? 1) * 10;
        await token.actor.update({
            system: {
                hp: { value: objectHP, max: objectHP },
                overshield: { value: 0 },
                heat: { value: 0 },
                burn: 0,
            }
        });
        log(`${token.name} is a wreck!`);
        token = await wreckIt(token);
        if (isSquad(token) && getModuleSetting('squadLostOnDeath'))
            await token.actor.toggleStatusEffect('mia', { active: true, overlay: true });
        if (token)
            await macroEffect('Wreck', token.actor, token, true);
    }
    else
    {
        response = `${token.name} structure is greater than zero.`;
        if (isSquad(token) && getModuleSetting('squadLostOnDeath'))
            await token.actor.toggleStatusEffect('mia', { active: false, overlay: true });
        if (game.combat && !token.combatant && getModuleSetting('enableRemoveFromCombat'))
            await token.document.toggleCombatant();
        await macroEffect('Wreck', token.actor, token, false);
    }
    return response;
}

function resolveWreckFaction(token)
{
    const choice = getModuleSetting('wreckFactionOnDeath') || 'same';
    const origDisposition = token.document.disposition;
    const origFlag = token.document.flags?.['token-factions'] ?? null;

    if (choice === 'same')
        return { disposition: origDisposition, factionsFlag: origFlag };
    if (choice === 'neutral')
        return { disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL, factionsFlag: null };

    const teams = game.settings.settings.has('token-factions.team-setup')
        ? (game.settings.get('token-factions', 'team-setup') || [])
        : [];
    const target = teams.find(team => team.id === choice);
    if (target)
    {
        const disposition = (target.gmDisposition !== undefined && target.gmDisposition !== null)
            ? parseInt(target.gmDisposition)
            : CONST.TOKEN_DISPOSITIONS.NEUTRAL;
        return { disposition: disposition, factionsFlag: { ...(origFlag || {}), team: target.id } };
    }
    return { disposition: CONST.TOKEN_DISPOSITIONS.NEUTRAL, factionsFlag: null };
}

async function wreckIt(token)
{
    const isDead = getLAFlag(token.document,'isDead')
        || getLAFlag(token.document,'isWreck');
    if (isDead)
    {
        log(`${token.name} is already wrecked.`);
        return token;
    }
    log(`Wrecking ${token.name}!`);
    if (typeof TokenMagic !== 'undefined')
        await TokenMagic.deleteFilters(token);

    const category = getTokenCategory(token);
    const wreckLabel = isBiological(token) ? 'Corpse' : 'Wreck';

    const spawnWreckImage = getLAFlag(token.document,'spawnWreckImage') ?? true;
    const playWreckSound = getLAFlag(token.document,'playWreckSound') ?? true;
    const playWreckEffect = getLAFlag(token.document,'playWreckEffect') ?? true;
    const terrainOverride = getLAFlag(token.document,'terrainOverride');
    // Per-token override accepts: 'none'/'terrain'/'aura' (explicit), 'yes'/'no' (legacy boolean).
    const categoryMode = getWreckTerrainMode(category);
    let terrainMode = categoryMode;
    if (terrainOverride === 'no')
        terrainMode = 'none';
    else if (terrainOverride === 'yes')
        terrainMode = categoryMode === 'none' ? 'terrain' : categoryMode;
    else if (terrainOverride === 'terrain' || terrainOverride === 'aura' || terrainOverride === 'none')
        terrainMode = terrainOverride;
    const shouldSpawnTerrain = terrainMode === 'terrain';
    const shouldAttachAura = terrainMode === 'aura';

    const imagePath = await _resolveMaybeFolder(getLAFlag(token.document,'wreckImgPath'));
    const effectPath = await _resolveMaybeFolder(getLAFlag(token.document,'wreckEffectPath'));
    const soundPath = await _resolveMaybeFolder(getLAFlag(token.document,'wreckSoundPath'));
    const wreckScale = getLAFlag(token.document,'wreckScale') ?? 1;

    const tokenWreckMode = getLAFlag(token.document,'wreckMode');
    const wreckMode = (tokenWreckMode && tokenWreckMode !== 'default')
        ? tokenWreckMode
        : getWreckMode(category);
    if (wreckMode === 'none')
    {
        log(`${token.name} wreck skipped (mode = none)`);
        return token;
    }
    const tileWreck = wreckMode === 'tile';

    if (tileWreck)
    {
        new Sequence()
            .sound().file(soundPath).volume(getModuleSetting('wreckMasterVolume') ?? 1).playIf(!!soundPath && playWreckSound && getModuleSetting('enableWreckAudio') && (getModuleSetting('wreckMasterVolume') ?? 1) > 0)
            .effect().file(effectPath).scaleToObject(wreckScale * 2.25).atLocation(token).mirrorX(Math.random() > 0.5).waitUntilFinished(-500)
            .playIf(!!effectPath && playWreckEffect && getModuleSetting('enableWreckAnimation'))
            .thenDo(async () =>
            {
                const gridSize = canvas.scene.grid.size;
                const newWidth = token.document.width * gridSize * wreckScale;
                const newHeight = token.document.height * gridSize * wreckScale;
                const newX = token.document.x - (newWidth - token.w) / 2;
                const newY = token.document.y - (newHeight - token.h) / 2;
                if (spawnWreckImage && imagePath)
                {
                    canvas.scene.createEmbeddedDocuments('Tile', [{
                        x: newX,
                        y: newY,
                        height: newHeight,
                        width: newWidth,
                        texture: { src: imagePath },
                        flags: { [MODULE_ID]: { isWreck: true, tokenDocument: token.document.toObject() } }
                    }]);
                }
                if (shouldSpawnTerrain)
                    spawnDifficultTerrain(token);
                await waitForStructureFlow(token.actor?.uuid);
                token.document.delete();
            })
            .play();
    }
    else
    {
        new Sequence()
            .sound().file(soundPath).volume(getModuleSetting('wreckMasterVolume') ?? 1).playIf(!!soundPath && playWreckSound && getModuleSetting('enableWreckAudio') && (getModuleSetting('wreckMasterVolume') ?? 1) > 0)
            .effect().file(effectPath).scaleToObject(2.25).atLocation(token).mirrorX(Math.random() > 0.5).waitUntilFinished(-500)
            .playIf(!!effectPath && playWreckEffect && getModuleSetting('enableWreckAnimation'))
            .thenDo(async () =>
            {
                try
                {
                    if (spawnWreckImage)
                    {
                        const wreckActor = await getOrCreateWreckActor();
                        if (wreckActor)
                        {
                            const gameplaySize = token.actor?.system?.size ?? 1;
                            const category = getTokenCategory(token);
                            const fragile = category === 'human' || category === 'pilot' || category === 'squad';
                            const wreckHP = fragile ? 1 : Math.min(4, gameplaySize) * 10;
                            const wreckFaction = resolveWreckFaction(token);
                            const tokenData = {
                                name: `${token.name} ${wreckLabel}`,
                                x: token.document.x,
                                y: token.document.y,
                                width: token.document.width,
                                height: token.document.height,
                                shape: token.document.shape,
                                lockRotation: token.document.lockRotation,
                                rotation: token.document.rotation,
                                disposition: wreckFaction.disposition,
                                displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                                displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
                                delta: {
                                    system: {
                                        stats: { hp: wreckHP, size: gameplaySize },
                                        hp: { value: wreckHP, max: wreckHP, min: 0 },
                                    }
                                },
                                flags: {
                                    [MODULE_ID]: {
                                        isWreck: true,
                                        tokenDocument: token.document.toObject(),
                                    },
                                    lancer: {
                                        manual_token_size: token.document.getFlag('lancer', 'manual_token_size') ?? false,
                                    },
                                    ...(wreckFaction.factionsFlag ? { 'token-factions': wreckFaction.factionsFlag } : {}),
                                    ...(shouldAttachAura && game.modules.get('grid-aware-auras')?.active ? buildWreckAuraFlag() : {}),
                                }
                            };
                            const textureSrc = imagePath || `modules/${MODULE_ID}/icons/tombstone.svg`;
                            tokenData.texture = { src: textureSrc, scaleX: wreckScale, scaleY: wreckScale };
                            const wreckToken = await wreckActor.getTokenDocument(tokenData);
                            if (game.user.isGM)
                                await canvas.scene.createEmbeddedDocuments('Token', [wreckToken]);
                            else
                            {
                                game.socket.emit(`module.${MODULE_ID}`, {
                                    action: 'createTokens',
                                    payload: { sceneId: canvas.scene.id, tokenDataArray: [wreckToken.toObject()] }
                                });
                            }
                        }
                    }
                    if (shouldSpawnTerrain)
                        spawnDifficultTerrain(token);
                    await waitForStructureFlow(token.actor?.uuid);
                    token.document.delete();
                }
                catch (e)
                {
                    console.error(`${MODULE_ID} | wreckIt error:`, e);
                }
            })
            .play();
    }
    return token;
}

// Resurrect

export async function resurrect(token)
{
    const isWreck = getLAFlag(token.document,'isWreck');
    if (!isWreck)
    {
        log(`${token.name} is not a wreck.`);
        return token;
    }
    log(`Resurrecting ${token.name}!`);
    const tokenData = getLAFlag(token.document,'tokenDocument');
    if (!tokenData)
        return token;
    const actor = game.actors.get(tokenData.actorId);
    if (!actor)
    {
        log(`No actor found for wreck token ${token.name}`);
        return token;
    }
    delete tokenData._id;
    tokenData.x = token.document.x;
    tokenData.y = token.document.y;
    const fullRestore = {
        'system.structure.value': actor.system.structure?.max ?? 1,
        'system.stress.value': actor.system.stress?.max ?? 1,
        'system.hp.value': actor.system.hp?.max ?? 1,
        'system.heat.value': 0,
        'system.burn': 0,
        'system.overshield.value': 0,
    };
    if (tokenData.actorLink)
    {
        await actor.update(fullRestore);
        const newTokenDoc = await actor.getTokenDocument({ x: tokenData.x, y: tokenData.y });
        await canvas.scene.createEmbeddedDocuments('Token', [newTokenDoc]);
    }
    else
    {
        const [newToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        if (newToken?.actor)
            await newToken.actor.update(fullRestore);
    }
    await token.document.delete();
    return token;
}

// Tile HUD button

export function tileHUDButton(app, html)
{
    const tile = app?.object?.document;
    if (!tile || !getLAFlag(tile,'isWreck'))
        return;
    const button = document.createElement('div');
    button.classList.add('control-icon', MODULE_ID);
    button.title = 'Resurrect';
    button.dataset.tooltip = localize('LA.wreck.resurrect');
    const icon = document.createElement('i');
    icon.classList.add('fas', 'fa-person-rays');
    button.appendChild(icon);
    button.addEventListener('mouseup', () => unWreckTile(tile));
    // v13 ApplicationV2 HUDs pass HTMLElement; v12 passed jQuery. Handle both.
    const root = html instanceof HTMLElement ? html : html[0];
    root?.querySelector('.col.right')?.appendChild(button);
}

async function unWreckTile(tile)
{
    const isWreck = getLAFlag(tile,'isWreck');
    if (!isWreck)
        return;
    const tokenData = getLAFlag(tile,'tokenDocument');
    const actor = game.actors.get(tokenData?.actorId);
    if (!actor)
    {
        log(`No actor found for tile wreck`);
        return;
    }
    tokenData.x = tile.x;
    tokenData.y = tile.y;
    if (tokenData.actorLink)
    {
        if (actor.system.structure.value === 0)
            await actor.update({ 'system.structure.value': 1 });
        const restoredToken = await actor.getTokenDocument({ x: tile.x, y: tile.y });
        await canvas.scene.createEmbeddedDocuments('Token', [restoredToken]);
    }
    else
    {
        const [newToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        if (newToken?.actor?.system?.structure?.value === 0)
            await newToken.actor.update({ 'system.structure.value': 1 });
    }
    await tile.delete();
}

// Pre-wreck (cache textures on token creation)

export async function preWreck(document, _change, userId)
{
    if (!game.users.activeGM?.isSelf)
        return;
    const size = document.actor?.system?.size ?? 1;
    let wreckImgPath = getLAFlag(document,'wreckImgPath');
    let wreckEffectPath = getLAFlag(document,'wreckEffectPath');
    let wreckSoundPath = getLAFlag(document,'wreckSoundPath');

    const noImg = !wreckImgPath || wreckImgPath.trim() === '';
    const noEffect = !wreckEffectPath || wreckEffectPath.trim() === '';
    const noSound = !wreckSoundPath || wreckSoundPath.trim() === '';

    const category = getTokenCategory(document);
    const useCorpse = category !== 'mech';
    const muteHumanSound = ['human', 'pilot', 'squad'].includes(category)
        && getModuleSetting('disableHumanDeathSound');
    if (useCorpse)
    {
        if (noImg)
            wreckImgPath = await getCorpseImage(category, size);
        if (noEffect)
            wreckEffectPath = await getCorpseEffect(category);
        if (noSound && !muteHumanSound)
            wreckSoundPath = await getCorpseSound(category);
    }
    else
    {
        if (noImg)
            wreckImgPath = await getWreckImage(size);
        if (noEffect)
            wreckEffectPath = await getWreckEffect();
        if (noSound)
            wreckSoundPath = await getWreckSound();
    }
    if (wreckImgPath)
        await preLoadImageForAll(wreckImgPath, true);
    if (wreckEffectPath)
        await preLoadImageForAll(wreckEffectPath, true);
    if (wreckImgPath)
        await setLAFlag(document,'wreckImgPath', wreckImgPath);
    if (wreckEffectPath)
        await setLAFlag(document,'wreckEffectPath', wreckEffectPath);
    if (wreckSoundPath)
        await setLAFlag(document,'wreckSoundPath', wreckSoundPath);

    const wreckScale = getLAFlag(document,'wreckScale');
    if (wreckScale === undefined || wreckScale === null)
        await setLAFlag(document,'wreckScale', 1);
    if (userId)
        log(`Preloaded wreck for ${document.name} (${category})`);
}

// Token config "L.A" tab

export function initWreckTokenConfig()
{
    const handler = (app, html, data) => _renderWreckTab(app, html, data);
    Hooks.on('renderTokenConfig', handler);
    Hooks.on('renderPrototypeTokenConfig', handler);
}

function _renderWreckTab(app, html, data)
{
    const tokenDoc = app.token ?? app.object;
    if (!tokenDoc?.actor)
        return;
    const actorType = tokenDoc.actor.type;
    if (!['mech', 'npc', 'pilot', 'deployable'].includes(actorType))
        return;

    const rootEl = typeof html?.querySelector === 'function' ? html : html?.[0];
    if (!rootEl)
        return;

    // Add nav entry once
    const nav = rootEl.querySelector('a[data-action="tab"][data-tab="resources"]');
    if (nav && !rootEl.querySelector('a[data-action="tab"][data-tab="la"]'))
    {
        nav.insertAdjacentHTML('afterend',
            `<a data-action="tab" data-group="sheet" data-tab="la"><i class="fas fa-cog" inert></i><span>L.A</span></a>`);
    }

    // Add section once
    if (rootEl.querySelector('div.tab[data-tab="la"]'))
        return;

    const flags = getLAFlags(data.object) ?? getLAFlags(data.source) ?? {};
    const showWreck = getModuleSetting('enableWrecks') && actorType !== 'deployable';

    const sections = [];
    if (showWreck)
        sections.push({ title: localize('LA.wreck.sectionWreck'), html: _buildWreckSectionHtml(flags) });
    sections.push({ title: localize('LA.wreck.sectionDetection'), html: _buildAwarenessSectionHtml(flags) });
    sections.push({ title: localize('LA.wreck.sectionStatHint'), html: _buildStatHintSectionHtml(flags) });
    if (game.user?.isGM)
        sections.push({ title: localize('LA.wreck.sectionScan'), cls: 'la-scan-section', html: _buildScanSectionHtml(tokenDoc) });
    sections.push({ title: localize('LA.wreck.sectionElevation'), html: _buildElevationSectionHtml(flags) });
    sections.push({ title: localize('LA.wreck.sectionPortrait'), html: _buildPortraitSectionHtml(flags, actorType) });
    const sectionsHtml = sections.map((section, idx) => _wrapSection(section, idx > 0)).join('');

    const tabHtml = `<div class="tab scrollable" data-group="sheet" data-tab="la"><div class="la-compact-config">${sectionsHtml}</div></div>`;
    const resourcesTab = rootEl.querySelector('div.tab[data-tab="resources"]');
    if (resourcesTab)
        resourcesTab.insertAdjacentHTML('afterend', tabHtml);

    const laTab = rootEl.querySelector('div.tab[data-tab="la"]');
    laTab?.addEventListener('click', (event) =>
    {
        const head = event.target?.closest?.('.la-config-section-head');
        if (!head)
            return;
        event.preventDefault();
        head.parentElement.classList.toggle('collapsed');
        if (typeof app.setPosition === 'function')
            app.setPosition({ height: 'auto' });
    });

    const portraitSelect = laTab?.querySelector('[data-la-portrait-mode]');
    const portraitImgRow = laTab?.querySelector('[data-la-portrait-img]');
    if (portraitSelect && portraitImgRow)
    {
        portraitSelect.addEventListener('change', () =>
        {
            portraitImgRow.hidden = portraitSelect.value !== PORTRAIT_MODES.CUSTOM;
            if (typeof app.setPosition === 'function')
                app.setPosition({ height: 'auto' });
        });
    }

    for (const btn of rootEl.querySelectorAll('button.la-pick-folder'))
    {
        btn.addEventListener('click', (event) =>
        {
            event.preventDefault();
            const picker = rootEl.querySelector(`file-picker[name="${btn.dataset.for}"]`);
            new FilePicker({
                type: 'folder',
                current: picker?.value || '',
                callback: (path) =>
                {
                    picker.value = path;
                }
            }).render(true);
        });
    }

    if (game.user?.isGM)
        _wireScanControls(rootEl, tokenDoc, app);

    if (typeof app.setPosition === 'function')
        app.setPosition({ height: 'auto' });
}

function _buildWreckSectionHtml(flags)
{
    const imgPath = flags.wreckImgPath ?? '';
    const effectPath = flags.wreckEffectPath ?? '';
    const soundPath = flags.wreckSoundPath ?? '';
    const scale = flags.wreckScale ?? 1;
    const spawnImg = flags.spawnWreckImage ?? true;
    const playSound = flags.playWreckSound ?? true;
    const playEffect = flags.playWreckEffect ?? true;
    const wreckMode = flags.wreckMode ?? 'default';
    const modeOpt = (val, label) => `<option value="${val}" ${wreckMode === val ? 'selected' : ''}>${label}</option>`;
    const terrainOverride = flags.terrainOverride ?? 'default';
    const terrainOpt = (val, label) => `<option value="${val}" ${terrainOverride === val ? 'selected' : ''}>${label}</option>`;
    return `
        <div class="form-group">
            <label>Wreck Mode</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.wreckMode">
                    ${modeOpt('default', 'Default (use category setting)')}
                    ${modeOpt('token', 'Token')}
                    ${modeOpt('tile', 'Tile')}
                    ${modeOpt('none', 'Skip (do nothing)')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>On Wreck</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.terrainOverride">
                    ${terrainOpt('default', 'Default (use category setting)')}
                    ${terrainOpt('none', 'Nothing')}
                    ${terrainOpt('terrain', 'THT Difficult Terrain')}
                    ${terrainOpt('aura', 'Aura (movement +1)')}
                </select>
            </div>
        </div>
        <div class="form-group">
            <label>Wreck Image Path</label>
            <div class="form-fields">
                <file-picker name="flags.${MODULE_ID}.wreckImgPath" value="${imgPath}"></file-picker>
                <button type="button" class="la-pick-folder" data-for="flags.${MODULE_ID}.wreckImgPath" data-tooltip="${localize('LA.wreck.pickFolderTip')}" style="flex:0 0 auto;"><i class="fas fa-folder-tree" inert></i></button>
            </div>
        </div>
        <div class="form-group">
            <label>Wreck Effect Path</label>
            <div class="form-fields">
                <file-picker name="flags.${MODULE_ID}.wreckEffectPath" value="${effectPath}"></file-picker>
                <button type="button" class="la-pick-folder" data-for="flags.${MODULE_ID}.wreckEffectPath" data-tooltip="${localize('LA.wreck.pickFolderTip')}" style="flex:0 0 auto;"><i class="fas fa-folder-tree" inert></i></button>
            </div>
        </div>
        <div class="form-group">
            <label>Wreck Sound Path</label>
            <div class="form-fields">
                <file-picker name="flags.${MODULE_ID}.wreckSoundPath" value="${soundPath}"></file-picker>
                <button type="button" class="la-pick-folder" data-for="flags.${MODULE_ID}.wreckSoundPath" data-tooltip="${localize('LA.wreck.pickFolderTip')}" style="flex:0 0 auto;"><i class="fas fa-folder-tree" inert></i></button>
            </div>
        </div>
        <div class="form-group">
            <label>Tile Wreck Image/Effect Scale</label>
            <div class="form-fields">
                <input type="range" name="flags.${MODULE_ID}.wreckScale" value="${scale}" step="0.1" min="0" max="5" data-dtype="Number">
                <span class="range-value">${scale}</span>
            </div>
        </div>
        <div class="form-group">
            <label>Spawn Wreck Image</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.spawnWreckImage" data-dtype="Boolean" ${spawnImg ? 'checked' : ''}>
            </div>
            <p class="notes">Display wreck image when this token is destroyed.</p>
        </div>
        <div class="form-group">
            <label>Play Wreck Sound</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.playWreckSound" data-dtype="Boolean" ${playSound ? 'checked' : ''}>
            </div>
            <p class="notes">Play sound effect when this token is wrecked.</p>
        </div>
        <div class="form-group">
            <label>Play Wreck Effect</label>
            <div class="form-fields">
                <input type="checkbox" name="flags.${MODULE_ID}.playWreckEffect" data-dtype="Boolean" ${playEffect ? 'checked' : ''}>
            </div>
            <p class="notes">Play visual effect when this token is wrecked.</p>
        </div>
    `;
}

function _buildAwarenessSectionHtml(flags)
{
    const mode = flags.awarenessMode ?? 'default';
    const opt = (val, label) => `<option value="${val}" ${mode === val ? 'selected' : ''}>${label}</option>`;
    return `
        <div class="form-group">
            <label>Detection Visual</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.awarenessMode" data-dtype="String">
                    ${opt('default', 'Default (silhouette + scan)')}
                    ${opt('simple', 'Simple Object (rotating outline)')}
                    ${opt('visible', 'Visible (no overlay)')}
                    ${opt('ignore', 'Ignore (not detected)')}
                </select>
            </div>
            <p class="notes">Controls Battle Awareness display. Non-default modes also disable Sensor detection on this token.</p>
        </div>
    `;
}

function _buildStatHintSectionHtml(flags)
{
    const unknownLabel = flags.statHintUnknownLabel ?? '';
    const triSelect = (name, current) =>
    {
        const opt = (val, label) => `<option value="${val}" ${current === val ? 'selected' : ''}>${label}</option>`;
        return `<select name="flags.${MODULE_ID}.${name}" data-dtype="String">
            ${opt('default', 'Default (use global setting)')}
            ${opt('on', 'On')}
            ${opt('off', 'Off')}
        </select>`;
    };
    return `
        <div class="form-group">
            <label>Unknown Label</label>
            <div class="form-fields">
                <input type="text" name="flags.${MODULE_ID}.statHintUnknownLabel" value="${_escapeText(unknownLabel)}" placeholder="${localize('LA.wreck.defaultGlobalSetting')}">
            </div>
            <p class="notes">Stat hint header for this token while unscanned.</p>
        </div>
        <div class="form-group">
            <label>Hide class/templates/tier when not scanned</label>
            <div class="form-fields">${triSelect('statHintHideClass', flags.statHintHideClass ?? 'default')}</div>
            <p class="notes">Hide the class/frame subtitle and tier badge until scanned.</p>
        </div>
        <div class="form-group">
            <label>Hide current values without owner/observer access</label>
            <div class="form-fields">${triSelect('statHintHideCurrent', flags.statHintHideCurrent ?? 'default')}</div>
            <p class="notes">Current HP, heat, and resources show as "?" in the stat hint.</p>
        </div>
    `;
}

function _buildElevationSectionHtml(flags)
{
    const disableAutoTerrain = !!flags.disableAutoTerrainElevation;
    return `
        <div class="form-group">
            <label>Disable Auto-elevation from Terrain</label>
            <input type="checkbox" name="flags.${MODULE_ID}.disableAutoTerrainElevation" ${disableAutoTerrain ? 'checked' : ''}/>
            <p class="notes">Skip THT terrain elevation tracking for this token. Q/E offsets still work.</p>
        </div>
    `;
}

function _buildPortraitSectionHtml(flags, actorType)
{
    const mode = flags[FLAG_PORTRAIT_MODE] ?? PORTRAIT_MODES.DEFAULT;
    const img = flags[FLAG_PORTRAIT_IMG] ?? '';
    const opt = (val, label) => `<option value="${val}" ${mode === val ? 'selected' : ''}>${label}</option>`;
    const pilot = flags[FLAG_PORTRAIT_MECH_PILOT] ?? PORTRAIT_PILOT.DEFAULT;
    const pilotOpt = (val, label) => `<option value="${val}" ${pilot === val ? 'selected' : ''}>${label}</option>`;
    const pilotRow = actorType !== 'mech' ? '' : `
        <div class="form-group">
            <label>Use Pilot Portrait</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.${FLAG_PORTRAIT_MECH_PILOT}" data-dtype="String">
                    ${pilotOpt(PORTRAIT_PILOT.DEFAULT, 'Default (use global setting)')}
                    ${pilotOpt(PORTRAIT_PILOT.YES, 'Yes')}
                    ${pilotOpt(PORTRAIT_PILOT.NO, 'No')}
                </select>
            </div>
            <p class="notes">Draw the linked pilot's art instead of the mech's.</p>
        </div>
    `;
    return `
        <div class="form-group">
            <label>HUD Portrait</label>
            <div class="form-fields">
                <select name="flags.${MODULE_ID}.${FLAG_PORTRAIT_MODE}" data-dtype="String" data-la-portrait-mode>
                    ${opt(PORTRAIT_MODES.DEFAULT, 'Default (use global setting)')}
                    ${opt(PORTRAIT_MODES.TOKEN, 'Token art')}
                    ${opt(PORTRAIT_MODES.ACTOR, 'Actor portrait')}
                    ${opt(PORTRAIT_MODES.CUSTOM, 'Custom image')}
                    ${opt(PORTRAIT_MODES.OFF, 'Off')}
                </select>
            </div>
            <p class="notes">Artwork shown above the Token Action HUD name band.</p>
        </div>
        <div class="form-group" data-la-portrait-img ${mode === PORTRAIT_MODES.CUSTOM ? '' : 'hidden'}>
            <label>Portrait Image</label>
            <div class="form-fields">
                <file-picker name="flags.${MODULE_ID}.${FLAG_PORTRAIT_IMG}" type="imagevideo" value="${_escapeText(img)}"></file-picker>
            </div>
            <p class="notes">Used when the portrait is set to Custom image.</p>
        </div>
        ${pilotRow}
    `;
}

function _sectionHeadHtml(title)
{
    return `<button type="button" class="la-config-section-head"><i class="fas fa-chevron-down la-chevron" inert></i>${title}</button>`;
}

function _wrapSection(section, collapsed)
{
    const cls = section.cls ? ` ${section.cls}` : '';
    return `<div class="la-config-section${cls}${collapsed ? ' collapsed' : ''}">${_sectionHeadHtml(section.title)}${section.html}</div>`;
}

function _linkedScanDocsFor(actorUuid)
{
    const docs = [];
    if (!actorUuid)
        return docs;
    for (const entry of game.journal ?? [])
    {
        const scan = getLAFlag(entry,'scan');
        if (scan?.actorUuid === actorUuid)
            docs.push(entry);
    }
    return docs;
}

function _buildScanSectionHtml(tokenDoc)
{
    const actor = tokenDoc?.actor;
    const scannedByAll = !!getLAFlag(actor,'scannedByAll');
    const linkedDocs = _linkedScanDocsFor(actor?.uuid);
    const hasDoc = linkedDocs.length > 0;
    const docLabel = hasDoc
        ? linkedDocs.map((entry) => _escapeText(entry.name)).join(', ')
        : 'No scan document';
    const unlinkBtn = hasDoc
        ? `<button type="button" class="la-scan-unlink-btn"><i class="fas fa-unlink"></i> Unlink</button>`
        : '';
    return `
        <div class="form-group">
            <label>Scan Document</label>
            <div class="form-fields">
                <span class="la-scan-doc-name">${docLabel}</span>
            </div>
            <p class="notes">Journals stamped as this token's scan document. Players see it per each journal's own permissions.</p>
        </div>
        <div class="form-group">
            <label>Link Document</label>
            <div class="form-fields">
                <button type="button" class="la-scan-generate-btn"><i class="fas fa-satellite-dish"></i> Generate Scan</button>
                <button type="button" class="la-scan-link-btn"><i class="fas fa-link"></i> Link…</button>
                ${unlinkBtn}
            </div>
        </div>
        <div class="form-group">
            <label>Scanned by all</label>
            <div class="form-fields">
                <input type="checkbox" class="la-scanned-by-all" ${scannedByAll ? 'checked' : ''}>
            </div>
            <p class="notes">Force this token revealed (stats, name, battle log) to every player, ignoring scan journals.</p>
        </div>
    `;
}

function _wireScanControls(rootEl, tokenDoc, app)
{
    const laTab = rootEl?.querySelector?.('div.tab[data-tab="la"]');
    if (!laTab)
        return;
    const actor = tokenDoc?.actor;
    const checkbox = laTab.querySelector('.la-scanned-by-all');
    if (checkbox)
    {
        checkbox.addEventListener('change', async (ev) =>
        {
            if (!actor)
                return;
            const enabled = ev.currentTarget.checked;
            if (enabled)
                await setLAFlag(actor,'scannedByAll', true);
            else
                await unsetLAFlag(actor,'scannedByAll');
        });
    }
    const linkBtn = laTab.querySelector('.la-scan-link-btn');
    if (linkBtn)
        linkBtn.addEventListener('click', () => _promptLinkScanDoc(rootEl, tokenDoc, app));
    const unlinkBtn = laTab.querySelector('.la-scan-unlink-btn');
    if (unlinkBtn)
        unlinkBtn.addEventListener('click', () => _unlinkScanDocs(rootEl, tokenDoc, app));
    const generateBtn = laTab.querySelector('.la-scan-generate-btn');
    if (generateBtn)
    {
        generateBtn.addEventListener('click', async () =>
        {
            if (!game.user?.isGM)
            {
                globalThis.ui?.notifications?.warn('Only a GM can generate a scan.');
                return;
            }
            const target = tokenDoc?.object ?? tokenDoc;
            if (!target?.actor)
                return;
            const { performSystemScan } = await import('./scan.js');
            await performSystemScan(target, true);
            _refreshScanSection(rootEl, tokenDoc, app);
        });
    }
}

function _refreshScanSection(rootEl, tokenDoc, app)
{
    const laTab = rootEl?.querySelector?.('div.tab[data-tab="la"]');
    const section = laTab?.querySelector('.la-scan-section');
    if (!section)
        return;
    section.innerHTML = _sectionHeadHtml('Scan') + _buildScanSectionHtml(tokenDoc);
    _wireScanControls(rootEl, tokenDoc, app);
    if (typeof app?.setPosition === 'function')
        app.setPosition({ height: 'auto' });
}

function _promptLinkScanDoc(rootEl, tokenDoc, app)
{
    const actor = tokenDoc?.actor;
    if (!actor)
        return;
    const journals = [...(game.journal ?? [])].sort((first, second) => first.name.localeCompare(second.name));
    if (!journals.length)
    {
        globalThis.ui?.notifications?.warn('No journal entries exist to link.');
        return;
    }
    const linkedIds = new Set(_linkedScanDocsFor(actor.uuid).map((entry) => entry.id));
    const preselectedId = journals.find((entry) => linkedIds.has(entry.id))?.id ?? '';
    const rows = journals
        .map((entry) =>
        {
            const selected = linkedIds.has(entry.id) ? ' selected' : '';
            return `<div class="la-scan-row${selected}" data-id="${entry.id}" data-name="${_escapeText(entry.name.toLowerCase())}">${_escapeText(entry.name)}</div>`;
        })
        .join('');
    const content = `
        <style>
            .la-scan-search { width: 100%; margin-bottom: 6px; }
            .la-scan-list { max-height: 280px; overflow-y: auto; border: 1px solid var(--la-edge, #444); background: var(--la-plate, rgba(0,0,0,0.2)); border-radius: 4px; }
            .la-scan-row { padding: 4px 10px; cursor: pointer; border-bottom: 1px solid var(--la-edge, #333); }
            .la-scan-row:last-child { border-bottom: none; }
            .la-scan-row:hover { background: var(--la-edge, rgba(255,255,255,0.08)); }
            .la-scan-row.selected { background: var(--la-accent, #4b7bec); color: #fff; }
            .la-scan-empty { padding: 8px 10px; opacity: 0.7; font-style: italic; }
        </style>
        <div class="lancer-dialog-header">
            <h2 class="lancer-dialog-title">Link Scan Document</h2>
            <p class="lancer-dialog-subtitle">${_escapeText(actor.name)}</p>
        </div>
        <div class="form-group" style="flex-direction: column; align-items: stretch;">
            <label>Journal Entry</label>
            <input type="text" class="la-scan-search" placeholder="${localize('LA.common.searchByName')}" autocomplete="off">
            <div class="la-scan-list">${rows}<div class="la-scan-empty" style="display:none;">No matches.</div></div>
            <input type="hidden" name="scan-journal" value="${preselectedId}">
            <p class="notes">Stamps the chosen journal as this token's scan document.</p>
        </div>
    `;
    new globalThis.Dialog({
        title: localizeFormat('LA.dialogTitle.linkScanDocument', { name: actor.name }),
        content,
        render: (html) =>
        {
            const root = html?.[0] ?? html;
            if (!root)
                return;
            const search = root.querySelector('.la-scan-search');
            const hidden = root.querySelector('input[name="scan-journal"]');
            const empty = root.querySelector('.la-scan-empty');
            const rowEls = [...root.querySelectorAll('.la-scan-row')];
            for (const row of rowEls)
            {
                row.addEventListener('click', () =>
                {
                    for (const other of rowEls)
                        other.classList.toggle('selected', other === row);
                    if (hidden)
                        hidden.value = row.dataset?.id ?? '';
                });
            }
            if (search)
            {
                search.addEventListener('input', () =>
                {
                    const query = search.value.trim().toLowerCase();
                    let visible = 0;
                    for (const row of rowEls)
                    {
                        const match = !query || (row.dataset?.name ?? '').includes(query);
                        row.style.display = match ? '' : 'none';
                        if (match)
                            visible += 1;
                    }
                    if (empty)
                        empty.style.display = visible ? 'none' : '';
                });
                search.focus();
            }
        },
        buttons: {
            link: {
                label: `<i class="fas fa-link"></i> ${localize('LA.scan.link')}`,
                callback: async (html) =>
                {
                    const root = html?.[0] ?? html;
                    const id = root?.querySelector?.('input[name="scan-journal"]')?.value;
                    const entry = id ? game.journal?.get(id) : null;
                    if (!entry)
                    {
                        globalThis.ui?.notifications?.warn('Select a journal to link first.');
                        return;
                    }
                    await setLAFlag(entry,'scan', {
                        actorUuid: actor.uuid,
                        actorName: actor.name,
                        actorImg: actor.img,
                        scanIndex: '',
                        scannedAt: Date.now(),
                    });
                    globalThis.ui?.notifications?.info(`Linked "${entry.name}" as scan document for ${actor.name}.`);
                    _refreshScanSection(rootEl, tokenDoc, app);
                },
            },
            cancel: { label: `<i class="fas fa-times"></i> ${localize('LA.common.cancel')}` },
        },
        default: 'link',
    }, { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 420 }).render(true);
}

async function _unlinkScanDocs(rootEl, tokenDoc, app)
{
    const actor = tokenDoc?.actor;
    if (!actor)
        return;
    const docs = _linkedScanDocsFor(actor.uuid);
    if (!docs.length)
        return;
    const confirmed = await globalThis.Dialog.confirm({
        title: localizeFormat('LA.dialogTitle.unlinkScanDocument', { name: actor.name }),
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">${localize('LA.wreck.unlinkScanDocument')}</h2>
                <p class="lancer-dialog-subtitle">${_escapeText(actor.name)}</p>
            </div>
            <div class="form-group">
                <p>${localizeFormat('LA.wreck.unlinkScanPrompt', { count: docs.length, name: _escapeText(actor.name) })}</p>
            </div>
        `,
        options: { classes: ['lancer-dialog-base', 'lancer-no-title'], width: 420 },
    });
    if (!confirmed)
        return;
    for (const entry of docs)
        await unsetLAFlag(entry,'scan');
    globalThis.ui?.notifications?.info(localizeFormat('LA.notify.unlinkedScanDocuments', { name: actor.name }));
    _refreshScanSection(rootEl, tokenDoc, app);
}

// Canvas ready: preload all wreck textures

export async function canvasReadyWreck()
{
    for (const token of canvas.tokens.placeables)
    {
        const wreckImgPath = getLAFlags(token.document)?.wreckImgPath;
        const wreckEffectPath = getLAFlags(token.document)?.wreckEffectPath;
        if (wreckImgPath === undefined || wreckEffectPath === undefined)
            await preWreck(token.document);
        else
        {
            if (wreckImgPath)
                await preLoadImageForAll(wreckImgPath);
            if (wreckEffectPath)
                await preLoadImageForAll(wreckEffectPath);
        }
    }
}
