/* global game */

const MODULE_ID = 'lancer-automations';

const ROLL_TYPES = {
    attackRoll: {
        flows: ['BasicAttackFlow', 'WeaponAttackFlow'],
        insertBefore: 'printAttackCard',
        rerollStepName: 'rollAttacks',
        getRoll: (state) => state.data?.attack_results?.[0]?.roll ?? null,
        getSuccess: (state) => (state.data?.hit_results ?? []).some(hr => hr?.hit === true),
        getTargets: (state) => (state.data?.hit_results ?? []).map(hr => ({
            token: hr?.target ?? null,
            total: hr?.total ?? null,
            hit: hr?.hit ?? false,
            crit: hr?.crit ?? false
        })),
        applyChangeRoll: (state, newTotal) => {
            const attackResults = state.data?.attack_results ?? [];
            const hitResults = state.data?.hit_results ?? [];
            for (let i = 0; i < attackResults.length; i++) {
                const r = attackResults[i]?.roll;
                if (r)
                    r._total = newTotal;
                const hr = hitResults[i];
                if (hr) {
                    const isSmart = state.data?.is_smart ?? false;
                    const targetStat = isSmart
                        ? (hr.target?.actor?.system?.edef ?? 8)
                        : (hr.target?.actor?.system?.evasion ?? 5);
                    hr.total = String(newTotal).padStart(2, '0');
                    hr.hit = newTotal >= targetStat;
                    hr.crit = state.data?.attack_type !== 'Tech' && newTotal >= 20;
                }
            }
        }
    },
    techAttackRoll: {
        flows: ['TechAttackFlow'],
        insertBefore: 'printTechAttackCard',
        rerollStepName: 'rollAttacks',
        getRoll: (state) => state.data?.attack_results?.[0]?.roll ?? null,
        getSuccess: (state) => (state.data?.hit_results ?? []).some(hr => hr?.hit === true),
        getTargets: (state) => (state.data?.hit_results ?? []).map(hr => ({
            token: hr?.target ?? null,
            total: hr?.total ?? null,
            hit: hr?.hit ?? false
        })),
        applyChangeRoll: (state, newTotal) => {
            const attackResults = state.data?.attack_results ?? [];
            const hitResults = state.data?.hit_results ?? [];
            for (let i = 0; i < attackResults.length; i++) {
                const r = attackResults[i]?.roll;
                if (r)
                    r._total = newTotal;
                const hr = hitResults[i];
                if (hr) {
                    const edef = hr.target?.actor?.system?.edef ?? 8;
                    hr.total = String(newTotal).padStart(2, '0');
                    hr.hit = newTotal >= edef;
                }
            }
        }
    },
    damageRoll: {
        flows: ['DamageRollFlow'],
        insertBefore: 'printDamageCard',
        rerollStepName: 'rollNormalDamage',
        extraRerollSteps: ['rollReliable', 'rollCritDamage'],
        // rollNormalDamage pushes to these arrays instead of replacing, so clear first.
        beforeReroll: (state) => {
            if (state.data) {
                state.data.damage_results = [];
                state.data.reliable_results = [];
                state.data.targets = [];
            }
        },
        getRoll: (state) => state.data?.damage_results?.[0]?.roll ?? null,
        getSuccess: () => undefined,
        getTargets: (state) => (state.data?.targets ?? []).map(t => ({
            token: t?.target ?? null,
            damage: t?.damage ?? null
        })),
        applyChangeRoll: (state, newTotal) => {
            const r = state.data?.damage_results?.[0]?.roll;
            if (r)
                r._total = newTotal;
        }
    },
    skillRoll: {
        flows: ['StatRollFlow'],
        insertBefore: 'printStatRollCard',
        rerollStepName: 'rollCheck',
        getRoll: (state) => state.data?.result?.roll ?? null,
        getSuccess: (state) => {
            const total = state.data?.result?.roll?.total;
            if (typeof total !== 'number')
                return undefined;
            return total >= 10;
        },
        getTargets: () => undefined,
        applyChangeRoll: (state, newTotal) => {
            const r = state.data?.result?.roll;
            if (r)
                r._total = newTotal;
        }
    },
    structureRoll: {
        flows: ['StructureFlow'],
        insertBefore: 'noStructureRemaining',
        rerollStepName: 'rollStructureTable',
        getRoll: (state) => state.data?.result?.roll ?? null,
        getSuccess: () => undefined,
        getTargets: () => undefined,
        applyChangeRoll: (state, newTotal) => {
            const r = state.data?.result?.roll;
            if (r)
                r._total = newTotal;
        }
    },
    stressRoll: {
        flows: ['OverheatFlow'],
        insertBefore: 'noStressRemaining',
        rerollStepName: 'rollOverheatTable',
        getRoll: (state) => state.data?.result?.roll ?? null,
        getSuccess: () => undefined,
        getTargets: () => undefined,
        applyChangeRoll: (state, newTotal) => {
            const r = state.data?.result?.roll;
            if (r)
                r._total = newTotal;
        }
    }
};

function buildPayload(rollType, def, state, rerollCount, markDirty) {
    const token = state.actor?.token ? state.actor.token.object : state.actor?.getActiveTokens?.()?.[0];
    const roll = def.getRoll(state);
    const success = def.getSuccess(state);
    const targets = def.getTargets(state);

    const doReroll = async () => {
        if (def.beforeReroll)
            def.beforeReroll(state);
        const primaryStep = game.lancer?.flowSteps?.get(def.rerollStepName);
        if (typeof primaryStep !== 'function')
            throw new Error(`${MODULE_ID} | reroll(${rollType}): "${def.rerollStepName}" missing`);
        await primaryStep(state);
        for (const extra of def.extraRerollSteps ?? []) {
            const extraStep = game.lancer?.flowSteps?.get(extra);
            if (typeof extraStep === 'function')
                await extraStep(state);
        }
        markDirty();
    };

    // Shared card presentation for reroll() and changeRoll(). Mirrors the cancel pattern:
    // default opts (item, originToken, relatedToken) come from fn._defaultContext attached
    // at reactor dispatch. allowConfirm:true pops a choice card; allowConfirm:false runs silently.
    const presentCard = async (fn, { reasonText, title, choiceText, apply, preConfirm, postChoice, allowConfirm, userIdControl, opts }) => {
        const api = game.modules.get(MODULE_ID)?.api;
        const def2 = fn._defaultContext ?? {};
        const item = opts?.item ?? def2.item ?? null;
        const originToken = opts?.originToken ?? def2.originToken ?? null;
        const relatedToken = opts?.relatedToken ?? def2.relatedToken ?? null;
        const runApply = async (chose) => {
            if (chose)
                await apply();
            if (postChoice)
                await postChoice(chose);
        };
        if (!allowConfirm) {
            if (preConfirm) {
                const ok = await preConfirm();
                if (!ok)
                    return;
            }
            await runApply(true);
            return;
        }
        if (preConfirm) {
            const ok = await preConfirm();
            if (!ok)
                return;
        }
        const targetUid = userIdControl ?? api?.getTokenOwnerUserId(relatedToken) ?? api?.getActiveGMId();
        const result = await api.startChoiceCard({
            title,
            description: reasonText ?? undefined,
            item,
            originToken,
            relatedToken,
            userIdControl: targetUid,
            choices: [
                { text: choiceText, icon: 'fas fa-dice' },
                { text: 'Keep', icon: 'fas fa-times' }
            ]
        });
        await runApply(result?.choiceIdx === 0);
    };

    const autoTitle = (fn, fallback) => {
        const name = fn._defaultContext?.item?.name;
        return name ? `${String(name).toUpperCase()} \u2014 ${fallback}` : fallback;
    };

    const rollLine = () => {
        const r = def.getRoll(state);
        if (!r)
            return null;
        return `<code>${r.formula}</code> = <b>${r.total}</b>`;
    };
    const joinReason = (reasonText) => {
        const line = rollLine();
        return [reasonText, line].filter(Boolean).join('<br>') || null;
    };

    const reroll = async (reasonText = null, title = null, allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
        await presentCard(reroll, {
            reasonText: joinReason(reasonText),
            title: title ?? autoTitle(reroll, 'REROLL?'),
            choiceText: 'Reroll',
            apply: doReroll,
            preConfirm, postChoice, allowConfirm, userIdControl, opts
        });
    };

    const changeRoll = async (newTotal, reasonText = null, title = null, allowConfirm = true, userIdControl = null, preConfirm = null, postChoice = null, opts = {}) => {
        if (typeof newTotal !== 'number')
            throw new TypeError(`${MODULE_ID} | changeRoll(${rollType}): newTotal must be a number`);
        const apply = async () => {
            def.applyChangeRoll(state, newTotal);
            markDirty();
        };
        await presentCard(changeRoll, {
            reasonText: joinReason(reasonText),
            title: title ?? autoTitle(changeRoll, 'CHANGE ROLL?'),
            choiceText: `Change to ${newTotal}`,
            apply,
            preConfirm, postChoice, allowConfirm, userIdControl, opts
        });
    };

    return {
        triggeringToken: token,
        rollType,
        roll,
        total: roll?.total ?? null,
        success,
        targets,
        item: state.item ?? null,
        rerollCount,
        isReroll: rerollCount > 0,
        reroll,
        changeRoll,
        flowState: state
    };
}

async function applyBonusRerolls(state, rollType, def) {
    const api = game.modules.get(MODULE_ID)?.api;
    const actor = state.actor;
    if (!api || !actor)
        return;

    const globals = api.getGlobalBonuses?.(actor) ?? [];
    const constants = api.getConstantBonuses?.(actor) ?? [];
    const candidates = [
        ...globals.map(b => ({ b, source: 'global' })),
        ...constants.map(b => ({ b, source: 'constant' }))
    ].filter(({ b }) => b.type === 'reroll'
        && (!b.rollTypes || b.rollTypes.length === 0 || b.rollTypes.includes(rollType)));

    const consumed = [];
    const token = actor.token ? actor.token.object : actor.getActiveTokens?.()?.[0] ?? null;

    for (const entry of candidates) {
        const bonus = entry.b;
        const roll = def.getRoll(state);
        const rollLine = roll ? `<code>${roll.formula}</code> = <b>${roll.total}</b>` : null;
        const name = bonus.name || 'Reroll';
        const result = await api.startChoiceCard({
            title: `${String(name).toUpperCase()} \u2014 USE REROLL?`,
            description: rollLine ?? undefined,
            originToken: token,
            userIdControl: api.getTokenOwnerUserId?.(token) ?? api.getActiveGMId?.(),
            choices: [
                { text: 'Use', icon: 'fas fa-dice' },
                { text: 'Keep', icon: 'fas fa-times' }
            ]
        });
        if (result?.choiceIdx !== 0)
            continue;

        if (def.beforeReroll)
            def.beforeReroll(state);
        const primaryStep = game.lancer?.flowSteps?.get(def.rerollStepName);
        if (typeof primaryStep !== 'function')
            break;
        await primaryStep(state);
        for (const extra of def.extraRerollSteps ?? []) {
            const extraStep = game.lancer?.flowSteps?.get(extra);
            if (typeof extraStep === 'function')
                await extraStep(state);
        }
        consumed.push(entry);
    }

    for (const { b, source } of consumed) {
        if (!b.id)
            continue;
        if (source === 'global' && api.removeGlobalBonus)
            await api.removeGlobalBonus(actor, b.id, false);
        else if (source === 'constant' && api.removeConstantBonus)
            await api.removeConstantBonus(actor, b.id);
    }
}

function makeOnRollStep(rollType) {
    const def = ROLL_TYPES[rollType];
    return async function onRollStep(state) {
        const api = game.modules.get(MODULE_ID)?.api;
        if (!api?.handleTrigger)
            return true;
        await applyBonusRerolls(state, rollType, def);
        let rerollCount = 0;
        let dirty;
        do {
            dirty = false;
            const payload = buildPayload(rollType, def, state, rerollCount, () => {
                dirty = true;
                rerollCount++;
            });
            await api.handleTrigger('onRoll', payload);
        } while (dirty);
        return true;
    };
}

export function registerRerollFlowSteps(flowSteps, flows) {
    for (const [rollType, def] of Object.entries(ROLL_TYPES)) {
        const stepName = `lancer-automations:onRoll:${rollType}`;
        flowSteps.set(stepName, makeOnRollStep(rollType));
        for (const flowName of def.flows) {
            flows.get(flowName)?.insertStepBefore(def.insertBefore, stepName);
        }
    }
}
