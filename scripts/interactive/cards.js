/* global canvas, PIXI, game, ui, $, Hooks */

import { firstKeyFor } from "./keybindings.js";
import { isWhiteIcon } from "../tah/item-helpers.js";
import { createTokenMark } from "./target-shapes.js";

// Info Card Helpers (internal)

export function isWhiteSvgIcon(iconPath)
{
    return isWhiteIcon(iconPath);
}

const IMMOVABLE_ICON = 'modules/lancer-automations/icons/immovable.svg';

const _ELEV_KEY_LABELS = { KeyQ: 'Q', KeyE: 'E', KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S' };
function _elevationKeyLabels()
{
    const labelOf = (keyCode) => _ELEV_KEY_LABELS[keyCode] ?? (keyCode ? keyCode.replace(/^Key/, '') : '');
    return {
        up: labelOf(firstKeyFor('elevationUp')),
        down: labelOf(firstKeyFor('elevationDown')),
        tiltUp: labelOf(firstKeyFor('lineTiltUp')),
        tiltDown: labelOf(firstKeyFor('lineTiltDown')),
    };
}

export const _cardDefaults = {
    chooseToken: { title: "SELECT TARGETS", icon: "fas fa-crosshairs" },
    knockBack:   { title: "KNOCKBACK",       icon: "fas fa-arrow-right" },
    placeToken:  { title: "PLACE TOKEN",     icon: "fas fa-user-plus" },
    placeZone:   { title: "PLACE ZONE",      icon: "fas fa-bullseye" },
    choiceCard:  { title: "CHOICE",          icon: "fas fa-list" },
    deploymentCard: { title: "DEPLOY",      icon: "cci cci-deployable" },
    voteCard:    { title: "VOTE",            icon: "fas fa-poll" },
    haseContest: { title: "HASE CONTEST",    icon: "fas fa-dice-d20" },
    forceCheck:  { title: "FORCE CHECK",     icon: "mdi mdi-alert-circle-check-outline" }
};

// Card queue: serialise all interactive cards so they never overwrite each other
const INTER_CARD_DELAY_MS = 400;
let _cardQueue = Promise.resolve();
let _cardQueueTitles = []; // index 0 = active card, 1+ = pending
let _serialActive = false;

// Card visual stack: sub-cards push on top, parent cards re-appear when child pops
let _cardCallbackDepth = 0;  // >0 → inside a card callback, new cards push on stack
let _cardVisualStack = [];   // jQuery elements - topmost is visible

// _queueCard calls inside fn push onto the visual stack instead of waiting behind the serial queue.
export async function _runCardCallback(fn)
{
    _cardCallbackDepth++;
    try
    {
        return await fn();
    }
    finally
    {
        _cardCallbackDepth--;
    }
}

function _injectCardQueueStyles()
{
    if (document.getElementById('la-card-queue-styles'))
        return;
    const style = document.createElement('style');
    style.id = 'la-card-queue-styles';
    style.textContent = `
        .la-card-queue-banner {
            background: var(--primary-color, #b13a30);
            color: #ffffff;
            padding: 4px 12px;
            font-family: inherit;
            font-size: 0.82em;
            letter-spacing: 0.18em;
            text-transform: uppercase;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            border-bottom: 1px solid #000;
            cursor: help;
        }
        .la-card-queue-banner i {
            color: #ffffff;
            animation: la-card-queue-pulse 1.6s ease-in-out infinite;
        }
        .la-card-queue-banner b {
            color: #ffeb99;
            font-weight: 800;
            margin-right: 2px;
        }
        @keyframes la-card-queue-pulse {
            0%, 100% { opacity: 0.7; transform: rotate(0deg); }
            50%      { opacity: 1.0; transform: rotate(180deg); }
        }
    `;
    document.head.appendChild(style);
}

export function _updatePendingBadge()
{
    _injectCardQueueStyles();
    const hiddenAliveTitles = _cardVisualStack.slice(0, -1).map((cardEl) => cardEl[0]?._laCardTitle || 'Card');
    const serialPendingTitles = _cardQueueTitles.slice(_serialActive ? 1 : 0);
    const pendingTitles = [...hiddenAliveTitles, ...serialPendingTitles];
    const banner = $('.la-info-card .la-card-queue-banner');
    if (pendingTitles.length > 0)
    {
        const pendingCount = pendingTitles.length;
        const tooltip = pendingTitles.map((cardTitle, i) => `${i + 1}. ${cardTitle || 'Card'}`).join('<br>');
        const html = `<i class="fas fa-hourglass-half"></i><span><b>${pendingCount}</b> card${pendingCount === 1 ? '' : 's'} queued</span>`;
        if (banner.length)
            banner.html(html).attr('data-tooltip', tooltip);
        else
        {
            const div = document.createElement('div');
            div.className = 'la-card-queue-banner';
            div.dataset.tooltip = tooltip;
            div.dataset.tooltipDirection = 'UP';
            div.innerHTML = html;
            // Prepend INSIDE the visible card body (before the lancer-header).
            const hud = $('.la-info-card').last().find('.lancer-hud').first();
            if (hud.length)
                hud.prepend(div);
            else
                $('.la-info-card').last().prepend(div);
        }
    }
    else
        banner.remove();
}

export function _queueCardUrgent(fn, title = '')
{
    return _queueCard(fn, title, { urgent: true });
}

export function _queueCard(fn, title = '', { urgent = false } = {})
{
    // In-scope or urgent (reactive): push on visual stack, bypass serial queue
    if (urgent || _cardCallbackDepth > 0)
    {
        if (_cardVisualStack.length > 0)
            _cardVisualStack[_cardVisualStack.length - 1].hide();
        const promise = fn();
        _updatePendingBadge();
        return promise;
    }

    // Out-of-scope: normal queue behaviour
    const wasIdle = _cardQueueTitles.length === 0;
    _cardQueueTitles.push(title);
    _updatePendingBadge(); // badge on currently visible card, if any
    const next = _cardQueue.then(async () =>
    {
        if (!wasIdle)
            await new Promise((resolve) => setTimeout(resolve, INTER_CARD_DELAY_MS));
        while (_cardVisualStack.length > 0 && _cardVisualStack[_cardVisualStack.length - 1][0]?._laClose)
            await _cardVisualStack[_cardVisualStack.length - 1][0]._laClose;
        _serialActive = true;
        const promise = fn(); // card DOM created synchronously here
        _updatePendingBadge(); // badge on newly shown card
        return promise;
    });
    const _onCardDone = () =>
    {
        _serialActive = false;
        _cardQueueTitles.shift();
        _updatePendingBadge();
    };
    _cardQueue = next.then(_onCardDone, _onCardDone);
    return next;
}

export function _createInfoCard(type, opts)
{
    const defaults = _cardDefaults[type] || { title: "INFO", icon: "fas fa-info" };
    const {
        title = defaults.title,
        icon = defaults.icon,
        headerClass = "",
        description = "",
        origin = "",
        range = null,
        areaRange = null,
        pattern = "",
        count = 1,
        zoneType = "",
        zoneSize = 1,
        onConfirm = () =>
        {},
        onCancel = () =>
        {},
        relatedToken = null,
        originToken = null
    } = opts;

    // Remove orphaned info cards (not on the visual stack)
    $('.la-info-card').each(function ()
    {
        if (!_cardVisualStack.some(el => el[0] === this))
            $(this).remove();
    });

    let infoRowHtml = '';
    if (type !== "choiceCard" && type !== "deploymentCard" && type !== "voteCard" && type !== "haseContest" && type !== "forceCheck")
    {
        let infoItems = [];
        const isAoePattern = pattern === 'blast' || pattern === 'burst' || pattern === 'cone' || pattern === 'line';
        const shownRange = range !== null ? range : (isAoePattern ? areaRange : null);
        if (shownRange !== null && shownRange !== undefined)
            infoItems.push(`<span style="white-space:nowrap"><b>Range:</b> ${shownRange}</span>`);
        if (count !== -1)
            infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> ${count}</span>`);
        else
            infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> &infin;</span>`);
        if (type === "placeZone")
        {
            if (zoneType)
                infoItems.push(`<span style="white-space:nowrap"><b>Type:</b> ${zoneType}</span>`);
            infoItems.push(`<span style="white-space:nowrap"><b>Size:</b> ${zoneSize}</span>`);
        }
        if (infoItems.length > 0)
            infoRowHtml = `<label class="flexrow la-info-row lancer-border-primary">${infoItems.join('  ')}</label>`;
    }

    const descHtml = description
        ? `<div class="la-info-description">${description}</div>`
        : '';

    let dynamicHtml = "";
    if (type === "chooseToken")
    {
        const selectionCheckbox = opts.hasSelection ? `
            <label class="flexrow" style="gap:6px; align-items:center; margin-bottom:6px; cursor:pointer; font-size:12px;">
                <input type="checkbox" data-role="selection-toggle" checked style="margin:0;" />
                <span>Restrict to selection</span>
            </label>` : '';
        const isAreaPattern = opts.pattern === 'blast' || opts.pattern === 'burst' || opts.pattern === 'cone' || opts.pattern === 'line';
        const showAutoElev = opts.pattern === 'blast' || opts.pattern === 'cone' || opts.pattern === 'line'; // burst pins elevation to its host token
        const showQEHint = opts.pattern === 'blast' || opts.pattern === 'cone' || opts.pattern === 'line';
        const showRotateHint = opts.pattern === 'cone' || opts.pattern === 'line';
        const showTiltHint = opts.pattern === 'line';
        const elevKeys = _elevationKeyLabels();
        const blastSection = isAreaPattern ? `
            <h3 class="la-section-header lancer-border-primary">Placed Areas</h3>
            <div class="la-area-modes" data-role="area-modes" style="display:flex;gap:14px;align-items:center;padding:4px 4px 6px 4px;border-bottom:1px solid #ccc;margin-bottom:6px;color:#fff;font-size:11.5px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                    <input type="checkbox" data-role="elevation-aware-toggle" style="margin:0;">
                    <span>Elevation aware</span>
                </label>
                ${showAutoElev ? `<label data-role="auto-elevation-wrap" style="display:flex;align-items:center;gap:5px;cursor:pointer;">
                    <input type="checkbox" data-role="auto-elevation-toggle" style="margin:0;">
                    <span>Auto elevation</span>
                </label>` : ''}
                <label data-role="propagation-wrap" style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Area spreads cell-to-cell from its origin; terrain taller than the area blocks the spread">
                    <input type="checkbox" data-role="propagation-toggle" style="margin:0;">
                    <span>Propagation</span>
                </label>
                ${showQEHint ? `<span style="margin-left:auto;color:#666;font-size:10.5px;font-style:italic;">${elevKeys.down}/${elevKeys.up}: shift elevation</span>` : ''}
                ${showRotateHint ? `<span style="color:#666;font-size:10.5px;font-style:italic;">Ctrl+wheel: rotate</span>` : ''}
                ${showTiltHint ? `<span style="color:#666;font-size:10.5px;font-style:italic;">${elevKeys.tiltDown}/${elevKeys.tiltUp}: tilt</span>` : ''}
            </div>
            <div class="la-placed-areas" data-role="area-list">
                <div class="la-empty-state">No areas placed</div>
            </div>` : '';
        dynamicHtml = `
            ${selectionCheckbox}
            ${blastSection}
            <h3 class="la-section-header lancer-border-primary">Selected Targets</h3>
            <div class="la-selected-targets" data-role="target-list">
                <div class="la-empty-state">No targets selected</div>
            </div>`;
    }
    else if (type === "knockBack")
    {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Tokens to Move</h3>
            <div class="la-knockback-list" data-role="knockback-list">
                <!-- Populated dynamically -->
            </div>`;
    }
    else if (type === "placeToken")
    {
        const selectorHtml = opts.isMultiActor ? `
            <h3 class="la-section-header lancer-border-primary">Select Actor</h3>
            <div class="la-actor-selector" data-role="actor-selector" style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;"></div>` : '';
        dynamicHtml = `
            ${selectorHtml}
            <h3 class="la-section-header lancer-border-primary">Tokens to Place</h3>
            <div style="font-size:0.78em; opacity:0.85; margin:-4px 0 4px 0; display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:4px;cursor:pointer;"><input type="checkbox" data-role="placetoken-auto-elev" style="margin:0;"> Auto elevation</label>
                <span style="opacity:0.75;">Use <kbd>${_elevationKeyLabels().down}</kbd> / <kbd>${_elevationKeyLabels().up}</kbd> to offset before placing.</span>
            </div>
            <div style="font-size:0.78em; opacity:0.9; margin:0 0 4px 0; display:flex; align-items:center; gap:12px; flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:4px;" title="Placement range (blank = unlimited)">Range <input type="number" data-role="placetoken-range" value="${opts.range ?? ''}" min="0" max="99" style="width:48px;height:22px;font-size:0.9em;"></label>
                <label style="display:flex;align-items:center;gap:4px;" title="Max tokens (blank = unlimited)">Count <input type="number" data-role="placetoken-count" value="${opts.count === -1 ? '' : (opts.count ?? '')}" min="1" max="20" style="width:48px;height:22px;font-size:0.9em;"></label>
            </div>
            <div style="font-size:0.72em; opacity:0.7; font-style:italic; margin:-2px 0 4px 0; color:#b34700;">
                <i class="fas fa-info-circle" style="margin-right:4px;"></i>Placing outside range is allowed; out-of-range spots only show a soft warning.
            </div>
            <div class="la-placed-tokens" data-role="token-list">
                <div class="la-empty-state">No tokens placed</div>
            </div>`;
    }
    else if (type === "choiceCard")
    {
        const modeLabel = opts.mode === "and" ? "Complete All" : "Choose One";
        dynamicHtml = `
            ${opts.disabled ? '' : `<h3 class="la-section-header lancer-border-primary">${modeLabel}</h3>`}
            <div class="la-choice-list" data-role="choice-list"></div>`;
    }
    else if (type === "deploymentCard")
    {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Deployables</h3>
            <div class="la-deployment-list" data-role="deployment-list"></div>`;
    }
    else if (type === "voteCard")
    {
        dynamicHtml = `
            ${opts.disabled ? '' : `<h3 class="la-section-header lancer-border-primary">Cast Your Vote</h3>`}
            <div class="la-choice-list" data-role="choice-list"></div>
            <div class="la-vote-status" data-role="vote-status" style="font-size:0.8em; color:#aaa; margin-top:4px;"></div>`;
    }
    else if (type === "haseContest")
    {
        const contestCol = (side, name) => `
            <div class="la-contest-col" data-side="${side}" style="flex:1;min-width:0;display:flex;flex-direction:column;align-items:center;gap:5px;">
                <div style="font-weight:700;font-size:0.82em;letter-spacing:0.04em;opacity:0.85;">${name}</div>
                <div style="width:46px;height:46px;border-radius:3px;background:rgba(0,0,0,0.25);border:1px solid rgba(255,255,255,0.15);display:flex;align-items:center;justify-content:center;overflow:hidden;color:rgba(255,255,255,0.3);flex:0 0 auto;">
                    <i class="fas fa-crosshairs" data-role="token-placeholder"></i>
                    <img data-role="token-img" src="" style="width:100%;height:100%;object-fit:contain;display:none;">
                </div>
                <button type="button" data-role="pick-token" class="lancer-button lancer-secondary" style="width:100%;padding:5px 6px;overflow:hidden;">
                    <span data-role="token-label" style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Pick token</span>
                </button>
                <select data-role="skill" style="width:100%;padding:4px;" disabled></select>
            </div>`;
        dynamicHtml = `
            <div style="display:flex;gap:8px;align-items:center;">
                ${contestCol('a', 'Contender A')}
                <div style="font-weight:800;color:#c33;flex:0 0 auto;">VS</div>
                ${contestCol('b', 'Contender B')}
            </div>
            <label style="display:flex;align-items:center;gap:6px;font-size:0.82em;margin-top:8px;">
                <input type="checkbox" data-role="sendowner" checked style="margin:0;"> Send each roll to the token's owner
            </label>
            <button type="button" data-action="run-contest" class="lancer-button lancer-secondary submit default" disabled style="width:100%;margin-top:2px;padding:6px;font-weight:700;">
                <i class="fas fa-dice-d20"></i> RUN CONTEST
            </button>`;
    }
    else if (type === "forceCheck")
    {
        dynamicHtml = `
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;font-size:0.85em;">
                    <span style="flex:0 0 62px;font-weight:700;">Skill</span>
                    <select data-role="skill" style="flex:1;padding:4px;">
                        <option value="HULL">HULL</option>
                        <option value="AGI">AGI</option>
                        <option value="SYS">SYS</option>
                        <option value="ENG">ENG</option>
                    </select>
                </label>
                <div style="display:flex;align-items:center;gap:8px;font-size:0.85em;">
                    <span style="flex:0 0 62px;font-weight:700;">Save vs</span>
                    <div class="accdiff-ranges flexrow svelte-13q4b2q" style="flex:1;min-width:0;">
                        <button type="button" data-role="pick-savevs" class="range-button la-accdiff-target-button svelte-13q4b2q" style="overflow:hidden;">
                            <i class="fas fa-crosshairs"></i> <span data-role="savevs-label" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">Pick actor (optional)</span>
                        </button>
                    </div>
                    <span data-role="clear-savevs" title="Clear" style="cursor:pointer;color:#a33;padding:0 4px;display:none;"><i class="fas fa-times"></i></span>
                </div>
                <div style="font-size:0.72em;color:#888;font-style:italic;margin:-4px 0 0 70px;">Empty = plain HASE check (&ge; 10).</div>
                <div class="accdiff-grid__section svelte-13q4b2q" style="position:relative;">
                    <span class="accdiff-weight flex-center flexrow">Targets</span>
                    <div class="accdiff-ranges flexrow svelte-13q4b2q" data-role="target-row"></div>
                </div>
                <div class="la-forcecheck-targets" data-role="target-list" style="display:flex;flex-direction:column;gap:2px;">
                    <div class="la-empty-state">No targets</div>
                </div>
                <label style="display:flex;align-items:center;gap:6px;font-size:0.82em;">
                    <input type="checkbox" data-role="sendowner" checked style="margin:0;"> Send each roll to the token's owner
                </label>
                <button type="button" data-action="run-forcecheck" class="lancer-button lancer-secondary submit default" disabled style="width:100%;padding:6px;font-weight:700;margin-top:2px;">
                    <i class="mdi mdi-alert-circle-check-outline"></i> FORCE CHECK
                </button>
            </div>`;
    }
    else if (type === "placeZone")
    {
        const zoneElevKeys = _elevationKeyLabels();
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Placed Zones</h3>
            <div style="display:flex;gap:12px;align-items:center;font-size:11.5px;margin-bottom:4px;flex-wrap:wrap;">
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Tokens outside the zone's elevation band are not counted as inside it">
                    <input type="checkbox" data-role="zone-elev-toggle" ${opts.elevationAware === false ? '' : 'checked'} style="margin:0;">
                    <span>Elevation aware</span>
                </label>
                <label style="display:flex;align-items:center;gap:5px;cursor:pointer;" title="Base the zone's elevation on the terrain under it">
                    <input type="checkbox" data-role="zone-auto-elev" ${opts.autoElevation === false ? '' : 'checked'} style="margin:0;">
                    <span>Auto elevation</span>
                </label>
            </div>
            <div style="font-size:0.75em;opacity:0.8;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">
                <span data-role="zone-elev-readout">Elevation: auto</span>
                <span style="opacity:0.7;font-style:italic;">${zoneElevKeys.down}/${zoneElevKeys.up}: shift elevation</span>
            </div>
            <button type="button" data-role="place-more" style="width:100%;margin-bottom:6px;padding:5px;cursor:pointer;background:#3a9e6e;color:#fff;border:none;border-radius:3px;font-weight:600;">
                <i class="fas fa-plus"></i> Place Zone
            </button>
            <div class="la-placed-zones" data-role="zone-list">
                <div class="la-empty-state">No zones placed</div>
            </div>`;
    }
    else
    {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Placed Zones</h3>
            <button type="button" data-role="place-more" style="width:100%;margin-bottom:6px;padding:5px;cursor:pointer;background:#3a9e6e;color:#fff;border:none;border-radius:3px;font-weight:600;">
                <i class="fas fa-plus"></i> Place Zone
            </button>
            <div class="la-placed-zones" data-role="zone-list">
                <div class="la-empty-state">No zones placed</div>
            </div>`;
    }

    const showConfirm = type !== "choiceCard" && type !== "voteCard" && type !== "haseContest" && type !== "forceCheck";
    const showConfirmVote = type === "voteCard" && opts.isCreator;

    const html = `
    <div class="component grid-enforcement la-info-card" data-card-type="${type}">
        <div class="lancer lancer-hud window-content">
            <div class="lancer-header ${headerClass} medium">
                ${/[./]/.test(icon) ? `<img src="${icon}" style="width:32px;height:32px;object-fit:contain;flex-shrink:0;border:none;transform:scale(1.5);transform-origin:center;${opts.iconInvert ? 'filter:invert(1);' : ''}">` : `<i class="${icon} i--m" style="color:#fff;"></i>`}
                <div style="display:flex; flex-direction:column; min-width:0; overflow:hidden; flex:1;">
                    <span>${title}</span>
                    ${origin ? `<span style="font-size:0.7em; font-weight:normal; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${origin}</span>` : ''}
                </div>
                ${(originToken || relatedToken) ? `
                    <div style="display:flex;align-items:center;gap:3px;margin-left:auto;flex-shrink:0;">
                        ${originToken ? `<img data-role="origin-token" src="${originToken.document?.texture?.src ?? originToken.texture?.src ?? ''}" title="Origin Token" style="width:38px;height:38px;object-fit:contain;border:2px solid #ff6400;cursor:pointer;border-radius:3px;flex-shrink:0;">` : ''}
                        ${(originToken && relatedToken) ? `<span style="color:#aaa;font-size:0.8em;">→</span>` : ''}
                        ${relatedToken ? `<img data-role="related-token" src="${relatedToken.document?.texture?.src ?? relatedToken.texture?.src ?? ''}" title="Related Token" style="width:38px;height:38px;object-fit:contain;border:2px solid #4488ff;cursor:pointer;border-radius:3px;flex-shrink:0;">` : ''}
                    </div>` : ''}
            </div>
            <div class="la-info-card-body">
                ${infoRowHtml}
                ${descHtml}
                ${dynamicHtml}
                <div class="dialog-buttons flexrow">
                    ${showConfirm ? `<button class="lancer-button lancer-secondary dialog-button submit default" data-action="confirm" type="button"><i class="fas fa-check"></i> Confirm</button>` : ''}
                    ${showConfirmVote ? `<button class="lancer-button lancer-secondary dialog-button submit default" data-action="confirm-vote" type="button"><i class="fas fa-check-double"></i> Confirm Vote</button>` : ''}
                    <button class="dialog-button cancel" data-action="cancel" type="button"><i class="fas fa-times"></i> Cancel</button>
                </div>
            </div>
        </div>
    </div>`;

    // v13: #hudzone is created lazily (only with a Lancer HUD shown); fall back to #la-hudzone so cards always have a container.
    let container = $('#hudzone');
    if (!container.length)
    {
        let laHud = $('#la-hudzone');
        if (!laHud.length)
        {
            laHud = $('<div id="la-hudzone" class="lancer-hud-zone" style="position:fixed;bottom:0;right:var(--sidebar-width,38px);z-index:70;display:flex;flex-direction:column-reverse;align-items:flex-end;pointer-events:none;"></div>');
            $('body').append(laHud);
        }
        container = laHud;
    }
    container.append(html);
    const cardEl = $('.la-info-card').last();

    // Re-parent the card into Lancer's real #hudzone if it appears later (DAMAGE ROLL / ATTACK HUD opens).
    const reparentHook = Hooks.on('renderApplication', () =>
    {
        const realHud = document.getElementById('hudzone');
        if (realHud && cardEl[0].parentElement?.id !== 'hudzone')
            realHud.appendChild(cardEl[0]);
    });
    cardEl[0]._laReparentHook = reparentHook;

    cardEl.find('[data-action="confirm"]').on('click', () => onConfirm());
    cardEl.find('[data-action="confirm-vote"]').on('click', () => opts.onConfirmVote?.());
    cardEl.find('[data-action="cancel"]').on('click', () => onCancel());
    cardEl.find('[data-role="placetoken-range"]').on('change', (ev) =>
    {
        const raw = String($(ev.currentTarget).val() ?? '').trim();
        opts.onRangeChange?.(raw === '' ? null : Number(raw));
    });
    cardEl.find('[data-role="placetoken-count"]').on('change', (ev) =>
    {
        const raw = String($(ev.currentTarget).val() ?? '').trim();
        opts.onCountChange?.(raw === '' ? -1 : Number(raw));
    });
    if (originToken)
    {
        cardEl.find('[data-role="origin-token"]').on('click', () =>
        {
            canvas.animatePan(originToken.center);
        });
    }
    if (relatedToken)
    {
        cardEl.find('[data-role="related-token"]').on('click', () =>
        {
            canvas.animatePan(relatedToken.center);
        });
    }

    // v13: #hudzone handles anchoring and child stacking; no JS positioning needed.

    cardEl.css({ transform: 'translateY(30px)', opacity: 0 });
    cardEl.animate(
        { opacity: 1 },
        200,
        function ()
        {
            $(this).css('transform', 'translateY(0)');
        }
    );
    setTimeout(() => cardEl.css('transform', 'translateY(0)'), 10);

    cardEl[0]._laClose = new Promise((resolve) => { cardEl[0]._laCloseResolve = resolve; });
    cardEl[0]._laCardTitle = title;
    if (relatedToken)
        cardEl[0]._laRelatedMark = createTokenMark(relatedToken);
    _cardVisualStack.push(cardEl);
    return cardEl;
}

export function _updateInfoCard(cardEl, type, cardState)
{
    if (!cardEl || cardEl.length === 0)
        return;

    if (type === "chooseToken")
    {
        // Placed Areas section (blast mode only)
        if (cardState.pattern === 'blast' || cardState.pattern === 'burst' || cardState.pattern === 'cone' || cardState.pattern === 'line')
        {
            const modesEl = cardEl.find('[data-role="area-modes"]');
            if (modesEl.length)
            {
                const elevAware = !!cardState.elevationAware;
                const autoElev = !!cardState.autoElevation;
                const $elevAware = modesEl.find('[data-role="elevation-aware-toggle"]');
                const $autoElev = modesEl.find('[data-role="auto-elevation-toggle"]');
                $elevAware.prop('checked', elevAware);
                $autoElev.prop('checked', autoElev).prop('disabled', !elevAware);
                modesEl.find('[data-role="auto-elevation-wrap"]').css('opacity', elevAware ? 1 : 0.5);
                $elevAware.off('change').on('change', () => cardState.onToggleElevationAware?.());
                $autoElev.off('change').on('change', () => cardState.onToggleAutoElevation?.());
                const $prop = modesEl.find('[data-role="propagation-toggle"]');
                $prop.prop('checked', !!cardState.propagation).prop('disabled', !elevAware);
                modesEl.find('[data-role="propagation-wrap"]').css('opacity', elevAware ? 1 : 0.5);
                $prop.off('change').on('change', () => cardState.onTogglePropagation?.());
            }
            const areaEl = cardEl.find('[data-role="area-list"]');
            areaEl.empty();
            const placements = cardState.placements ?? [];
            if (placements.length === 0)
                areaEl.html('<div class="la-empty-state">No areas placed</div>');
            else
            {
                const aoeIconSrc = cardState.pattern === 'burst'
                    ? 'systems/lancer/assets/icons/aoe_burst.svg'
                    : cardState.pattern === 'cone' ? 'systems/lancer/assets/icons/aoe_cone.svg'
                        : cardState.pattern === 'line' ? 'systems/lancer/assets/icons/aoe_line.svg'
                            : 'systems/lancer/assets/icons/aoe_blast.svg';
                for (const placement of placements)
                {
                    const tokensHtml = placement.candidates.map(candidate =>
                    {
                        const dimmed = !candidate.eligible;
                        const checked = candidate.included ? 'checked' : '';
                        const disabled = dimmed ? 'disabled' : '';
                        return `
                            <label class="la-area-token-row" data-token-id="${candidate.id}" style="display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:${dimmed ? 'not-allowed' : 'pointer'};opacity:${dimmed ? 0.45 : 1};font-size:11px;">
                                <input type="checkbox" data-role="area-token-toggle" ${checked} ${disabled} style="margin:0;">
                                <img src="${candidate.img}" alt="${candidate.name}" style="width:18px;height:18px;object-fit:contain;border:1px solid #555;border-radius:2px;">
                                <span style="${candidate.filtered ? 'text-decoration:line-through;' : ''}">${candidate.name}</span>
                            </label>`;
                    }).join('');
                    const filterToggleHtml = placement.hasFiltered ? `
                        <label style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:10.5px;color:#666;cursor:pointer;">
                            <input type="checkbox" data-role="area-filter-toggle" ${placement.ignoreFilter ? 'checked' : ''} style="margin:0;">
                            <span>Ignore filter</span>
                        </label>` : '';
                    const candidatesHtml = placement.candidates.length === 0
                        ? '<div style="font-size:10.5px;color:#888;font-style:italic;padding:2px 4px;">No tokens caught</div>'
                        : tokensHtml;
                    const oorWarn = placement.centerOutOfRange
                        ? `<div style="font-size:10.5px;color:#b34700;font-style:italic;margin-bottom:3px;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>Area center out of range</div>`
                        : '';
                    const elevBadge = cardState.elevationAware
                        ? `<span style="font-size:10.5px;color:#555;padding:0 4px;" title="Q/E to adjust">Elev ${placement.elevation}${placement.elevationOffset ? ` (${placement.elevationOffset > 0 ? '+' : ''}${placement.elevationOffset})` : ''}</span>`
                        : '';
                    areaEl.append(`
                        <div class="la-placed-area" data-area-id="${placement.id}" style="border:1px solid ${placement.centerOutOfRange ? '#ffaa00' : '#aaa'};border-radius:3px;padding:4px;margin-bottom:4px;background:${placement.centerOutOfRange ? '#fff6e0' : '#fafafa'};color:#111;">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <img src="${aoeIconSrc}" alt="${cardState.pattern}" style="width:16px;height:16px;object-fit:contain;flex-shrink:0;">
                                <span style="flex:1;font-weight:600;font-size:12px;color:#111;">${placement.label}</span>
                                ${elevBadge}
                                <span style="font-size:10.5px;color:#555;">(${placement.count} target${placement.count === 1 ? '' : 's'})</span>
                                <span class="la-area-remove" style="cursor:pointer;color:#a00;padding:0 4px;" title="Remove area"><i class="fas fa-times"></i></span>
                            </div>
                            ${oorWarn}
                            <div class="la-area-tokens" style="color:#111;">${candidatesHtml}</div>
                            ${filterToggleHtml}
                        </div>`);
                }
                areaEl.find('.la-placed-area').each(function ()
                {
                    const $area = $(this);
                    const areaId = Number($area.data('area-id'));
                    $area.find('.la-area-remove').on('click', (e) =>
                    {
                        e.stopPropagation();
                        cardState.onRemoveArea?.(areaId);
                    });
                    $area.find('[data-role="area-token-toggle"]').on('change', function (e)
                    {
                        e.stopPropagation();
                        const tokenId = $(this).closest('.la-area-token-row').data('token-id');
                        cardState.onToggleAreaToken?.(areaId, String(tokenId));
                    });
                    $area.find('[data-role="area-filter-toggle"]').on('change', (e) =>
                    {
                        e.stopPropagation();
                        cardState.onToggleAreaFilter?.(areaId);
                    });
                    $area.find('.la-area-token-row').each(function ()
                    {
                        const $row = $(this);
                        const tokenId = String($row.data('token-id') ?? '');
                        $row.on('mouseenter', () => cardState.onHoverToken?.(tokenId));
                        $row.on('mouseleave', () => cardState.onUnhoverToken?.());
                    });
                });
            }
        }

        const listEl = cardEl.find('[data-role="target-list"]');
        listEl.empty();

        if (cardState.selectedTokens.size === 0)
            listEl.html('<div class="la-empty-state">No targets selected</div>');
        else
        {
            for (const token of cardState.selectedTokens)
            {
                const imgSrc = token.document.texture.src;
                const name = token.name;
                const warns = cardState.warnings?.[token.id] ?? [];
                const warnHtml = warns.length > 0
                    ? `<div class="la-target-warnings" style="width:100%;margin-top:3px;font-size:10.5px;color:#b34700;font-style:italic;">
                           ${warns.map(w => `<div><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>${w}</div>`).join('')}
                       </div>`
                    : '';
                listEl.append(`
                    <div class="la-selected-target" data-token-id="${token.id}" style="flex-wrap:wrap;${warns.length > 0 ? 'border-color:#ffaa00;background:#fff6e0;' : ''}">
                        <img src="${imgSrc}" alt="${name}">
                        <span class="la-selected-target-name">${name}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                        ${warnHtml}
                    </div>`);
            }

            listEl.find('.la-selected-target').on('click', function ()
            {
                const tokenId = $(this).data('token-id');
                if (cardState.onDeselect)
                    cardState.onDeselect(tokenId);
            });
            listEl.find('.la-selected-target').each(function ()
            {
                const $row = $(this);
                const tokenId = String($row.data('token-id') ?? '');
                $row.on('mouseenter', () => cardState.onHoverToken?.(tokenId));
                $row.on('mouseleave', () => cardState.onUnhoverToken?.());
            });
        }
    }
    else if (type === "placeZone")
    {
        const placeBtn = cardEl.find('[data-role="place-more"]');
        if (placeBtn.length)
        {
            const can = cardState.canPlaceMore !== false;
            placeBtn.prop('disabled', !can).css({ opacity: can ? 1 : 0.45, cursor: can ? 'pointer' : 'not-allowed' });
            placeBtn.off('click').on('click', () =>
            {
                if (cardState.canPlaceMore !== false)
                    cardState.onPlaceMore?.();
            });
        }
        const listEl = cardEl.find('[data-role="zone-list"]');
        listEl.empty();

        if (cardState.placedZones.length === 0)
            listEl.html('<div class="la-empty-state">No zones placed</div>');
        else
        {
            cardState.placedZones.forEach((zone, idx) =>
            {
                const label = `Zone ${idx + 1}`;
                listEl.append(`
                    <div class="la-selected-target" data-zone-index="${idx}">
                        <i class="fas fa-bullseye" style="color:var(--primary-color); font-size:16px;"></i>
                        <span class="la-selected-target-name">${label}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function ()
            {
                const zoneIdx = $(this).data('zone-index');
                if (cardState.onDeleteZone)
                    cardState.onDeleteZone(zoneIdx);
            });
        }
    }
    else if (type === "placeToken")
    {
        const autoElevEl = cardEl.find('[data-role="placetoken-auto-elev"]');
        autoElevEl.prop('checked', cardState.autoElevation !== false);
        autoElevEl.off('change').on('change', () => cardState.onToggleAutoElevation?.());

        if (cardState.isMultiActor && cardState.actorEntries)
        {
            const selectorEl = cardEl.find('[data-role="actor-selector"]');
            selectorEl.empty();
            cardState.actorEntries.forEach((entry, idx) =>
            {
                const isActive = idx === cardState.activeActorIndex;
                const borderColor = isActive ? '#ff6400' : '#555';
                const opacity = isActive ? '1' : '0.6';
                const imgSrc = entry.texture || entry.actor?.img || '';
                const imgHtml = imgSrc
                    ? `<img src="${imgSrc}" style="width:32px; height:32px; object-fit:contain;">`
                    : `<i class="fas fa-user" style="font-size:20px; color:#ccc;"></i>`;
                selectorEl.append(`
                    <div class="la-actor-entry" data-actor-index="${idx}" title="${entry.name}"
                         style="cursor:pointer; padding:3px; border:2px solid ${borderColor}; border-radius:4px;
                                background:${isActive ? 'rgba(255,100,0,0.15)' : 'transparent'}; opacity:${opacity};
                                display:flex; align-items:center; gap:4px; transition:all 0.15s;">
                        ${imgHtml}
                        <span style="font-size:0.8em; white-space:nowrap; max-width:80px; overflow:hidden; text-overflow:ellipsis;">${entry.name}</span>
                    </div>`);
            });
            selectorEl.find('.la-actor-entry').on('click', function ()
            {
                const idx = $(this).data('actor-index');
                if (cardState.onSelectActor)
                    cardState.onSelectActor(idx);
            });
        }

        const listEl = cardEl.find('[data-role="token-list"]');
        listEl.empty();

        if (cardState.placements.length === 0)
            listEl.html('<div class="la-empty-state">No tokens placed</div>');
        else
        {
            cardState.placements.forEach((placement, idx) =>
            {
                const entry = cardState.actorEntries?.[placement.actorIndex ?? 0];
                const imgSrc = entry?.texture || "";
                const tokenName = entry?.name || `Token ${idx + 1}`;
                const imgHtml = imgSrc
                    ? `<img src="${imgSrc}" style="width:24px; height:24px; object-fit:contain; border:1px solid #000; margin-right:8px;">`
                    : `<i class="fas fa-user" style="color:#ff6400; font-size:16px; margin-right:8px;"></i>`;
                const warns = cardState.warnings?.[idx] ?? [];
                const warnHtml = warns.length > 0
                    ? `<div class="la-target-warnings" style="width:100%;margin-top:3px;font-size:10.5px;color:#b34700;font-style:italic;">
                           ${warns.map(w => `<div><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>${w}</div>`).join('')}
                       </div>`
                    : '';
                const elev = typeof placement.elevation === 'number' ? placement.elevation : 0;
                const elevKeys = _elevationKeyLabels();
                const elevHtml = `<span class="la-selected-target-elev" title="Elevation (use ${elevKeys.down} / ${elevKeys.up} keys)" style="margin-left:auto; margin-right:6px; font-size:0.85em; opacity:0.9; white-space:nowrap;"><i class="fas fa-arrows-alt-v"></i> ${elev}</span>`;
                listEl.append(`
                    <div class="la-selected-target" data-placement-index="${idx}" style="flex-wrap:wrap;${warns.length > 0 ? 'border-color:#ffaa00;background:#fff6e0;' : ''}">
                        ${imgHtml}
                        <span class="la-selected-target-name">${tokenName} #${idx + 1}</span>
                        ${elevHtml}
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                        ${warnHtml}
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function ()
            {
                const idx = $(this).data('placement-index');
                if (cardState.onDeletePlacement)
                    cardState.onDeletePlacement(idx);
            });
        }
    }
    else if (type === "knockBack")
    {
        const listEl = cardEl.find('[data-role="knockback-list"]');
        listEl.empty();

        cardState.tokens.forEach((token, idx) =>
        {
            const isMoved = cardState.moves.has(token.id);
            const isActive = idx === cardState.activeIndex;
            const statusClass = isMoved ? "la-kb-moved" : "la-kb-pending";
            const activeClass = isActive ? "la-kb-active" : "";
            const statusIcon = isMoved ? '<i class="fas fa-check" style="color:var(--lancer-color-green)"></i>' : '<i class="fas fa-arrow-right"></i>';

            let immovableIcon = "";
            if (token.actor?.statuses?.has?.('immovable'))
                immovableIcon = `<span title="Immovable" style="display:inline-block; width:14px; height:14px; margin-left:8px; background-color:#ff6400; mask-image:url('${IMMOVABLE_ICON}'); -webkit-mask-image:url('${IMMOVABLE_ICON}'); mask-size:contain; -webkit-mask-size:contain; mask-repeat:no-repeat; -webkit-mask-repeat:no-repeat;"></span>`;

            const itemHtml = `
                <div class="la-knockback-item ${statusClass} ${activeClass}" data-token-index="${idx}">
                    <img src="${token.document.texture.src}" class="la-kb-img" style="width:24px; height:24px; object-fit:contain;">
                    <span class="la-kb-name" style="display:flex; align-items:center;">${token.name}${immovableIcon}</span>
                    <span class="la-kb-status">${statusIcon}</span>
                </div>`;
            listEl.append(itemHtml);
        });

        listEl.find('.la-knockback-item').on('click', function ()
        {
            const idx = $(this).data('token-index');
            if (cardState.onSelectToken)
                cardState.onSelectToken(idx);
        });
    }
    else if (type === "choiceCard")
    {
        const listEl = cardEl.find('[data-role="choice-list"]');
        listEl.empty();

        cardState.choices.forEach((choice, idx) =>
        {
            const isDone = cardState.chosenSet?.has(idx);
            const doneClass = isDone ? "la-choice-done" : "";
            const disabledClass = (cardState.disabled || choice.disabled) ? "la-choice-disabled" : "";
            const iconHtml = choice.icon
                ? (/[./]/.test(choice.icon)
                    ? `<img class="la-hud-icon--${isWhiteSvgIcon(choice.icon) ? 'white' : 'dark'}" src="${choice.icon}" style="width:18px;height:18px;object-fit:contain;border:none;margin-right:8px;flex-shrink:0;transform:scale(1.25);transform-origin:center;filter:${isWhiteSvgIcon(choice.icon) ? 'invert(1)' : 'none'};">`
                    : `<i class="${choice.icon}" style="font-size:16px; margin-right:8px;"></i>`)
                : '';
            const statusHtml = isDone
                ? '<span class="la-choice-status"><i class="fas fa-check"></i></span>'
                : '';
            const titleAttr = choice.disabled && choice.disabledReason ? ` title="${choice.disabledReason}"` : '';

            listEl.append(`
                <div class="la-choice-item ${doneClass} ${disabledClass}" data-choice-index="${idx}"${titleAttr}>
                    ${iconHtml}
                    <span class="la-choice-text">${choice.text}</span>
                    ${statusHtml}
                </div>`);
        });

        if (!cardState.disabled)
        {
            listEl.find('.la-choice-item:not(.la-choice-done):not(.la-choice-disabled)').on('click', function ()
            {
                const idx = $(this).data('choice-index');
                if (cardState.onChoose)
                    cardState.onChoose(idx);
            });
        }
    }
    else if (type === "deploymentCard")
    {
        const listEl = cardEl.find('[data-role="deployment-list"]');
        listEl.empty();

        if (!cardState.deployables || cardState.deployables.length === 0)
            listEl.html('<div class="la-empty-state">No deployables available</div>');
        else
        {
            cardState.deployables.forEach((dep, idx) =>
            {
                const disabledClass = dep.disabled ? "la-choice-done" : "";
                const imgHtml = dep.img
                    ? `<img src="${dep.img}" style="width:24px; height:24px; object-fit:contain; border:1px solid #000; margin-right:8px;">`
                    : `<i class="cci cci-deployable" style="font-size:16px; margin-right:8px;"></i>`;
                const usesHtml = dep.usesText
                    ? `<span style="font-size:0.8em; color:#ff6400; margin-left:auto; white-space:nowrap;"><i class="fas fa-battery-three-quarters"></i> ${dep.usesText}</span>`
                    : '';
                const chargesHtml = dep.chargesText
                    ? `<span style="font-size:0.8em; color:#4488ff; margin-left:${dep.usesText ? '6px' : 'auto'}; white-space:nowrap;"><i class="fas fa-bolt"></i> ${dep.chargesText}</span>`
                    : '';
                const badgeHtml = dep.fromCompendium
                    ? `<span style="font-size:0.65em; background:#ff6400; color:white; padding:1px 4px; border-radius:2px; margin-left:6px;">COMP</span>`
                    : '';

                listEl.append(`
                    <div class="la-choice-item ${disabledClass}" data-dep-index="${idx}" style="display:flex; align-items:center; gap:4px; cursor:${dep.disabled ? 'not-allowed' : 'pointer'};">
                        ${imgHtml}
                        <span class="la-choice-text" style="flex:1;">${dep.name}${badgeHtml}</span>
                        ${usesHtml}
                        ${chargesHtml}
                    </div>`);
            });

            listEl.find('.la-choice-item:not(.la-choice-done)').on('click', function ()
            {
                const idx = $(this).data('dep-index');
                if (cardState.onDeploy)
                    cardState.onDeploy(idx);
            });
        }
    }
    else if (type === "voteCard")
    {
        const listEl = cardEl.find('[data-role="choice-list"]');
        const statusEl = cardEl.find('[data-role="vote-status"]');
        listEl.empty();

        const { choices = [], voteCounts = [], myVote = null, hidden = false, isCreator = false, disabled = false, responded = [], allVoters = [] } = cardState;

        choices.forEach((choice, idx) =>
        {
            const isMyVote = myVote === idx;
            const iconHtml = choice.icon
                ? `<i class="${choice.icon}" style="font-size:16px; margin-right:8px;"></i>`
                : '';
            const checkHtml = isMyVote
                ? '<span class="la-choice-status" style="color:#ff6400;"><i class="fas fa-check"></i></span>'
                : '';

            // Highlight selected vote: orange left border + subtle tint; no strikethrough
            const selectedStyle = isMyVote
                ? 'border-left:3px solid #ff6400; background:rgba(255,100,0,0.08); padding-left:6px;'
                : 'border-left:3px solid transparent; padding-left:6px;';

            // Creators and non-hidden voters see all counts; hidden voters see only their own.
            let countBadge = '';
            const count = voteCounts[idx] ?? 0;
            if (isCreator || !hidden)
                countBadge = `<span style="font-size:0.78em; font-weight:600; color:#cc5200; background:rgba(255,100,0,0.12); border:1px solid rgba(255,100,0,0.3); border-radius:3px; padding:1px 6px; margin-left:auto; white-space:nowrap;">${count}</span>`;
            else if (isMyVote)
            {
                // Hidden, non-creator: only show own vote indicator
                countBadge = `<i class="fas fa-circle" style="font-size:0.55em; color:#ff6400; margin-left:auto; opacity:0.8;"></i>`;
            }

            listEl.append(`
                <div class="la-choice-item" data-choice-index="${idx}" style="display:flex; align-items:center; cursor:${disabled ? 'default' : 'pointer'}; ${selectedStyle}">
                    ${iconHtml}
                    <span class="la-choice-text" style="flex:1;">${choice.text}</span>
                    ${countBadge}
                    ${checkHtml}
                </div>`);
        });

        if (!cardState.disabled)
        {
            listEl.find('.la-choice-item').on('click', function ()
            {
                const idx = $(this).data('choice-index');
                if (cardState.onChoose)
                    cardState.onChoose(idx);
            });
        }

        const votedCount = responded.length;
        const totalCount = allVoters.length;
        statusEl.html(
            totalCount > 0
                ? `<i class="fas fa-users"></i> ${votedCount} / ${totalCount} voted`
                : ''
        );
    }
}

export function _removeInfoCard(cardEl)
{
    if (!cardEl || cardEl.length === 0)
        return;

    // Tear down the reparent hook so it doesn't leak.
    const reparentHook = cardEl[0]?._laReparentHook;
    if (reparentHook)
    {
        Hooks.off('renderApplication', reparentHook);
        cardEl[0]._laReparentHook = null;
    }
    cardEl[0]._laRelatedMark?.destroy();
    cardEl[0]._laRelatedMark = null;

    const stackIdx = _cardVisualStack.findIndex((stackEl) => stackEl[0] === cardEl[0]);
    if (stackIdx >= 0)
        _cardVisualStack.splice(stackIdx, 1);
    cardEl[0]._laCloseResolve?.();

    // Reveal parent card immediately (appears behind the fade-out for a cross-fade)
    if (_cardVisualStack.length > 0)
        _cardVisualStack[_cardVisualStack.length - 1].show();

    cardEl.css('transform', 'translateY(30px)');
    cardEl.animate(
        { opacity: 0 },
        200,
        function ()
        {
            $(this).remove();
        }
    );
}
