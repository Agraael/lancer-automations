import { _queueCard, _createInfoCard, _removeInfoCard, _updatePendingBadge, isWhiteSvgIcon, claimCardEscape } from "./cards.js";
import "./hover-pan.js";

function pickIconHtml(icon)
{
    if (!icon)
        return '';

    if (/[./]/.test(icon))
    {
        const white = isWhiteSvgIcon(icon);
        return `<img class="la-hud-icon--${white ? 'white' : 'dark'}" src="${icon}" style="width:18px;height:18px;object-fit:contain;border:none;margin-right:8px;flex-shrink:0;transform:scale(1.25);transform-origin:center;filter:${white ? 'invert(1)' : 'none'};">`;
    }

    return `<i class="${icon}" style="font-size:16px; margin-right:8px;"></i>`;
}

const pickChipHtml = chip => `<span class="la-pick-chip"><i class="cci cci-${chip.type}${chip.damage ? ` damage--${chip.type}` : ''}"></i>${chip.val}</span>`;

const pickTagClass = tag => `${tag.tone ? ` la-pick-tag--${tag.tone}` : ''}${tag.when ? ` la-pick-tag--${tag.when}` : ''}`;

const pickTagHtml = (tag, fit = false) => `<span class="la-pick-tag${pickTagClass(tag)}">${fit ? (tag.short ?? tag.text) : tag.text}</span>`;

const pickCornerHtml = tag => `<span class="la-pick-corner${pickTagClass(tag)}">${tag.text}</span>`;

function pickRowBody(row, fit = false)
{
    const subText = fit ? `<span class="la-pick-sub la-pan-clip"><span>${row.sub}</span></span>` : `<span class="la-pick-sub">${row.sub}</span>`;
    const sub = row.sub ? subText : '';
    const chips = row.chips?.length ? `<span class="la-pick-chips">${row.chips.map(pickChipHtml).join('')}</span>` : '';
    const line = sub || chips ? `<span class="la-pick-line">${sub}${chips}</span>` : '';
    const lines = (row.lines ?? []).map(text => `<span class="la-pick-sub">${text}</span>`).join('');
    const why = row.why ? `<span class="la-pick-sub la-pick-why">${row.why}</span>` : '';
    const sideTags = (row.tags ?? []).filter(tag => !fit || !tag.corner);
    const tags = sideTags.length ? `<span class="la-pick-tags">${sideTags.map(tag => pickTagHtml(tag, fit)).join('')}</span>` : '';

    return `${pickIconHtml(row.icon)}<span class="la-choice-text"><span class="la-pick-name la-pan-clip"><span>${row.name}</span></span>${line}${lines}${why}</span>${tags}`;
}

function pickRowHtml(row, idx, fit = false)
{
    const classes = ['la-choice-item', row.picked && !row.off && 'la-pick-row--picked', row.off && 'la-pick-row--off', row.done && 'la-choice-done', row.nested && 'la-pick-row--nested'].filter(Boolean).join(' ');
    const badge = row.done ? '<span class="la-choice-status"><i class="fas fa-check"></i></span>' : (row.badge ? `<span class="la-choice-status la-pick-badge">${row.badge}</span>` : '');
    const section = row.section ? `<h3 class="la-section-header lancer-border-primary">${row.section}</h3>` : '';
    const group = row.group == null ? '' : ` data-pick-group="${row.group}"`;
    const corner = fit ? (row.tags ?? []).filter(tag => tag.corner).map(pickCornerHtml).join('') : '';

    return `${section}<div class="${classes}" data-pick-index="${idx}"${group}>${pickRowBody(row, fit)}${badge}${corner}</div>${row.inside ?? ''}`;
}

export function pickRowsText(label, rows)
{
    const head = label ? `<span class="la-pick-group-label">${label}</span>` : '';
    return head + rows.map(row => `<span class="la-pick-group-row">${pickRowBody(row)}</span>`).join('');
}

export function profileChips(profile)
{
    return [
        ...(profile?.range ?? []).map(entry => ({ type: String(entry.type).toLowerCase(), val: entry.val })),
        ...(profile?.damage ?? []).map(entry => ({ type: String(entry.type).toLowerCase(), val: entry.val, damage: true })),
    ];
}

/**
 * Corner card with rich rows, under the normal card queue.
 * @param {Object} options
 * @param {string} options.title
 * @param {string} [options.icon]
 * @param {string} [options.origin]
 * @param {Token|null} [options.originToken]
 * @param {Token|null} [options.relatedToken]
 * @param {string} [options.description]
 * @param {string} [options.hint]
 * @param {string} [options.foot]
 * @param {string} [options.confirmText] - Shows a confirm button
 * @param {string} [options.confirmIcon]
 * @param {string} [options.cancelText] - Label of the cancel button, "Cancel" by default
 * @param {string} [options.cancelIcon]
 * @param {boolean} [options.urgent=false]
 * @param {boolean} [options.fitRows=false] - One row height: short tags, corner tags in the row corner
 * @param {boolean} [options.tiles=false] - Rows two per line, name only
 * @param {() => string} [options.getHead] - HTML above the list, redrawn with the rows
 * @param {(element: HTMLElement, card: any) => any} [options.onHeadClick] - Click on a `[data-head]` element of the head
 * @param {() => any[]} options.getRows
 * @param {(row: any, card: any) => any} options.onPick
 * @param {(card: any) => any} [options.onConfirm]
 * @param {(row: any, card: any, element: HTMLElement) => any} [options.onContext] - element is the right-clicked row
 * @param {(card: any) => any} [options.onReady] - Runs once the card is shown
 * @returns {Promise<any>} what the card finished with, null if cancelled
 */
export function startPickCard(options)
{
    const { title, icon, origin, originToken = null, relatedToken = null, description = '', hint = '', foot = '', confirmText = '', confirmIcon, cancelText = '', cancelIcon, urgent = false, fitRows = false, tiles = false, getHead, onHeadClick, getRows, onPick, onConfirm, onContext, onReady } = options;

    return _queueCard(() => new Promise((resolve) =>
    {
        let done = false;
        let rows = [];
        const card = {};

        const keyHandler = (event) =>
        {
            if (!card.busy && claimCardEscape(event, card.element))
                card.finish(null);
        };

        card.finish = (value) =>
        {
            if (done)
                return;
            done = true;
            document.removeEventListener('keydown', keyHandler);
            _removeInfoCard(card.element);
            resolve(value);
        };

        card.element = _createInfoCard('pickCard', {
            title, icon, origin, originToken, relatedToken, description, hint, foot, confirmText, confirmIcon, cancelText, cancelIcon,
            onConfirm: () => onConfirm?.(card),
            onCancel: () => card.finish(null),
        });

        const listEl = card.element.find('[data-role="pick-list"]');
        const headEl = card.element.find('[data-role="pick-head"]');
        listEl.toggleClass('la-pick-list--fit', fitRows);
        listEl.toggleClass('la-pick-list--tiles', tiles);

        card.refresh = () =>
        {
            rows = getRows();
            listEl.html(rows.map((row, idx) => pickRowHtml(row, idx, fitRows)).join(''));
            headEl.html(getHead?.() ?? '');
        };

        headEl.on('click', '[data-head]', function ()
        {
            if (!card.busy)
                onHeadClick?.(this, card);
        });

        card.setMessage = (text) =>
        {
            card.element.find('.la-info-description').first().html(text);
        };

        card.setConfirm = (text, enabled = true) =>
        {
            const button = card.element.find('[data-action="confirm"]');
            button.prop('disabled', !enabled);
            button.contents().last().replaceWith(document.createTextNode(` ${text}`));
        };

        card.run = async (fn) =>
        {
            card.busy = true;

            try
            {
                return await fn();
            }
            finally
            {
                card.busy = false;
            }
        };

        const rowOf = element => rows[Number(element.dataset.pickIndex)];

        listEl.on('click', '[data-pick-index]', function ()
        {
            const row = rowOf(this);
            if (row && !row.off && !row.done && !card.busy)
                onPick(row, card);
        });

        listEl.on('contextmenu', '[data-pick-index]', function (event)
        {
            event.preventDefault();
            const row = rowOf(this);
            if (row)
                onContext?.(row, card, this);
        });

        listEl.on('mouseenter mouseleave', '[data-pick-group]', function (event)
        {
            const row = rowOf(this);
            if (!row || row.off)
                return;
            listEl.find(`[data-pick-group="${row.group}"]`).toggleClass('la-pick-row--group', event.type === 'mouseenter');
            this.classList.toggle('la-pick-row--lead', event.type === 'mouseenter');
        });

        document.addEventListener('keydown', keyHandler);
        card.refresh();
        onReady?.(card);
        _updatePendingBadge();
    }), title, { urgent, afterFlows: true });
}
