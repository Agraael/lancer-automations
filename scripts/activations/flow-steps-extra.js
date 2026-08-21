import { startChoiceCard, deployWeaponToken, knockBackToken } from "../interactive/index.js";
import { getWeaponProfiles_WithBonus } from "../tools/misc-tools.js";
import { accDiffTargetToken, getMinGridDistance } from "../combat/grid-helpers.js";
import { injectKnockbackCheckbox } from "../bonuses/genericBonuses.js";
import { LA_INLINE_ATTACK_FX, playDefaultThrowFX } from "../fx/actionFX.js";
import { ActiveFlowState } from "./flows.js";

export async function throwChoiceStep(state)
{
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
                callback: () =>
                {
                    isThrow = false;
                } },
            { text: `Throw (${throwRange})`,
                icon: "fas fa-hammer",
                callback: () =>
                {
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

// Mirror LA throw choice into native thrown flag so the attack HUD checkbox opens ticked.
export async function syncThrowToAccDiffStep(state)
{
    const isThrow = !!state.la_extraData?.is_throw;
    const weapon = state.data?.acc_diff?.weapon;
    if (weapon)
        weapon.thrown = isThrow;
    return true;
}

// Mirror native thrown flag back to la_extraData so the HUD checkbox can trigger throw mechanics.
export async function syncAccDiffToThrowStep(state)
{
    if (state.data?.acc_diff?.weapon?.thrown)
    {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.is_throw = true;
    }
    return true;
}

export async function throwDeployStep(state)
{
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
    for (let i = 0; i < hitResults.length; i++)
    {
        if (hitResults[i]?.hit)
        {
            const tokenDoc = hitResults[i]?.target ?? accDiffTargetToken(targetInfos[i]);
            deployTarget = tokenDoc?.object || (tokenDoc?.id ? canvas.tokens.get(tokenDoc.id) : null) || tokenDoc;
            if (deployTarget)
                break;
        }
    }
    if (!deployTarget && targetInfos.length > 0)
    {
        const tokenDoc = accDiffTargetToken(targetInfos[0]);
        deployTarget = tokenDoc?.object || (tokenDoc?.id ? canvas.tokens.get(tokenDoc.id) : null) || tokenDoc;
    }

    const multipleTargets = targetInfos.length > 1;
    await deployWeaponToken(item, actor, token, {
        range: multipleTargets ? null : 1,
        at: multipleTargets ? null : deployTarget,
        title: `THROW ${item.name}`
    });

    return true;
}

export async function knockbackInjectStep(state)
{
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    injectKnockbackCheckbox(state);
    return true;
}

export async function knockbackDamageStep(state)
{
    if (!game.settings.get('lancer-automations', 'enableKnockbackFlow'))
        return true;
    const knockback = state.data?._csmKnockback;
    if (!knockback?.enabled)
        return true;

    const distance = knockback.value || 1;
    const targets = state.data?.targets || [];
    const hitTokens = [];

    for (const targetInfo of targets)
    {
        const target = targetInfo.target;
        if (target)
        {
            const tokenObj = target.object || (target.id ? canvas.tokens.get(target.id) : null) || target;
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
export function _actorSuppressId(x)
{
    return x?.actor?.uuid ?? x?.uuid ?? x?.actor?.id ?? x?.id ?? null;
}
function _suppressNextLwfxFor(actorOrToken)
{
    const id = _actorSuppressId(actorOrToken);
    if (!id)
        return;
    _lwfxSuppressActors.add(id);
    setTimeout(() => _lwfxSuppressActors.delete(id), 3000);
}

export const _lwfxForceActors = new Set();
function _forceNextLwfxFor(actorOrToken)
{
    const id = _actorSuppressId(actorOrToken);
    if (!id)
        return;
    _lwfxForceActors.add(id);
    setTimeout(() => _lwfxForceActors.delete(id), 3000);
}

export const _lwfxSourceRedirects = new Map();

/**
 * One-shot: the next lwfx effect fired by this actor plays from `sourceToken` instead.
 * Long window: attack HUDs can sit open on user input.
 * @param {Actor|Token} actorOrToken - Whose next effect gets redirected
 * @param {Token} sourceToken - Token the FX visually fires from
 */
export function redirectNextLwfxSource(actorOrToken, sourceToken)
{
    const id = _actorSuppressId(actorOrToken);
    if (!id || !sourceToken)
        return;
    _lwfxSourceRedirects.set(id, sourceToken);
    setTimeout(() => _lwfxSourceRedirects.delete(id), 60000);
}

// lwfx resolves FX from state.item; stubbed in after the card so no weapon-fire step sees it.
// An explicit fxItem wins over an item already carried by the flow.
export async function applyFxItemStub(state)
{
    const uuid = state.la_extraData?.fxItemUuid;
    if (!uuid)
        return true;
    const item = await fromUuid(uuid);
    if (item)
        state.item = item;
    return true;
}

export async function playInlineAttackFX(state)
{
    const title = state.data?.title;
    const fxPlayer = LA_INLINE_ATTACK_FX[title];
    if (!fxPlayer)
        return true;
    _suppressNextLwfxFor(state.actor);
    try
    {
        await fxPlayer(state);
    }
    catch (e)
    {
        console.error(`lancer-automations | FX "${title}" failed:`, e);
    }
    return true;
}

export async function playThrowFXIfNeeded(state)
{
    if (!state.la_extraData?.is_throw)
        return true;
    _suppressNextLwfxFor(state.actor);
    try
    {
        await playDefaultThrowFX(state);
    }
    catch (e)
    {
        console.error('lancer-automations | throw FX failed:', e);
    }
    return true;
}

const LWFX_PACK_ID = 'lancer-weapon-fx.weaponfx';
const LWFX_RANGED_DEFAULT_NAME = 'Pistol';

function _basicAttackContext(state)
{
    const sourceToken = state.actor?.getActiveTokens?.()[0] ?? state.actor?.token?.object ?? null;
    const hitResults = state.data?.hit_results ?? [];
    const accDiffTargets = state.data?.acc_diff?.targets ?? [];
    const targetTokens = [];
    for (let idx = 0; idx < Math.max(hitResults.length, accDiffTargets.length); idx++)
    {
        const target = hitResults[idx]?.target ?? accDiffTargets[idx]?.target ?? null;
        if (target)
            targetTokens.push(target);
    }
    const targetsMissed = new Set(hitResults.filter(hitResult => !hitResult.hit).map(hitResult => hitResult.target?.id).filter(Boolean));
    const targetsCrit = new Set(hitResults.filter(hitResult => hitResult.crit).map(hitResult => hitResult.target?.id).filter(Boolean));
    return { sourceToken, targetTokens, targetsMissed, targetsCrit };
}

async function _resolveLwfxMacro(name)
{
    const pack = game.packs?.get(LWFX_PACK_ID);
    if (!pack)
        return null;
    const search = (name ?? '').toLowerCase().trim();
    const docs = await pack.getDocuments();
    return docs.find(doc => (doc.name ?? '').toLowerCase().trim() === search) ?? null;
}

async function _playLwfxRangedDefault(actor, context)
{
    const macro = await _resolveLwfxMacro(LWFX_RANGED_DEFAULT_NAME);
    if (!macro)
        return;
    const MacroCls = CONFIG.Macro?.documentClass ?? globalThis.Macro;
    if (!MacroCls)
        return;
    const tempMacro = new MacroCls(macro.toObject());
    tempMacro.flags['lancer-weapon-fx'] = {
        ...(tempMacro.flags['lancer-weapon-fx'] ?? {}),
        flowInfo: {
            sourceToken: context.sourceToken,
            macroUuid: macro.uuid,
            targetTokens: context.targetTokens,
            targetsMissed: context.targetsMissed,
            targetsCrit: context.targetsCrit,
        },
    };
    tempMacro.ownership.default = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    _forceNextLwfxFor(actor);
    await tempMacro.execute({ actor: context.sourceToken?.actor, token: context.sourceToken });
}

// Item-less basic melee attack vs a target more than 1 grid away: play lwfx's ranged default instead of its melee one.
export async function playBasicRangedFXIfNeeded(state)
{
    if (state.la_extraData?.is_throw || state.la_extraData?.fxItemUuid)
        return true;
    if (LA_INLINE_ATTACK_FX[state.data?.title])
        return true;
    if (state.data?.attack_type !== 'Melee')
        return true;

    const context = _basicAttackContext(state);
    if (!context.sourceToken || context.targetTokens.length === 0)
        return true;

    let nearest = Infinity;
    for (const target of context.targetTokens)
    {
        const dist = getMinGridDistance(context.sourceToken, target);
        if (dist < nearest)
            nearest = dist;
    }
    if (nearest <= 1)
        return true;

    _suppressNextLwfxFor(state.actor);
    try
    {
        await _playLwfxRangedDefault(state.actor, context);
    }
    catch (e)
    {
        console.error('lancer-automations | basic ranged FX failed:', e);
    }
    return true;
}

// Damage flows spawned from a basic attack pick up tags/damage/bonuses injected on the attack.
export async function pullInjectedTagsFromAttack(state)
{
    const tags = ActiveFlowState.current?.injectedTags;
    if (Array.isArray(tags) && tags.length > 0)
    {
        if (!state.data)
            state.data = {};
        state.data.tags = [...(state.data.tags || []), ...tags];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.injectedTags = tags;
    }

    const damage = ActiveFlowState.current?.injectedDamage;
    if (Array.isArray(damage) && damage.length > 0)
    {
        if (!state.data)
            state.data = {};
        state.data.damage = [...(state.data.damage || []), ...damage];
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.injectedDamage = damage;
    }

    const flowBonus = ActiveFlowState.current?.flow_bonus;
    if (Array.isArray(flowBonus) && flowBonus.length > 0)
    {
        state.la_extraData = state.la_extraData || {};
        state.la_extraData.flow_bonus = [...(state.la_extraData.flow_bonus || []), ...flowBonus];
    }
    return true;
}
