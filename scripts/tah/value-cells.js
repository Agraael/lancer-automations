import { escapeHtml } from '../tools/string-utils.js';
import { htmlToElement } from '../tools/dom-utils.js';
import { laHudRenderIcon } from './item-helpers.js';
import { playUiSound } from './sound.js';
import { BG_DEFAULT } from './hud-palette.js';

function runCellSyncs(selector, dataKey)
{
    $(selector).each(function()
    {
        const sync = /** @type {any} */ ($(this).data(dataKey));
        if (typeof sync === 'function')
            sync();
    });
}

export function refreshToggleCells()
{
    runCellSyncs('.la-toggle-cell', 'laToggleSync');
}

export function refreshValueCells()
{
    runCellSyncs('.la-value-cell', 'laValueSync');
}

export function buildValueCell(item, { incDepth, decDepth })
{
    const cellName = item.nameHtml ?? escapeHtml(item.name);
    const hasMax  = item.max != null;
    const noColor = !!item.noColor;
    const min     = item.min ?? (hasMax ? 0 : -Infinity);
    const max     = item.max ?? Infinity;
    const iconHtml = item.icon ? laHudRenderIcon(item.icon) : '';
    const invert = !!item.invertScale;
    const atBad = (/** @type {number} */ val) => invert ? val >= max : val <= 0;
    const atMid = (/** @type {number} */ val) => invert ? val > 0 : val < max;
    const stateOf = (/** @type {number} */ val) => (noColor || !hasMax) ? null : atBad(val) ? 'bad' : atMid(val) ? 'mid' : 'ok';
    let cell;
    if (item.subtype === 'increment')
    {
        let cur = item.getValue();
        const formatAt = (/** @type {number} */ val) => String(item.formatValue ? item.formatValue(val) : hasMax ? `${val}/${max}` : `${val}`);
        const valText = () => formatAt(cur);
        const step = item.step ?? 1;
        let ghost = '';
        if (Number.isFinite(min) && Number.isFinite(max) && step > 0)
        {
            for (let val = min; val <= max; val += step)
            {
                const text = formatAt(val);
                if (text.length > ghost.length)
                    ghost = text;
            }
        }
        const ghostAttr = ghost ? ` data-ghost="${escapeHtml(ghost)}"` : '';
        cell = $(htmlToElement(`<div class="la-hud-cell">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${cellName}</span></span><div class="la-hud-cell__buttons"><span class="la-inc-val la-hud-cell__val"${ghostAttr}>${valText()}</span><span class="la-hud-cell__spin"><span class="la-inc-btn la-hud-cell__btn">▲</span><span class="la-dec-btn la-hud-cell__btn">▼</span></span></div></div>`));
        const suppress = () =>
        {
            incDepth(); setTimeout(decDepth, 300);
        };
        const updateDisplay = () =>
        {
            const state = stateOf(cur);
            cell.find('.la-inc-val').text(valText());
            cell.removeClass('la-value-cell--bad la-value-cell--mid la-value-cell--ok');
            if (state)
                cell.addClass(`la-value-cell--${state}`);
        };
        cell.find('.la-dec-btn').on('click', (ev) =>
        {
            ev.stopPropagation(); if (cur <= min)
                return; playUiSound('toggle'); suppress(); cur = Math.max(min, cur - step); item.onValueChanged(cur); updateDisplay();
        });
        cell.find('.la-inc-btn').on('click', (ev) =>
        {
            ev.stopPropagation(); if (cur >= max)
                return; playUiSound('toggle'); suppress(); cur = Math.min(max, cur + step); item.onValueChanged(cur); updateDisplay();
        });
        updateDisplay();
        cell.data('restingBg', '');
        cell.addClass('la-value-cell').data('laValueSync', () =>
        {
            const fresh = item.getValue();
            if (fresh !== cur)
            {
                cur = fresh;
                updateDisplay();
            }
        });
    }
    else if (item.subtype === 'pips')
    {
        let cur = item.getValue();
        let pipsHtml = '';
        for (let segment = 1; segment <= max; segment++)
            pipsHtml += `<span class="la-hud-pip" data-segment="${segment}"></span>`;
        cell = $(htmlToElement(`<div class="la-hud-cell la-pip-cell${item.bad ? ' la-pip-cell--bad' : ''}">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${cellName}</span></span><span class="la-hud-pips">${pipsHtml}</span></div>`));
        // Restyle in place: replacing the nodes under the pointer re-fires the cell's mouseenter.
        const repaint = () => cell.find('.la-hud-pip').each((idx, pip) =>
        {
            pip.classList.toggle('la-hud-pip--on', (idx + 1) <= cur);
        });
        repaint();
        cell.on('click', '.la-hud-pip', (ev) =>
        {
            ev.stopPropagation();
            const segment = Number($(ev.currentTarget).data('segment'));
            const next = cur === segment ? segment - 1 : segment;
            if (next === cur)
                return;
            playUiSound('toggle');
            incDepth();
            setTimeout(decDepth, 300);
            cur = Math.min(max, Math.max(min, next));
            item.onValueChanged(cur);
            repaint();
        });
        cell.data('restingBg', BG_DEFAULT);
        cell.addClass('la-value-cell').data('laValueSync', () =>
        {
            const fresh = item.getValue();
            if (fresh !== cur)
            {
                cur = fresh;
                repaint();
            }
        });
    }
    else if (item.subtype === 'toggle')
    {
        let on = !!item.getValue();
        const onColor = 'var(--primary-color)';
        const offColor = '#666';
        const switchHtml = `<span class="la-toggle-switch" style="background:${on ? onColor : offColor};"><span class="la-toggle-knob" style="left:${on ? '14px' : '1px'};"></span></span>`;
        cell = $(htmlToElement(`<div class="la-hud-cell la-toggle-cell${on ? '' : ' la-toggle-cell--off'}">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${cellName}</span></span>${switchHtml}</div>`));
        const paintSwitch = () =>
        {
            const sw = cell.find('.la-toggle-switch');
            sw.css('background', on ? onColor : offColor);
            sw.find('.la-toggle-knob').css('left', on ? '14px' : '1px');
            cell.toggleClass('la-toggle-cell--off', !on);
        };
        cell.data('laToggleSync', () =>
        {
            on = !!item.getValue();
            paintSwitch();
        });
        cell.find('.la-toggle-switch').on('click', async (ev) =>
        {
            ev.stopPropagation();
            playUiSound('toggle');
            on = !on;
            paintSwitch();
            incDepth();
            try
            {
                await item.onToggle(on);
            }
            finally
            {
                decDepth();
            }
        });
        cell.data('restingBg', BG_DEFAULT);
    }
    else if (item.subtype === 'pills')
    {
        const states = item.pills.map((/** @type {any} */ pill) => !!pill.getValue());
        cell = $(htmlToElement(`<div class="la-hud-cell la-pill-cell">${item.pills.map((/** @type {any} */ pill, /** @type {number} */ idx) => `<span class="la-hud-pill" data-idx="${idx}"><i></i>${escapeHtml(pill.label)}</span>`).join('')}</div>`));
        const paintPills = () => cell.find('.la-hud-pill').each((idx, el) =>
        {
            const pill = item.pills[idx];
            $(el).toggleClass('la-hud-pill--on', states[idx]).children('i').attr('class', states[idx] ? pill.icon : (pill.iconOff ?? pill.icon));
        });
        paintPills();
        cell.on('click', '.la-hud-pill', async (ev) =>
        {
            ev.stopPropagation();
            const idx = Number($(ev.currentTarget).data('idx'));
            playUiSound('toggle');
            states[idx] = !states[idx];
            paintPills();
            incDepth();
            try
            {
                await item.pills[idx].onToggle(states[idx]);
            }
            finally
            {
                decDepth();
            }
        });
        cell.data('restingBg', BG_DEFAULT);
    }
    else
    {
        cell = $(htmlToElement(`<div class="la-hud-cell">${iconHtml}<span class="la-hud-clip"><span class="la-hud-pan">${cellName}</span></span><input type="number" class="la-type-val la-hud-cell__input" value="${item.getValue()}"></div>`));
        cell.find('.la-type-val').on('change', (ev) =>
        {
            ev.stopPropagation(); playUiSound('toggle'); const value = Number.parseInt(/** @type {HTMLInputElement} */(ev.target).value, 10); if (!Number.isNaN(value))
                item.onValueChanged(value);
        }).on('click mousedown', (ev) => ev.stopPropagation());
        cell.data('restingBg', BG_DEFAULT);
        cell.addClass('la-value-cell').data('laValueSync', () =>
        {
            const input = cell.find('.la-type-val');
            if (!input.is(':focus'))
                input.val(item.getValue());
        });
    }
    return cell;
}

export function activateValueCell(row, rightClick)
{
    const incBtn = row.find('.la-inc-btn');
    if (incBtn.length)
        (rightClick ? row.find('.la-dec-btn') : incBtn).trigger('click');
    else if (!rightClick)
        row.find('.la-toggle-switch').trigger('click');
}
