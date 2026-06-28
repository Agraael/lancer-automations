/* global canvas, PIXI, game, ui, $, Hooks */

// --- Info Card Helpers (internal) ---

/**
 * SVGs in lancer-automations/icons/ (and Foundry's icons/svg/) are white-on-transparent by design.
 * On light card headers/buttons they vanish. Returns true if the icon path should be inverted to render black.
 * Icons under a /black/ subfolder are already black and must NOT be inverted.
 */
export function isWhiteSvgIcon(iconPath) {
    if (typeof iconPath !== 'string' || !iconPath.endsWith('.svg'))
        return false;
    if (iconPath.includes('/black/'))
        return false;
    return iconPath.includes('/white/')
        || iconPath.includes('modules/lancer-automations/')
        || iconPath.startsWith('icons/svg/');
}

const _ELEV_KEY_LABELS = { KeyQ: 'Q', KeyE: 'E', KeyA: 'A', KeyD: 'D', KeyW: 'W', KeyS: 'S' };
function _elevationKeyLabels() {
    const labelOf = (k) => _ELEV_KEY_LABELS[k] ?? k.replace(/^Key/, '');
    const up = game.keybindings?.get?.('core', 'zoomIn')?.[0]?.key;
    const down = game.keybindings?.get?.('core', 'zoomOut')?.[0]?.key;
    return { up: up ? labelOf(up) : 'E', down: down ? labelOf(down) : 'Q' };
}

export const _cardDefaults = {
    chooseToken: { title: "SELECT TARGETS", icon: "fas fa-crosshairs" },
    knockBack:   { title: "KNOCKBACK",       icon: "fas fa-arrow-right" },
    placeToken:  { title: "PLACE TOKEN",     icon: "fas fa-user-plus" },
    placeZone:   { title: "PLACE ZONE",      icon: "fas fa-bullseye" },
    choiceCard:  { title: "CHOICE",          icon: "fas fa-list" },
    deploymentCard: { title: "DEPLOY",      icon: "cci cci-deployable" },
    voteCard:    { title: "VOTE",            icon: "fas fa-poll" }
};

// --- Card queue: serialise all interactive cards so they never overwrite each other ---
const INTER_CARD_DELAY_MS = 400;
let _cardQueue = Promise.resolve();
let _cardQueueTitles = []; // index 0 = active card, 1+ = pending

// --- Card visual stack: sub-cards push on top, parent cards re-appear when child pops ---
let _cardCallbackDepth = 0;  // >0 → inside a card callback, new cards push on stack
let _cardVisualStack = [];   // jQuery elements — topmost is visible

/**
 * Wrap a card callback so that any _queueCard call inside it pushes
 * on top of the visual stack instead of waiting behind the queue.
 */
export async function _runCardCallback(fn) {
    _cardCallbackDepth++;
    try {
        return await fn();
    } finally {
        _cardCallbackDepth--;
    }
}

function _injectCardQueueStyles() {
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

export function _updatePendingBadge() {
    _injectCardQueueStyles();
    const pendingTitles = _cardQueueTitles.slice(1);
    const banner = $('.la-info-card .la-card-queue-banner');
    if (pendingTitles.length > 0) {
        const n = pendingTitles.length;
        const tooltip = pendingTitles.map((t, i) => `${i + 1}. ${t || 'Card'}`).join('<br>');
        const html = `<i class="fas fa-hourglass-half"></i><span><b>${n}</b> card${n === 1 ? '' : 's'} queued</span>`;
        if (banner.length) {
            banner.html(html).attr('data-tooltip', tooltip);
        } else {
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
    } else {
        banner.remove();
    }
}

export function _queueCardUrgent(fn, title = '') {
    return _queueCard(fn, title, { urgent: true });
}

export function _queueCard(fn, title = '', { urgent = false } = {}) {
    // --- In-scope or urgent (reactive): push on visual stack, bypass serial queue ---
    if (urgent || _cardCallbackDepth > 0) {
        if (_cardVisualStack.length > 0)
            _cardVisualStack[_cardVisualStack.length - 1].hide();
        return fn();
    }

    // --- Out-of-scope: normal queue behaviour ---
    const wasIdle = _cardQueueTitles.length === 0;
    _cardQueueTitles.push(title);
    _updatePendingBadge(); // badge on currently visible card, if any
    const next = _cardQueue.then(async () => {
        if (!wasIdle)
            await new Promise(r => setTimeout(r, INTER_CARD_DELAY_MS));
        const promise = fn(); // card DOM created synchronously here
        _updatePendingBadge(); // badge on newly shown card
        return promise;
    });
    const _onCardDone = () => {
        _cardQueueTitles.shift();
        _updatePendingBadge();
    };
    _cardQueue = next.then(_onCardDone, _onCardDone);
    return next;
}

export function _createInfoCard(type, opts) {
    const defaults = _cardDefaults[type] || { title: "INFO", icon: "fas fa-info" };
    const {
        title = defaults.title,
        icon = defaults.icon,
        headerClass = "",
        description = "",
        origin = "",
        range = null,
        count = 1,
        zoneType = "",
        zoneSize = 1,
        onConfirm = () => {},
        onCancel = () => {},
        relatedToken = null,
        originToken = null
    } = opts;

    // Remove orphaned info cards (not on the visual stack)
    $('.la-info-card').each(function () {
        if (!_cardVisualStack.some(el => el[0] === this))
            $(this).remove();
    });

    let infoRowHtml = '';
    if (type !== "choiceCard" && type !== "deploymentCard" && type !== "voteCard") {
        let infoItems = [];
        if (range !== null) {
            infoItems.push(`<span style="white-space:nowrap"><b>Range:</b> ${range}</span>`);
        }
        if (count !== -1) {
            infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> ${count}</span>`);
        } else {
            infoItems.push(`<span style="white-space:nowrap"><b>Count:</b> &infin;</span>`);
        }
        if (type === "placeZone") {
            if (zoneType) {
                infoItems.push(`<span style="white-space:nowrap"><b>Type:</b> ${zoneType}</span>`);
            }
            infoItems.push(`<span style="white-space:nowrap"><b>Size:</b> ${zoneSize}</span>`);
        }
        if (infoItems.length > 0) {
            infoRowHtml = `<label class="flexrow la-info-row lancer-border-primary">${infoItems.join('  ')}</label>`;
        }
    }

    const descHtml = description
        ? `<div class="la-info-description">${description}</div>`
        : '';

    let dynamicHtml = "";
    if (type === "chooseToken") {
        const selectionCheckbox = opts.hasSelection ? `
            <label class="flexrow" style="gap:6px; align-items:center; margin-bottom:6px; cursor:pointer; font-size:12px;">
                <input type="checkbox" data-role="selection-toggle" checked style="margin:0;" />
                <span>Restrict to selection</span>
            </label>` : '';
        const isAreaPattern = opts.pattern === 'blast' || opts.pattern === 'burst' || opts.pattern === 'cone' || opts.pattern === 'line';
        const showAutoElev = opts.pattern === 'blast' || opts.pattern === 'cone' || opts.pattern === 'line'; // burst pins elevation to its host token
        const showQEHint = opts.pattern === 'blast' || opts.pattern === 'cone' || opts.pattern === 'line';
        const showRotateHint = opts.pattern === 'cone' || opts.pattern === 'line';
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
                ${showQEHint ? `<span style="margin-left:auto;color:#666;font-size:10.5px;font-style:italic;">Q/E: shift elevation</span>` : ''}
                ${showRotateHint ? `<span style="color:#666;font-size:10.5px;font-style:italic;">Ctrl+wheel: rotate</span>` : ''}
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
    } else if (type === "knockBack") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Tokens to Move</h3>
            <div class="la-knockback-list" data-role="knockback-list">
                <!-- Populated dynamically -->
            </div>`;
    } else if (type === "placeToken") {
        const selectorHtml = opts.isMultiActor ? `
            <h3 class="la-section-header lancer-border-primary">Select Actor</h3>
            <div class="la-actor-selector" data-role="actor-selector" style="display:flex; gap:4px; flex-wrap:wrap; margin-bottom:8px;"></div>` : '';
        dynamicHtml = `
            ${selectorHtml}
            <h3 class="la-section-header lancer-border-primary">Tokens to Place</h3>
            <div style="font-size:0.78em; opacity:0.75; margin:-4px 0 4px 0;">Use <kbd>${_elevationKeyLabels().down}</kbd> / <kbd>${_elevationKeyLabels().up}</kbd> to adjust the last placed token's elevation.</div>
            <div class="la-placed-tokens" data-role="token-list">
                <div class="la-empty-state">No tokens placed</div>
            </div>`;
    } else if (type === "choiceCard") {
        const modeLabel = opts.mode === "and" ? "Complete All" : "Choose One";
        dynamicHtml = `
            ${opts.disabled ? '' : `<h3 class="la-section-header lancer-border-primary">${modeLabel}</h3>`}
            <div class="la-choice-list" data-role="choice-list"></div>`;
    } else if (type === "deploymentCard") {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Deployables</h3>
            <div class="la-deployment-list" data-role="deployment-list"></div>`;
    } else if (type === "voteCard") {
        dynamicHtml = `
            ${opts.disabled ? '' : `<h3 class="la-section-header lancer-border-primary">Cast Your Vote</h3>`}
            <div class="la-choice-list" data-role="choice-list"></div>
            <div class="la-vote-status" data-role="vote-status" style="font-size:0.8em; color:#aaa; margin-top:4px;"></div>`;
    } else {
        dynamicHtml = `
            <h3 class="la-section-header lancer-border-primary">Placed Zones</h3>
            <button type="button" data-role="place-more" style="width:100%;margin-bottom:6px;padding:5px;cursor:pointer;background:#3a9e6e;color:#fff;border:none;border-radius:3px;font-weight:600;">
                <i class="fas fa-plus"></i> Place Zone
            </button>
            <div class="la-placed-zones" data-role="zone-list">
                <div class="la-empty-state">No zones placed</div>
            </div>`;
    }

    const showConfirm = type !== "choiceCard" && type !== "voteCard";
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

    // v13: Lancer system v3 creates #hudzone lazily (only when a Lancer HUD is shown).
    // Ensure we have an LA fallback hudzone (#la-hudzone) at the same screen position so
    // cards always land in the correct spot, with or without Lancer HUDs visible.
    let container = $('#hudzone');
    if (!container.length) {
        let laHud = $('#la-hudzone');
        if (!laHud.length) {
            laHud = $('<div id="la-hudzone" class="lancer-hud-zone" style="position:fixed;bottom:0;right:var(--sidebar-width,38px);z-index:70;display:flex;flex-direction:column-reverse;align-items:flex-end;pointer-events:none;"></div>');
            $('body').append(laHud);
        }
        container = laHud;
    }
    container.append(html);
    const cardEl = $('.la-info-card').last();

    // Re-parent the card into Lancer's real #hudzone if it appears later (DAMAGE ROLL / ATTACK HUD opens).
    const reparentHook = Hooks.on('renderApplication', () => {
        const realHud = document.getElementById('hudzone');
        if (realHud && cardEl[0].parentElement?.id !== 'hudzone') {
            realHud.appendChild(cardEl[0]);
        }
    });
    cardEl[0]._laReparentHook = reparentHook;

    cardEl.find('[data-action="confirm"]').on('click', () => onConfirm());
    cardEl.find('[data-action="confirm-vote"]').on('click', () => opts.onConfirmVote?.());
    cardEl.find('[data-action="cancel"]').on('click', () => onCancel());
    if (originToken) {
        cardEl.find('[data-role="origin-token"]').on('click', () => {
            canvas.animatePan(originToken.center);
        });
    }
    if (relatedToken) {
        cardEl.find('[data-role="related-token"]').on('click', () => {
            canvas.animatePan(relatedToken.center);
        });
    }

    // v13: #hudzone (Lancer system v3) is already anchored bottom-right next to the sidebar
    // and stacks its children (Lancer HUDs + LA cards) automatically. No JS positioning needed.

    // Slide up from bottom + fade in
    cardEl.css({ transform: 'translateY(30px)', opacity: 0 });
    cardEl.animate(
        { opacity: 1 },
        200,
        function () {
            $(this).css('transform', 'translateY(0)');
        }
    );
    setTimeout(() => cardEl.css('transform', 'translateY(0)'), 10);

    // Track on visual stack
    _cardVisualStack.push(cardEl);
    return cardEl;
}

export function _updateInfoCard(cardEl, type, data) {
    if (!cardEl || cardEl.length === 0)
        return;

    if (type === "chooseToken") {
        // ── Placed Areas section (blast mode only) ──
        if (data.pattern === 'blast' || data.pattern === 'burst' || data.pattern === 'cone' || data.pattern === 'line') {
            // Sync global mode toggles (elevation aware + auto elevation).
            const modesEl = cardEl.find('[data-role="area-modes"]');
            if (modesEl.length) {
                const elevAware = !!data.elevationAware;
                const autoElev = !!data.autoElevation;
                const $elevAware = modesEl.find('[data-role="elevation-aware-toggle"]');
                const $autoElev = modesEl.find('[data-role="auto-elevation-toggle"]');
                $elevAware.prop('checked', elevAware);
                $autoElev.prop('checked', autoElev).prop('disabled', !elevAware);
                modesEl.find('[data-role="auto-elevation-wrap"]').css('opacity', elevAware ? 1 : 0.5);
                $elevAware.off('change').on('change', () => data.onToggleElevationAware?.());
                $autoElev.off('change').on('change', () => data.onToggleAutoElevation?.());
                const $prop = modesEl.find('[data-role="propagation-toggle"]');
                $prop.prop('checked', !!data.propagation).prop('disabled', !elevAware);
                modesEl.find('[data-role="propagation-wrap"]').css('opacity', elevAware ? 1 : 0.5);
                $prop.off('change').on('change', () => data.onTogglePropagation?.());
            }
            const areaEl = cardEl.find('[data-role="area-list"]');
            areaEl.empty();
            const placements = data.placements ?? [];
            if (placements.length === 0) {
                areaEl.html('<div class="la-empty-state">No areas placed</div>');
            } else {
                const aoeIconSrc = data.pattern === 'burst'
                    ? 'systems/lancer/assets/icons/aoe_burst.svg'
                    : data.pattern === 'cone' ? 'systems/lancer/assets/icons/aoe_cone.svg'
                    : data.pattern === 'line' ? 'systems/lancer/assets/icons/aoe_line.svg'
                    : 'systems/lancer/assets/icons/aoe_blast.svg';
                for (const p of placements) {
                    const tokensHtml = p.candidates.map(c => {
                        const dimmed = !c.eligible;
                        const checked = c.included ? 'checked' : '';
                        const disabled = dimmed ? 'disabled' : '';
                        return `
                            <label class="la-area-token-row" data-token-id="${c.id}" style="display:flex;align-items:center;gap:6px;padding:2px 4px;cursor:${dimmed ? 'not-allowed' : 'pointer'};opacity:${dimmed ? 0.45 : 1};font-size:11px;">
                                <input type="checkbox" data-role="area-token-toggle" ${checked} ${disabled} style="margin:0;">
                                <img src="${c.img}" alt="${c.name}" style="width:18px;height:18px;object-fit:contain;border:1px solid #555;border-radius:2px;">
                                <span style="${c.filtered ? 'text-decoration:line-through;' : ''}">${c.name}</span>
                            </label>`;
                    }).join('');
                    const filterToggleHtml = p.hasFiltered ? `
                        <label style="display:flex;align-items:center;gap:4px;padding:2px 4px;font-size:10.5px;color:#666;cursor:pointer;">
                            <input type="checkbox" data-role="area-filter-toggle" ${p.ignoreFilter ? 'checked' : ''} style="margin:0;">
                            <span>Ignore filter</span>
                        </label>` : '';
                    const candidatesHtml = p.candidates.length === 0
                        ? '<div style="font-size:10.5px;color:#888;font-style:italic;padding:2px 4px;">No tokens caught</div>'
                        : tokensHtml;
                    const oorWarn = p.centerOutOfRange
                        ? `<div style="font-size:10.5px;color:#b34700;font-style:italic;margin-bottom:3px;"><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>Area center out of range</div>`
                        : '';
                    const elevBadge = data.elevationAware
                        ? `<span style="font-size:10.5px;color:#555;padding:0 4px;" title="Q/E to adjust">Elev ${p.elevation}${p.elevationOffset ? ` (${p.elevationOffset > 0 ? '+' : ''}${p.elevationOffset})` : ''}</span>`
                        : '';
                    areaEl.append(`
                        <div class="la-placed-area" data-area-id="${p.id}" style="border:1px solid ${p.centerOutOfRange ? '#ffaa00' : '#aaa'};border-radius:3px;padding:4px;margin-bottom:4px;background:${p.centerOutOfRange ? '#fff6e0' : '#fafafa'};color:#111;">
                            <div style="display:flex;align-items:center;gap:6px;margin-bottom:3px;">
                                <img src="${aoeIconSrc}" alt="${data.pattern}" style="width:16px;height:16px;object-fit:contain;flex-shrink:0;">
                                <span style="flex:1;font-weight:600;font-size:12px;color:#111;">${p.label}</span>
                                ${elevBadge}
                                <span style="font-size:10.5px;color:#555;">(${p.count} target${p.count === 1 ? '' : 's'})</span>
                                <span class="la-area-remove" style="cursor:pointer;color:#a00;padding:0 4px;" title="Remove area"><i class="fas fa-times"></i></span>
                            </div>
                            ${oorWarn}
                            <div class="la-area-tokens" style="color:#111;">${candidatesHtml}</div>
                            ${filterToggleHtml}
                        </div>`);
                }
                areaEl.find('.la-placed-area').each(function () {
                    const $area = $(this);
                    const areaId = Number($area.data('area-id'));
                    $area.find('.la-area-remove').on('click', (e) => {
                        e.stopPropagation();
                        data.onRemoveArea?.(areaId);
                    });
                    $area.find('[data-role="area-token-toggle"]').on('change', function (e) {
                        e.stopPropagation();
                        const tokenId = $(this).closest('.la-area-token-row').data('token-id');
                        data.onToggleAreaToken?.(areaId, String(tokenId));
                    });
                    $area.find('[data-role="area-filter-toggle"]').on('change', (e) => {
                        e.stopPropagation();
                        data.onToggleAreaFilter?.(areaId);
                    });
                    $area.find('.la-area-token-row').each(function () {
                        const $row = $(this);
                        const tokenId = String($row.data('token-id') ?? '');
                        $row.on('mouseenter', () => data.onHoverToken?.(tokenId));
                        $row.on('mouseleave', () => data.onUnhoverToken?.());
                    });
                });
            }
        }

        const listEl = cardEl.find('[data-role="target-list"]');
        listEl.empty();

        if (data.selectedTokens.size === 0) {
            listEl.html('<div class="la-empty-state">No targets selected</div>');
        } else {
            for (const token of data.selectedTokens) {
                const imgSrc = token.document.texture.src;
                const name = token.name;
                const warns = data.warnings?.[token.id] ?? [];
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

            listEl.find('.la-selected-target').on('click', function () {
                const tokenId = $(this).data('token-id');
                if (data.onDeselect)
                    data.onDeselect(tokenId);
            });
            listEl.find('.la-selected-target').each(function () {
                const $row = $(this);
                const tokenId = String($row.data('token-id') ?? '');
                $row.on('mouseenter', () => data.onHoverToken?.(tokenId));
                $row.on('mouseleave', () => data.onUnhoverToken?.());
            });
        }
    } else if (type === "placeZone") {
        const placeBtn = cardEl.find('[data-role="place-more"]');
        if (placeBtn.length) {
            const can = data.canPlaceMore !== false;
            placeBtn.prop('disabled', !can).css({ opacity: can ? 1 : 0.45, cursor: can ? 'pointer' : 'not-allowed' });
            placeBtn.off('click').on('click', () => { if (data.canPlaceMore !== false) data.onPlaceMore?.(); });
        }
        const listEl = cardEl.find('[data-role="zone-list"]');
        listEl.empty();

        if (data.placedZones.length === 0) {
            listEl.html('<div class="la-empty-state">No zones placed</div>');
        } else {
            data.placedZones.forEach((zone, idx) => {
                const label = `Zone ${idx + 1}`;
                listEl.append(`
                    <div class="la-selected-target" data-zone-index="${idx}">
                        <i class="fas fa-bullseye" style="color:var(--primary-color); font-size:16px;"></i>
                        <span class="la-selected-target-name">${label}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function () {
                const zoneIdx = $(this).data('zone-index');
                if (data.onDeleteZone)
                    data.onDeleteZone(zoneIdx);
            });
        }
    } else if (type === "placeToken") {
        // --- Actor selector ---
        if (data.isMultiActor && data.actorEntries) {
            const selectorEl = cardEl.find('[data-role="actor-selector"]');
            selectorEl.empty();
            data.actorEntries.forEach((entry, idx) => {
                const isActive = idx === data.activeActorIndex;
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
            selectorEl.find('.la-actor-entry').on('click', function () {
                const idx = $(this).data('actor-index');
                if (data.onSelectActor)
                    data.onSelectActor(idx);
            });
        }

        // --- Placements list ---
        const listEl = cardEl.find('[data-role="token-list"]');
        listEl.empty();

        if (data.placements.length === 0) {
            listEl.html('<div class="la-empty-state">No tokens placed</div>');
        } else {
            data.placements.forEach((placement, idx) => {
                const entry = data.actorEntries?.[placement.actorIndex ?? 0];
                const imgSrc = entry?.texture || "";
                const tokenName = entry?.name || `Token ${idx + 1}`;
                const imgHtml = imgSrc
                    ? `<img src="${imgSrc}" style="width:24px; height:24px; object-fit:contain; border:1px solid #000; margin-right:8px;">`
                    : `<i class="fas fa-user" style="color:#ff6400; font-size:16px; margin-right:8px;"></i>`;
                const warns = data.warnings?.[idx] ?? [];
                const warnHtml = warns.length > 0
                    ? `<div class="la-target-warnings" style="width:100%;margin-top:3px;font-size:10.5px;color:#b34700;font-style:italic;">
                           ${warns.map(w => `<div><i class="fas fa-exclamation-triangle" style="margin-right:4px;"></i>${w}</div>`).join('')}
                       </div>`
                    : '';
                const elev = typeof placement.elevation === 'number' ? placement.elevation : 0;
                const _ek = _elevationKeyLabels();
                const elevHtml = `<span class="la-selected-target-elev" title="Elevation (use ${_ek.down} / ${_ek.up} keys)" style="margin-left:auto; margin-right:6px; font-size:0.85em; opacity:0.9; white-space:nowrap;"><i class="fas fa-arrows-alt-v"></i> ${elev}</span>`;
                listEl.append(`
                    <div class="la-selected-target" data-placement-index="${idx}" style="flex-wrap:wrap;${warns.length > 0 ? 'border-color:#ffaa00;background:#fff6e0;' : ''}">
                        ${imgHtml}
                        <span class="la-selected-target-name">${tokenName} #${idx + 1}</span>
                        ${elevHtml}
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                        ${warnHtml}
                    </div>`);
            });

            listEl.find('.la-selected-target').on('click', function () {
                const idx = $(this).data('placement-index');
                if (data.onDeletePlacement)
                    data.onDeletePlacement(idx);
            });
        }
    } else if (type === "knockBack") {
        const listEl = cardEl.find('[data-role="knockback-list"]');
        listEl.empty();

        data.tokens.forEach((token, idx) => {
            const isMoved = data.moves.has(token.id);
            const isActive = idx === data.activeIndex;
            const statusClass = isMoved ? "la-kb-moved" : "la-kb-pending";
            const activeClass = isActive ? "la-kb-active" : "";
            const statusIcon = isMoved ? '<i class="fas fa-check" style="color:var(--lancer-color-green)"></i>' : '<i class="fas fa-arrow-right"></i>';

            let immovableIcon = "";
            const api = game.modules.get('lancer-automations')?.api;
            if (api?.findEffectOnToken(token, "immovable")) {
                immovableIcon = '<i class="cci cci-immovable" title="Immovable" style="color:#ff6400; margin-left: 8px;"></i>';
            }

            const itemHtml = `
                <div class="la-knockback-item ${statusClass} ${activeClass}" data-token-index="${idx}">
                    <img src="${token.document.texture.src}" class="la-kb-img" style="width:24px; height:24px; object-fit:contain;">
                    <span class="la-kb-name" style="display:flex; align-items:center;">${token.name}${immovableIcon}</span>
                    <span class="la-kb-status">${statusIcon}</span>
                </div>`;
            listEl.append(itemHtml);
        });

        listEl.find('.la-knockback-item').on('click', function () {
            const idx = $(this).data('token-index');
            if (data.onSelectToken)
                data.onSelectToken(idx);
        });
    } else if (type === "choiceCard") {
        const listEl = cardEl.find('[data-role="choice-list"]');
        listEl.empty();

        data.choices.forEach((choice, idx) => {
            const isDone = data.chosenSet?.has(idx);
            const doneClass = isDone ? "la-choice-done" : "";
            const disabledClass = (data.disabled || choice.disabled) ? "la-choice-disabled" : "";
            const iconHtml = choice.icon
                ? (/[./]/.test(choice.icon)
                    ? `<img src="${choice.icon}" style="width:18px;height:18px;object-fit:contain;border:none;margin-right:8px;flex-shrink:0;transform:scale(1.25);transform-origin:center;${isWhiteSvgIcon(choice.icon) ? 'filter:invert(1);' : ''}">`
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

        if (!data.disabled) {
            listEl.find('.la-choice-item:not(.la-choice-done):not(.la-choice-disabled)').on('click', function () {
                const idx = $(this).data('choice-index');
                if (data.onChoose)
                    data.onChoose(idx);
            });
        }
    } else if (type === "deploymentCard") {
        const listEl = cardEl.find('[data-role="deployment-list"]');
        listEl.empty();

        if (!data.deployables || data.deployables.length === 0) {
            listEl.html('<div class="la-empty-state">No deployables available</div>');
        } else {
            data.deployables.forEach((dep, idx) => {
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

            listEl.find('.la-choice-item:not(.la-choice-done)').on('click', function () {
                const idx = $(this).data('dep-index');
                if (data.onDeploy)
                    data.onDeploy(idx);
            });
        }
    } else if (type === "voteCard") {
        const listEl = cardEl.find('[data-role="choice-list"]');
        const statusEl = cardEl.find('[data-role="vote-status"]');
        listEl.empty();

        const { choices = [], voteCounts = [], myVote = null, hidden = false, isCreator = false, disabled = false, responded = [], allVoters = [] } = data;

        choices.forEach((choice, idx) => {
            const isMyVote = myVote === idx;
            const iconHtml = choice.icon
                ? `<i class="${choice.icon}" style="font-size:16px; margin-right:8px;"></i>`
                : '';
            const checkHtml = isMyVote
                ? '<span class="la-choice-status" style="color:#ff6400;"><i class="fas fa-check"></i></span>'
                : '';

            // Highlight selected vote — orange left border + subtle tint; no strikethrough
            const selectedStyle = isMyVote
                ? 'border-left:3px solid #ff6400; background:rgba(255,100,0,0.08); padding-left:6px;'
                : 'border-left:3px solid transparent; padding-left:6px;';

            // Show count: creator always sees full count, non-hidden voters see full count,
            // hidden voters see only their own vote indicator
            let countBadge = '';
            const count = voteCounts[idx] ?? 0;
            if (isCreator || !hidden) {
                countBadge = `<span style="font-size:0.78em; font-weight:600; color:#cc5200; background:rgba(255,100,0,0.12); border:1px solid rgba(255,100,0,0.3); border-radius:3px; padding:1px 6px; margin-left:auto; white-space:nowrap;">${count}</span>`;
            } else if (isMyVote) {
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

        if (!data.disabled) {
            listEl.find('.la-choice-item').on('click', function () {
                const idx = $(this).data('choice-index');
                if (data.onChoose)
                    data.onChoose(idx);
            });
        }

        // Status line
        const votedCount = responded.length;
        const totalCount = allVoters.length;
        statusEl.html(
            totalCount > 0
                ? `<i class="fas fa-users"></i> ${votedCount} / ${totalCount} voted`
                : ''
        );
    }
}

export function _removeInfoCard(cardEl) {
    if (!cardEl || cardEl.length === 0)
        return;

    // Tear down the reparent hook so it doesn't leak.
    const reparentHook = cardEl[0]?._laReparentHook;
    if (reparentHook) {
        Hooks.off('renderApplication', reparentHook);
        cardEl[0]._laReparentHook = null;
    }

    // Pop from visual stack
    const stackIdx = _cardVisualStack.findIndex(el => el[0] === cardEl[0]);
    if (stackIdx >= 0)
        _cardVisualStack.splice(stackIdx, 1);

    // Reveal parent card immediately (appears behind the fade-out for a cross-fade)
    if (_cardVisualStack.length > 0)
        _cardVisualStack[_cardVisualStack.length - 1].show();

    // Slide down + fade out
    cardEl.css('transform', 'translateY(30px)');
    cardEl.animate(
        { opacity: 0 },
        200,
        function () {
            $(this).remove();
        }
    );
}
