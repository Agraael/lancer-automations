/** @returns {{ activationType: "code", activationMode: "instead" }} */
const codeInstead = () => ({ activationType: "code", activationMode: "instead" });

/**
 * Reaction config presets. Spread first, override after: `{ ...api.presets.ownActivation(), activationCode }`.
 * Each call returns a fresh object.
 */
export const presets = {
    codeInstead,

    /** @returns {AutomationConfig} The item's own activation: onActivation, source-matched, self only, auto, code instead. */
    ownActivation: () => ({
        triggers: ["onActivation"],
        onlyOnSourceMatch: true,
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        ...codeInstead()
    }),

    /**
     * @param {(TriggerType | CustomTriggerType)[]} triggers
     * @returns {AutomationConfig} Fires on the reactor's own events: self only, auto, code instead.
     */
    selfTrigger: (triggers) => ({
        triggers,
        actionType: "Automation",
        triggerSelf: true,
        triggerOther: false,
        autoActivate: true,
        outOfCombat: true,
        ...codeInstead()
    }),

    /**
     * @param {(TriggerType | CustomTriggerType)[]} triggers
     * @returns {AutomationConfig} A Lancer reaction to others: 1/Round, checks and awaits, in combat only, code instead.
     */
    reaction: (triggers) => ({
        triggers,
        actionType: "Reaction",
        frequency: "1/Round",
        triggerSelf: false,
        triggerOther: true,
        outOfCombat: false,
        autoActivate: true,
        awaitActivationCompletion: true,
        checkReaction: true,
        ...codeInstead()
    }),

    /**
     * @param {AutomationConfig['onInit']} [onInit]
     * @returns {AutomationConfig} Setup only: no triggers, runs onInit.
     */
    setup: (onInit = null) => ({
        triggers: [],
        triggerSelf: false,
        triggerOther: false,
        autoActivate: false,
        activationType: "none",
        ...(onInit ? { onInit } : {})
    })
};

export const AutomationPresetsAPI = { presets };
