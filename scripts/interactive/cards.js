/* global canvas, PIXI, game, ui, $ */

// --- Info Card Helpers (internal) ---

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

export function _updatePendingBadge() {
    const pendingTitles = _cardQueueTitles.slice(1);
    const badge = $('.la-info-card .la-queue-badge');
    if (pendingTitles.length > 0) {
        const text = `+${pendingTitles.length}`;
        const tooltip = pendingTitles.join('\n');
        if (badge.length) {
            badge.text(text).attr('title', tooltip);
        } else {
            $('.la-info-card .lancer-header').append(
                `<span class="la-queue-badge" title="${tooltip}">${text}</span>`
            );
        }
    } else {
        badge.remove();
    }
}

export function _queueCard(fn, title = '') {
    // --- In-scope: push on visual stack, bypass queue ---
    if (_cardCallbackDepth > 0) {
        if (_cardVisualStack.length > 0)
            _cardVisualStack[_cardVisualStack.length - 1].hide();
        return fn();
    }

    // --- Out-of-scope: normal queue behaviour ---
    _cardQueueTitles.push(title);
    _updatePendingBadge(); // badge on currently visible card, if any
    const next = _cardQueue.then(() => {
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
        onCancel = () => {}
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
        dynamicHtml = `
            ${selectionCheckbox}
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
                <i class="${icon} i--m" style="color:#000;"></i>
                <div style="display:flex; flex-direction:column; min-width:0; overflow:hidden;">
                    <span>${title}</span>
                    ${origin ? `<span style="font-size:0.7em; font-weight:normal; opacity:0.7; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${origin}</span>` : ''}
                </div>
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

    const container = $('#hudzone').length ? $('#hudzone') : $('body');
    container.append(html);
    const cardEl = $('.la-info-card').last();

    cardEl.find('[data-action="confirm"]').on('click', () => onConfirm());
    cardEl.find('[data-action="confirm-vote"]').on('click', () => opts.onConfirmVote?.());
    cardEl.find('[data-action="cancel"]').on('click', () => onCancel());

    // Slide up from bottom + fade in
    cardEl.css({ transform: 'translateY(30px)', opacity: 0 });
    cardEl.animate(
        { opacity: 1 },
        200,
        function () {
            $(this).css('transform', 'translateY(0)');
        }
    );
    // CSS transition handles the transform animation
    setTimeout(() => cardEl.css('transform', 'translateY(0)'), 10);

    // Track on visual stack
    _cardVisualStack.push(cardEl);
    return cardEl;
}

export function _updateInfoCard(cardEl, type, data) {
    if (!cardEl || cardEl.length === 0)
        return;

    if (type === "chooseToken") {
        const listEl = cardEl.find('[data-role="target-list"]');
        listEl.empty();

        if (data.selectedTokens.size === 0) {
            listEl.html('<div class="la-empty-state">No targets selected</div>');
        } else {
            for (const token of data.selectedTokens) {
                const imgSrc = token.document.texture.src;
                const name = token.name;
                listEl.append(`
                    <div class="la-selected-target" data-token-id="${token.id}">
                        <img src="${imgSrc}" alt="${name}">
                        <span class="la-selected-target-name">${name}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
                    </div>`);
            }

            listEl.find('.la-selected-target').on('click', function () {
                const tokenId = $(this).data('token-id');
                if (data.onDeselect)
                    data.onDeselect(tokenId);
            });
        }
    } else if (type === "placeZone") {
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
                listEl.append(`
                    <div class="la-selected-target" data-placement-index="${idx}">
                        ${imgHtml}
                        <span class="la-selected-target-name">${tokenName} #${idx + 1}</span>
                        <span class="la-selected-target-remove"><i class="fas fa-times"></i></span>
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
            const disabledClass = data.disabled ? "la-choice-disabled" : "";
            const iconHtml = choice.icon
                ? `<i class="${choice.icon}" style="font-size:16px; margin-right:8px;"></i>`
                : '';
            const statusHtml = isDone
                ? '<span class="la-choice-status"><i class="fas fa-check"></i></span>'
                : '';

            listEl.append(`
                <div class="la-choice-item ${doneClass} ${disabledClass}" data-choice-index="${idx}">
                    ${iconHtml}
                    <span class="la-choice-text">${choice.text}</span>
                    ${statusHtml}
                </div>`);
        });

        if (!data.disabled) {
            listEl.find('.la-choice-item:not(.la-choice-done)').on('click', function () {
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
