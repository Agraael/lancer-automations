import { getApiEntries, getTriggerHelperEntries, apiDocUrl } from '../setup/codemirror-hints.js';

// Shown before any search; everything else is reachable from the search box.
const CURATED_GROUPS = [
    { label: 'Cancel & modify the trigger', names: ['triggerData.cancel', 'triggerData.cancelAction', 'triggerData.cancelAttack', 'triggerData.cancelTechAttack', 'triggerData.cancelCheck', 'triggerData.cancelChange', 'triggerData.cancelTriggeredMove', 'triggerData.changeTriggeredMove', 'triggerData.cancelStructure', 'triggerData.cancelStress', 'triggerData.cancelStructureOutcome', 'triggerData.cancelStressOutcome', 'triggerData.cancelHpChange', 'triggerData.cancelHeatChange', 'triggerData.modifyHpChange', 'triggerData.modifyHeatChange', 'triggerData.modifyRoll', 'triggerData.reroll', 'triggerData.changeRoll'] },
    { label: 'Reach the reactor', names: ['triggerData.startRelatedFlow', 'triggerData.startRelatedFlowToReactor', 'triggerData.sendMessageToReactor', 'triggerData.endActivation', 'triggerData.debugActivation'] },
    { label: 'Attacks & rolls', names: ['executeBasicAttack', 'executeTechAttack', 'executeDamageRoll', 'executeSkirmish', 'executeBarrage', 'attackWith', 'beginWeaponAttackFlow', 'executeStatRoll', 'executeForceCheck', 'executeContestedCheck', 'openHaseContestCard', 'executeSaveVsEffect'] },
    { label: 'Activations', names: ['executeSimpleActivation', 'executeItemActivation', 'setItemAsActivated', 'getActivatedItems', 'endItemActivation', 'getFlowFlag', 'setFlowFlag', 'consumeOncePerRound'] },
    { label: 'Effects', names: ['applyEffectsToTokens', 'removeEffectsByNameFromTokens', 'findEffectOnToken', 'findEffectsOnToken', 'findEffectFrom', 'hasStatus', 'getAllEffects', 'deleteEffect', 'consumeEffectCharge', 'triggerEffectImmunity', 'ensureLinkedEffect', 'linkEffectToItem', 'applyMark', 'findMarkedTokens', 'clearMarks'] },
    { label: 'Bonuses', names: ['addGlobalBonus', 'removeGlobalBonus', 'addConstantBonus', 'removeConstantBonus', 'getGlobalBonuses', 'getConstantBonuses', 'ensureLinkedBonus', 'linkBonusToItem', 'unlinkBonusFromItem', 'getLinkedBonuses', 'injectBonusToFlowState'] },
    { label: 'Cards & choices', names: ['startChoiceCard', 'confirmCard', 'askCard', 'pickCard', 'pickItem', 'startVoteCard', 'openChoiceMenu'] },
    { label: 'Tokens & canvas', names: ['chooseToken', 'placeToken', 'moveToken', 'knockBackToken', 'placeZone', 'placeDeployable', 'spawnHardCover', 'createAura', 'ensureAura', 'findAura', 'getTokensInAura', 'deleteAuras'] },
    { label: 'HUD actions', names: ['addExtraActions', 'removeExtraActions', 'lockActorAction', 'unlockActorAction', 'lockActorActionTypes', 'unlockActorActionTypes', 'disableActorAction', 'enableActorAction', 'disableActorActionTypes', 'enableActorActionTypes', 'destroyItem', 'disableItem', 'restoreItem', 'setActionOverlay', 'getActionOverlay', 'addExtraDeploymentLids', 'setHidePrimaryAction'] },
    { label: 'Flags', names: ['getActorFlags', 'addActorFlags', 'removeActorFlags', 'getItemFlags', 'addItemFlags', 'getTokenFlags', 'addTokenFlags'] },
    { label: 'Queries', names: ['getTokenDistance', 'getMinGridDistance', 'findItemByLid', 'getWeapons', 'getMaxWeaponRanges_WithBonus', 'isHostile', 'isFriendly', 'canProvokeReaction', 'hasLineOfSight', 'consumeItemResource', 'getTier', 'tierValue'] },
];

const TAG_ROW = 'display: flex; align-items: baseline; gap: 5px; padding: 3px 8px; border-bottom: 1px solid var(--la-edge);';

function esc(str)
{
    return String(str ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
}

function rowHtml(entry)
{
    const docName = entry.docName ?? entry.name;
    const hasDoc = !!apiDocUrl(docName);
    const docLink = hasDoc
        ? `<a class="la-api-ref-doc" data-name="${esc(docName)}" title="Open the doc" style="margin-left: auto; flex-shrink: 0; cursor: pointer; color: var(--la-accent); font-size: 0.8em;"><i class="fas fa-book"></i></a>`
        : '';
    const returns = entry.returns
        ? `<span style="font-size: 0.7em; color: var(--la-ink-dim, #888); flex-shrink: 0;">&rarr; ${esc(entry.returns)}</span>`
        : '';
    const tip = entry.summary ? ` title="${esc(entry.summary)}"` : '';
    const nameAttrs = hasDoc
        ? `class="la-api-ref-doc" data-name="${esc(docName)}" title="Open the doc"`
        : '';
    const nameStyle = `${hasDoc ? 'cursor: pointer; ' : ''}font-weight: bold; font-size: 0.8em; color: var(--la-accent); flex-shrink: 0;`;
    return `<div class="la-api-ref-row" style="${TAG_ROW}"${tip}>
        <span ${nameAttrs} style="${nameStyle}">${esc(entry.name)}</span>
        <span style="font-size: 0.73em; color: var(--la-ink); opacity: 0.65; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0;">${esc(entry.args)}</span>
        ${returns}
        ${docLink}
    </div>`;
}

function groupsHtml(byName)
{
    return CURATED_GROUPS.map(group =>
    {
        const rows = group.names.map(name => byName.get(name)).filter(Boolean).map(rowHtml).join('');
        if (!rows)
            return '';
        return `<div class="la-api-ref-group">
            <div class="la-api-ref-head" style="padding: 5px 8px; font-weight: bold; font-size: 0.85em; color: var(--la-ink); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 6px; background: color-mix(in srgb, var(--primary-color), transparent 93%); border-bottom: 1px solid var(--la-edge);">
                <span class="la-caret" style="display: inline-block; width: 0.7em;">&#9654;</span>
                <span>${esc(group.label)}</span>
            </div>
            <div class="la-api-ref-body" style="display: none;">${rows}</div>
        </div>`;
    }).join('');
}

function searchHtml(entries, query)
{
    const needle = query.toLowerCase();
    const hits = entries.filter(entry =>
        entry.name.toLowerCase().includes(needle) || (entry.summary ?? '').toLowerCase().includes(needle));
    if (!hits.length)
        return `<div style="padding: 10px; font-size: 0.8em; color: var(--la-ink-dim, #888);">No function matches "${esc(query)}".</div>`;
    const shown = hits.slice(0, 80);
    const more = hits.length > shown.length
        ? `<div style="padding: 6px 8px; font-size: 0.75em; color: var(--la-ink-dim, #888);">${hits.length - shown.length} more, keep typing to narrow it down.</div>`
        : '';
    return shown.map(rowHtml).join('') + more;
}

/**
 * Draggable API reference panel for the activation editors.
 * @returns {{element: HTMLElement, destroy: Function}}
 */
export function openApiRefPopup()
{
    const entries = [...getTriggerHelperEntries(), ...getApiEntries()];
    const byName = new Map(entries.map(entry => [entry.name, entry]));

    const popup = document.createElement('div');
    popup.innerHTML = `
        <div class="la-api-ref-header" style="display: flex; align-items: center; padding: 6px 10px; background: var(--primary-color); color: #fff; cursor: move; border-radius: 6px 6px 0 0; font-weight: bold; font-size: 0.85em;">
            <span style="flex: 1;">Function Reference</span>
            <span class="la-api-ref-close" style="cursor: pointer; font-size: 1.2em; line-height: 1;">&times;</span>
        </div>
        <div style="padding: 6px 8px; border-bottom: 1px solid var(--la-edge);">
            <input type="text" class="la-api-ref-search" placeholder="Search all functions..." style="width: 100%; box-sizing: border-box; padding: 3px 6px; font-size: 0.8em; font-family: inherit; background: var(--la-plate); color: var(--la-ink); border: 1px solid var(--la-edge); border-radius: 3px; outline: none;">
        </div>
        <div class="la-api-ref-list" style="max-height: 420px; overflow-y: auto;">${groupsHtml(byName)}</div>
    `;
    Object.assign(popup.style, {
        position: 'fixed',
        top: '100px',
        left: '540px',
        width: '440px',
        background: 'var(--la-plate)',
        border: '2px solid var(--primary-color)',
        borderRadius: '6px',
        boxShadow: '0 4px 20px rgba(0,0,0,0.3)',
        zIndex: '10000',
        fontFamily: 'inherit'
    });

    const list = popup.querySelector('.la-api-ref-list');
    const bindGroupHeads = () =>
    {
        popup.querySelectorAll('.la-api-ref-head').forEach(head =>
        {
            head.addEventListener('click', () =>
            {
                const body = head.nextElementSibling;
                const caret = head.querySelector('.la-caret');
                const open = body.style.display !== 'none';
                body.style.display = open ? 'none' : 'block';
                if (caret)
                    caret.innerHTML = open ? '&#9654;' : '&#9660;';
            });
        });
    };
    bindGroupHeads();

    popup.querySelector('.la-api-ref-search').addEventListener('input', (event) =>
    {
        const query = String(event.currentTarget.value ?? '').trim();
        list.innerHTML = query ? searchHtml(entries, query) : groupsHtml(byName);
        if (!query)
            bindGroupHeads();
    });

    popup.addEventListener('click', (event) =>
    {
        const docEl = event.target.closest?.('.la-api-ref-doc');
        const url = docEl && apiDocUrl(docEl.dataset.name);
        if (url)
            window.open(url, '_blank', 'noopener');
    });

    let dragging = false, dx = 0, dy = 0;
    popup.querySelector('.la-api-ref-header').addEventListener('mousedown', (event) =>
    {
        dragging = true;
        dx = event.clientX - popup.offsetLeft;
        dy = event.clientY - popup.offsetTop;
        event.preventDefault();
    });
    const onDocMove = (event) =>
    {
        if (!dragging)
            return;
        popup.style.left = (event.clientX - dx) + 'px';
        popup.style.top = (event.clientY - dy) + 'px';
    };
    const onDocUp = () =>
    {
        dragging = false;
    };
    document.addEventListener('mousemove', onDocMove);
    document.addEventListener('mouseup', onDocUp);

    const destroy = () =>
    {
        document.removeEventListener('mousemove', onDocMove);
        document.removeEventListener('mouseup', onDocUp);
        popup.remove();
    };
    popup.querySelector('.la-api-ref-close').addEventListener('click', destroy);

    document.body.appendChild(popup);
    return { element: popup, destroy };
}
