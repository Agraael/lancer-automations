import { chooseToken, startChoiceCard, deployWeaponToken, knockBackToken } from "../interactive/index.js";
import { getWeaponProfiles_WithBonus } from "../tools/misc-tools.js";
import { accDiffTargetToken } from "../combat/grid-helpers.js";
import { injectKnockbackCheckbox } from "../bonuses/genericBonuses.js";
import { LA_INLINE_ATTACK_FX, playDefaultThrowFX } from "../fx/actionFX.js";
import { ActiveFlowState } from "./flows.js";

export async function statRollTargetSelectStep(state) {
    if (!game.settings.get('lancer-automations', 'statRollTargeting')) {
        return true;
    }

    if (state.la_extraData?.targetTokenId || state.la_extraData?.chooseToken === false) {
        return true;
    }

    const actor = state.actor;
    const token = actor.token?.object || canvas.tokens.get(actor.token?.id) || canvas.tokens.controlled[0];
    if (!token) {
        return true;
    }

    // Infer stat from path (e.g. system.hull -> HULL)
    const STATS = new Set(['AGI', 'HULL', 'ENG', 'SYS', 'GRIT', 'TIER']);
    let statName = "STAT";
    if (state.data.path) {
        const parts = state.data.path.split('.');
        statName = parts[parts.length - 1].toUpperCase();
    }

    let targets = [];
    if (STATS.has(state.data.title)) {
        targets = await chooseToken(token, {
            title: `${statName} SAVE TARGET`,
            description: `Select a target to make it a Skill Save (Optional)`,
            count: 1,
            range: null,
            includeSelf: true
        });
    }

    if (targets && targets.length > 0) {
        const targetToken = targets[0];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.targetTokenId = targetToken.id;

        let targetVal = 10;
        const targetActor = targetToken.actor;

        if (targetActor.type === "npc" || targetActor.type === "deployable") {
            targetVal = targetActor.system.save || 10;
        } else if (targetActor.type === "mech") {
            const path = state.data.path;
            targetVal = foundry.utils.getProperty(targetActor, path) || 10;
        }

        state.la_extraData.targetVal = targetVal;

        const currentTitle = state.data.title || `${statName} Check`;
        let newTitle = currentTitle.replace("Check", "Save");
        if (!newTitle.includes("Save"))
            newTitle += " Save";

        state.data.title = `${newTitle} (>= ${targetVal})`;
    }

    return true;
}

export async function throwChoiceStep(state) {
    if (!game.settings.get('lancer-automations', 'enableThrowFlow'))
        return true;
    if (state.la_extraData?.is_throw)
        return true;

    const item = state.item;
    if (!item)
        return true;

    const profile = item.system?.active_profile;
    const tags = profile?.all_tags || item.system?.tags || [];
    const thrownTag = tags.find(t => t.lid === "tg_thrown" || t.id === "tg_thrown");
    if (!thrownTag)
        return true;

    const throwRange = thrownTag.val || thrownTag.num_val || "?";
    const activeProfileIdx = item.system?.selected_profile_index ?? 0;
    const activeProfileWithBonus = getWeaponProfiles_WithBonus(item, state.actor)?.[activeProfileIdx];
    const weaponRanges = (activeProfileWithBonus?.range ?? profile?.all_range ?? profile?.range ?? item.system?.range ?? [])
        .filter(r => r.type !== "Thrown")
        .map(r => `${r.type} ${r.val}`)
        .join(", ") || "—";

    let isThrow = false;
    const result = await startChoiceCard({
        mode: "or",
        title: item.name,
        icon: "cci cci-melee",
        description: "This weapon can be thrown.",
        choices: [
            { text: `Attack (${weaponRanges})`,
                icon: "cci cci-melee",
                callback: () => {
                    isThrow = false;
                } },
            { text: `Throw (${throwRange})`,
                icon: "fas fa-hammer",
                callback: () => {
                    isThrow = true;
                } }
        ]
    });

    if (result === null)
        return false;
    state.la_extraData = state.la_extraData || {};
    state.la_extraData.is_throw = isThrow;
    return true;
}

// After v3's initAttackData builds acc_diff, mirror LA's throw choice into the native
// thrown flag so v3's attack HUD opens with the checkbox ticked (and range/rules update).
export async function syncThrowToAccDiffStep(state) {
    const isThrow = !!state.la_extraData?.is_throw;
    const weapon = state.data?.acc_diff?.weapon;
    if (weapon) weapon.thrown = isThrow;
    return true;
}

// After v3's HUD closes, mirror the native thrown flag BACK into LA's is_throw so the user
// can opt into throw mechanics via the HUD checkbox without going through LA's dialog.
export async function syncAccDiffToThrowStep(state) {
    if (state.data?.acc_diff?.weapon?.thrown) {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.is_throw = true;
    }
    return true;
}

export async function throwDeployStep(state) {
    if (!state.la_extraData?.is_throw)
        return true;

    const item = state.item;
    if (!item)
        return true;

    const actor = state.actor;
    const token = actor?.token ? canvas.tokens.get(actor.token.id) : actor?.getActiveTokens()?.[0];
    const hitResults = state.data?.hit_results || [];
    const targetInfos = state.data?.acc_diff?.targets || [];

    let deployTarget = null;
    for (let i = 0; i < hitResults.length; i++) {
        if (hitResults[i]?.hit) {
            const tDoc = hitResults[i]?.target ?? accDiffTargetToken(targetInfos[i]);
            deployTarget = tDoc?.object || (tDoc?.id ? canvas.tokens.get(tDoc.id) : null) || tDoc;
            if (deployTarget)
                break;
        }
    }
    if (!deployTarget && targetInfos.length > 0) {
        const tDoc = accDiffTargetToken(targetInfos[0]);
        deployTarget = tDoc?.object || (tDoc?.id ? canvas.tokens.get(tDoc.id) : null) || tDoc;
    }

    const multipleTargets = targetInfos.length > 1;
    await deployWeaponToken(item, actor, token, {
        range: multipleTargets ? null : 1,
        at: multipleTargets ? null : deployTarget,
        title: `THROW ${item.name}`
    });

    return true;
}

export async function knockbackInjectStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    injectKnockbackCheckbox(state);
    return true;
}

export async function knockbackDamageStep(state) {
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    const kb = state.data?._csmKnockback;
    if (!kb?.enabled)
        return true;

    const distance = kb.value || 1;
    const targets = state.data?.targets || [];
    const hitTokens = [];

    for (const targetInfo of targets) {
        const t = targetInfo.target;
        if (t) {
            const tokenObj = t.object || (t.id ? canvas.tokens.get(t.id) : null) || t;
            if (tokenObj)
                hitTokens.push(tokenObj);
        }
    }

    if (hitTokens.length === 0)
        return true;

    const attackerToken = state.actor?.token?.object
        || canvas.tokens.get(state.actor?.token?.id)
        || state.actor?.getActiveTokens()?.[0];

    const itemName = state.item?.name || state.data?.title || 'Damage';
    await knockBackToken(hitTokens, distance, {
        title: `${itemName} Knockback`,
        triggeringToken: attackerToken
    });

    return true;
}

export const _lwfxSuppressActors = new Set();
export function _actorSuppressId(x) {
    return x?.actor?.uuid ?? x?.uuid ?? x?.actor?.id ?? x?.id ?? null;
}
function _suppressNextLwfxFor(actorOrToken) {
    const id = _actorSuppressId(actorOrToken);
    if (!id)
        return;
    _lwfxSuppressActors.add(id);
    setTimeout(() => _lwfxSuppressActors.delete(id), 3000);
}

export async function playInlineAttackFX(state) {
    const title = state.data?.title;
    const fxPlayer = LA_INLINE_ATTACK_FX[title];
    if (!fxPlayer)
        return true;
    _suppressNextLwfxFor(state.actor);
    try {
        await fxPlayer(state);
    } catch (e) {
        console.error(`lancer-automations | FX "${title}" failed:`, e);
    }
    return true;
}

export async function playThrowFXIfNeeded(state) {
    if (!state.la_extraData?.is_throw)
        return true;
    _suppressNextLwfxFor(state.actor);
    try {
        await playDefaultThrowFX(state);
    } catch (e) {
        console.error('lancer-automations | throw FX failed:', e);
    }
    return true;
}

// Damage flows spawned from a basic attack pick up tags/bonuses injected on the attack.
export async function pullInjectedTagsFromAttack(state) {
    const tags = ActiveFlowState.current?.injectedTags;
    if (Array.isArray(tags) && tags.length > 0) {
        if (!state.data)
            state.data = {};
        state.data.tags = [...(state.data.tags || []), ...tags];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.injectedTags = tags;
    }

    const flowBonus = ActiveFlowState.current?.flow_bonus;
    if (Array.isArray(flowBonus) && flowBonus.length > 0) {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.flow_bonus = [...(state.la_extraData.flow_bonus || []), ...flowBonus];
    }
    return true;
}
