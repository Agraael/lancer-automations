const MODULE_ID = 'lancer-automations';

const pendingRoll = new Set();
const rollOnRender = new Set();
const pendingApply = new Set();

function shouldAutoRoll(message)
{
    if (!game.settings.get(MODULE_ID, 'autoDamageRoll'))
        return false;
    if (message.author?.id !== game.user.id)
        return false;
    return !!message.flags?.lancer?.attackData;
}

function shouldWatchApply(message)
{
    if (!game.settings.get(MODULE_ID, 'autoDamageApply'))
        return false;
    return (message.flags?.lancer?.damageData?.targetDamageResults?.length ?? 0) > 0;
}

// author's client applies owned targets, active GM's client the rest
function isMyApplyDuty(message, targetActor)
{
    const author = message.author;
    if (author && targetActor.testUserPermission(author, 'OWNER'))
        return author.id === game.user.id;
    return game.users.activeGM?.id === game.user.id;
}

function autoApplyTargets(message, root)
{
    for (const group of root.querySelectorAll('.lancer-damage-button-group'))
    {
        const tokenDoc = group.dataset.target ? fromUuidSync(group.dataset.target) : null;
        const actor = /** @type {any} */ (tokenDoc)?.actor;
        if (!actor || !isMyApplyDuty(message, actor))
            continue;
        const button = group.querySelector('.lancer-damage-apply');
        if (button)
            setTimeout(() => button.click(), 0);
    }
}

/** @param {string} messageId @param {HTMLElement} [root] */
function clickDamageFlow(messageId, root)
{
    const scope = root ?? document.querySelector(`.chat-message[data-message-id="${messageId}"]`);
    const button = /** @type {HTMLElement|null} */ (scope?.querySelector('.lancer-damage-flow'));
    if (!button)
        return false;
    setTimeout(() => button.click(), 0);
    return true;
}

export function initAutoDamage()
{
    Hooks.on('createChatMessage', message =>
    {
        if (shouldAutoRoll(message))
            pendingRoll.add(message.id);
        if (shouldWatchApply(message))
            pendingApply.add(message.id);
    });

    for (const flowName of ['WeaponAttackFlow', 'BasicAttackFlow', 'TechAttackFlow'])
    {
        Hooks.on(`lancer.postFlow.${flowName}`, () =>
        {
            for (const messageId of pendingRoll)
            {
                if (!clickDamageFlow(messageId))
                    rollOnRender.add(messageId);
            }
            pendingRoll.clear();
        });
    }

    Hooks.on('renderChatMessageHTML', (message, htmlOrEl) =>
    {
        const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
        if (!root)
            return;
        if (rollOnRender.delete(message.id))
            clickDamageFlow(message.id, root);
        if (pendingApply.delete(message.id))
            autoApplyTargets(message, root);
    });
}
