import { MODULE_ID } from '../tools/constants.js';
import { getModuleSetting, getExternalSetting } from '../tools/settings-utils.js';

const SOCKET_CHANNEL = `module.${MODULE_ID}`;
const DSN_ID = 'dice-so-nice';
const DICE_STEP = `${MODULE_ID}:diceFirst`;
const SHOWN_FLAG = 'laDiceShown';
const WAIT_CAP_MS = 10000;
const POLL_MS = 30;

const FLOW_ANCHORS = {
    BasicAttackFlow: ['rollAttacks', 'printAttackCard'],
    WeaponAttackFlow: ['rollAttacks', 'printAttackCard'],
    TechAttackFlow: ['rollAttacks', 'printTechAttackCard'],
    StatRollFlow: ['rollCheck', 'printStatRollCard'],
    DamageRollFlow: ['rollCritDamage', 'printDamageCard'],
    StructureFlow: ['rollStructureTable', 'printStructureCard'],
    OverheatFlow: ['rollOverheatTable', 'printOverheatCard']
};

function pendingRolls(data)
{
    const damage = data.crit_damage_results?.length ? data.crit_damage_results : data.damage_results ?? [];

    const rolls = [
        data.roll,
        data.result?.roll,
        ...(data.attack_results ?? []).map(result => result.roll),
        ...damage.map(result => result.roll),
        data.self_heat_result?.roll
    ];

    return rolls.filter(roll => roll?.options && !roll.options[SHOWN_FLAG]);
}

async function playDice({ rolls, userId, whisper, blind, speaker })
{
    const dice3d = /** @type {any} */ (game).dice3d;
    const author = game.users.get(userId);

    if (!dice3d || !author)
        return;

    const isAuthor = author === game.user;
    const visible = !whisper.length || whisper.includes(game.user.id) || (isAuthor && !blind);
    const hideSecret = getExternalSetting(DSN_ID, 'hide3dDiceOnSecretRolls', false);
    const ghostMode = getExternalSetting(DSN_ID, 'showGhostDice', '0');
    const ghostAllowed = ghostMode === '1' || (ghostMode === '2' && isAuthor && hideSecret);

    if (!visible && !ghostAllowed && hideSecret)
        return;

    const options = { ghost: !visible && hideSecret, secret: whisper.length > 0 && hideSecret };
    await Promise.all(rolls.map(async roll => dice3d.showForRoll(roll, author, false, null, false, null, speaker, options)));
}

export function handleRemoteDice(payload)
{
    return playDice({ ...payload, rolls: payload.rolls.map(data => Roll.fromData(data)) });
}

function nearDiceEnd(leadMs)
{
    const box = /** @type {any} */ (game).dice3d?.box;
    let timer = null;

    const promise = new Promise(resolve =>
    {
        if (!box || !Number.isFinite(box.iteration) || !Number.isFinite(box.iterationsNeeded))
            return;

        const busy = box.rolling && box.iteration < box.iterationsNeeded;
        let last = box.iteration;
        let armed = false;

        timer = setInterval(() =>
        {
            const { iteration, iterationsNeeded } = box;
            armed ||= iteration < last || (!busy && iteration > last);
            last = iteration;

            const stepMs = (box.framerate > 0 && box.framerate < 1 ? box.framerate * 1000 : 1000 / 60) / (box.speed || 1);

            if (armed && box.rolling && (iterationsNeeded - iteration) * stepMs <= leadMs)
                resolve();
        }, POLL_MS);
    });

    return { promise, stop: () => clearInterval(timer) };
}

export async function showFlowDice(state)
{
    if (!state?.data || !getModuleSetting('diceFirst', false) || !(/** @type {any} */ (game).dice3d))
        return true;

    const rolls = pendingRolls(state.data);
    if (!rolls.length)
        return true;

    const rollMode = /** @type {any} */ (game.settings.get('core', 'rollMode'));
    const { whisper = [], blind = false } = ChatMessage.applyRollMode(/** @type {any} */ ({}), rollMode);
    const payload = { userId: game.user.id, whisper, blind, speaker: ChatMessage.getSpeaker({ actor: state.actor }) };

    for (const roll of rolls)
        roll.options[SHOWN_FLAG] = true;

    game.socket.emit(SOCKET_CHANNEL, { action: 'diceFirst', payload: { ...payload, rolls: rolls.map(roll => roll.toJSON()) } });

    const shown = playDice({ ...payload, rolls })
        .catch(error => console.warn(`${MODULE_ID} | dice first failed:`, error));

    if (document.hidden)
        return true;

    const leadMs = Number(getModuleSetting('diceFirstLead', 1000));
    const early = leadMs > 0 ? nearDiceEnd(leadMs) : null;
    const waits = [shown, new Promise(resolve => setTimeout(resolve, WAIT_CAP_MS))];

    if (early)
        waits.push(early.promise);

    await Promise.race(waits);
    early?.stop();

    return true;
}

function skipShownCardDice(messageId, interception)
{
    const message = /** @type {any} */ (game.messages.get(messageId));
    const rolls = message?.rolls ?? [];

    if (!rolls.length || !rolls.every(roll => roll.options?.[SHOWN_FLAG]))
        return;

    interception.willTrigger3DRoll = false;

    if (message.sound === CONFIG.sounds.dice && /** @type {any} */ (game).dice3d?.isEnabled())
        delete message.sound;
}

function wrapRollBurnCheck(flowSteps)
{
    const origRollBurnCheck = flowSteps.get('rollBurnCheck');
    if (!origRollBurnCheck)
        return;

    flowSteps.set('rollBurnCheck', async function wrappedRollBurnCheck(state, options)
    {
        const StatRollFlow = game.lancer?.flows?.get('StatRollFlow');

        if (!getModuleSetting('diceFirst', false) || !state.data || typeof StatRollFlow !== 'function')
            return origRollBurnCheck(state, options);

        const rollFlow = new StatRollFlow(state.actor, { title: 'BURN :: ENG', path: 'system.eng' });
        const success = await rollFlow.begin();

        state.data.check_total = rollFlow.state?.data?.result?.roll?.total;

        const message = /** @type {any} */ (game.messages.contents.at(-1));
        if (message?._dice3danimating)
            await /** @type {any} */ (game).dice3d.waitFor3DAnimationByMessageID(message.id);

        return success && state.data.check_total !== undefined && state.data.check_total !== null;
    });
}

export function registerDiceFirstFlowSteps(flowSteps, flows)
{
    flowSteps.set(DICE_STEP, showFlowDice);

    for (const [flowName, [rollStep, printStep]] of Object.entries(FLOW_ANCHORS))
    {
        const flow = flows.get(flowName);

        if (flow?.steps?.includes(rollStep))
            flow.insertStepAfter(rollStep, DICE_STEP);
        if (flow?.steps?.includes(printStep))
            flow.insertStepBefore(printStep, DICE_STEP);
    }

    wrapRollBurnCheck(flowSteps);
    Hooks.on('diceSoNiceMessageProcessed', skipShownCardDice);
}
