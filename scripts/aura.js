/**
 * Wrapper for Grid-Aware Auras to support lambda function callbacks within Lancer Automations.
 * This utilizes libWrapper to intercept macro execution calls dynamically without modifying the original GAA codebase.
 */
import { hasReactionAvailable } from "./misc-tools.js";

export class LAAuras {
    /** Session cache of compiled aura macro callbacks, keyed on serialized source string. */
    static callbackCache = new Map();
    static _initialized = false;

    /**
     * Initialize the libWrapper intercept.
     */
    static init() {
        if (LAAuras._initialized)
            return;

        if (typeof libWrapper === "function") {
            libWrapper.register('lancer-automations', 'Macros.prototype.get', function (wrapped, ...args) {
                const id = args[0];
                if (typeof id === 'string' && id.startsWith('@@fn:')) {
                    const src = id.slice('@@fn:'.length);
                    let fn = LAAuras.callbackCache.get(src);
                    if (!fn) {
                        try {
                            fn = new Function('token', 'parent', 'aura', 'options',
                                `return (${src})(token, parent, aura, options);`
                            );
                            LAAuras.callbackCache.set(src, fn);
                        } catch (e) {
                            console.error(`lancer-automations | Failed to reconstruct Aura callback from source:`, e);
                            return wrapped(...args);
                        }
                    }
                    return {
                        canExecute: true,
                        execute: (params) => {
                            try {
                                fn(params.token, params.parent, params.aura, params.options);
                            } catch (e) {
                                console.error(`lancer-automations | Error executing Aura lambda function for aura '${params.aura?.name}':`, e);
                            }
                        }
                    };
                }
                return wrapped(...args);
            }, 'MIXED');
            LAAuras._initialized = true;
        } else {
            console.warn("lancer-automations | libWrapper not found, Grid-Aware Auras lambda functions will not work.");
        }
    }

    /**
     * Wrapper for Grid-Aware Auras `createAura`.
     * Intercepts `function` definitions in `macros` and converts them to virtual macro IDs.
     */
    static async createAura(owner, auraConfig) {
        const gaa = game.modules.get("grid-aware-auras");
        if (!gaa?.api?.createAura) {
            console.warn("lancer-automations | Grid-Aware Auras module is not active or does not support the API.");
            return undefined;
        }

        if (!LAAuras._initialized) {
            LAAuras.init();
        }

        let configToPass = foundry.utils.deepClone(auraConfig);

        const tokenDoc = owner.document ?? owner;
        if (tokenDoc?.actor) {
            const actor = tokenDoc.actor;
            const hasReaction = hasReactionAvailable(actor);
            const tokenFactionsApi = game.modules.get("token-factions")?.api;

            let resolvedColor = "#ffffff";
            if (tokenFactionsApi && hasReaction) {
                const color = await tokenFactionsApi.retrieveBorderFactionsColorFromToken(tokenDoc.name);
                if (color)
                    resolvedColor = color;
            } else if (actor.folder?.color && hasReaction) {
                resolvedColor = actor.folder.color;
            }

            const fillTexture = game.modules.get("templatemacro")?.active
                ? "modules/templatemacro/textures/hatching-cog.png"
                : "";

            const defaultAuraConfig = {
                _v: 1,
                unified: true,
                name: "lancer-automations-aura",
                enabled: true,
                animation: true,
                animationType: "scroll",
                animationSpeed: 0.1,
                animationInvert: true,
                fillAnimation: true,
                fillAnimationSpeed: 0.15,
                lineType: 2,
                lineWidth: 2,
                lineOpacity: 1,
                lineDashSize: 5,
                lineGapSize: 5,
                fillType: 2,
                fillOpacity: 0.15,
                fillTextureOffset: { x: 0, y: 0 },
                fillTextureScale: { x: 50, y: 50 },
                lineColor: "#ffffff",
                fillColor: resolvedColor,
                fillTexture: fillTexture,
                ownerVisibility: {
                    default: true,
                },
                nonOwnerVisibility: {
                    default: tokenDoc.disposition === CONST.TOKEN_DISPOSITIONS.FRIENDLY,
                }
            };

            configToPass = foundry.utils.mergeObject(defaultAuraConfig, configToPass);
        }

        if (configToPass.macros && Array.isArray(configToPass.macros)) {
            for (let macro of configToPass.macros) {
                if (typeof macro.function === 'function') {
                    const src = macro.function.toString();
                    macro.macroId = '@@fn:' + src;
                    LAAuras.callbackCache.set(src, macro.function);
                    delete macro.function; // Strip the function so GAA doesn't get confused
                }
            }
        }

        return await gaa.api.createAura(owner, configToPass);
    }

    /**
     * Passthrough wrapper for Grid-Aware Auras `deleteAuras`.
     */
    static async deleteAuras(owner, filter, options = {}) {
        const gaa = game.modules.get("grid-aware-auras");
        if (!gaa?.api?.deleteAuras)
            return [];
        return await gaa.api.deleteAuras(owner, filter, options);
    }

    /**
     * Finds an aura on an actor by its name.
     * @param {Actor|Token|TokenDocument} actorOrToken - The actor or token to search.
     * @param {string} auraName - The name of the aura to find.
     * @returns {object|null} The aura configuration object, or null if not found.
     */
    static findAura(actorOrToken, auraName) {
        const actor = /** @type {Actor} */ (/** @type {any} */ (actorOrToken).actor || actorOrToken);
        const auras = actor?.getFlag('grid-aware-auras', 'auras');
        if (!auras)
            return null;
        return Object.values(auras).find(a => a.name === auraName) || null;
    }
}

export const AurasAPI = {
    createAura: LAAuras.createAura,
    deleteAuras: LAAuras.deleteAuras,
    findAura: LAAuras.findAura
};
