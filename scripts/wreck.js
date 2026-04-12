/* global CONST, console, game, canvas, loadTexture, FilePicker, TokenMagic, Sequence, foundry */

const MODULE_ID = 'lancer-automations';

function log(...args) {
    console.log(`${MODULE_ID} | wreck |`, ...args);
}

// Macro effect throttle
let _macroThrottle = 0;
let _macroCount = 10;

async function macroEffect(name, actor, token, enable) {
    const suffix = enable ? 'apply' : 'remove';
    const macro = game.macros.find(m => m.name === `${name}.${suffix}`);
    if (!macro) return;
    const now = +new Date();
    if (now - _macroThrottle > 500) {
        _macroCount = 10;
        _macroThrottle = now;
        await macro.execute({ token, actor });
    } else if (_macroCount > 0) {
        _macroCount--;
        await macro.execute({ token, actor });
    }
}

// ---------------------------------------------------------------------------
// Category detection
// ---------------------------------------------------------------------------

export function getTokenCategory(token) {
    const actor = token.actor ?? game.actors.find(x => x.id === token.document?.actorId);
    if (!actor) return 'mech';
    if (actor.type === 'pilot') return 'pilot';
    const items = actor.items ?? [];
    const hasLid = (lid) => items.some(i => i.system?.lid === lid);
    if (hasLid('npcc_squad')) return 'squad';
    if (hasLid('npcc_monstrosity')) return 'monstrosity';
    if (hasLid('npcc_human')) return 'human';
    if (hasLid('npcc_specialist')) return 'human';
    if (items.some(i => i.system?.role === 'biological')) return 'biological';
    return 'mech';
}

function getWreckMode(category) {
    // Map squad/pilot to their base categories for settings lookup.
    const settingCat = (category === 'squad' || category === 'pilot') ? 'human' : category;
    try {
        return game.settings.get(MODULE_ID, `wreckMode_${settingCat}`) || 'token';
    } catch {
        return 'token';
    }
}

function categorySpawnsTerrain(category) {
    const settingCat = (category === 'squad' || category === 'pilot') ? 'human' : category;
    try {
        return game.settings.get(MODULE_ID, `wreckTerrain_${settingCat}`) === true;
    } catch {
        return category === 'mech' || category === 'monstrosity';
    }
}

const CATEGORY_FALLBACKS = {
    squad: ['squad', 'human', 'biological'],
    human: ['human', 'biological'],
    pilot: ['human', 'biological'],
    biological: ['biological'],
    monstrosity: ['monstrosity', 'biological'],
    mech: [],
};

function isSquad(token) { return getTokenCategory(token) === 'squad'; }

// ---------------------------------------------------------------------------
// Asset resolution
// ---------------------------------------------------------------------------

async function _browseFiles(path) {
    try {
        const result = await FilePicker.browse('data', path);
        return result.files ?? [];
    } catch {
        return [];
    }
}

function _randomFile(files) {
    if (!files || files.length === 0) return null;
    return files[Math.floor(Math.random() * files.length)];
}

function _getWreckBasePath() {
    try {
        const custom = game.settings.get(MODULE_ID, 'wreckAssetsPath');
        if (custom && custom.trim()) return custom.trim();
    } catch { /* fall through */ }
    return `modules/${MODULE_ID}/wrecks`;
}

async function _resolveAssetWithFallback(subDir, category) {
    const basePath = _getWreckBasePath();
    const chain = CATEGORY_FALLBACKS[category] ?? [];
    for (const cat of chain) {
        const files = await _browseFiles(`${basePath}/${subDir}/${cat}`);
        if (files.length > 0) return _randomFile(files);
    }
    if (category === 'mech') {
        const fallback = await _browseFiles(`${basePath}/${subDir}`);
        return _randomFile(fallback);
    }
    return null;
}

async function getCorpseImage(category, size = 1) {
    if (size < 1) size = 1;
    if (size > 3) size = 3;
    return _resolveAssetWithFallback(`s${size}`, category);
}
async function getCorpseEffect(category) { return _resolveAssetWithFallback('effects', category); }
async function getCorpseSound(category) { return _resolveAssetWithFallback('audio', category); }

async function getWreckImage(size) {
    if (size < 1) size = 1;
    if (size > 3) size = 3;
    return _resolveAssetWithFallback(`s${size}`, 'mech');
}
async function getWreckEffect() { return _resolveAssetWithFallback('effects', 'mech'); }
async function getWreckSound() { return _resolveAssetWithFallback('audio', 'mech'); }

// ---------------------------------------------------------------------------
// Terrain
// ---------------------------------------------------------------------------

function getTokenCells(token) {
    return game.modules.get(MODULE_ID)?.api?.getTokenCells?.(token) ?? [];
}

async function spawnDifficultTerrain(token) {
    if (!game.modules.get('terrain-height-tools')?.active) return;
    const terrainTypeId = game.settings.get(MODULE_ID, 'wreckTerrainType');
    if (!terrainTypeId) return;
    try {
        const terrainAPI = globalThis.terrainHeightTools;
        if (!terrainAPI) return;
        const wallHeight = token.actor?.prototypeToken?.flags?.['wall-height']?.tokenHeight;
        const rawHeight = wallHeight ?? (token.actor?.system?.size ?? 1);
        const terrainHeight = Math.floor(rawHeight * 2) / 2;
        const cells = getTokenCells(token);
        if (cells.length === 0) return;
        const terrainTypes = terrainAPI.getTerrainTypes?.() || [];
        // Each cell gets its own elevation based on the ground below it.
        for (const [row, col] of cells) {
            const existing = terrainAPI.getCell(col, row) || [];
            let maxH = 0;
            for (const t of existing) {
                const tt = terrainTypes.find(ty => ty.id === t.terrainTypeId);
                if (tt?.usesHeight && tt?.isSolid) {
                    maxH = Math.max(maxH, (t.elevation || 0) + (t.height || 0));
                }
            }
            await terrainAPI.paintCells([[row, col]], {
                id: terrainTypeId,
                height: terrainHeight,
                elevation: maxH
            }, { mode: 'additiveMerge' });
        }
    } catch (e) {
        console.error(`${MODULE_ID} | wreck terrain error:`, e);
    }
}

// ---------------------------------------------------------------------------
// Template actor
// ---------------------------------------------------------------------------

async function getOrCreateWreckActor() {
    const WRECK_NAME = 'Template Wreck';
    let actor = game.actors.find(a => a.name === WRECK_NAME && a.type === 'deployable');
    if (actor) return actor;
    actor = await Actor.create({
        name: WRECK_NAME,
        type: 'deployable',
        img: `modules/${MODULE_ID}/icons/tombstone.svg`,
        prototypeToken: {
            actorLink: false,
            displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
            displayName: CONST.TOKEN_DISPLAY_MODES.NONE,
            texture: { src: `modules/${MODULE_ID}/icons/tombstone.svg` },
        },
    });
    log('Created Template Wreck actor');
    return actor;
}

// ---------------------------------------------------------------------------
// Preload
// ---------------------------------------------------------------------------

export async function preLoadImageForAll(src, push = false) {
    if (!src || !src.trim()) return src;
    if (push) {
        game.socket.emit(`module.${MODULE_ID}`, { action: 'preLoadImageForAll', payload: src });
    }
    await loadTexture(src);
    return src;
}

// ---------------------------------------------------------------------------
// Core wreck logic
// ---------------------------------------------------------------------------

export async function updateStructure(token) {
    let response = '';
    const structure = token.actor.system.structure.value;
    if (structure <= 0) {
        response = `${token.name} structure is zero or less.`;
        if (game.settings.get(MODULE_ID, 'enableWipOnDeath')) {
            log(`${token.name} is dead, removing statuses.`);
            await token.actor.deleteEmbeddedDocuments('ActiveEffect', token.actor.effects.map(e => e.id));
        }
        if (game.combat && token.combatant && game.settings.get(MODULE_ID, 'enableRemoveFromCombat')) {
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
        if (isSquad(token) && game.settings.get(MODULE_ID, 'squadLostOnDeath')) {
            await token.actor.toggleStatusEffect('mia', { active: true, overlay: true });
        }
        if (token) {
            await macroEffect('Wreck', token.actor, token, true);
        }
    } else {
        response = `${token.name} structure is greater than zero.`;
        if (isSquad(token) && game.settings.get(MODULE_ID, 'squadLostOnDeath')) {
            await token.actor.toggleStatusEffect('mia', { active: false, overlay: true });
        }
        if (game.combat && !token.combatant && game.settings.get(MODULE_ID, 'enableRemoveFromCombat')) {
            await token.document.toggleCombatant();
        }
        await macroEffect('Wreck', token.actor, token, false);
    }
    return response;
}

async function wreckIt(token) {
    const isDead = token.document.getFlag(MODULE_ID, 'isDead')
        || token.document.getFlag(MODULE_ID, 'isWreck');
    if (isDead) {
        log(`${token.name} is already wrecked.`);
        return token;
    }
    log(`Wrecking ${token.name}!`);
    if (typeof TokenMagic !== 'undefined') {
        await TokenMagic.deleteFilters(token);
    }

    const category = getTokenCategory(token);
    const isBio = ['biological', 'human', 'squad', 'pilot'].includes(category);
    const wreckLabel = isBio ? 'Corpse' : 'Wreck';

    const spawnWreckImage = token.document.getFlag(MODULE_ID, 'spawnWreckImage') ?? true;
    const playWreckSound = token.document.getFlag(MODULE_ID, 'playWreckSound') ?? true;
    const playWreckEffect = token.document.getFlag(MODULE_ID, 'playWreckEffect') ?? true;
    const terrainOverride = token.document.getFlag(MODULE_ID, 'terrainOverride');
    const shouldSpawnTerrain = terrainOverride === 'yes'
        || (terrainOverride !== 'no' && categorySpawnsTerrain(category));

    const imgString = token.document.getFlag(MODULE_ID, 'wreckImgPath');
    const effString = token.document.getFlag(MODULE_ID, 'wreckEffectPath');
    const souString = token.document.getFlag(MODULE_ID, 'wreckSoundPath');
    const wreckScale = token.document.getFlag(MODULE_ID, 'wreckScale') ?? 1;

    const tokenWreckMode = token.document.getFlag(MODULE_ID, 'wreckMode');
    const wreckMode = (tokenWreckMode && tokenWreckMode !== 'default')
        ? tokenWreckMode
        : getWreckMode(category);
    const tileWreck = wreckMode === 'tile';

    if (tileWreck) {
        new Sequence()
            .sound().file(souString).volume(game.settings.get(MODULE_ID, 'wreckMasterVolume') ?? 1).playIf(!!souString && playWreckSound && game.settings.get(MODULE_ID, 'enableWreckAudio') && (game.settings.get(MODULE_ID, 'wreckMasterVolume') ?? 1) > 0)
            .effect().file(effString).scaleToObject(wreckScale * 2.25).atLocation(token).mirrorX(Math.random() > 0.5).waitUntilFinished(-500)
                .playIf(!!effString && playWreckEffect && game.settings.get(MODULE_ID, 'enableWreckAnimation'))
            .thenDo(() => {
                const gridSize = canvas.scene.grid.size;
                const newWidth = token.document.width * gridSize * wreckScale;
                const newHeight = token.document.height * gridSize * wreckScale;
                const newX = token.document.x - (newWidth - token.w) / 2;
                const newY = token.document.y - (newHeight - token.h) / 2;
                if (spawnWreckImage && imgString) {
                    canvas.scene.createEmbeddedDocuments('Tile', [{
                        x: newX, y: newY, height: newHeight, width: newWidth,
                        texture: { src: imgString },
                        flags: { [MODULE_ID]: { isWreck: true, tokenDocument: token.document.toObject() } }
                    }]);
                }
                if (shouldSpawnTerrain) spawnDifficultTerrain(token);
                token.document.delete();
            })
            .play();
    } else {
        new Sequence()
            .sound().file(souString).volume(game.settings.get(MODULE_ID, 'wreckMasterVolume') ?? 1).playIf(!!souString && playWreckSound && game.settings.get(MODULE_ID, 'enableWreckAudio') && (game.settings.get(MODULE_ID, 'wreckMasterVolume') ?? 1) > 0)
            .effect().file(effString).scaleToObject(2.25).atLocation(token).mirrorX(Math.random() > 0.5).waitUntilFinished(-500)
                .playIf(!!effString && playWreckEffect && game.settings.get(MODULE_ID, 'enableWreckAnimation'))
            .thenDo(async () => {
                try {
                    if (spawnWreckImage) {
                        const wreckActor = await getOrCreateWreckActor();
                        if (wreckActor) {
                            const gameplaySize = token.actor?.system?.size ?? 1;
                            const cat = getTokenCategory(token);
                            const fragile = cat === 'human' || cat === 'pilot' || cat === 'squad';
                            const wreckHP = fragile ? 1 : Math.min(4, gameplaySize) * 10;
                            const tokenData = {
                                name: `${token.name} ${wreckLabel}`,
                                x: token.document.x,
                                y: token.document.y,
                                width: token.document.width,
                                height: token.document.height,
                                hexagonalShape: token.document.hexagonalShape,
                                lockRotation: token.document.lockRotation,
                                rotation: token.document.rotation,
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
                                }
                            };
                            const textureSrc = imgString || `modules/${MODULE_ID}/icons/tombstone.svg`;
                            tokenData.texture = { src: textureSrc, scaleX: wreckScale, scaleY: wreckScale };
                            const wreckToken = await wreckActor.getTokenDocument(tokenData);
                            await canvas.scene.createEmbeddedDocuments('Token', [wreckToken]);
                        }
                    }
                    if (shouldSpawnTerrain) spawnDifficultTerrain(token);
                    token.document.delete();
                } catch (e) {
                    console.error(`${MODULE_ID} | wreckIt error:`, e);
                }
            })
            .play();
    }
    return token;
}

// ---------------------------------------------------------------------------
// Resurrect
// ---------------------------------------------------------------------------

export async function resurrect(token) {
    const isWreck = token.document.getFlag(MODULE_ID, 'isWreck');
    if (!isWreck) {
        log(`${token.name} is not a wreck.`);
        return token;
    }
    log(`Resurrecting ${token.name}!`);
    const tokenData = token.document.getFlag(MODULE_ID, 'tokenDocument');
    if (!tokenData) return token;
    const actor = game.actors.get(tokenData.actorId);
    if (!actor) {
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
    if (tokenData.actorLink) {
        await actor.update(fullRestore);
        const newTokenDoc = await actor.getTokenDocument({ x: tokenData.x, y: tokenData.y });
        await canvas.scene.createEmbeddedDocuments('Token', [newTokenDoc]);
    } else {
        const [newToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        if (newToken?.actor) {
            await newToken.actor.update(fullRestore);
        }
    }
    await token.document.delete();
    return token;
}

// ---------------------------------------------------------------------------
// Tile HUD button
// ---------------------------------------------------------------------------

export function tileHUDButton(app, html) {
    const tile = app?.object?.document;
    if (!tile || !tile.getFlag(MODULE_ID, 'isWreck')) return;
    const button = document.createElement('div');
    button.classList.add('control-icon', MODULE_ID);
    button.title = 'Resurrect';
    button.dataset.tooltip = 'Resurrect';
    const icon = document.createElement('i');
    icon.classList.add('fas', 'fa-person-rays');
    button.appendChild(icon);
    button.addEventListener('mouseup', () => unWreckTile(tile));
    html.find('.col.right').append(button);
}

async function unWreckTile(tile) {
    const isWreck = tile.getFlag(MODULE_ID, 'isWreck');
    if (!isWreck) return;
    const tokenData = tile.getFlag(MODULE_ID, 'tokenDocument');
    const actor = game.actors.get(tokenData?.actorId);
    if (!actor) {
        log(`No actor found for tile wreck`);
        return;
    }
    tokenData.x = tile.x;
    tokenData.y = tile.y;
    if (tokenData.actorLink) {
        if (actor.system.structure.value === 0) {
            await actor.update({ 'system.structure.value': 1 });
        }
        const mechToken = await actor.getTokenDocument({ x: tile.x, y: tile.y });
        await canvas.scene.createEmbeddedDocuments('Token', [mechToken]);
    } else {
        const [newToken] = await canvas.scene.createEmbeddedDocuments('Token', [tokenData]);
        if (newToken?.actor?.system?.structure?.value === 0) {
            await newToken.actor.update({ 'system.structure.value': 1 });
        }
    }
    await tile.delete();
}

// ---------------------------------------------------------------------------
// Pre-wreck (cache textures on token creation)
// ---------------------------------------------------------------------------

export async function preWreck(document, _change, userId) {
    if (!game.users.activeGM?.isSelf) return;
    const size = document.actor?.system?.size ?? 1;
    let wreckImgPath = document.getFlag(MODULE_ID, 'wreckImgPath');
    let wreckEffectPath = document.getFlag(MODULE_ID, 'wreckEffectPath');
    let wreckSoundPath = document.getFlag(MODULE_ID, 'wreckSoundPath');

    const noImg = !wreckImgPath || wreckImgPath.trim() === '';
    const noEff = !wreckEffectPath || wreckEffectPath.trim() === '';
    const noSnd = !wreckSoundPath || wreckSoundPath.trim() === '';

    const category = getTokenCategory(document);
    const useCorpse = category !== 'mech';
    const muteHumanSound = ['human', 'pilot', 'squad'].includes(category)
        && game.settings.get(MODULE_ID, 'disableHumanDeathSound');
    if (useCorpse) {
        if (noImg) wreckImgPath = await getCorpseImage(category, size);
        if (noEff) wreckEffectPath = await getCorpseEffect(category);
        if (noSnd && !muteHumanSound) wreckSoundPath = await getCorpseSound(category);
    } else {
        if (noImg) wreckImgPath = await getWreckImage(size);
        if (noEff) wreckEffectPath = await getWreckEffect();
        if (noSnd) wreckSoundPath = await getWreckSound();
    }
    if (wreckImgPath) await preLoadImageForAll(wreckImgPath, true);
    if (wreckEffectPath) await preLoadImageForAll(wreckEffectPath, true);
    if (wreckImgPath) await document.setFlag(MODULE_ID, 'wreckImgPath', wreckImgPath);
    if (wreckEffectPath) await document.setFlag(MODULE_ID, 'wreckEffectPath', wreckEffectPath);
    if (wreckSoundPath) await document.setFlag(MODULE_ID, 'wreckSoundPath', wreckSoundPath);

    const wreckScale = document.getFlag(MODULE_ID, 'wreckScale');
    if (wreckScale === undefined || wreckScale === null) {
        await document.setFlag(MODULE_ID, 'wreckScale', 1);
    }
    if (userId) {
        log(`Preloaded wreck for ${document.name} (${category})`);
    }
}

// ---------------------------------------------------------------------------
// Canvas ready — preload all wreck textures
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Token config "L.A" tab
// ---------------------------------------------------------------------------

export function initWreckTokenConfig() {
    Hooks.on('renderTokenConfig', (app, html, data) => {
        if (!game.settings.get(MODULE_ID, 'enableWrecks')) return;
        const tokenDoc = app.token ?? app.object;
        if (!tokenDoc?.actor) return;
        const actorType = tokenDoc.actor.type;
        if (!['mech', 'npc', 'pilot'].includes(actorType)) return;

        const $html = html instanceof $ ? html : $(html);

        // Add L.A tab nav item.
        const $nav = $html.find('a.item[data-tab="resources"]');
        if ($nav.length && !$html.find('a.item[data-tab="la"]').length) {
            $nav.after(`<a class="item" data-tab="la"><i class="fas fa-cog"></i> L.A</a>`);
        }

        // Add L.A tab content.
        if ($html.find('div.tab[data-tab="la"]').length) return;

        const flags = data.object?.flags?.[MODULE_ID] ?? {};
        const imgPath = flags.wreckImgPath ?? '';
        const effPath = flags.wreckEffectPath ?? '';
        const sndPath = flags.wreckSoundPath ?? '';
        const scale = flags.wreckScale ?? 1;
        const spawnImg = flags.spawnWreckImage ?? true;
        const playSound = flags.playWreckSound ?? true;
        const playEffect = flags.playWreckEffect ?? true;
        const wreckMode = flags.wreckMode ?? 'default';
        const modeOpt = (val, label) => `<option value="${val}" ${wreckMode === val ? 'selected' : ''}>${label}</option>`;
        const terrainOverride = flags.terrainOverride ?? 'default';
        const tOpt = (val, label) => `<option value="${val}" ${terrainOverride === val ? 'selected' : ''}>${label}</option>`;

        const newHtml = $(`
            <div class="tab" data-group="main" data-tab="la">
                <div class="form-group">
                    <label>Wreck Mode</label>
                    <div class="form-fields">
                        <select name="flags.${MODULE_ID}.wreckMode">
                            ${modeOpt('default', 'Default (use category setting)')}
                            ${modeOpt('token', 'Token')}
                            ${modeOpt('tile', 'Tile')}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Spawn Terrain</label>
                    <div class="form-fields">
                        <select name="flags.${MODULE_ID}.terrainOverride">
                            ${tOpt('default', 'Default (use category setting)')}
                            ${tOpt('yes', 'Yes')}
                            ${tOpt('no', 'No')}
                        </select>
                    </div>
                </div>
                <div class="form-group">
                    <label>Wreck Image Path</label>
                    <div class="form-fields">
                        <file-picker name="flags.${MODULE_ID}.wreckImgPath" value="${imgPath}"></file-picker>
                    </div>
                </div>
                <div class="form-group">
                    <label>Wreck Effect Path</label>
                    <div class="form-fields">
                        <file-picker name="flags.${MODULE_ID}.wreckEffectPath" value="${effPath}"></file-picker>
                    </div>
                </div>
                <div class="form-group">
                    <label>Wreck Sound Path</label>
                    <div class="form-fields">
                        <file-picker name="flags.${MODULE_ID}.wreckSoundPath" value="${sndPath}"></file-picker>
                    </div>
                </div>
                <div class="form-group">
                    <label>Tile Wreck Image/Effect Scale</label>
                    <div class="form-fields">
                        <input type="range" name="flags.${MODULE_ID}.wreckScale" value="${scale}" step="0.1" min="0" max="5">
                        <span class="range-value">${scale}</span>
                    </div>
                </div>
                <div class="form-group">
                    <label>Spawn Wreck Image</label>
                    <div class="form-fields">
                        <input type="checkbox" name="flags.${MODULE_ID}.spawnWreckImage" ${spawnImg ? 'checked' : ''}>
                    </div>
                    <p class="notes">Display wreck image when this token is destroyed.</p>
                </div>
                <div class="form-group">
                    <label>Play Wreck Sound</label>
                    <div class="form-fields">
                        <input type="checkbox" name="flags.${MODULE_ID}.playWreckSound" ${playSound ? 'checked' : ''}>
                    </div>
                    <p class="notes">Play sound effect when this token is wrecked.</p>
                </div>
                <div class="form-group">
                    <label>Play Wreck Effect</label>
                    <div class="form-fields">
                        <input type="checkbox" name="flags.${MODULE_ID}.playWreckEffect" ${playEffect ? 'checked' : ''}>
                    </div>
                    <p class="notes">Play visual effect when this token is wrecked.</p>
                </div>
            </div>
        `);
        $html.find('div.tab[data-tab="resources"]').after(newHtml);

        if (typeof app.setPosition === 'function') {
            app.setPosition({ height: 'auto' });
        }
    });
}

// ---------------------------------------------------------------------------
// Canvas ready — preload all wreck textures
// ---------------------------------------------------------------------------

export async function canvasReadyWreck() {
    for (const token of canvas.tokens.placeables) {
        const wreckImgPath = token.document.flags[MODULE_ID]?.wreckImgPath;
        const wreckEffectPath = token.document.flags[MODULE_ID]?.wreckEffectPath;
        if (wreckImgPath === undefined || wreckEffectPath === undefined) {
            await preWreck(token.document);
        } else {
            if (wreckImgPath) await preLoadImageForAll(wreckImgPath);
            if (wreckEffectPath) await preLoadImageForAll(wreckEffectPath);
        }
    }
}
