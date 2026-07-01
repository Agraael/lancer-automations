/* global game */

const MODULE_ID = 'lancer-automations';

const _clone = (v) => (typeof foundry?.utils?.deepClone === 'function' ? foundry.utils.deepClone(v) : JSON.parse(JSON.stringify(v ?? null)));
const _snapshotAttackLike = (state) => ({
    attack_results: _clone(state.data?.attack_results ?? []),
    hit_results: _clone(state.data?.hit_results ?? [])
});
const _restoreAttackLike = (state, snap) => {
    if (!state.data) return;
    state.data.attack_results = snap.attack_results;
    state.data.hit_results = snap.hit_results;
};
const _snapshotSimpleRoll = (state) => ({ roll: _clone(state.data?.result?.roll ?? null) });
const _restoreSimpleRoll = (state, snap) => {
    if (state.data?.result)
        state.data.result.roll = snap.roll;
    else if (state.data)
        state.data.result = { roll: snap.roll };
};

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
        snapshot: _snapshotAttackLike,
        restore: _restoreAttackLike,
        applyChangeRoll: (state, newTotal) => {
            const attackResults = state.data?.attack_results ?? [];
            const hitResults = state.data?.hit_results ?? [];
            for (let i = 0; i < attackResults.length; i++) {
                const attackRoll = attackResults[i]?.roll;
                if (attackRoll)
                    attackRoll._total = newTotal;
                const hitResult = hitResults[i];
                if (hitResult) {
                    const isSmart = state.data?.is_smart ?? false;
                    const targetStat = isSmart
                        ? (hitResult.target?.actor?.system?.edef ?? 8)
                        : (hitResult.target?.actor?.system?.evasion ?? 5);
                    hitResult.total = String(newTotal).padStart(2, '0');
                    hitResult.hit = newTotal >= targetStat;
                    hitResult.crit = state.data?.attack_type !== 'Tech' && newTotal >= 20;
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
        snapshot: _snapshotAttackLike,
        restore: _restoreAttackLike,
        applyChangeRoll: (state, newTotal) => {
            const attackResults = state.data?.attack_results ?? [];
            const hitResults = state.data?.hit_results ?? [];
            for (let i = 0; i < attackResults.length; i++) {
                const techRoll = attackResults[i]?.roll;
                if (techRoll)
                    techRoll._total = newTotal;
                const hitResult = hitResults[i];
                if (hitResult) {
                    const edef = hitResult.target?.actor?.system?.edef ?? 8;
                    hitResult.total = String(newTotal).padStart(2, '0');
                    hitResult.hit = newTotal >= edef;
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
        snapshot: (state) => ({
            damage_results: _clone(state.data?.damage_results ?? []),
            reliable_results: _clone(state.data?.reliable_results ?? []),
            targets: _clone(state.data?.targets ?? [])
        }),
        restore: (state, snap) => {
            if (!state.data) return;
            state.data.damage_results = snap.damage_results;
            state.data.reliable_results = snap.reliable_results;
            state.data.targets = snap.targets;
        },
        applyChangeRoll: (state, newTotal) => {
            const damageRoll = state.data?.damage_results?.[0]?.roll;
            if (damageRoll)
                damageRoll._total = newTotal;
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
        snapshot: _snapshotSimpleRoll,
        restore: _restoreSimpleRoll,
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
        snapshot: _snapshotSimpleRoll,
        restore: _restoreSimpleRoll,
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
        snapshot: _snapshotSimpleRoll,
        restore: _restoreSimpleRoll,
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

    const makeChooseHandler = (titleStr) => async (orig, alt) => {
        const api = game.modules.get(MODULE_ID)?.api;
        const def2 = /** @type {any} */ (reroll)._defaultContext ?? {};
        const userOwners = api?.getTokenOwnerUserId(def2.relatedToken ?? def2.originToken ?? token);
        const pick = await api.startChoiceCard({
            title: titleStr,
            item: def2.item ?? null,
            originToken: def2.originToken ?? null,
            relatedToken: def2.relatedToken ?? null,
            userIdControl: userOwners ?? api?.getActiveGMId(),
            choices: [
                { text: `Alt (${alt ?? '?'})`, icon: 'fas fa-dice' },
                { text: `Original (${orig ?? '?'})`, icon: 'fas fa-undo' }
            ]
        });
        return pick?.choiceIdx === 0;
    };
    const doReroll = async (subtype = 'retry', titleForChoose = 'KEEP WHICH?') => {
        await _runRerollWithSubtype(def, state, _normalizeSubtype(subtype), makeChooseHandler(titleForChoose));
        markDirty();
    };


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

    const reroll = async (reasonText = null, subtype = 'retry', title = null, allowConfirm = true, userIdControl = null, opts = {}) => {
        const sub = _normalizeSubtype(subtype);
        const chooseTitle = title ?? autoTitle(reroll, 'KEEP WHICH?');
        const preConfirm = /** @type {any} */ (opts)?.preConfirm ?? null;
        const postChoice = /** @type {any} */ (opts)?.postChoice ?? null;
        await presentCard(reroll, {
            reasonText: joinReason(reasonText),
            title: title ?? autoTitle(reroll, 'REROLL?'),
            choiceText: `Reroll (${sub})`,
            apply: () => doReroll(sub, chooseTitle),
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

// Resolution priority: retry first (replaces), then highest/lowest (extremes), then choose last
// (so the user picks against the running best). Within a priority bucket, registration order.
const _SUBTYPE_PRIORITY = { retry: 0, highest: 1, lowest: 1, choose: 2 };
const _normalizeSubtype = (st) => {
    const v = String(st ?? 'retry').toLowerCase();
    return ['retry', 'highest', 'lowest', 'choose'].includes(v) ? v : 'retry';
};

// Shared executor: snapshot → run alt roll → resolve via subtype.
// `chooseHandler(originalTotal, altTotal) -> Promise<boolean>` returns true=keep alt, false=keep original.
async function _runRerollWithSubtype(def, state, subtype, chooseHandler) {
    const snap = def.snapshot ? def.snapshot(state) : null;
    const originalTotal = def.getRoll(state)?.total ?? null;

    if (def.beforeReroll)
        def.beforeReroll(state);
    const primaryStep = game.lancer?.flowSteps?.get(def.rerollStepName);
    if (typeof primaryStep !== 'function')
        throw new Error(`${MODULE_ID} | reroll: "${def.rerollStepName}" missing`);
    await primaryStep(state);
    for (const extra of def.extraRerollSteps ?? []) {
        const fn = game.lancer?.flowSteps?.get(extra);
        if (typeof fn === 'function')
            await fn(state);
    }

    const altTotal = def.getRoll(state)?.total ?? null;
    let keptOriginal = false;

    if (subtype === 'highest' && typeof originalTotal === 'number' && typeof altTotal === 'number')
        keptOriginal = originalTotal >= altTotal;
    else if (subtype === 'lowest' && typeof originalTotal === 'number' && typeof altTotal === 'number')
        keptOriginal = originalTotal <= altTotal;
    else if (subtype === 'choose' && typeof chooseHandler === 'function')
        keptOriginal = !(await chooseHandler(originalTotal, altTotal));
    // 'retry' default: keep alt — no restore.

    if (keptOriginal && snap && def.restore)
        def.restore(state, snap);

    return { originalTotal, altTotal, keptOriginal };
}

async function applyBonusRerolls(state, rollType, def) {
    const api = game.modules.get(MODULE_ID)?.api;
    const actor = state.actor;
    if (!api || !actor)
        return;

    const globals = api.getGlobalBonuses?.(actor) ?? [];
    const constants = api.getConstantBonuses?.(actor) ?? [];
    const candidates = [
        ...globals.map(bonus => ({ b: bonus, source: 'global' })),
        ...constants.map(bonus => ({ b: bonus, source: 'constant' }))
    ].filter(({ b: bonus }) => bonus.type === 'reroll'
        && (!bonus.rollTypes || bonus.rollTypes.length === 0 || bonus.rollTypes.includes(rollType)));

    candidates.sort((left, right) =>
        _SUBTYPE_PRIORITY[_normalizeSubtype(left.b.subtype)] - _SUBTYPE_PRIORITY[_normalizeSubtype(right.b.subtype)]);

    const consumed = [];
    const token = actor.token ? actor.token.object : actor.getActiveTokens?.()?.[0] ?? null;
    const userIdControl = api.getTokenOwnerUserId?.(token) ?? api.getActiveGMId?.();

    for (const candidate of candidates) {
        const bonus = candidate.b;
        const subtype = _normalizeSubtype(bonus.subtype);
        const name = bonus.name || 'Reroll';
        const upperName = String(name).toUpperCase();

        const currentRoll = def.getRoll(state);
        const rollLineHtml = currentRoll ? `<code>${currentRoll.formula}</code> = <b>${currentRoll.total}</b>` : null;
        const offer = await api.startChoiceCard({
            title: `${upperName} \u2014 USE REROLL?`,
            description: rollLineHtml ?? undefined,
            originToken: token,
            userIdControl,
            choices: [
                { text: `Use - (${subtype})`, icon: 'fas fa-dice' },
                { text: 'Keep', icon: 'fas fa-times' }
            ]
        });
        if (offer?.choiceIdx !== 0)
            continue;

        const chooseHandler = async (orig, alt) => {
            const pick = await api.startChoiceCard({
                title: `${upperName} \u2014 KEEP WHICH?`,
                originToken: token,
                userIdControl,
                choices: [
                    { text: `Alt (${alt ?? '?'})`, icon: 'fas fa-dice' },
                    { text: `Original (${orig ?? '?'})`, icon: 'fas fa-undo' }
                ]
            });
            return pick?.choiceIdx === 0;
        };
        try {
            await _runRerollWithSubtype(def, state, subtype, chooseHandler);
        } catch (e) {
            console.error(`${MODULE_ID} | bonus reroll failed:`, e);
            break;
        }

        consumed.push(candidate);
    }

    for (const { b: bonus, source } of consumed) {
        if (!bonus.id)
            continue;
        const usesCur = typeof bonus.uses === 'number' ? bonus.uses : null;
        if (usesCur !== null && usesCur > 1) {
            const newUses = usesCur - 1;
            if (source === 'constant' && api.addConstantBonus) {
                await api.addConstantBonus(actor, { ...bonus, uses: newUses });
            } else if (source === 'global') {
                const bonuses = actor.getFlag('lancer-automations', 'global_bonuses') || [];
                const updated = bonuses.map(existing => existing.id === bonus.id ? { ...existing, uses: newUses } : existing);
                await actor.setFlag('lancer-automations', 'global_bonuses', updated);
                const linkedEffect = actor.effects.find(effect => effect.getFlag('lancer-automations', 'linkedBonusId') === bonus.id);
                if (linkedEffect)
                    await linkedEffect.update({ 'flags.statuscounter.value': newUses });
            }
            continue;
        }
        if (source === 'global' && api.removeGlobalBonus)
            await api.removeGlobalBonus(actor, bonus.id, false);
        else if (source === 'constant' && api.removeConstantBonus)
            await api.removeConstantBonus(actor, bonus.id);
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
