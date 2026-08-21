/* global Dialog, game, fromUuid */

import { playBattleLogSound, playUiSound, stopBattleLogTheme, setBattleLogThemeMuted, getBattleLogThemeSrc } from '../tah/sound.js';
import { getStatsForActor, buildTwoZoneStatsHtml, ensureStyleSheet } from '../tah/tokenStatHint.js';
import { getScanJournalsForActor } from '../tools/scan-lookup.js';
import { exportSquadPoster, exportPlayerPoster } from './share-image.js';

const _escape = str => String(str ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

function _themeNameHtml()
{
    const src = getBattleLogThemeSrc();
    if (!src)
        return '';
    let name = String(src).split('/').pop() ?? '';
    try
    {
        name = decodeURIComponent(name);
    }
    catch
    { /* keep raw */ }
    name = name.replace(/\.[^.]+$/, '');
    if (!name)
        return '';
    return `<span class="battelog-recap-theme-name" title="${_escape(name)}"><i class="fas fa-music"></i><span class="battelog-recap-theme-clip"><span class="battelog-recap-theme-scroll">${_escape(name)}</span></span></span>`;
}

const RECAP_OPEN_DELAY_MS = 125;
const RECAP_OPEN_SOUND_DELAY_MS = RECAP_OPEN_DELAY_MS + 120;

// Kept in sync with the .has-tip transition-delay in battelog.css.
const HOVER_TIP_REVEAL_MS = 350;

const TIP_HOVER_SELECTOR = [
    '.battelog-pcol-stat-cell.has-tip',
    '.battelog-pcol-activity-cell.has-tip',
    '.battelog-pcol-kills-block.has-tip',
    '.battelog-pcol-assists-block.has-tip',
    '.battelog-pcol-medal',
    '.battelog-pcol-gearlost.has-lost',
    '.battelog-hcard-scan-btn.has-tip',
    '.battelog-hcard-marker.has-tip',
    '.battelog-hcard-killers.has-tip',
    '.battelog-pcol-frame-name.has-tip',
].join(', ');

const IMMEDIATE_HOVER_SELECTOR = '.battelog-recap-tab:not(.disabled), .battelog-recap-dismiss, .battelog-recap-theme-mute, .battelog-hcard-scan-btn, .battelog-telemetry-metric, .battelog-telemetry-legend-item, .battelog-telemetry-legend-total, .battelog-encounter-filter-btn:not([disabled])';

const CLICK_SELECTOR = '.battelog-recap-tab:not(.disabled), .battelog-hcard-scan-btn, .battelog-telemetry-metric, .battelog-telemetry-legend-item, .battelog-telemetry-legend-total, .battelog-recap-theme-mute, .battelog-recap-dismiss, .battelog-encounter-filter-btn:not([disabled]), .battelog-recap-tab-panel[data-tab-panel="squad"] .battelog-pcol';

/**
 * @param {object} battle
 * @param {object} [opts]
 * @param {'VICTORY'|'DEFEAT'|'PARTIAL'} [opts.outcome]
 * @param {string|null} [opts.mvpId]
 */
export function openBattleLogRecap(battle, { outcome = 'VICTORY', mvpId = null } = {})
{
    setTimeout(() => playBattleLogSound('logOpen'), RECAP_OPEN_SOUND_DELAY_MS);
    const mission = battle?.mission ?? {};
    const players = battle?.players ?? [];
    const hostiles = battle?.hostiles ?? [];
    const friendlies = battle?.friendlies ?? [];
    const neutrals = battle?.neutrals ?? [];
    const secrets = battle?.secrets ?? [];
    const encounter = [...hostiles, ...friendlies, ...neutrals, ...secrets];

    const date = mission.date ?? new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
    const rounds = mission.rounds ?? 0;
    const realtime = mission.realtime ?? _formatRealtime(mission.durationMs);
    const combatants = mission.combatants ?? (players.length + hostiles.length);

    const sorted = _sortPlayers(players, mvpId);
    // mvpId (GM's pick) overrides the derived MVP: strip the old MVP entry and inject one for it.
    const nonMvpAwards = (battle?.awards ?? []).filter(award => award.key !== 'MVP');
    const effectiveAwards = mvpId && players.some(p => p.id === mvpId)
        ? [{
            key: 'MVP',
            holder: mvpId,
            label: 'MVP',
            icon: 'fa-star',
            stat: '',
            sub: 'Recognized as the squad standout this engagement',
        }, ...nonMvpAwards]
        : nonMvpAwards;
    const squadTabHtml = _squadTabHtml(sorted, mvpId, effectiveAwards);
    const encounterTabHtml = _encounterTabHtml(encounter, sorted);
    const telemetryTabHtml = _telemetryTabHtml(battle);

    const content = `
        <div class="battelog-recap-head">
            <div class="battelog-recap-head-left">
                <div class="battelog-recap-kicker">INCOMING TRANSMISSION : DECRYPTED</div>
                <div class="battelog-recap-title">Battle Log</div>
                <div class="battelog-recap-meta">
                    <span class="battelog-recap-meta-item"><i class="fas fa-calendar-day"></i> ${_escape(date)}</span>
                    <span class="battelog-recap-meta-dot">·</span>
                    <span class="battelog-recap-meta-item">${_escape(rounds)} ROUNDS</span>
                    <span class="battelog-recap-meta-dot">·</span>
                    <span class="battelog-recap-meta-item">${_escape(realtime)}</span>
                    <span class="battelog-recap-meta-dot">·</span>
                    <span class="battelog-recap-meta-item">${_escape(combatants)} COMBATANTS</span>
                </div>
            </div>
            <div class="battelog-recap-head-right">
                ${_outcomeStamp(outcome)}
            </div>
        </div>

        <nav class="battelog-recap-tabbar">
            <button type="button" class="battelog-recap-tab on" data-tab="squad"><i class="fas fa-users"></i> SQUAD</button>
            <button type="button" class="battelog-recap-tab"    data-tab="encounter"><i class="fas fa-users-line"></i> ENCOUNTER</button>
            <button type="button" class="battelog-recap-tab"    data-tab="telemetry"><i class="fas fa-chart-line"></i> TELEMETRY</button>
        </nav>

        <div class="battelog-recap-body">
            <div class="battelog-recap-tab-panel is-active" data-tab-panel="squad">${squadTabHtml}</div>
            <div class="battelog-recap-tab-panel" data-tab-panel="encounter">${encounterTabHtml}</div>
            <div class="battelog-recap-tab-panel" data-tab-panel="telemetry">${telemetryTabHtml}</div>
        </div>

        <footer class="battelog-recap-foot">
            <span class="battelog-recap-brand"><i class="fas fa-file-lines"></i> LANCER AUTOMATIONS · BATTLE LOG</span>
            ${_themeNameHtml()}
            <button type="button" class="battelog-recap-theme-mute" data-action="toggle-theme" title="Mute theme">
                <i class="fas fa-volume-high"></i>
            </button>
            <button type="button" class="battelog-recap-share" data-action="share"
                title="Save the squad as an image (Shift-click to copy to clipboard)">
                <i class="fas fa-camera"></i>
            </button>
            <button type="button" class="battelog-recap-dismiss" data-action="close">DISMISS</button>
        </footer>
    `;

    const dlg = new Dialog({
        title: 'Battle Log · Recap',
        content,
        buttons: {
            // Hidden via CSS; real buttons live inline. Dialog requires at least one entry.
            _hidden: { label: '',
                callback: () =>
                {} },
        },
        default: '_hidden',
        close: () => stopBattleLogTheme({ fadeMs: 1200 }),
        render: (html) =>
        {
            const $root = html instanceof $ ? html : $(html);

            // Medal counts differ per card; level every award block to the tallest so the stats below line up.
            const equalizeMedalBlocks = () =>
            {
                const grid = $root[0]?.querySelector('.battelog-recap-squad-grid');
                if (!grid)
                    return;
                const blocks = grid.querySelectorAll('.battelog-pcol-medals');
                if (!blocks.length)
                    return;
                let maxHeight = 0;
                blocks.forEach((block) =>
                {
                    block.style.minHeight = '';
                    if (block.offsetHeight > maxHeight)
                        maxHeight = block.offsetHeight;
                });
                if (maxHeight > 0)
                {
                    blocks.forEach((block) =>
                    {
                        block.style.minHeight = `${maxHeight}px`;
                    });
                }
                blocks.forEach((block) =>
                {
                    block.parentElement?.classList.toggle('has-overflow', block.scrollHeight > block.clientHeight + 1);
                });
            };
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(equalizeMedalBlocks));
            globalThis.setTimeout(equalizeMedalBlocks, 500);

            globalThis.requestAnimationFrame(() =>
            {
                const themeName = $root[0]?.querySelector('.battelog-recap-theme-name');
                const themeClip = themeName?.querySelector('.battelog-recap-theme-clip');
                const themeScroll = themeClip?.querySelector('.battelog-recap-theme-scroll');
                if (!themeName || !themeClip || !themeScroll)
                    return;
                if (themeScroll.scrollWidth <= themeClip.clientWidth + 4)
                    return;
                const single = themeScroll.innerHTML + '<span class="battelog-recap-theme-gap"></span>';
                themeScroll.innerHTML = single + single;
                themeName.classList.add('is-scrolling');
                themeScroll.style.animationDuration = `${Math.max(8, themeScroll.scrollWidth / 2 / 14)}s`;
            });

            $root.on('click', '.battelog-pcol-medals-scroll', function ()
            {
                const medals = /** @type {HTMLElement} */ (this).closest('.battelog-pcol-medals-wrap')?.querySelector('.battelog-pcol-medals');
                if (medals)
                    medals.scrollBy({ top: Number(/** @type {HTMLElement} */ (this).dataset.dir || 1) * 48, behavior: 'smooth' });
            });

            $root.on('click', '.battelog-recap-share', function (ev)
            {
                ev.preventDefault();
                const btn = /** @type {HTMLElement} */ (this);
                btn.classList.add('is-busy');
                const focusedCard = /** @type {HTMLElement} */ ($root[0].querySelector('.battelog-recap-squad-grid.is-focus .battelog-pcol.is-focus-target'));
                let exportPromise;
                if (focusedCard)
                {
                    const detailEl = /** @type {HTMLElement} */ (focusedCard.parentElement?.querySelector('.battelog-focus-detail'));
                    const pilot = (focusedCard.querySelector('.battelog-pcol-ribbon-text')?.textContent ?? '').split('·')[0].trim();
                    exportPromise = exportPlayerPoster(/** @type {HTMLElement} */ ($root[0]), focusedCard,
                        { pilot }, { toClipboard: !!ev.shiftKey, detailEl });
                }
                else
                {
                    exportPromise = exportSquadPoster(/** @type {HTMLElement} */ ($root[0]), { date },
                        { toClipboard: !!ev.shiftKey });
                }
                exportPromise.finally(() => btn.classList.remove('is-busy'));
            });

            $root.on('click', '.battelog-recap-dismiss', () => dlg.close());
            // Boot-in translate overshoots the container; hide the scrollbar and play displayList during the stagger.
            let bootLoop = null;
            let stopLoopTimer = null;
            let stopClassTimer = null;
            const stopBootLoop = () =>
            {
                if (bootLoop)
                {
                    bootLoop.stop();
                    bootLoop = null;
                }
            };
            const suppressBooting = ($panel) =>
            {
                // Cancel prior timers first; otherwise a stale one would kill the loop we're about to start.
                if (stopLoopTimer)
                {
                    clearTimeout(stopLoopTimer);
                    stopLoopTimer = null;
                }
                if (stopClassTimer)
                {
                    clearTimeout(stopClassTimer);
                    stopClassTimer = null;
                }
                stopBootLoop();
                $root.find('.battelog-recap-tab-panel.is-booting').removeClass('is-booting');
                $panel.addClass('is-booting');
                // recycled each boot; the fill-mode would pin transform/box-shadow forever
                $panel.find('.stagger-done').removeClass('stagger-done').addClass('stagger');
                // The last delay drives the end, not the count: hidden siblings never animate.
                let lastDelayMs = -1;
                $panel.find('.stagger').each((_, el) =>
                {
                    if (!el.offsetParent && el.style.position !== 'fixed')
                        return;
                    const step = Number(el.style.getPropertyValue('--i'));
                    if (Number.isFinite(step))
                        lastDelayMs = Math.max(lastDelayMs, 100 + step * 40);
                });
                const isTelemetry = $panel.attr('data-tab-panel') === 'telemetry';
                // Telemetry has no stagger elements; it uses the chart line-draw animation (~1.7s).
                const opacityEndMs = lastDelayMs >= 0
                    ? lastDelayMs + 250
                    : (isTelemetry ? 640 : 900);
                const animEndMs = lastDelayMs >= 0
                    ? lastDelayMs + 550
                    : (isTelemetry ? 640 : 1400);
                if (lastDelayMs >= 0 || isTelemetry)
                    bootLoop = playBattleLogSound('displayList', { loop: true });
                stopLoopTimer = setTimeout(() =>
                {
                    stopLoopTimer = null;
                    stopBootLoop();
                }, opacityEndMs);
                stopClassTimer = setTimeout(() =>
                {
                    stopClassTimer = null;
                    $panel.removeClass('is-booting');
                    const $staggered = $panel.find('.stagger');
                    // no hover lift snapping in under a resting cursor
                    $staggered.filter((_, el) => el.matches(':hover')).addClass('hover-hold');
                    $staggered.removeClass('stagger').addClass('stagger-done');
                }, animEndMs);
            };
            suppressBooting($root.find('.battelog-recap-tab-panel.is-active'));
            $root.on('click', '.battelog-recap-tab', function (ev)
            {
                ev.preventDefault();
                const el = /** @type {HTMLElement} */ (this);
                if (el.classList.contains('disabled') || el.classList.contains('on'))
                    return;
                const target = el.dataset.tab;
                $root.find('.battelog-recap-tab').removeClass('on');
                el.classList.add('on');
                $root.find('.battelog-recap-tab-panel').removeClass('is-active');
                const $newPanel = $root.find(`.battelog-recap-tab-panel[data-tab-panel="${target}"]`);
                $newPanel.addClass('is-active');
                const panelEl = $newPanel[0];
                if (panelEl)
                {
                    panelEl.scrollTop = 0;
                    panelEl.scrollLeft = 0;
                    panelEl.querySelectorAll('.battelog-recap-squad-scroll, .battelog-hostiles-grid, .battelog-telemetry-chart, .battelog-telemetry-legend')
                        .forEach(node =>
                        {
                            node.scrollTop = 0;
                            node.scrollLeft = 0;
                        });
                }
                $root.find('.battelog-recap-share').prop('disabled', target !== 'squad');
                suppressBooting($newPanel);
                // Chart can't measure until the panel is visible.
                if (target === 'telemetry')
                    requestAnimationFrame(() => rerenderTelemetry());
            });
            // Focused mech view: stat strip on top, panels in three labeled category columns.
            const PANEL_GROUPS = [
                { label: 'Offense', titles: new Set(['confirmed kills', 'assisted kills', 'attacks & tech', 'accuracy', 'weapons used']) },
                { label: 'Defense', titles: new Set(['damage dealt', 'damage taken', 'attacks avoided', 'h.a.s.e']) },
                { label: 'Operations', titles: new Set(['actions used', 'movement', 'repairs', 'awards']) },
            ];
            const buildFocusDetail = (card) =>
            {
                const detail = document.createElement('div');
                detail.className = 'battelog-focus-detail';
                const wideRow = document.createElement('div');
                wideRow.className = 'battelog-focus-wide';
                const grouped = PANEL_GROUPS.map(() => []);
                const linkByKey = new Map();
                card.querySelectorAll('.has-tip, .battelog-pcol-medals').forEach((anchor) =>
                {
                    // __scanTip: the stat tip lives in <body> once it has been hovered
                    const tip = /** @type {any} */ (anchor).__scanTip
                        ?? (anchor.classList.contains('battelog-pcol-medals')
                            ? card.querySelector('.battelog-awards-tip')
                            : anchor.querySelector('.battelog-tip-panel'));
                    if (!(tip instanceof HTMLElement))
                        return;
                    const key = (tip.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
                    if (!key)
                        return;
                    // duplicates (fav weapon / top action) just link to the first copy
                    if (linkByKey.has(key))
                    {
                        anchor.setAttribute('data-tip-link', String(linkByKey.get(key)));
                        return;
                    }
                    const panelIndex = linkByKey.size;
                    linkByKey.set(key, panelIndex);
                    const panelClone = /** @type {HTMLElement} */ (tip.cloneNode(true));
                    panelClone.classList.remove('is-visible', 'is-left');
                    panelClone.style.removeProperty('left');
                    panelClone.style.removeProperty('top');
                    panelClone.classList.add('stagger');
                    panelClone.setAttribute('data-tip-link', String(panelIndex));
                    anchor.setAttribute('data-tip-link', String(panelIndex));
                    if (panelClone.classList.contains('battelog-scan-tip'))
                    {
                        wideRow.appendChild(panelClone);
                        return;
                    }
                    const title = (panelClone.querySelector('.battelog-tip-title')?.textContent ?? '').trim().toLowerCase();
                    const groupIndex = PANEL_GROUPS.findIndex(group => group.titles.has(title));
                    grouped[groupIndex >= 0 ? groupIndex : PANEL_GROUPS.length - 1].push(panelClone);
                });
                if (wideRow.childElementCount)
                    detail.appendChild(wideRow);
                const colsWrap = document.createElement('div');
                colsWrap.className = 'battelog-focus-cols';
                PANEL_GROUPS.forEach((group, groupIndex) =>
                {
                    if (!grouped[groupIndex].length)
                        return;
                    const colEl = document.createElement('div');
                    colEl.className = 'battelog-focus-col';
                    const head = document.createElement('div');
                    head.className = 'battelog-focus-colhead';
                    head.textContent = group.label;
                    colEl.appendChild(head);
                    grouped[groupIndex].forEach(panel => colEl.appendChild(panel));
                    colsWrap.appendChild(colEl);
                });
                detail.appendChild(colsWrap);
                // stagger follows the final placement, not the order panels were discovered in
                detail.querySelectorAll('.battelog-tip-panel').forEach((panel, index) =>
                {
                    /** @type {HTMLElement} */ (panel).style.setProperty('--i', String(index + 1));
                });
                card.insertAdjacentElement('afterend', detail);
                return detail;
            };
            const closeFocus = () =>
            {
                const $grid = $root.find('.battelog-recap-squad-grid.is-focus');
                if (!$grid.length)
                    return false;
                $grid.find('[data-tip-link]').removeAttr('data-tip-link');
                $grid.find('.battelog-focus-detail').remove();
                $grid.find('.battelog-pcol.is-focus-target').removeClass('is-focus-target');
                $grid.removeClass('is-focus');
                return true;
            };
            $root.on('click', '.battelog-recap-tab-panel[data-tab-panel="squad"] .battelog-pcol', function (ev)
            {
                if (ev.target.closest('button, a'))
                    return;
                const card = /** @type {HTMLElement} */ (this);
                const grid = card.closest('.battelog-recap-squad-grid');
                if (!grid)
                    return;
                const wasFocused = card.classList.contains('is-focus-target');
                closeFocus();
                const $panel = $root.find('.battelog-recap-tab-panel[data-tab-panel="squad"]');
                if (wasFocused)
                {
                    // re-shown siblings replay their stagger
                    suppressBooting($panel);
                    return;
                }
                grid.classList.add('is-focus');
                card.classList.add('is-focus-target');
                buildFocusDetail(card);
                suppressBooting($panel);
            });
            $root.on('mouseleave', '.hover-hold', function ()
            {
                this.classList.remove('hover-hold');
            });
            $root.on('mouseenter', '.battelog-pcol.is-focus-target [data-tip-link]', function ()
            {
                const linkIndex = /** @type {HTMLElement} */ (this).getAttribute('data-tip-link');
                $root.find(`.battelog-focus-detail .battelog-tip-panel[data-tip-link="${linkIndex}"]`).addClass('is-linked');
            });
            $root.on('mouseleave', '.battelog-pcol.is-focus-target [data-tip-link]', function ()
            {
                const linkIndex = /** @type {HTMLElement} */ (this).getAttribute('data-tip-link');
                $root.find(`.battelog-focus-detail .battelog-tip-panel[data-tip-link="${linkIndex}"]`).removeClass('is-linked');
            });
            $root.on('wheel', '.battelog-recap-squad-scroll', function (ev)
            {
                const el = /** @type {HTMLElement} */ (this);
                if (el.scrollWidth <= el.clientWidth)
                    return;
                const native = /** @type {WheelEvent} */ (ev.originalEvent ?? ev);
                if (!native.deltaY)
                    return;
                ev.preventDefault();
                el.scrollLeft += native.deltaY;
            });
            $root.on('click', '.battelog-hcard-scan-btn', async function ()
            {
                const uuid = /** @type {HTMLElement} */ (this).dataset.journalUuid;
                if (!uuid)
                    return;
                const entry = await fromUuid(uuid);
                /** @type {any} */ (entry)?.sheet?.render(true);
            });
            const rerenderTelemetry = () =>
            {
                const $tel = $root.find('.battelog-telemetry');
                if ($tel.length === 0)
                    return;
                const view = String($tel.attr('data-view') ?? 'hp');
                const rawH = String($tel.attr('data-highlight') ?? '');
                const highlight = rawH === '' ? null : rawH;
                const showTotal = String($tel.attr('data-total') ?? '0') === '1';
                const chartEl = $tel.find('.battelog-telemetry-chart')[0];
                const chartSize = chartEl && chartEl.clientHeight > 40
                    ? { w: chartEl.clientWidth, h: chartEl.clientHeight }
                    : null;
                $tel.html(_telemetryInnerHtml(battle, view, highlight, showTotal, chartSize));
            };
            // Fire the displayList loop for the chart draw-in on metric / legend change.
            let chartDrawLoop = null;
            let chartDrawStopTimer = null;
            const playChartDrawSound = (durationMs = 640) =>
            {
                if (chartDrawStopTimer)
                {
                    clearTimeout(chartDrawStopTimer);
                    chartDrawStopTimer = null;
                }
                if (chartDrawLoop)
                {
                    chartDrawLoop.stop();
                    chartDrawLoop = null;
                }
                chartDrawLoop = playBattleLogSound('displayList', { loop: true });
                chartDrawStopTimer = setTimeout(() =>
                {
                    if (chartDrawLoop)
                    {
                        chartDrawLoop.stop();
                        chartDrawLoop = null;
                    }
                    chartDrawStopTimer = null;
                }, durationMs);
            };

            const staggerSoundMs = (count) => Math.min(3000, Math.max(280, (count - 1) * 25 + 100));
            $root.on('click', '.battelog-encounter-filter-btn', function ()
            {
                const btn = /** @type {HTMLElement} */ (this);
                if (btn.hasAttribute('disabled'))
                    return;
                const next = btn.dataset.dispo ?? 'hostile';
                const $enc = $root.find('.battelog-encounter');
                if (String($enc.attr('data-dispo') ?? '') === next)
                    return;
                $enc.attr('data-dispo', next);
                $enc.html(_encounterInnerHtml(encounter, sorted, next));
                const nCards = encounter.filter(entry => (entry.side ?? 'hostile') === next).length;
                playChartDrawSound(staggerSoundMs(nCards));
            });
            $root.on('click', '.battelog-telemetry-metric', function ()
            {
                const el = /** @type {HTMLElement} */ (this);
                const $tel = $root.find('.battelog-telemetry');
                $tel.attr('data-view', el.dataset.metric ?? 'hp');
                $tel.attr('data-highlight', '');
                $tel.attr('data-total', '0');
                rerenderTelemetry();
                playChartDrawSound();
            });
            $root.on('click', '.battelog-telemetry-legend-item', function ()
            {
                const el = /** @type {HTMLElement} */ (this);
                const $tel = $root.find('.battelog-telemetry');
                const cur = String($tel.attr('data-highlight') ?? '');
                const next = cur === el.dataset.seriesId ? '' : (el.dataset.seriesId ?? '');
                $tel.attr('data-highlight', next);
                rerenderTelemetry();
                playChartDrawSound();
            });
            $root.on('click', '.battelog-telemetry-legend-total', function ()
            {
                const $tel = $root.find('.battelog-telemetry');
                const cur = String($tel.attr('data-total') ?? '0') === '1';
                $tel.attr('data-total', cur ? '0' : '1');
                rerenderTelemetry();
                playChartDrawSound();
            });
            let lastHoverAt = 0;
            $root.on('mouseover', '.battelog-telemetry-hit', function ()
            {
                const el = /** @type {SVGElement} */ (this);
                const svg = el.ownerSVGElement;
                if (!svg)
                    return;
                const hoverLayer = svg.querySelector('.battelog-telemetry-hover');
                if (!(hoverLayer instanceof Element))
                    return;
                const raw = el.dataset.hover;
                if (!raw)
                    return;
                let payload;
                try
                {
                    payload = JSON.parse(decodeURIComponent(raw));
                }
                catch
                {
                    return;
                }
                hoverLayer.innerHTML = _telemetryHoverSvg(payload, svg);
                const now = Date.now();
                if (now - lastHoverAt > 120)
                {
                    lastHoverAt = now;
                    playUiSound('battleLogHover');
                }
            });
            $root.on('mouseout', '.battelog-telemetry-hit', function ()
            {
                const el = /** @type {SVGElement} */ (this);
                const svg = el.ownerSVGElement;
                const hoverLayer = svg?.querySelector('.battelog-telemetry-hover');
                if (hoverLayer instanceof Element)
                    hoverLayer.innerHTML = '';
            });
            $root.on('click', '.battelog-recap-theme-mute', function ()
            {
                const muted = setBattleLogThemeMuted();
                const icon = /** @type {HTMLElement} */ (this).querySelector('i');
                if (icon)
                    icon.className = muted ? 'fas fa-volume-xmark' : 'fas fa-volume-high';
                /** @type {HTMLElement} */ (this).title = muted ? 'Unmute theme' : 'Mute theme';
                /** @type {HTMLElement} */ (this).classList.toggle('is-muted', muted);
            });

            let lastImmediateAt = 0;
            $root.on('mouseenter', IMMEDIATE_HOVER_SELECTOR, () =>
            {
                const now = Date.now();
                if (now - lastImmediateAt < 90)
                    return;
                lastImmediateAt = now;
                playUiSound('battleLogHover');
            });

            // Scan tip mirrors the token stat hint (sound = 'details'); other tips use 'battleLogHover'.
            $root.on('mouseenter', TIP_HOVER_SELECTOR, function ()
            {
                const el = /** @type {HTMLElement} */ (this);
                const variant = el.matches('.battelog-hcard-scan-btn.has-tip, .battelog-pcol-frame-name.has-tip')
                    ? 'details'
                    : 'battleLogHover';
                // the focused view has no tooltip reveal, so no sound delay
                if (el.closest('.battelog-pcol.is-focus-target'))
                {
                    playUiSound(variant);
                    return;
                }
                const timer = setTimeout(() =>
                {
                    playUiSound(variant);
                    el.dataset.hoverSfxTimer = '';
                }, HOVER_TIP_REVEAL_MS);
                el.dataset.hoverSfxTimer = String(timer);
            });
            $root.on('mouseleave', TIP_HOVER_SELECTOR, function ()
            {
                const el = /** @type {HTMLElement} */ (this);
                const timerId = Number(el.dataset.hoverSfxTimer);
                if (timerId)
                {
                    clearTimeout(timerId);
                    el.dataset.hoverSfxTimer = '';
                }
            });

            // Scan tip lives in <body>; tab panel overflow clips it and a Foundry dialog transform breaks position:fixed.
            const scanTips = new Set();
            $root.on('mouseenter', '.battelog-hcard-scan-btn.has-tip, .battelog-pcol-frame-name.has-tip', function ()
            {
                const btn = /** @type {any} */ (this);
                // the focused view already shows the stat panel flat
                if (btn.closest('.battelog-pcol.is-focus-target'))
                    return;
                let tip = /** @type {HTMLElement | null} */ (btn.__scanTip ?? null);
                if (!tip)
                {
                    tip = btn.querySelector(':scope > .battelog-scan-tip');
                    if (!(tip instanceof HTMLElement))
                        return;
                    document.body.appendChild(tip);
                    btn.__scanTip = tip;
                    scanTips.add(tip);
                }
                const btnRect = btn.getBoundingClientRect();
                const w = tip.offsetWidth || 260;
                const h = tip.offsetHeight || 200;
                const gap = 8;
                const margin = 8;
                const vw = globalThis.innerWidth;
                const vh = globalThis.innerHeight;
                const placeLeft = btnRect.right + gap + w + margin > vw;
                let left = placeLeft ? (btnRect.left - w - gap) : (btnRect.right + gap);
                left = Math.max(margin, Math.min(left, vw - w - margin));
                let top = btnRect.top + btnRect.height / 2 - h / 2;
                top = Math.max(margin, Math.min(top, vh - h - margin));
                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
                tip.classList.toggle('is-left', placeLeft);
                tip.classList.add('is-visible');
            });
            $root.on('mouseleave', '.battelog-hcard-scan-btn.has-tip, .battelog-pcol-frame-name.has-tip', function ()
            {
                const btn = /** @type {any} */ (this);
                const tip = /** @type {HTMLElement | null} */ (btn.__scanTip ?? null);
                if (tip)
                    tip.classList.remove('is-visible');
            });

            // Medal tips move to <body> so the 2-line award scroll box can't clip them.
            $root.on('mouseenter', '.battelog-pcol-medal', function ()
            {
                const medal = /** @type {any} */ (this);
                let tip = /** @type {HTMLElement | null} */ (medal.__medalTip ?? null);
                if (!tip)
                {
                    tip = medal.querySelector(':scope > .battelog-pcol-medal-tip');
                    if (!(tip instanceof HTMLElement))
                        return;
                    const medalStyle = globalThis.getComputedStyle(medal);
                    ['--la-panel-ink', '--la-primary', '--la-amber', '--la-danger'].forEach((varName) =>
                    {
                        const value = medalStyle.getPropertyValue(varName);
                        if (value)
                            tip.style.setProperty(varName, value.trim());
                    });
                    if (medal.classList.contains('is-mvp'))
                        tip.classList.add('is-mvp');
                    if (medal.classList.contains('is-kia'))
                        tip.classList.add('is-kia');
                    document.body.appendChild(tip);
                    tip.style.position = 'fixed';
                    tip.style.bottom = 'auto';
                    tip.style.zIndex = '2147483000';
                    medal.__medalTip = tip;
                    scanTips.add(tip);
                }
                const rect = medal.getBoundingClientRect();
                const tipW = tip.offsetWidth || 200;
                const tipH = tip.offsetHeight || 120;
                const gap = 8;
                const margin = 8;
                const viewW = globalThis.innerWidth;
                const viewH = globalThis.innerHeight;
                const left = Math.max(margin, Math.min(rect.left, viewW - tipW - margin));
                let top = rect.top - tipH - gap;
                if (top < margin)
                    top = rect.bottom + gap;
                top = Math.max(margin, Math.min(top, viewH - tipH - margin));
                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
                tip.classList.add('is-visible');
            });
            $root.on('mouseleave', '.battelog-pcol-medal', function ()
            {
                const medal = /** @type {any} */ (this);
                const tip = /** @type {HTMLElement | null} */ (medal.__medalTip ?? null);
                if (tip)
                    tip.classList.remove('is-visible');
            });

            $root.on('mouseenter', '.battelog-hcard-killers.has-tip', function ()
            {
                const anchor = /** @type {any} */ (this);
                let tip = /** @type {HTMLElement | null} */ (anchor.__killersTip ?? null);
                if (!tip)
                {
                    tip = anchor.querySelector(':scope > .battelog-hcard-killers-tip');
                    if (!(tip instanceof HTMLElement))
                        return;
                    const anchorStyle = globalThis.getComputedStyle(anchor);
                    ['--la-panel-ink', '--la-primary', '--la-amber', '--la-danger', '--la-ink', '--la-accent'].forEach((varName) =>
                    {
                        const value = anchorStyle.getPropertyValue(varName);
                        if (value)
                            tip.style.setProperty(varName, value.trim());
                    });
                    document.body.appendChild(tip);
                    tip.style.position = 'fixed';
                    tip.style.bottom = 'auto';
                    tip.style.zIndex = '2147483000';
                    anchor.__killersTip = tip;
                    scanTips.add(tip);
                }
                const rect = anchor.getBoundingClientRect();
                const tipW = tip.offsetWidth || 200;
                const tipH = tip.offsetHeight || 120;
                const gap = 8;
                const margin = 8;
                const viewW = globalThis.innerWidth;
                const viewH = globalThis.innerHeight;
                const left = Math.max(margin, Math.min(rect.left, viewW - tipW - margin));
                let top = rect.top - tipH - gap;
                if (top < margin)
                    top = rect.bottom + gap;
                top = Math.max(margin, Math.min(top, viewH - tipH - margin));
                tip.style.left = `${Math.round(left)}px`;
                tip.style.top = `${Math.round(top)}px`;
                tip.classList.add('is-visible');
            });
            $root.on('mouseleave', '.battelog-hcard-killers.has-tip', function ()
            {
                const anchor = /** @type {any} */ (this);
                const tip = /** @type {HTMLElement | null} */ (anchor.__killersTip ?? null);
                if (tip)
                    tip.classList.remove('is-visible');
            });

            const origCloseWithTips = dlg.close.bind(dlg);
            dlg.close = (...args) =>
            {
                for (const tip of scanTips)
                    tip.remove();
                scanTips.clear();
                stopBootLoop();
                return origCloseWithTips(...args);
            };

            let lastClickAt = 0;
            $root.on('click', CLICK_SELECTOR, () =>
            {
                const now = Date.now();
                if (now - lastClickAt < 90)
                    return;
                lastClickAt = now;
                playUiSound('battleLogClick');
            });

            const measureRibbons = () =>
            {
                const nodes = $root[0].querySelectorAll('.battelog-pcol-ribbon-text');
                for (const node of nodes)
                {
                    const overflow = node.scrollWidth - node.clientWidth;
                    if (overflow > 2)
                    {
                        node.classList.add('is-overflow');
                        node.style.setProperty('--marquee-end', `-${overflow}px`);
                        node.style.setProperty('--marquee-dur', `${Math.max(4, overflow / 30 + 3)}s`);
                    }
                }
            };
            setTimeout(measureRibbons, 260);

            const onResize = () => rerenderTelemetry();
            $(globalThis).on('resize.battelogRecap', onResize);
            const origClose = dlg.close.bind(dlg);
            dlg.close = (...args) =>
            {
                $(globalThis).off('resize.battelogRecap', onResize);
                return origClose(...args);
            };
        },
    }, {
        classes: ['lancer-dialog-base', 'lancer-no-title', 'battelog-recap-dialog'],
        width: 1080,
    });
    setTimeout(() => dlg.render(true), RECAP_OPEN_DELAY_MS);
    return dlg;
}

function _formatRealtime(ms)
{
    if (!ms || !Number.isFinite(ms))
        return '--:--';
    const total = Math.floor(ms / 1000);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const seconds = total % 60;
    const pad = num => String(num).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
}

function _outcomeStamp(outcome)
{
    const tone = outcome === 'VICTORY' ? 'win' : outcome === 'DEFEAT' ? 'lose' : 'partial';
    const word = tone === 'win' ? 'SUCCESS' : tone === 'lose' ? 'FAILURE' : 'PARTIAL';
    const lead = tone === 'win' ? '★' : tone === 'lose' ? '✕' : '◇';
    return `<div class="battelog-outcome-stamp ${tone}">${lead} ${word} ${lead}</div>`;
}

function _sortPlayers(players, mvpId)
{
    return [...players].sort((a, b) =>
    {
        if (mvpId)
        {
            if (a.id === mvpId && b.id !== mvpId)
                return -1;
            if (b.id === mvpId && a.id !== mvpId)
                return 1;
        }
        const ka = a.kills ?? 0;
        const kb = b.kills ?? 0;
        if (kb !== ka)
            return kb - ka;
        return (b.dmgDealt ?? 0) - (a.dmgDealt ?? 0);
    });
}

function _pipsHtml(count, max, tone)
{
    const filled = Math.max(0, Math.min(count, max));
    const empty = Math.max(0, max - filled);
    let html = '';
    for (let i = 0; i < filled; i++)
        html += `<span class="battelog-pcol-pip on ${tone}"></span>`;
    for (let i = 0; i < empty; i++)
        html += `<span class="battelog-pcol-pip ${tone}"></span>`;
    return html;
}

function _gearLostHtml(gear)
{
    const gearObj = gear && typeof gear === 'object' ? gear : {};
    const weapons = Array.isArray(gearObj.weapons) ? gearObj.weapons : (Array.isArray(gear) ? gear : []);
    const systems = Array.isArray(gearObj.systems) ? gearObj.systems : [];
    const count = weapons.length + systems.length;
    const hasLost = count > 0;
    const groupHtml = (title, iconSvg, items) => items.length === 0 ? '' : `
        <div class="battelog-pcol-gearlost-group">
            <div class="battelog-pcol-gearlost-group-title">
                <span class="battelog-pcol-gearlost-group-icon" style="mask-image:url('${iconSvg}');-webkit-mask-image:url('${iconSvg}');"></span>${title}
            </div>
            <ul class="battelog-pcol-gearlost-tip-list">
                ${items.map(item => `<li><span>${_escape(item)}</span></li>`).join('')}
            </ul>
        </div>
    `;
    return `
        <div class="battelog-pcol-gearlost ${hasLost ? 'has-lost' : ''}" data-count="${count}">
            <i class="fas fa-triangle-exclamation"></i>
            <span class="battelog-pcol-gearlost-label">EQUIPMENT DESTROYED</span>
            <span class="battelog-pcol-gearlost-count">${count}</span>
            ${hasLost ? `
                <div class="battelog-pcol-gearlost-tip">
                    ${groupHtml('Destroyed Weapons', 'systems/lancer/assets/icons/weapon.svg', weapons)}
                    ${groupHtml('Destroyed Systems', 'systems/lancer/assets/icons/mech_system.svg', systems)}
                </div>
            ` : ''}
        </div>
    `;
}

const _DMG_ICON = {
    KINETIC:   'systems/lancer/assets/icons/damage_kinetic.svg',
    EXPLOSIVE: 'systems/lancer/assets/icons/damage_explosive.svg',
    ENERGY:    'systems/lancer/assets/icons/damage_energy.svg',
    BURN:      'systems/lancer/assets/icons/damage_burn.svg',
    HEAT:      'systems/lancer/assets/icons/damage_heat.svg',
    INFECTION: 'modules/lancer-automations/icons/infection.svg',
};

// Canonical Lancer damage colors (lancer.css damage-type rules + LA infection.js).
const _DMG_COLOR = {
    KINETIC:   '#616161',
    EXPLOSIVE: '#fca017',
    ENERGY:    '#2195ca',
    BURN:      '#ce871e',
    HEAT:      '#e74210',
    INFECTION: '#1a8a3a',
};

function _movementRows(battleData)
{
    const max = battleData?.movement?.maxTurn ?? 0;
    return [
        { k: 'MAX IN ONE TURN', v: String(max) },
    ];
}

function _evaPct(battleData)
{
    const evaded = battleData?.dmgIn?.evaded ?? 0;
    const rolled = battleData?.dmgIn?.evasionRolledAgainst ?? 0;
    return rolled > 0 ? Math.round(evaded / rolled * 100) + '%' : '-';
}

function _edefPct(battleData)
{
    const edef = battleData?.dmgIn?.edef ?? 0;
    const rolled = battleData?.dmgIn?.edefRolledAgainst ?? 0;
    return rolled > 0 ? Math.round(edef / rolled * 100) + '%' : '-';
}

function _damageTypeRows(section)
{
    const types = (section?.types ?? []).filter(t => (t.v ?? 0) > 0);
    const physical = types.filter(t => t.k !== 'HEAT' && t.k !== 'INFECTION');
    const special = types.filter(t => t.k === 'HEAT' || t.k === 'INFECTION');
    const build = dmgType => ({ k: dmgType.k, v: String(dmgType.v), kIcon: _DMG_ICON[dmgType.k], kColor: _DMG_COLOR[dmgType.k] });
    return [
        ...physical.map(build),
        ...special.map((dmgType, i) => ({ ...build(dmgType), sep: i === 0 })),
    ];
}

function _mitigatedRows(section)
{
    const rows = [];
    const armor = section?.mitigatedArmor ?? 0;
    const overshield = section?.mitigatedOvershield ?? 0;
    if (armor > 0)
        rows.push({ k: 'MITIGATED (ARMOR)', v: String(armor), sep: true, kIcon: 'modules/lancer-automations/icons/stats/armor.svg' });
    if (overshield > 0)
        rows.push({ k: 'MITIGATED (OVERSHIELD)', v: String(overshield), sep: armor === 0, kIcon: 'modules/lancer-automations/icons/stats/armor.svg' });
    return rows;
}

function _haseRows(hase)
{
    const attempts = hase?.attempts ?? { hull: 0, agi: 0, sys: 0, eng: 0 };
    const total = hase?.total ?? { attempts: 0, rate: null };
    const row = (label, rate, count, icon) => ({
        k: `${label} ×${count}`,
        v: count > 0 && rate != null ? rate + '%' : '-',
        kIcon: `modules/lancer-automations/icons/stats/${icon}`,
    });
    return [
        row('HULL',        hase?.H, attempts.hull, 'hull.svg'),
        row('AGILITY',     hase?.A, attempts.agi,  'agi.svg'),
        row('SYSTEMS',     hase?.S, attempts.sys,  'sys.svg'),
        row('ENGINEERING', hase?.E, attempts.eng,  'eng.svg'),
        {
            k: `TOTAL ×${total.attempts}`,
            v: total.attempts > 0 && total.rate != null ? total.rate + '%' : '-',
            sep: true,
        },
    ];
}

function _dodgedEfficiencyRows(section)
{
    const evaded = section?.dmgIn?.evaded ?? 0;
    const edef = section?.dmgIn?.edef ?? 0;
    const evasionRolled = section?.dmgIn?.evasionRolledAgainst ?? 0;
    const edefRolled = section?.dmgIn?.edefRolledAgainst ?? 0;
    const totalRolled = evasionRolled + edefRolled;
    const totalAvoided = evaded + edef;
    const evaVal   = evasionRolled > 0 ? Math.round(evaded / evasionRolled * 100) + '%' : '-';
    const edefVal  = edefRolled    > 0 ? Math.round(edef   / edefRolled    * 100) + '%' : '-';
    const totalVal = totalRolled   > 0 ? Math.round(totalAvoided / totalRolled * 100) + '%' : '-';
    return [
        { k: `EVASION ×${evasionRolled}`, v: evaVal,   kIcon: 'modules/lancer-automations/icons/stats/evasion.svg' },
        { k: `E-DEFENSE ×${edefRolled}`,  v: edefVal,  tone: 'var(--la-tech)', kColor: 'var(--la-tech)', kIcon: 'modules/lancer-automations/icons/stats/edef.svg' },
        { k: `TOTAL ×${totalRolled}`,     v: totalVal, sep: true },
    ];
}

function _killListRows(list)
{
    if (!Array.isArray(list) || list.length === 0)
        return [];
    // Same NPC name can appear multiple times; collapse to unique rows with ×N counts.
    const counts = new Map();
    for (const name of list)
    {
        const key = String(name);
        counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()].map(([k, count]) => ({ k, v: '×' + count }));
}

// Flat token-bar palette from scripts/tah/tokenStatBar.js BAR_DEFS.
const _BAR_HP     = '#66cc66';
const _BAR_HEAT   = '#cc4422';
const _BAR_STRUCT = '#ffd633';
const _BAR_STRESS = '#ff8822';

function _accAvg(player)
{
    const total = player?.bd?.acc?.total;
    if (total != null)
        return total;
    const vals = ['ranged', 'melee', 'tech']
        .map(k => player?.bd?.acc?.[k])
        .filter(stat => stat != null);
    return vals.length ? Math.round(vals.reduce((a, b) => a + b, 0) / vals.length) : (player?.accuracy ?? 0);
}

function _bestIds(players)
{
    const top = (fn) =>
    {
        let bestPlayer = null;
        let bestVal = -Infinity;
        for (const player of players)
        {
            const score = fn(player);
            if (score > bestVal)
            {
                bestVal = score; bestPlayer = player;
            }
        }
        return bestPlayer?.id ?? null;
    };
    return {
        dmgDealt: top(player => player.dmgDealt ?? 0),
        dmgTaken: top(player => player.dmgTaken ?? 0),
        attacks:  top(player => player.attacks ?? 0),
        techAtk:  top(player => player.techAtk ?? 0),
        kills:    top(player => player.kills ?? 0),
        assists:  top(player => player.assists ?? 0),
        accuracy: top(player => _accAvg(player)),
        dodged:   top(player => player.bd?.dmgIn?.dodged ?? 0),
        hase:     top(player => player.bd?.acc?.hase ?? 0),
    };
}

const _CROWN = '<i class="fas fa-crown battelog-pcol-crown" title="Squad best"></i>';
function _crown(on)
{
    return on ? _CROWN : '';
}

function _tipPanelHtml({ title, rows, align = 'left', extraClass = '' })
{
    const rowsHtml = rows.length === 0
        ? '<span class="battelog-tip-none">None</span>'
        : rows.map(row => `
            <div class="battelog-tip-row ${row.sep ? 'sep' : ''}">
                <span class="battelog-tip-k">
                    ${row.dot ? `<span class="battelog-tip-dot" style="background:${row.dot};"></span>` : ''}
                    ${row.kIcon ? `<span class="battelog-tip-k-icon" style="mask-image:url('${row.kIcon}');-webkit-mask-image:url('${row.kIcon}');${row.kColor ? `background-color:${row.kColor};` : ''}"></span>` : ''}
                    ${_escape(row.k)}
                </span>
                <span class="battelog-tip-v" ${row.tone ? `style="color:${row.tone};"` : ''}>${_escape(row.v)}</span>
            </div>
        `).join('');
    return `
        <div class="battelog-tip-panel align-${align}${extraClass ? ` ${extraClass}` : ''}">
            <div class="battelog-tip-title">${_escape(title)}</div>
            <div class="battelog-tip-rows">${rowsHtml}</div>
        </div>
    `;
}

function _playerAwards(player, allAwards)
{
    return (allAwards ?? []).filter(award => award.holder === player.id);
}

function _resolveImg(player)
{
    if (player?.img)
        return player.img;
    const actor = player?.actorId ? game.actors?.get(player.actorId) : null;
    return actor?.img ?? '';
}

function _squadTabHtml(players, mvpId, allAwards)
{
    const best = _bestIds(players);
    const cols = players.map((player, i) => _playerColumnHtml(player, mvpId, i, best, allAwards)).join('');
    const count = players.length;
    const scroll = count > 4;
    const empties = Math.max(0, 4 - count);
    const emptyCols = Array.from({ length: empties }, () => `
        <div class="battelog-pcol-empty">
            <i class="fas fa-user-slash"></i>
            <span>NO PILOT</span>
        </div>
    `).join('');
    const gridClass = 'battelog-recap-squad-grid' + (scroll ? ' scroll' : '');
    const gridStyle = scroll ? `style="grid-template-columns: repeat(${count}, 232px);"` : '';
    return `
        <div class="battelog-recap-section-title">
            <i class="fas fa-users"></i> Squad Debrief
            <span class="battelog-recap-section-rule"></span>
            <span class="battelog-recap-section-note">${count} PILOT${count === 1 ? '' : 'S'}</span>
        </div>
        <div class="battelog-recap-squad-scroll">
            <div class="${gridClass}" ${gridStyle}>
                ${cols}
                ${emptyCols}
            </div>
        </div>
    `;
}

function _playerColumnHtml(player, mvpId, rank = 0, best = {}, allAwards = [])
{
    const isMvp = !!mvpId && player.id === mvpId;
    const dead = !!player.destroyed;
    const accent = player.accent ?? (isMvp ? '#ffaa00' : dead ? '#c62828' : '#7bd3ff');

    const img = _resolveImg(player);
    const pilot = player.pilot ?? '';
    const mechName = player.mechName ?? player.callsign ?? '';
    const frame = player.frame ?? '';
    const statTip = _playerStatTipHtml(player);
    const ll = Number(player.ll ?? 0);

    const kills = player.kills ?? 0;
    const assists = player.assists ?? 0;
    const skills = player.skills ?? 0;
    const moves = player.moves ?? 0;
    const repairsMax = player.repairsMax ?? 0;
    const repairsLeft = Math.max(0, repairsMax - (player.repairs ?? 0));
    const corePower = !!player.corePower;

    const dmgDealt = player.dmgDealt ?? 0;
    const dmgTaken = player.dmgTaken ?? 0;
    const accuracy = _accAvg(player);
    const attacks = player.attacks ?? 0;
    const techAtk = player.techAtk ?? 0;
    const haseRate = player.bd?.acc?.hase;
    const haseAcc = haseRate == null ? '-' : `${haseRate}%`;
    const battleData = player.bd ?? {};

    const hpEnd = player.hpEnd ?? 0;
    const hpMax = player.hpMax ?? 1;
    const hpPct = Math.max(0, Math.min(100, Math.round((hpEnd / Math.max(1, hpMax)) * 100)));
    const structEnd = player.structEnd ?? 0;
    const structMax = player.structMax ?? 4;

    const heatEnd = player.heatEnd ?? 0;
    const heatMax = player.heatMax ?? 1;
    const heatPct = Math.max(0, Math.min(100, Math.round((heatEnd / Math.max(1, heatMax)) * 100)));
    const stressEnd = player.stressEnd ?? 0;
    const stressMax = player.stressMax ?? 4;

    const favWeapon = player.favWeapon ?? '-';
    const topAction = player.topAction ?? '-';

    const awards = _playerAwards(player, allAwards);
    const medalsHtml = awards.map(award => `
        <span class="battelog-pcol-medal ${award.key === 'MVP' ? 'is-mvp' : ''} ${award.key === 'KIA' ? 'is-kia' : ''}">
            <i class="fas ${award.icon}"></i> ${award.label}
            <div class="battelog-pcol-medal-tip">
                <div class="battelog-pcol-medal-tip-title">
                    <i class="fas ${award.icon}"></i> ${_escape(award.label)}
                </div>
                <div class="battelog-pcol-medal-tip-sub">${_escape(award.sub ?? '')}.</div>
                <div class="battelog-pcol-medal-tip-stat">${_escape(award.stat ?? '')}</div>
            </div>
        </span>
    `).join('');

    const ribbonSuffix = isMvp && dead
        ? ' · MVP · DESTROYED'
        : isMvp
            ? ' · MVP'
            : dead
                ? ' · DESTROYED'
                : '';
    const ribbonIcon = isMvp && dead
        ? '<i class="fas fa-star"></i><i class="fas fa-skull"></i>'
        : isMvp
            ? '<i class="fas fa-star"></i>'
            : dead
                ? '<i class="fas fa-skull"></i>'
                : '';

    return `
        <div class="battelog-pcol stagger ${isMvp ? 'is-mvp' : ''} ${dead ? 'is-dead' : ''}" style="--accent:${accent}; --i:${rank};">

            <div class="battelog-pcol-ribbon">
                <span class="battelog-pcol-ribbon-icon">${ribbonIcon}</span>
                <span class="battelog-pcol-ribbon-text">${_escape(pilot)}${_escape(ribbonSuffix)}</span>
            </div>

            <div class="battelog-pcol-portrait">
                <img class="battelog-pcol-portrait-img" src="${_escape(img)}" alt="" onerror="this.style.display='none'"/>
                ${dead ? '<div class="battelog-pcol-portrait-tape"><span class="tape a"></span><span class="tape b"></span></div>' : ''}
                <div class="battelog-pcol-portrait-frame">${_escape(mechName)}</div>
            </div>

            <div class="battelog-pcol-name">
                <div class="battelog-pcol-name-row">
                    <div class="battelog-pcol-callsign"><span class="battelog-pcol-frame-name ${statTip ? 'has-tip' : ''}">${_escape(frame)}${statTip}</span></div>
                    <span class="battelog-pcol-ll" title="License Level ${ll}">
                        <span class="battelog-pcol-ll-lbl">LL</span>
                        <span class="battelog-pcol-ll-num">${ll}</span>
                    </span>
                </div>
                <div class="battelog-pcol-medals-wrap">
                    <div class="battelog-pcol-medals">
                        ${medalsHtml}
                    </div>
                    <div class="battelog-pcol-medals-nav">
                        <button type="button" class="battelog-pcol-medals-scroll" data-dir="-1"><i class="fas fa-caret-up"></i></button>
                        <button type="button" class="battelog-pcol-medals-scroll" data-dir="1"><i class="fas fa-caret-down"></i></button>
                    </div>
                    ${awards.length ? `
                    <div class="battelog-tip-panel battelog-awards-tip align-left">
                        <div class="battelog-tip-title">Awards</div>
                        <div class="battelog-tip-rows">
                            ${awards.map(award => `
                            <div class="battelog-tip-row">
                                <span class="battelog-tip-k"><i class="fas ${award.icon}"></i> ${_escape(award.label)}</span>
                                <span class="battelog-tip-v">${_escape(award.stat ?? '')}</span>
                            </div>`).join('')}
                        </div>
                    </div>` : ''}
                </div>
            </div>

            <div class="battelog-pcol-kills">
                <div class="battelog-pcol-kills-block has-tip">
                    <span class="battelog-pcol-kills-icon battelog-icon-mask battelog-icon-destroyed"></span>
                    <span class="battelog-pcol-kills-num">${kills}</span>
                    <div>
                        <div class="battelog-pcol-kills-label"><span class="confirmed">CONFIRMED</span></div>
                        <div class="battelog-pcol-kills-label">KILLS${_crown(best.kills === player.id)}</div>
                    </div>
                    ${_tipPanelHtml({ title: 'Confirmed Kills', rows: _killListRows(player.killedList) })}
                </div>
                <div class="battelog-pcol-assists-block has-tip">
                    <span class="battelog-pcol-assists-num">${assists}</span>
                    <span class="battelog-pcol-assists-label">ASSISTS${_crown(best.assists === player.id)}</span>
                    ${_tipPanelHtml({ title: 'Assisted Kills', align: 'right', rows: _killListRows(player.assistedList) })}
                </div>
            </div>

            <div class="battelog-pcol-activity">
                <div class="battelog-pcol-activity-cell has-tip">
                    <div class="battelog-pcol-activity-top">
                        <span class="battelog-pcol-activity-icon"><span class="battelog-icon-mask battelog-icon-activation"></span></span>
                        <span class="battelog-pcol-activity-value">${skills}</span>
                    </div>
                    <span class="battelog-pcol-activity-label">ACTIONS</span>
                    ${_tipPanelHtml({
                        title: 'Actions Used',
                        rows: (battleData.skills ?? []).map(skill => ({ k: skill.k, v: '×' + skill.n })),
                    })}
                </div>
                <div class="battelog-pcol-activity-cell has-tip">
                    <div class="battelog-pcol-activity-top">
                        <span class="battelog-pcol-activity-icon"><i class="fas fa-shoe-prints"></i></span>
                        <span class="battelog-pcol-activity-value">${moves}</span>
                    </div>
                    <span class="battelog-pcol-activity-label">MOVES</span>
                    ${_tipPanelHtml({
                        title: 'Movement',
                        rows: _movementRows(battleData),
                    })}
                </div>
                <div class="battelog-pcol-activity-cell has-tip">
                    <div class="battelog-pcol-activity-top">
                        <span class="battelog-pcol-activity-icon"><span class="battelog-icon-mask battelog-icon-repair"></span></span>
                        <span class="battelog-pcol-activity-value ${repairsLeft <= 0 ? 'danger' : 'success'}">${repairsLeft}/${repairsMax}</span>
                    </div>
                    <span class="battelog-pcol-activity-label">REPAIRS</span>
                    ${_tipPanelHtml({
                        title: 'Repairs',
                        rows: [
                            { k: 'HP RESTORED', v: `+${player.hpRestored ?? 0}`, kIcon: 'modules/lancer-automations/icons/stats/hp.svg' },
                            { k: 'HEAT COOLED', v: `-${player.heatCooled ?? 0}`, tone: 'var(--la-heat)', kIcon: 'modules/lancer-automations/icons/stats/heat.svg', kColor: 'var(--la-heat)' },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-activity-cell">
                    <div class="battelog-pcol-activity-top">
                        <span class="battelog-pcol-activity-icon"><span class="battelog-icon-mask battelog-icon-corepower"></span></span>
                        <span class="battelog-pcol-activity-value ${corePower ? 'used' : ''}">${corePower ? 'USED' : 'HELD'}</span>
                    </div>
                    <span class="battelog-pcol-activity-label">CORE</span>
                </div>
            </div>

            <div class="battelog-pcol-stats">
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value"><span class="phys">${player.physicalDmgDealt ?? 0}</span><span class="sep">/</span><span class="heat">${player.heatDmgDealt ?? 0}</span>${_crown(best.dmgDealt === player.id)}</div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-burst"></i> DMG DEALT</div>
                    ${_tipPanelHtml({
                        title: 'Damage Dealt',
                        rows: [
                            ..._damageTypeRows(battleData.dmgOut),
                            ..._mitigatedRows(battleData.dmgOut),
                            { k: 'TOTAL', v: String(dmgDealt), sep: true },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value"><span class="phys">${player.physicalDmgTaken ?? 0}</span><span class="sep">/</span><span class="heat">${player.heatDmgTaken ?? 0}</span>${_crown(best.dmgTaken === player.id)}</div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-heart-crack"></i> DMG TAKEN</div>
                    ${_tipPanelHtml({
                        title: 'Damage Taken',
                        align: 'right',
                        rows: [
                            ..._damageTypeRows(battleData.dmgIn),
                            ..._mitigatedRows(battleData.dmgIn),
                            { k: 'TOTAL', v: String(dmgTaken), sep: true },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value">${attacks}<span class="sep">/</span><span class="tech">${techAtk}</span>${_crown(best.techAtk === player.id && techAtk > 0)}</div>
                    <div class="battelog-pcol-stat-label"><span class="battelog-icon-mask battelog-icon-weapon"></span> ATK <span class="tech"><span class="battelog-icon-mask battelog-icon-tech-quick"></span> TECH</span></div>
                    ${_tipPanelHtml({
                        title: 'Attacks & Tech',
                        rows: [
                            ...(battleData.weapons  ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })),
                            ...(battleData.techActs ?? []).map(techAct => ({ k: techAct.k, v: '×' + techAct.n, tone: 'var(--la-tech)', dot: 'var(--la-tech)' })),
                            { k: 'TOTAL', v: '×' + (attacks + techAtk), sep: true },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value"><span class="eva">${_evaPct(battleData)}</span><span class="sep">/</span><span class="edef">${_edefPct(battleData)}</span>${_crown(best.dodged === player.id)}</div>
                    <div class="battelog-pcol-stat-label"><span class="battelog-icon-mask battelog-icon-evasion"></span> EVA <span class="edef"><span class="battelog-icon-mask battelog-icon-edef"></span> E-DEF</span></div>
                    ${_tipPanelHtml({
                        title: 'Attacks Avoided',
                        align: 'right',
                        rows: _dodgedEfficiencyRows(battleData),
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value">${accuracy}%${_crown(best.accuracy === player.id)}</div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-crosshairs"></i> ACCURACY</div>
                    ${_tipPanelHtml({
                        title: 'Accuracy',
                        rows: [
                            { k: `RANGED ×${battleData.acc?.rangedShots ?? 0}`, v: battleData.acc?.ranged != null ? battleData.acc.ranged + '%' : '-' },
                            { k: `MELEE ×${battleData.acc?.meleeShots ?? 0}`,   v: battleData.acc?.melee  != null ? battleData.acc.melee  + '%' : '-' },
                            { k: `TECH ×${battleData.acc?.techShots ?? 0}`,     v: battleData.acc?.tech   != null ? battleData.acc.tech   + '%' : '-', tone: battleData.acc?.tech != null ? 'var(--la-tech)' : undefined },
                            { k: `TOTAL ×${battleData.acc?.totalShots ?? 0}`,   v: battleData.acc?.total  != null ? battleData.acc.total  + '%' : '-', sep: true },
                            { k: 'CRITICAL HITS', v: String(battleData.acc?.crits ?? 0) },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    <div class="battelog-pcol-stat-value">${haseAcc}${_crown(best.hase === player.id)}</div>
                    <div class="battelog-pcol-stat-label"><span class="battelog-icon-mask battelog-icon-save"></span> H.A.S.E</div>
                    ${_tipPanelHtml({
                        title: 'H.A.S.E',
                        align: 'right',
                        rows: _haseRows(battleData.hase),
                    })}
                </div>
            </div>

            <div class="battelog-pcol-survival">
                <div class="battelog-pcol-survival-row">
                    <div class="battelog-pcol-pips-block leading">
                        <span class="battelog-pcol-pips-label">STRUCTURE</span>
                        <div class="battelog-pcol-pips">${_pipsHtml(structEnd, structMax, 'struct')}</div>
                    </div>
                    <div class="battelog-pcol-meter">
                        <div class="battelog-pcol-meter-header">
                            <span class="battelog-pcol-meter-label">HP</span>
                            <span class="battelog-pcol-meter-value">${hpEnd}/${hpMax}</span>
                        </div>
                        <div class="battelog-pcol-meter-track"><div class="battelog-pcol-meter-fill" style="width:${hpPct}%;background:${_BAR_HP};"></div></div>
                    </div>
                </div>
                <div class="battelog-pcol-survival-row">
                    <div class="battelog-pcol-pips-block leading">
                        <span class="battelog-pcol-pips-label">STRESS</span>
                        <div class="battelog-pcol-pips">${_pipsHtml(stressEnd, stressMax, 'stress')}</div>
                    </div>
                    <div class="battelog-pcol-meter">
                        <div class="battelog-pcol-meter-header">
                            <span class="battelog-pcol-meter-label">HEAT</span>
                            <span class="battelog-pcol-meter-value">${heatEnd}/${heatMax}</span>
                        </div>
                        <div class="battelog-pcol-meter-track"><div class="battelog-pcol-meter-fill" style="width:${heatPct}%;background:${_BAR_HEAT};"></div></div>
                    </div>
                </div>
                ${_gearLostHtml(player.gearLost ?? [])}
            </div>

            <div class="battelog-pcol-footer-strip">
                <div class="battelog-pcol-fav has-tip">
                    <span class="battelog-icon-mask battelog-icon-weapon"></span>
                    <span class="battelog-pcol-fs-label">FAV WPN</span>
                    <span class="battelog-pcol-fs-value">${_escape(favWeapon)}</span>
                    ${_tipPanelHtml({ title: 'Weapons Used', rows: (battleData.weapons ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })) })}
                </div>
                <div class="battelog-pcol-topact has-tip">
                    <span class="battelog-icon-mask battelog-icon-activation"></span>
                    <span class="battelog-pcol-fs-label">TOP ACT</span>
                    <span class="battelog-pcol-fs-value">${_escape(topAction)}</span>
                    ${_tipPanelHtml({ title: 'Actions Used', rows: (battleData.skills ?? []).map(action => ({ k: action.k, v: '×' + action.n })) })}
                </div>
            </div>

        </div>
    `;
}

function _groupHostiles(entries)
{
    const map = new Map();
    const groups = [];
    for (const entry of entries)
    {
        const key = [
            entry.side ?? 'hostile',
            entry.actorType ?? 'npc',
            entry.actorType === 'mech' ? (entry.frameName ?? '') : entry.cls,
            entry.actorType === 'mech' ? (entry.ll ?? 0) : entry.tier,
            (entry.templates ?? []).join(','),
            entry.scanned !== false,
        ].join('|');
        let group = map.get(key);
        if (!group)
        {
            group = { ...entry, instances: [] };
            map.set(key, group);
            groups.push(group);
        }
        group.instances.push(entry);
    }
    return groups;
}

function _scanJournalFor(actorId)
{
    if (!actorId)
        return null;
    const actor = game.actors?.get(actorId);
    if (!actor)
        return null;
    let best = null;
    for (const entry of getScanJournalsForActor(actor, { user: game.user, allowGm: !!game.user?.isGM }))
    {
        const modified = entry._stats?.modifiedTime ?? 0;
        if (!best || modified > (best._stats?.modifiedTime ?? 0))
            best = entry;
    }
    return best;
}

function _isActorForceScanned(actorId)
{
    if (!actorId)
        return false;
    const actor = game.actors?.get(actorId);
    if (!actor)
        return false;
    if (/** @type {any} */ (actor).getFlag?.('lancer-automations', 'scannedByAll'))
        return true;
    // Unlinked tokens carry the flag on their delta actor, not the base sheet recap reads.
    const tokens = /** @type {any} */ (actor).getActiveTokens?.() ?? [];
    return tokens.some((token) => /** @type {any} */ (token)?.actor?.getFlag?.('lancer-automations', 'scannedByAll'));
}

function _tierTone(tier)
{
    if (tier >= 3)
        return 'danger';
    if (tier === 2)
        return 'amber';
    return 'neutral';
}

function _hostileScanTipHtml(group)
{
    const actor = group?.actorId ? game.actors?.get(group.actorId) : null;
    if (!actor)
        return '';
    ensureStyleSheet();
    const stats = getStatsForActor(actor);
    return `
        <div class="battelog-tip-panel align-right battelog-scan-tip">
            <div class="la-stat-hint-body">${buildTwoZoneStatsHtml(actor, stats, { omitCombatState: true })}</div>
        </div>
    `;
}

function _playerStatTipHtml(player)
{
    const actor = player?.actorId ? game.actors?.get(player.actorId) : null;
    if (!actor)
        return '';
    ensureStyleSheet();
    const stats = getStatsForActor(actor);
    return `
        <div class="battelog-tip-panel align-right battelog-scan-tip">
            <div class="la-stat-hint-body">${buildTwoZoneStatsHtml(actor, stats, { omitCombatState: true })}</div>
        </div>
    `;
}

const _KILLER_TEAM_LABEL = {
    friendly: 'ALLY',
    hostile: 'HOSTILE',
    neutral: 'NEUTRAL',
    secret: 'SECRET',
    unknown: 'UNKNOWN',
};
const _KILLER_TEAM_COLOR = {
    friendly: '#3aa955',
    hostile: 'var(--la-danger, #c8353d)',
    neutral: '#d09024',
    secret: '#6b45a8',
    unknown: '#888',
};

function _hostileKillersTipHtml(instances, players)
{
    const playerByTokenId = (id) => players.find(player => player.tokenId === id);
    const tally = new Map();
    for (const inst of instances)
    {
        if (inst.killed === false)
            continue;
        const team = inst.killedByTeam ?? 'unknown';
        const key = (team === 'player' && inst.killedBy)
            ? `player:${inst.killedBy}`
            : team;
        tally.set(key, (tally.get(key) ?? 0) + 1);
    }
    const mechRows = [];
    const teamRows = [];
    for (const [key, count] of tally.entries())
    {
        if (key.startsWith('player:'))
        {
            const player = playerByTokenId(key.slice(7));
            if (player)
            {
                mechRows.push({ k: player.callsign, v: `×${count}`, dot: player.accent });
                continue;
            }
        }
        const team = key.startsWith('player:') ? 'unknown' : key;
        teamRows.push({
            k: _KILLER_TEAM_LABEL[team] ?? _KILLER_TEAM_LABEL.unknown,
            v: `×${count}`,
            dot: _KILLER_TEAM_COLOR[team] ?? _KILLER_TEAM_COLOR.unknown,
            sep: false,
        });
    }
    if (mechRows.length && teamRows.length)
        teamRows[0].sep = true;
    return _tipPanelHtml({ title: 'DESTROYED BY', rows: [...mechRows, ...teamRows], extraClass: 'battelog-hcard-killers-tip' });
}

function _hcardBadgeTipHtml(title, body)
{
    return `
        <div class="battelog-tip-panel align-left battelog-hcard-badge-tip">
            <div class="battelog-tip-title">${_escape(title)}</div>
            <div class="battelog-tip-rows">
                <div class="battelog-tip-row"><span class="battelog-tip-k">${_escape(body)}</span></div>
            </div>
        </div>
    `;
}

function _hostileCountBadgeHtml(count, killedCount)
{
    const aliveCount = count - killedCount;
    const alive = aliveCount > 0
        ? `<span class="battelog-hcard-badge-alive"><i class="fas fa-heart-pulse"></i> ${aliveCount}</span>`
        : '';
    const dead = killedCount > 0
        ? `<span class="battelog-hcard-badge-dead"><img class="battelog-hcard-badge-count-icon" src="modules/lancer-automations/FX/svg/Destroyed.svg" alt=""/>${killedCount}</span>`
        : '';
    return alive + dead;
}

function _hostileCardHtml(group, idx, players, badge = null)
{
    const isNemesis = badge === 'nemesis';
    const isDanger = badge === 'danger';
    const instances = group.instances ?? [];
    const count = instances.length;
    const killedCount = instances.filter(x => x.killed !== false).length;
    const allKilled = count > 0 && killedCount === count;
    const noneKilled = killedCount === 0;
    // Scanned = an accessible scan journal exists, or the actor is force-scanned; the mock group.scanned is ignored.
    const scanJournal = _scanJournalFor(group.actorId);
    const scanned = !!scanJournal || _isActorForceScanned(group.actorId);
    const totalDealt = instances.reduce((sum, hostile) => sum + (hostile.dmgDealt ?? 0), 0);
    const totalTaken = instances.reduce((sum, hostile) => sum + (hostile.dmgTaken ?? 0), 0);
    const physDealt  = instances.reduce((sum, hostile) => sum + (hostile.physicalDmgDealt ?? 0), 0);
    const heatDealt  = instances.reduce((sum, hostile) => sum + (hostile.heatDmgDealt ?? 0), 0);
    const physTaken  = instances.reduce((sum, hostile) => sum + (hostile.physicalDmgTaken ?? 0), 0);
    const heatTaken  = instances.reduce((sum, hostile) => sum + (hostile.heatDmgTaken ?? 0), 0);
    const tierTone = _tierTone(group.tier);
    const title = scanned ? group.name : 'UNIDENTIFIED';
    const size = group.size ?? 1;
    const img = group.img ?? '';
    const templates = group.templates ?? [];
    const isMech = group.actorType === 'mech';

    const tagsHtml = isMech
        ? `
            <span class="battelog-hcard-tag tier ${tierTone}">LL ${_escape(group.ll ?? 0)}</span>
            <span class="battelog-hcard-tag frame">${_escape(group.frameName ?? 'UNKNOWN')}</span>
        `
        : `
            <span class="battelog-hcard-tag tier ${tierTone}">TIER ${group.tier}</span>
            <span class="battelog-hcard-tag cls">${_escape(group.cls)}</span>
            ${templates.map(t => `<span class="battelog-hcard-tag template">${_escape(t)}</span>`).join('')}
        `;

    const statusHtml = noneKilled ? `
        <div class="battelog-hcard-notkilled">
            <i class="fas fa-person-running"></i> NOT DESTROYED
        </div>
    ` : `
        <div class="battelog-hcard-killers has-tip">
            <span class="battelog-hcard-killers-label">
                <span class="battelog-hcard-killers-icon battelog-icon-mask battelog-icon-destroyed"></span> DESTROYED BY
            </span>
            ${_hostileKillersTipHtml(instances, players)}
        </div>
    `;

    const scanTipHtml = scanned ? _hostileScanTipHtml(group) : '';
    const actionHtml = scanJournal ? `
        <button type="button" class="battelog-hcard-scan-btn ${scanTipHtml ? 'has-tip' : ''}" data-journal-uuid="${scanJournal.uuid}">
            <i class="fas fa-satellite-dish"></i> Show Scan Data
            ${scanTipHtml}
        </button>
    ` : scanned ? `
        <span class="battelog-hcard-scan-btn ${scanTipHtml ? 'has-tip' : ''}">
            <i class="fas fa-satellite-dish"></i> SCANNED
            ${scanTipHtml}
        </span>
    ` : `
        <span class="battelog-hcard-noscan-chip">
            <i class="fas fa-triangle-exclamation"></i> No Scan Data
        </span>
    `;

    const badgeHtml = isNemesis
        ? `<div class="battelog-hcard-marker nem has-tip"><i class="fas fa-skull-crossbones"></i> NEMESIS${_hcardBadgeTipHtml('NEMESIS', 'Single NPC that dealt the most damage across the fight.')}</div>`
        : isDanger
            ? `<div class="battelog-hcard-marker top has-tip"><i class="fas fa-triangle-exclamation"></i> TOP THREAT${_hcardBadgeTipHtml('TOP THREAT', 'Group with the highest combined damage.')}</div>`
            : '';
    const metaHtml = isMech
        ? `<span class="battelog-hcard-meta">LL <b>${_escape(group.ll ?? 0)}</b> · SIZE <b>${_escape(size)}</b></span>`
        : `<span class="battelog-hcard-meta">SIZE <b>${_escape(size)}</b></span>`;
    return `
        <div class="battelog-hcard stagger is-side-${_escape(group.side ?? 'hostile')} ${allKilled ? 'is-killed' : 'is-active'} ${scanned ? '' : 'is-unscanned'} ${isDanger ? 'is-danger' : ''} ${isNemesis ? 'is-nemesis' : ''}" style="--i:${idx};">
            ${badgeHtml}
            <div class="battelog-hcard-portrait">
                <img class="battelog-hcard-portrait-img" src="${_escape(img)}" alt="" onerror="this.style.display='none'"/>
                ${_hostileCountBadgeHtml(count, killedCount)}
            </div>
            <div class="battelog-hcard-main">
                <div class="battelog-hcard-nameline">
                    <span class="battelog-hcard-name">${_escape(title)}</span>
                    ${count > 1 ? `<span class="battelog-hcard-count">×${count}</span>` : ''}
                    ${metaHtml}
                </div>
                <div class="battelog-hcard-tags">${tagsHtml}</div>
                <div class="battelog-hcard-status">${statusHtml}</div>
                <div class="battelog-hcard-action">${actionHtml}</div>
            </div>
            <div class="battelog-hcard-dmg">
                <div class="battelog-hcard-dmg-cell dealt" title="Physical / Heat · Total ${totalDealt}">
                    <span class="battelog-hcard-dmg-val">
                        <i class="fas fa-burst" title="Physical"></i><span class="phys">${physDealt}</span>
                        <span class="sep">/</span>
                        <i class="fas fa-thermometer-half heat" title="Heat"></i><span class="heat">${heatDealt}</span>
                    </span>
                    <span class="battelog-hcard-dmg-lbl">DMG DEALT</span>
                </div>
                <div class="battelog-hcard-dmg-cell taken" title="Physical / Heat · Total ${totalTaken}">
                    <span class="battelog-hcard-dmg-val">
                        <i class="fas fa-burst" title="Physical"></i><span class="phys">${physTaken}</span>
                        <span class="sep">/</span>
                        <i class="fas fa-thermometer-half heat" title="Heat"></i><span class="heat">${heatTaken}</span>
                    </span>
                    <span class="battelog-hcard-dmg-lbl">DMG TAKEN</span>
                </div>
            </div>
        </div>
    `;
}

const DISPO_MAP = {
    hostile:  { label: 'HOSTILE',  icon: 'fa-skull-crossbones',   color: 'var(--la-danger, #c8353d)' },
    friendly: { label: 'FRIENDLY', icon: 'fa-shield-halved',      color: '#3aa955' },
    neutral:  { label: 'NEUTRAL',  icon: 'fa-circle-half-stroke', color: '#d09024' },
    secret:   { label: 'SECRET',   icon: 'fa-user-secret',        color: '#6b45a8' },
};

function _encounterTabHtml(encounter, players)
{
    return `
        <div class="battelog-encounter" data-dispo="hostile">
            ${_encounterInnerHtml(encounter, players, 'hostile')}
        </div>
    `;
}

function _encounterFilterHtml(counts, activeDispo)
{
    const btns = Object.entries(DISPO_MAP).map(([key, dispoConfig]) =>
    {
        const count = counts[key] ?? 0;
        const disabled = count === 0;
        const active = key === activeDispo;
        return `
            <button type="button"
                class="battelog-encounter-filter-btn ${active ? 'is-active' : ''}"
                data-dispo="${key}"
                ${disabled ? 'disabled' : ''}
                style="--dispo:${dispoConfig.color};">
                <i class="fas ${dispoConfig.icon}"></i>
                <span class="battelog-encounter-filter-lbl">${dispoConfig.label}</span>
                <span class="battelog-encounter-filter-count">${count}</span>
            </button>
        `;
    }).join('');
    return `<div class="battelog-encounter-filter">${btns}</div>`;
}

function _encounterInnerHtml(encounter, players, dispo)
{
    const counts = encounter.reduce((acc, entry) =>
    {
        const side = entry.side ?? 'hostile';
        acc[side] = (acc[side] ?? 0) + 1;
        return acc;
    }, {});
    const filtered = encounter.filter(entry => (entry.side ?? 'hostile') === dispo);
    const isHostileView = dispo === 'hostile';

    // dmgDealt/dmgTaken are already filtered by counterparty in derive, per the side rules.
    const total       = filtered.length;
    const killedCount = filtered.filter(entry => entry.killed !== false).length;
    // Scan intel is per actor prototype (same actorId = same sheet).
    const uniqueActorIds = [...new Set(filtered.map(x => x.actorId))];
    const scannedTypes = uniqueActorIds.filter(id => !!_scanJournalFor(id) || _isActorForceScanned(id)).length;
    const totalTypes = uniqueActorIds.length;
    const dmgInflicted = filtered.reduce((sum, x) => sum + (x.dmgDealt ?? 0), 0);
    const dmgTaken    = filtered.reduce((sum, x) => sum + (x.dmgTaken ?? 0), 0);

    const groups = _groupHostiles(filtered);

    // NEMESIS + TOP THREAT: hostile view only.
    let nemesisGroup = null;
    let dangerGroup = null;
    if (isHostileView)
    {
        let nemesisInstance = null;
        let nemesisParent = null;
        let nemesisMax = 0;
        for (const group of groups)
        {
            for (const inst of group.instances ?? [])
            {
                const dmg = inst.dmgDealt ?? 0;
                if (dmg > nemesisMax)
                {
                    nemesisMax = dmg;
                    nemesisInstance = inst;
                    nemesisParent = group;
                }
            }
        }
        if (nemesisInstance)
        {
            nemesisGroup = { ...nemesisParent, instances: [nemesisInstance] };
            nemesisParent.instances = nemesisParent.instances.filter(x => x !== nemesisInstance);
        }
        let dangerMax = -1;
        for (const group of groups)
        {
            if ((group.instances?.length ?? 0) === 0)
                continue;
            const gTotal = (group.instances ?? []).reduce((sum, inst) => sum + (inst.dmgDealt ?? 0), 0);
            if (gTotal > dangerMax)
            {
                dangerMax = gTotal;
                dangerGroup = group;
            }
        }
    }
    const remainingGroups = groups.filter(g => (g.instances?.length ?? 0) > 0);

    const scanCache = new Map();
    const isScanned = (group) =>
    {
        if (!scanCache.has(group))
            scanCache.set(group, !!_scanJournalFor(group.actorId) || _isActorForceScanned(group.actorId));
        return scanCache.get(group);
    };
    const sortedRemaining = remainingGroups.slice().sort((a, b) =>
    {
        if (a === dangerGroup)
            return -1;
        if (b === dangerGroup)
            return 1;
        const tierDiff = (b.tier ?? 0) - (a.tier ?? 0);
        if (tierDiff !== 0)
            return tierDiff;
        const aScan = isScanned(a) ? 0 : 1;
        const bScan = isScanned(b) ? 0 : 1;
        if (aScan !== bScan)
            return aScan - bScan;
        return String(a.name ?? '').localeCompare(String(b.name ?? ''));
    });
    const orderedGroups = nemesisGroup ? [nemesisGroup, ...sortedRemaining] : sortedRemaining;
    const badgeFor = (group) => group === nemesisGroup ? 'nemesis' : (group === dangerGroup ? 'danger' : null);
    const cardsHtml = orderedGroups
        .map((group, idx) => _hostileCardHtml(group, idx, players, badgeFor(group)))
        .join('');

    const dispoConfig = DISPO_MAP[dispo] ?? DISPO_MAP.hostile;

    return `
        ${_encounterFilterHtml(counts, dispo)}
        <div class="battelog-hostiles-kpi">
            <div class="battelog-hostiles-kpi-cell danger">
                <i class="battelog-hostiles-kpi-icon fas fa-skull-crossbones"></i>
                <span class="battelog-hostiles-kpi-val">${killedCount} / ${total}</span>
                <span class="battelog-hostiles-kpi-lbl">DESTROYED · ENGAGED</span>
            </div>
            <div class="battelog-hostiles-kpi-cell">
                <i class="battelog-hostiles-kpi-icon fas fa-satellite-dish"></i>
                <span class="battelog-hostiles-kpi-val">${scannedTypes} / ${totalTypes}</span>
                <span class="battelog-hostiles-kpi-lbl">SCANNED · INTEL</span>
            </div>
            <div class="battelog-hostiles-kpi-cell">
                <i class="battelog-hostiles-kpi-icon fas fa-burst"></i>
                <span class="battelog-hostiles-kpi-val">${dmgInflicted}</span>
                <span class="battelog-hostiles-kpi-lbl">DAMAGE INFLICTED</span>
            </div>
            <div class="battelog-hostiles-kpi-cell heat">
                <i class="battelog-hostiles-kpi-icon fas fa-heart-crack"></i>
                <span class="battelog-hostiles-kpi-val">${dmgTaken}</span>
                <span class="battelog-hostiles-kpi-lbl">DAMAGE TAKEN</span>
            </div>
        </div>
        <div class="battelog-recap-section-title">
            <i class="fas ${dispoConfig.icon}"></i> Contact Log
            <span class="battelog-recap-section-rule"></span>
            <span class="battelog-recap-section-note">${orderedGroups.length} CONTACT TYPE${orderedGroups.length === 1 ? '' : 'S'} · ${total} TOTAL</span>
        </div>
        ${orderedGroups.length === 0
            ? '<div class="battelog-encounter-empty">No contacts match this filter.</div>'
            : `<div class="battelog-hostiles-grid">${cardsHtml}</div>`}
    `;
}

const TELEMETRY_CHART = { w: 660, h: 300, pl: 42, pr: 18, pt: 18, pb: 30 };

const TELEMETRY_METRICS = [
    { key: 'hp',    field: 'line',     label: 'HP TOTAL PER ROUND',     icon: 'fa-heart-pulse', startField: 'startHp' },
    { key: 'heat',  field: 'heatLine', label: 'HEAT TOTAL PER ROUND',   icon: 'fa-thermometer-half', startField: 'startHeat' },
    { key: 'dmg',   field: 'dmgLine',  label: 'DAMAGE TOTAL PER ROUND', icon: 'fa-burst',  cumulative: true },
    { key: 'kills', field: 'killAssistLine', label: 'KILL/ASSIST TOTAL PER ROUND', icon: 'fa-skull', cumulative: true },
];

function _telemetryMetric(view)
{
    return TELEMETRY_METRICS.find(m => m.key === view) ?? TELEMETRY_METRICS[0];
}

// Kills uses the same custom SVG as the Squad tab; other metrics stay on FA glyphs.
function _metricIconHtml(metric)
{
    if (metric.key === 'kills')
        return '<span class="battelog-icon-mask battelog-icon-destroyed"></span>';
    return `<i class="fas ${metric.icon}"></i>`;
}

function _telemetryCum(roundValues)
{
    let sum = 0;
    return roundValues.map(value => (sum += value));
}

function _telemetryNiceTicks(max)
{
    const step = max <= 4 ? 1 : max <= 12 ? 3 : max <= 24 ? 6 : max <= 40 ? 10 : max <= 120 ? 30 : 60;
    const ticks = [];
    for (let v = 0; v <= max; v += step)
        ticks.push(v);
    if (ticks.at(-1) !== max)
        ticks.push(max);
    return ticks;
}

function _telemetryHoverSvg(payload, svg)
{
    const items = Array.isArray(payload?.items) ? payload.items : [];
    if (items.length === 0)
        return '';
    const dataset = svg?.dataset ?? {};
    const w  = Number(dataset.chartW)  || TELEMETRY_CHART.w;
    const pl = Number(dataset.chartPl) || TELEMETRY_CHART.pl;
    const pr = Number(dataset.chartPr) || TELEMETRY_CHART.pr;
    const pt = Number(dataset.chartPt) || TELEMETRY_CHART.pt;
    const rowH = 15;
    const headH = 17;
    const pad = 6;
    const longest = Math.max(8, ...items.map(it => String(it.label).length + String(it.value).length + 3));
    const tw = Math.max(90, longest * 6.4 + 22);
    const th = headH + items.length * rowH + pad;
    let tx = payload.x - tw / 2;
    tx = Math.max(pl, Math.min(tx, w - pr - tw));
    const above = payload.y - th - 12 > pt;
    const ty = above ? payload.y - th - 12 : payload.y + 12;
    const rows = items.map((it, k) =>
    {
        const ry = ty + headH + k * rowH;
        return `
            <rect x="${tx + 9}" y="${ry}" width="7" height="7" rx="1" fill="${it.color}"/>
            <text x="${tx + 21}" y="${ry + 7}" fill="#fff" font-family="var(--font-primary, Signika, sans-serif)" font-size="9" font-weight="700" letter-spacing="0.3px" text-transform="uppercase">${_escape(String(it.label))}</text>
            <text x="${tx + tw - 9}" y="${ry + 7}" text-anchor="end" fill="${it.color}" font-family="'Space Mono', monospace" font-size="10" font-weight="700">${_escape(String(it.value))}</text>
        `;
    }).join('');
    return `
        <circle cx="${payload.x}" cy="${payload.y}" r="5" fill="${payload.color}" stroke="#fdfdfd" stroke-width="2" pointer-events="none"/>
        <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="3" fill="rgba(13,13,13,0.98)" stroke="#666" stroke-width="1" pointer-events="none"/>
        <text x="${tx + 9}" y="${ty + 12}" fill="color-mix(in srgb, #fff 55%, transparent)" font-family="'Space Mono', monospace" font-size="8" font-weight="700" letter-spacing="1px" pointer-events="none">ROUND ${_escape(String(payload.round))}</text>
        ${rows}
    `;
}

function _telemetryTabHtml(battle)
{
    return `
        <div class="battelog-telemetry" data-view="hp" data-highlight="" data-total="0">
            ${_telemetryInnerHtml(battle, 'hp', null, false)}
        </div>
    `;
}

function _telemetryInnerHtml(battle, view, highlight, showTotal, chartSize = null)
{
    const metric = _telemetryMetric(view);
    const rounds = battle.mission?.rounds ?? battle.rounds?.length ?? 0;
    const metricButtons = TELEMETRY_METRICS.map(m => `
        <button type="button" class="battelog-telemetry-metric ${m.key === view ? 'on' : ''}" data-metric="${m.key}">
            ${_metricIconHtml(m)}
            <span class="battelog-telemetry-metric-label">${_escape(m.label)}</span>
        </button>
    `).join('');
    const noteText = highlight
        ? 'ISOLATED · click again to reset'
        : `click a name to isolate · ${rounds} ROUNDS`;
    return `
        <div class="battelog-telemetry-metrics">${metricButtons}</div>
        <div class="battelog-telemetry-panel">
            <div class="battelog-telemetry-panel-head">
                <span class="battelog-telemetry-panel-title"><i class="fas fa-chart-line"></i> ${_escape(metric.label)}</span>
                <span class="battelog-telemetry-panel-note">${_escape(noteText)}</span>
            </div>
            <div class="battelog-telemetry-chart">${_telemetrySvgHtml(battle, metric, highlight, showTotal, chartSize)}</div>
        </div>
        <div class="battelog-telemetry-legend">${_telemetryLegendHtml(battle, metric, highlight, showTotal)}</div>
    `;
}

function _telemetrySvgHtml(battle, metric, highlight, showTotal, chartSize = null)
{
    const rawRounds = battle.rounds ?? [];
    const players = battle.players ?? [];
    const { pl, pr, pt, pb } = TELEMETRY_CHART;

    const roundCount = Math.max(5, rawRounds.length);
    // R0 is the combat-start column: full HP, zero heat/damage/kills.
    const columnCount = roundCount + 1;
    const rounds = [0, ...Array.from({ length: roundCount }, (_, i) => rawRounds[i] ?? (i + 1))];
    const measuredW = Math.max(0, chartSize?.w ?? 0);
    const measuredH = Math.max(0, chartSize?.h ?? 0);
    const w = measuredW > 0 ? measuredW : TELEMETRY_CHART.w;
    const h = measuredH > 40 ? measuredH : TELEMETRY_CHART.h;
    const innerW = w - pl - pr;
    const innerH = h - pt - pb;
    const cumulative = !!metric.cumulative;

    const isKills = metric.key === 'kills';
    const cum = arr => cumulative ? _telemetryCum(arr) : arr;
    const startValue = player => metric.startField ? (player[metric.startField] ?? 0) : 0;
    const playerSeries = players.map(player => ({
        key: player.id,
        label: String(player.callsign ?? '').toUpperCase(),
        color: player.accent,
        data: [startValue(player), ...cum(player[metric.field] ?? [])],
        splitA: isKills ? [0, ...cum(player.killLine ?? [])] : null,
        splitB: isKills ? [0, ...cum(player.assistLine ?? [])] : null,
    }));
    const totalRaw = rawRounds.map((_, i) => players.reduce((acc, player) => acc + (player[metric.field]?.[i] ?? 0), 0));
    const totalStart = players.reduce((acc, player) => acc + startValue(player), 0);
    const totalSplitA = isKills ? rawRounds.map((_, i) => players.reduce((acc, player) => acc + (player.killLine?.[i] ?? 0), 0)) : null;
    const totalSplitB = isKills ? rawRounds.map((_, i) => players.reduce((acc, player) => acc + (player.assistLine?.[i] ?? 0), 0)) : null;
    const totalSeries = {
        key: 'total',
        label: 'TOTAL',
        color: 'var(--la-ink, #0a0a0a)',
        data: [totalStart, ...cum(totalRaw)],
        splitA: isKills ? [0, ...cum(totalSplitA)] : null,
        splitB: isKills ? [0, ...cum(totalSplitB)] : null,
        dashed: true,
        thick: true,
    };
    const series = showTotal ? [...playerSeries, totalSeries] : playerSeries;
    const visible = highlight ? series.filter(s => s.key === highlight) : series;
    // 15% headroom so the peak never touches the top edge.
    const rawMax = Math.max(1, ...visible.flatMap(s => s.data));
    const yMax = Math.max(rawMax + 1, Math.ceil(rawMax * 1.15));

    const xOf = idx => pl + (columnCount === 1 ? innerW / 2 : (idx / (columnCount - 1)) * innerW);
    const yOf = v => pt + innerH - (v / yMax) * innerH;
    const ticks = _telemetryNiceTicks(yMax);

    const gridY = ticks.map(t => `
        <line x1="${pl}" x2="${w - pr}" y1="${yOf(t)}" y2="${yOf(t)}" class="battelog-telemetry-grid" ${t === 0 ? '' : 'stroke-dasharray="2 3"'} />
        <text x="${pl - 7}" y="${yOf(t) + 3}" text-anchor="end" class="battelog-telemetry-axis-text">${t}</text>
    `).join('');
    const gridX = rounds.map((r, i) => `
        <line x1="${xOf(i)}" x2="${xOf(i)}" y1="${pt}" y2="${pt + innerH}" class="battelog-telemetry-grid dim" stroke-dasharray="2 4" />
        <text x="${xOf(i)}" y="${h - 10}" text-anchor="middle" class="battelog-telemetry-tick-text">R${r}</text>
    `).join('');

    const jitterFor = (seriesIdx) => highlight ? 0 : (seriesIdx - (series.length - 1) / 2) * 1.7;

    const seriesSvg = series.map((ser, seriesIdx) =>
    {
        const dim = highlight && ser.key !== highlight;
        const emph = highlight === ser.key;
        const groupOpacity = dim ? 0.12 : 1;
        const jitter = jitterFor(seriesIdx);
        const points = ser.data.map((v, i) => [xOf(i), yOf(v) + jitter]);
        const strokeWidth = (ser.thick ? 3.4 : 2.2) + (emph ? 1.2 : 0);
        const linePoints = points.map(p => p.join(',')).join(' ');
        // Area fill ends at the last real data point, not the axis end, so short battles don't smear right.
        const lastX = ser.data.length > 0 ? xOf(ser.data.length - 1) : pl;
        const areaPoly = ser.thick ? '' : `<polygon class="battelog-telemetry-area" points="${pl},${pt + innerH} ${linePoints} ${lastX},${pt + innerH}" fill="${ser.color}" pointer-events="none"/>`;
        // Keep in sync with the CSS timings below: linear line draw makes each dot's fade finish as the polyline sweeps past it.
        const lineStartDelay = 0.04;
        const lineDuration = 0.6;
        const dotDuration = 0.1;
        const dotSpacing = points.length > 1 ? lineDuration / (points.length - 1) : 0;
        const dots = points.map((p, i) =>
        {
            const arrivalTime = lineStartDelay + i * dotSpacing;
            const delay = (arrivalTime - dotDuration).toFixed(3);
            return `<circle cx="${p[0]}" cy="${p[1]}" r="${ser.thick ? 3.5 : 2.8}" class="battelog-telemetry-dot" stroke="${ser.color}" stroke-width="${ser.thick ? 2.4 : 1.8}" pointer-events="none" style="animation-delay:${delay}s" />`;
        }).join('');
        return `
            <g style="opacity:${groupOpacity};">
                ${areaPoly}
                <polyline class="${ser.dashed ? 'battelog-telemetry-line-dashed' : 'battelog-telemetry-line'}" points="${linePoints}" pathLength="1" fill="none" stroke="${ser.color}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" pointer-events="none" ${ser.dashed ? 'stroke-dasharray="7 4"' : ''}/>
                ${dots}
            </g>
        `;
    }).join('');

    const hitCircles = series.flatMap((ser, seriesIdx) =>
    {
        if (highlight && highlight !== ser.key)
            return [];
        const jitter = jitterFor(seriesIdx);
        return ser.data.map((v, i) =>
        {
            const bucket = (highlight ? series.filter(z => z.key === highlight) : series)
                .filter(z => z.data[i] === v)
                .map(z => ({
                    label: z.label,
                    value: z.splitA ? `${z.splitA[i] ?? 0} / ${z.splitB[i] ?? 0}` : z.data[i],
                    color: z.color,
                }));
            const payload = encodeURIComponent(JSON.stringify({ round: rounds[i], items: bucket, x: xOf(i), y: yOf(v) + jitter, color: ser.color }));
            return `<circle class="battelog-telemetry-hit" cx="${xOf(i)}" cy="${yOf(v) + jitter}" r="11" fill="transparent" data-hover="${payload}"/>`;
        });
    }).join('');

    return `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block; width:100%; height:100%;" data-chart-w="${w}" data-chart-h="${h}" data-chart-pl="${pl}" data-chart-pr="${pr}" data-chart-pt="${pt}">
            <defs><clipPath id="battelog-telemetry-clip"><rect x="${pl}" y="${pt - 3}" width="${innerW}" height="${innerH + 6}"/></clipPath></defs>
            ${gridY}
            ${gridX}
            <g clip-path="url(#battelog-telemetry-clip)">${seriesSvg}</g>
            <g class="battelog-telemetry-hits">${hitCircles}</g>
            <g class="battelog-telemetry-hover"></g>
        </svg>
    `;
}

function _telemetryLegendHtml(battle, metric, highlight, showTotal)
{
    const players = battle.players ?? [];
    const rounds = battle.rounds ?? [];
    const isHp = metric.key === 'hp';
    const isHeat = metric.key === 'heat';
    const isKills = metric.key === 'kills';

    const items = players.map(player =>
    {
        const arr = player[metric.field] ?? [];
        let sub;
        if (isHp)
            sub = `${player.effectiveHpEnd ?? 0} / ${player.effectiveHpMax ?? 0}`;
        else if (isHeat)
            sub = `${player.heatConsumedEnd ?? 0} / ${player.heatCapacityMax ?? 0}`;
        else if (isKills)
            sub = `${player.kills ?? 0} / ${player.assists ?? 0}`;
        else
            sub = String(arr.reduce((a, b) => a + b, 0));
        const active = highlight === player.id;
        const dim = highlight && !active;
        return `
            <button type="button" class="battelog-telemetry-legend-item ${active ? 'is-active' : ''} ${dim ? 'is-dim' : ''}" data-series-id="${player.id}" style="--accent:${player.accent};">
                <span class="battelog-telemetry-legend-swatch"></span>
                <div class="battelog-telemetry-legend-text">
                    <div class="battelog-telemetry-legend-label">${_escape(player.callsign)}</div>
                    <div class="battelog-telemetry-legend-sub">${_metricIconHtml(metric)} ${_escape(sub)}</div>
                </div>
            </button>
        `;
    }).join('');

    let totalLabel;
    if (isHp)
    {
        const end = players.reduce((total, player) => total + (player.effectiveHpEnd ?? 0), 0);
        const max = players.reduce((n, p) => n + (p.effectiveHpMax ?? 0), 0);
        totalLabel = `${end} / ${max}`;
    }
    else if (isHeat)
    {
        const end = players.reduce((n, p) => n + (p.heatConsumedEnd ?? 0), 0);
        const max = players.reduce((n, p) => n + (p.heatCapacityMax ?? 0), 0);
        totalLabel = `${end} / ${max}`;
    }
    else if (isKills)
    {
        const k = players.reduce((n, p) => n + (p.kills ?? 0), 0);
        const a = players.reduce((n, p) => n + (p.assists ?? 0), 0);
        totalLabel = `${k} / ${a}`;
    }
    else
    {
        const totalRaw = rounds.map((_, i) => players.reduce((sum, p) => sum + (p[metric.field]?.[i] ?? 0), 0));
        totalLabel = String(totalRaw.reduce((a, b) => a + b, 0));
    }
    const totalSub = showTotal ? totalLabel : `OFF · ${totalLabel}`;
    const totalBtn = `
        <button type="button" class="battelog-telemetry-legend-total ${showTotal ? 'is-active' : ''}" data-series-id="total">
            <span class="battelog-telemetry-legend-swatch dashed"></span>
            <div class="battelog-telemetry-legend-text">
                <div class="battelog-telemetry-legend-label">SQUAD TOTAL</div>
                <div class="battelog-telemetry-legend-sub">${_metricIconHtml(metric)} ${_escape(totalSub)}</div>
            </div>
        </button>
    `;
    return items + totalBtn;
}
