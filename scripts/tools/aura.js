/**
 * Wraps Grid-Aware Auras to support lambda-function macro callbacks, via libWrapper (no GAA edits).
 */
import { hasReactionAvailable } from "./misc-tools.js";

// GAA auras live in one flag array with read-modify-write updates, so concurrent
// writers clobber each other's append unless serialized per owner document.
const _auraWriteQueues = new Map();

function _queueAuraWrite(owner, task)
{
    const doc = owner?.document ?? owner;
    const key = doc?.uuid ?? 'global';
    const chain = (_auraWriteQueues.get(key) ?? Promise.resolve()).catch(() => undefined).then(task);
    _auraWriteQueues.set(key, chain);
    chain.finally(() =>
    {
        if (_auraWriteQueues.get(key) === chain)
            _auraWriteQueues.delete(key);
    }).catch(() => undefined);
    return chain;
}

export class LAAuras
{
    /** Session cache of compiled aura macro callbacks, keyed on serialized source string. */
    static callbackCache = new Map();
    static _initialized = false;

    /**
     * Initialize the libWrapper intercept.
     */
    static init()
    {
        if (LAAuras._initialized)
            return;

        if (typeof libWrapper === "function")
        {
            libWrapper.register('lancer-automations', 'Macros.prototype.get', function (wrapped, ...args)
            {
                const id = args[0];
                if (typeof id === 'string' && id.startsWith('@@fn:'))
                {
                    const macroSource = id.slice('@@fn:'.length);
                    let callbackFn = LAAuras.callbackCache.get(macroSource);
                    if (!callbackFn)
                    {
                        try
                        {
                            callbackFn = new Function('token', 'parent', 'aura', 'options',
                                `return (${macroSource})(token, parent, aura, options);`
                            );
                            LAAuras.callbackCache.set(macroSource, callbackFn);
                        }
                        catch (e)
                        {
                            console.error(`lancer-automations | Failed to reconstruct Aura callback from source:`, e);
                            return wrapped(...args);
                        }
                    }
                    return {
                        canExecute: true,
                        execute: (params) =>
                        {
                            try
                            {
                                callbackFn(params.token, params.parent, params.aura, params.options);
                            }
                            catch (e)
                            {
                                console.error(`lancer-automations | Error executing Aura lambda function for aura '${params.aura?.name}':`, e);
                            }
                        }
                    };
                }
                return wrapped(...args);
            }, 'MIXED');
            LAAuras._initialized = true;
        }
        else
            console.warn("lancer-automations | libWrapper not found, Grid-Aware Auras lambda functions will not work.");
    }

    /**
     * Wrapper for Grid-Aware Auras `createAura`.
     * Intercepts `function` definitions in `macros` and converts them to virtual macro IDs.
     * Accepts Token / TokenDocument / Item owners; for Item owners, the context actor is
     * resolved from `item.parent` and the active token (or prototypeToken) provides name/disposition.
     * @returns {Promise<object|undefined>}
     */
    static async createAura(owner, auraConfig)
    {
        return _queueAuraWrite(owner, () => LAAuras._createAuraInner(owner, auraConfig));
    }

    static async _createAuraInner(owner, auraConfig)
    {
        const gridAwareAuras = game.modules.get("grid-aware-auras");
        if (!gridAwareAuras?.api?.createAura)
        {
            console.warn("lancer-automations | Grid-Aware Auras module is not active or does not support the API.");
            return undefined;
        }

        if (!LAAuras._initialized)
            LAAuras.init();

        let configToPass = foundry.utils.deepClone(auraConfig);

        // Resolve context actor + token-like doc (for disposition/name) regardless of owner type
        let contextActor = null;
        let contextTokenDoc = null;
        if (owner instanceof Item)
        {
            contextActor = owner.parent instanceof Actor ? owner.parent : null;
            contextTokenDoc = contextActor?.getActiveTokens?.()?.[0]?.document
                ?? contextActor?.prototypeToken
                ?? null;
        }
        else
        {
            contextTokenDoc = owner.document ?? owner;
            contextActor = contextTokenDoc?.actor ?? null;
        }

        if (contextActor && contextTokenDoc)
        {
            const hasReaction = hasReactionAvailable(contextActor);
            const tokenFactionsApi = game.modules.get("token-factions")?.api;

            let resolvedColor = "#ffffff";
            if (tokenFactionsApi && hasReaction)
            {
                const color = await tokenFactionsApi.retrieveBorderFactionsColorFromToken(contextTokenDoc.name);
                if (color)
                    resolvedColor = color;
            }
            else if (contextActor.folder?.color && hasReaction)
                resolvedColor = contextActor.folder.color;

            const fillTexture = game.modules.get("templatemacro")?.active
                ? "modules/templatemacro/textures/hatching-cog.png"
                : "";

            const defaultAuraConfig = {
                unified: true,
                name: "lancer-automations-aura",
                enabled: true,
                lineDashOffsetAnimation: -5,
                lineType: 2,
                lineWidth: 2,
                lineOpacity: 1,
                lineDashSize: 5,
                lineGapSize: 5,
                fillType: 2,
                innerRadius: 0,
                fillOpacity: 0.15,
                fillTextureOffset: { x: 0, y: 0 },
                fillTextureOffsetAnimation: { x: 5, y: 5 },
                fillTextureScale: { x: 50, y: 50 },
                lineColor: "#ffffff",
                fillColor: resolvedColor,
                fillTexture: fillTexture,
                ownerVisibility: {
                    default: true,
                },
                nonOwnerVisibility: {
                    default: contextTokenDoc.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                }
            };

            configToPass = foundry.utils.mergeObject(defaultAuraConfig, configToPass);
        }

        if (configToPass.macros && Array.isArray(configToPass.macros))
        {
            for (let macro of configToPass.macros)
            {
                if (typeof macro.function === 'function')
                {
                    const src = macro.function.toString();
                    macro.macroId = '@@fn:' + src;
                    LAAuras.callbackCache.set(src, macro.function);
                    delete macro.function; // Strip the function so GAA doesn't get confused
                }
            }
        }

        return await gridAwareAuras.api.createAura(owner, configToPass);
    }

    /**
     * Create the aura only if the owner has none by that name. The onInit way to attach an aura.
     * @param {Actor|Token|TokenDocument|Item} owner - Pass the Item to tie the aura to the item's lifetime.
     * @param {object} auraConfig - `name` is required, it is the dedupe key.
     * @returns {Promise<object|null>} The created aura, or null when one already existed.
     */
    static async ensureAura(owner, auraConfig)
    {
        if (!auraConfig?.name)
        {
            console.warn("lancer-automations | ensureAura: auraConfig.name is required for dedupe.");
            return LAAuras.createAura(owner, auraConfig);
        }
        // dedupe check runs inside the queue so two same-name ensures can't both pass it
        return _queueAuraWrite(owner, () =>
        {
            if (LAAuras.findAura(owner, auraConfig.name))
                return null;
            return LAAuras._createAuraInner(owner, auraConfig);
        });
    }

    /**
     * Passthrough wrapper for Grid-Aware Auras `deleteAuras`.
     * @returns {Promise<object[]>}
     */
    static async deleteAuras(owner, filter, options = {})
    {
        const gridAwareAuras = game.modules.get("grid-aware-auras");
        if (!gridAwareAuras?.api?.deleteAuras)
            return [];
        const opts = owner instanceof Item ? options : { includeItems: true, ...options };
        return _queueAuraWrite(owner, () => gridAwareAuras.api.deleteAuras(owner, filter, opts));
    }

    /** The placeable that renders a token's or actor's auras. */
    static _auraToken(actorOrToken)
    {
        const candidate = /** @type {any} */ (actorOrToken);
        if (candidate?.document?.documentName === 'Token')
            return candidate;
        if (candidate?.documentName === 'Token')
            return candidate.object ?? null;
        return candidate?.getActiveTokens?.()?.[0] ?? candidate?.actor?.getActiveTokens?.()?.[0] ?? null;
    }

    /** @returns {object|null} The aura config, or null if nothing by that name is on the token or its items */
    static findAura(actorOrToken, auraName)
    {
        if (actorOrToken instanceof Item)
        {
            const own = /** @type {any} */ (actorOrToken).getFlag?.('grid-aware-auras', 'auras');
            return own ? Object.values(own).find(aura => aura.name === auraName) ?? null : null;
        }

        const gridAwareAuras = game.modules.get('grid-aware-auras')?.api;
        const token = LAAuras._auraToken(actorOrToken);
        if (gridAwareAuras?.getTokenAuras && token)
            return gridAwareAuras.getTokenAuras(token).find(entry => entry.aura?.name === auraName)?.aura ?? null;

        const actor = /** @type {Actor} */ (/** @type {any} */ (actorOrToken).actor || actorOrToken);
        const auras = actor?.getFlag('grid-aware-auras', 'auras');
        if (!auras)
            return null;
        return Object.values(auras).find(aura => aura.name === auraName) || null;
    }

    /**
     * Tokens currently standing in a named aura, straight from Grid-Aware Auras.
     * Covers auras defined on the token and on its actor's items.
     * @param {Actor|Token|TokenDocument} actorOrToken - Owner of the aura.
     * @param {string} auraName
     * @returns {Token[]|null} null when occupancy can't be resolved (GAA inactive, or no aura by that name).
     */
    static getTokensInAura(actorOrToken, auraName)
    {
        const gridAwareAuras = game.modules.get('grid-aware-auras')?.api;
        const token = LAAuras._auraToken(actorOrToken);
        const aura = LAAuras.findAura(actorOrToken, auraName);
        if (!gridAwareAuras?.getTokensInsideAura || !aura || !token)
            return null;
        return gridAwareAuras.getTokensInsideAura(token, aura.id).filter(entry => !entry.isPreview);
    }

    /**
     * Toggle an aura's enabled state on an actor by name.
     * @param {Actor|Token|TokenDocument} actorOrToken
     * @param {string} auraName
     * @param {boolean} [on] - true=enable, false=disable. Flip current state if omitted.
     * @returns {Promise<boolean|null>} new enabled state, or null if the aura wasn't found.
     */
    static async toggleAura(actorOrToken, auraName, on)
    {
        const actor = /** @type {Actor} */ (/** @type {any} */ (actorOrToken).actor || actorOrToken);
        const auras = actor?.getFlag('grid-aware-auras', 'auras');
        if (!auras)
            return null;
        const entry = Object.entries(auras).find(([, candidateAura]) => /** @type {any} */ (candidateAura).name === auraName);
        if (!entry)
            return null;
        const [key, aura] = entry;
        const currentEnabled = !!(/** @type {any} */ (aura).enabled);
        const next = typeof on === 'boolean' ? on : !currentEnabled;
        if (next === currentEnabled)
            return currentEnabled;
        await actor.setFlag('grid-aware-auras', 'auras', {
            ...auras,
            [key]: { ...(/** @type {any} */ (aura)), enabled: next }
        });
        return next;
    }
}

/** Scene grid size relative to baseline (100 px); multiply stroke / dash / texture-scale fields by this. */
export function gridScale()
{
    const gridSize = canvas?.scene?.grid?.size ?? canvas?.grid?.size ?? 100;
    return gridSize / 100;
}

/**
 * Scale lineWidth / lineDashSize / lineGapSize / fillTextureScale on an aura config in place.
 * @returns {object}
 */
export function scaleAuraStroke(aura)
{
    const scale = gridScale();
    if (scale === 1)
        return aura;
    if (typeof aura.lineWidth === 'number')
        aura.lineWidth = Math.max(1, Math.round(aura.lineWidth * scale));
    if (typeof aura.lineDashSize === 'number')
        aura.lineDashSize = Math.max(1, Math.round(aura.lineDashSize * scale));
    if (typeof aura.lineGapSize === 'number')
        aura.lineGapSize = Math.max(1, Math.round(aura.lineGapSize * scale));
    if (aura.fillTextureScale && typeof aura.fillTextureScale === 'object')
    {
        if (typeof aura.fillTextureScale.x === 'number')
            aura.fillTextureScale.x = Math.max(1, Math.round(aura.fillTextureScale.x * scale));
        if (typeof aura.fillTextureScale.y === 'number')
            aura.fillTextureScale.y = Math.max(1, Math.round(aura.fillTextureScale.y * scale));
    }
    return aura;
}

export const AurasAPI = {
    createAura: LAAuras.createAura,
    ensureAura: LAAuras.ensureAura,
    deleteAuras: LAAuras.deleteAuras,
    findAura: LAAuras.findAura,
    getTokensInAura: LAAuras.getTokensInAura,
    toggleAura: LAAuras.toggleAura,
    gridScale,
    scaleAuraStroke,
};
