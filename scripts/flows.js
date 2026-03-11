/**
 * Custom flows for Lancer Automations
 */

import { injectBonusToFlowState } from './genericBonuses.js';

import('./genericBonuses.js');

export function registerModuleFlows(flowSteps, flows) {

    const ActivationFlow = flows.get("ActivationFlow");
    if (!ActivationFlow) {
        console.error("lancer-automations | Could not find ActivationFlow to retrieve base Flow class");
        return;
    }
    const Flow = Object.getPrototypeOf(ActivationFlow);

    class SimpleActivationFlow extends Flow {
        constructor(uuid, data) {
            const initialData = {
                type: "action",
                title: data?.title || "",
                action: data?.action || null,
                detail: data?.detail || "",
                tags: data?.tags || []
            };
            super(uuid, initialData);
        }
    }

    SimpleActivationFlow.steps = ["printActionUseCard"];
    flows.set("SimpleActivationFlow", SimpleActivationFlow);
    console.log("lancer-automations | Registered SimpleActivationFlow");

}

export function registerFlowStatePersistence() {
    ['printAttackCard', 'printTechAttackCard'].forEach(stepName => {
        const originalStep = game.lancer.flowSteps.get(stepName);
        if (!originalStep) {
            return;
        }

        game.lancer.flowSteps.set(stepName, async function(state, options) {
            const hookId = Hooks.on("preCreateChatMessage", (message) => {
                const attackData = message.flags?.lancer?.attackData;
                if (attackData && attackData.executeEffectId === state.data?.executeEffectId) {
                    let flowState = {};
                    if (state.la_extraData && typeof state.la_extraData === 'object') {
                        flowState = { ...state.la_extraData };
                    }

                    if (Object.keys(flowState).length > 0) {
                        message.updateSource({
                            "flags.lancer-automations.flowState": flowState
                        });
                    }
                }
            });

            try {
                return await originalStep(state, options);
            } finally {
                Hooks.off("preCreateChatMessage", hookId);
            }
        });
    });
}

/**
 * A globally accessible active state reference for when flows are initialized synchronously from UI clicks.
 */
export const ActiveFlowState = {
    current: null
};

export function bindChatMessageStateInterceptor(message, html) {
    const flowState = message.flags?.["lancer-automations"]?.flowState;
    if (!flowState) {
        return;
    }

    // Use vanilla JS to add a capture-phase listener so it runs before Lancer's jQuery listener
    const damageBtn = html[0].querySelector(".lancer-damage-flow");
    if (damageBtn) {
        damageBtn.addEventListener("click", () => {
            ActiveFlowState.current = flowState;
            // Clear it shortly after in case the flow doesn't begin synchronously for some reason
            setTimeout(() => {
                ActiveFlowState.current = null;
            }, 100);
        }, true);
    }
}

/**
 * Injects extra data management methods into a given Flow state object.
 * This directly modifies the passed state object to include injectFlowExtraData and getFlowExtraData.
 * It is safe to call multiple times on the same object.
 * @param {Object} state - The flow state object
 * @returns {Object} The modified state object
 */
export function injectExtraDataUtility(state) {
    if (!state)
        return state;

    if (!state.injectFlowExtraData) {
        state.injectFlowExtraData = function(extraData) {
            this.la_extraData = foundry.utils.mergeObject(this.la_extraData || {}, extraData);
        };
    }

    if (!state.getFlowExtraData) {
        state.getFlowExtraData = function() {
            return this.la_extraData || {};
        };
    }

    if (!state.injectBonus) {
        state.injectBonus = function(bonus) {
            injectBonusToFlowState(this, bonus);
        };
    }

    return state;
}


