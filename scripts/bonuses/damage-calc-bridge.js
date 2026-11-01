import { consumeEffectCharge } from "./flagged-effects.js";
import { MODULE_ID } from "../tools/constants.js";
import { broadcastFloatTokenText } from "../tools/float-text.js";
import { consumeResistanceUse, consumeVulnerabilityUse, getVulnerabilityBonuses, checkDamageResistances, checkDamageVulnerabilities } from "./genericBonuses.js";

// Resistance effects consumed on damage burn at apply time, after the halving they granted.
const _deferredResistanceConsumption = new Map();

/** Mirror of the defer, for clients that did not run the damage flow. */
export function receiveDeferredResistanceConsumption({ actorUuid, effectId, clear })
{
    if (!actorUuid)
        return;
    if (clear)
    {
        _deferredResistanceConsumption.delete(actorUuid);
        return;
    }
    if (!effectId)
        return;
    const pending = _deferredResistanceConsumption.get(actorUuid) ?? new Set();
    pending.add(effectId);
    _deferredResistanceConsumption.set(actorUuid, pending);
}

// The flow runs on the attacker's client but damageCalc runs on the defender's owner, so mirror it everywhere.
export function deferResistanceEffectConsumption(actor, effect)
{
    if (!actor?.uuid || !effect?.id)
        return;
    receiveDeferredResistanceConsumption({ actorUuid: actor.uuid, effectId: effect.id });
    game.socket.emit('module.lancer-automations', {
        action: 'deferResistanceConsumption',
        payload: { actorUuid: actor.uuid, effectId: effect.id }
    });
}

async function _consumeDeferredResistanceEffects(actor, damage, options)
{
    const pending = _deferredResistanceConsumption.get(actor.uuid);
    if (!pending)
        return;
    _deferredResistanceConsumption.delete(actor.uuid);
    game.socket.emit('module.lancer-automations', {
        action: 'deferResistanceConsumption',
        payload: { actorUuid: actor.uuid, clear: true }
    });
    if (options?.paracausal || actor.system?.statuses?.shredded)
        return;
    for (const effectId of pending)
    {
        const effect = actor.effects.get(effectId);
        if (!effect)
            continue;
        const coveredTypes = (effect.changes ?? [])
            .filter(change => change.key?.startsWith('system.resistances.'))
            .map(change => change.key.split('.').pop());
        const landed = coveredTypes.some(type => Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
        if (landed)
            await consumeEffectCharge(effect);
    }
}

function _scaleVulnerableDamage(actor, damage, options, vulnerabilityIds, aoe)
{
    if (!damage || getVulnerabilityBonuses(actor).length === 0)
        return [];
    const keyOf = (type) => type.charAt(0).toUpperCase() + type.slice(1);
    if (!actor.hasHeatcap?.() && Number(damage.Heat) > 0)
    {
        damage.Energy = (Number(damage.Energy) || 0) + Number(damage.Heat);
        damage.Heat = 0;
    }
    const vulnerable = ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat']
        .filter(type => Number(damage[keyOf(type)]) > 0 && checkDamageVulnerabilities(actor, type, vulnerabilityIds, aoe).length > 0);
    if (vulnerable.length === 0)
        return [];
    const multiple = [0.5, 1, 2].includes(options?.multiple) ? options.multiple : 1;
    const exposed = !!actor.system?.statuses?.exposed;
    const armored = ['kinetic', 'energy', 'explosive', 'variable'];
    const scaleOf = (type) => (multiple === 2 ? 2 : 1) * (exposed && armored.includes(type) ? 2 : 1);
    const resisted = (type) => multiple === 0.5 || !!actor.system?.resistances?.[type];
    const mitigated = !options?.paracausal && !actor.system?.statuses?.shredded;
    let armor = mitigated && !options?.ap ? (Number(actor.system?.armor) || 0) : 0;
    const armorTaken = {};
    const armorOrder = [...armored.filter(armoredType => !resisted(armoredType)), ...armored.filter(armoredType => resisted(armoredType))];
    for (const type of armorOrder)
    {
        armorTaken[type] = Math.min(armor, (Number(damage[keyOf(type)]) || 0) * scaleOf(type));
        armor -= armorTaken[type];
    }
    for (const type of vulnerable)
    {
        const landed = Number(damage[keyOf(type)]) * scaleOf(type);
        damage[keyOf(type)] = (2 * landed - (armorTaken[type] ?? 0)) / scaleOf(type);
    }
    return vulnerable;
}

// Bridges bonus-based resistances into damageCalc, which only reads system.resistances.
let _pendingApplyHalvedActorUuid = null;
let _pendingResistanceVerdict = null;
export function initDamageCalcWrapper()
{
    if (typeof libWrapper === 'undefined')
        return;

    // Cards with the half-damage box checked already halved their numbers; skip the bridge for those.
    document.body.addEventListener('click', (ev) =>
    {
        const button = ev.target?.closest?.('.lancer-damage-apply');
        if (!button)
            return;
        _pendingApplyHalvedActorUuid = null;
        _pendingResistanceVerdict = null;
        const chatMessageElement = button.closest('.chat-message.message');
        const damageData = game.messages?.get(chatMessageElement?.dataset.messageId)?.flags?.lancer?.damageData;
        const targetUuid = button.closest('.lancer-damage-button-group')?.dataset?.target;
        if (!damageData || !targetUuid)
            return;
        const targetResult = damageData.targetDamageResults?.find(entry => entry.target === targetUuid);
        const actorUuid = /** @type {any} */ (fromUuidSync(targetUuid))?.actor?.uuid ?? null;
        if (targetResult?.half_damage)
            _pendingApplyHalvedActorUuid = actorUuid;
        if (actorUuid && (Array.isArray(targetResult?.laResistance) || Array.isArray(targetResult?.laVulnerability)))
        {
            _pendingResistanceVerdict = {
                actorUuid,
                ids: Array.isArray(targetResult.laResistance) ? targetResult.laResistance : null,
                vulnerabilityIds: Array.isArray(targetResult.laVulnerability) ? targetResult.laVulnerability : null,
                aoe: targetResult.laAoe === true
            };
        }
    }, { capture: true });

    libWrapper.register(MODULE_ID,'CONFIG.Actor.documentClass.prototype.damageCalc',
        async function (wrapped, damage, options)
        {
            const alreadyHalved = _pendingApplyHalvedActorUuid !== null && _pendingApplyHalvedActorUuid === this.uuid;
            if (alreadyHalved)
                _pendingApplyHalvedActorUuid = null;
            // No verdict means no damage card decided this, so filtered bonuses stay permissive.
            const verdict = _pendingResistanceVerdict?.actorUuid === this.uuid ? _pendingResistanceVerdict : null;
            _pendingResistanceVerdict = null;
            const allowedIds = verdict?.ids ?? null;
            const aoe = verdict?.aoe === true;
            const resistances = this.system?.resistances;
            const bridged = [];
            if (resistances && !alreadyHalved)
            {
                for (const type of ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat'])
                {
                    if (!resistances[type] && checkDamageResistances(this, type, allowedIds, aoe).length > 0)
                    {
                        resistances[type] = true;
                        bridged.push(type);
                    }
                }
            }
            // damageCalc mutates the damage record, so snapshot which bridged types actually landed first.
            const mitigationBlocked = options?.paracausal || this.system?.statuses?.shredded;
            const spentOn = mitigationBlocked
                ? []
                : bridged.filter(type => Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
            const resistedTypes = mitigationBlocked
                ? []
                : ['kinetic', 'energy', 'explosive', 'variable', 'burn', 'heat']
                    .filter(type => resistances?.[type] && Number(damage?.[type.charAt(0).toUpperCase() + type.slice(1)]) > 0);
            const anyDamageRolled = ['Kinetic', 'Energy', 'Explosive', 'Variable', 'Burn', 'Heat']
                .some(type => Number(damage?.[type]) > 0);
            const showResisted = !mitigationBlocked && (resistedTypes.length > 0 || (options?.multiple === 0.5 && anyDamageRolled));
            let hpLanded;
            let vulnerableTypes = [];
            try
            {
                vulnerableTypes = _scaleVulnerableDamage(this, damage, options, verdict?.vulnerabilityIds ?? null, aoe);
                hpLanded = await wrapped(damage, options);
            }
            finally
            {
                for (const type of bridged)
                    resistances[type] = false;
            }
            if (spentOn.length)
                await consumeResistanceUse(this, null, { damageTypes: spentOn, aoe });
            if (vulnerableTypes.length)
                await consumeVulnerabilityUse(this, null, { damageTypes: vulnerableTypes, aoe });
            await _consumeDeferredResistanceEffects(this, damage, options);
            const floatToken = this.getActiveTokens?.()?.[0];
            if (showResisted && floatToken)
                broadcastFloatTokenText(floatToken, 'Resisted', 0x4da6ff);
            if (vulnerableTypes.length && floatToken)
                broadcastFloatTokenText(floatToken, 'Vulnerable', 0xff5c5c);
            Hooks.callAll('lancer-automations.battelog.damageApplied', this, hpLanded);
            return hpLanded;
        }, 'WRAPPER');
}
