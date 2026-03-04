/**
 * Wrapper for Grid-Aware Auras to support lambda function callbacks within Lancer Automations.
 * This utilizes libWrapper to intercept macro execution calls dynamically without modifying the original GAA codebase.
 */
export class LAAuras {
    static callbacks = new Map();
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
                if (typeof id === 'string' && id.startsWith('la_cb_')) {
                    const callback = LAAuras.callbacks.get(id);
                    if (callback) {
                        return {
                            canExecute: true,
                            execute: (params) => {
                                try {
                                    callback(params.token, params.parent, params.aura, params.options);
                                } catch (e) {
                                    console.error(`lancer-automations | Error executing Aura lambda function for aura '${params.aura?.name}':`, e);
                                }
                            }
                        };
                    }
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

        let configToPass = deepClone(auraConfig);

        const tokenDoc = owner.document ?? owner;
        if (tokenDoc?.actor) {
            const actor = tokenDoc.actor;
            const hasReaction = actor.system?.action_tracker?.reaction ?? 0;
            const tokenFactionsApi = game.modules.get("token-factions")?.api;

            let resolvedColor = "#000000";
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
                fillAnimation: true,
                fillAnimationSpeed: 0.15,
                lineType: 1,
                lineWidth: 3,
                lineOpacity: 1,
                lineDashSize: 15,
                lineGapSize: 15,
                fillType: 2,
                fillOpacity: 0.15,
                fillTextureOffset: { x: 0, y: 0 },
                fillTextureScale: { x: 50, y: 50 },
                lineColor: resolvedColor,
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
                    const cbId = `la_cb_${foundry.utils.randomID()}`;
                    LAAuras.callbacks.set(cbId, macro.function);
                    macro.macroId = cbId;
                    delete macro.function; // Strip the function so GAA doesn't get confused
                }
            }
        }

        return await gaa.api.createAura(owner, configToPass);
    }

    /**
     * Passthrough wrapper for Grid-Aware Auras `deleteAuras`.
     * Also cleans up any registered callbacks attached to these auras to prevent memory leaks.
     */
    static async deleteAuras(owner, filter, options = {}) {
        const gaa = game.modules.get("grid-aware-auras");
        if (!gaa?.api?.deleteAuras)
            return [];
        const deletedAuras = await gaa.api.deleteAuras(owner, filter, options);

        // Cleanup associated callbacks
        for (const aura of deletedAuras) {
            if (aura.macros) {
                for (const macro of aura.macros) {
                    if (macro.macroId && String(macro.macroId).startsWith('la_cb_')) {
                        LAAuras.callbacks.delete(macro.macroId);
                    }
                }
            }
        }

        return deletedAuras;
    }
}

export const AurasAPI = {
    createAura: LAAuras.createAura,
    deleteAuras: LAAuras.deleteAuras
};
