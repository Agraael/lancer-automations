/* global Dialog, game, fromUuid */

import { playBattleLogSound, playUiSound, stopBattleLogTheme, setBattleLogThemeMuted, getBattleLogThemeSrc } from '../tah/sound.js';
import { getStatsForActor, buildTwoZoneStatsHtml, ensureStyleSheet } from '../tah/tokenStatHint.js';
import { getLAFlag } from '../tools/flag-utils.js';
import { getScanJournalsForActor } from '../tools/scan-lookup.js';
import { exportSquadPoster, exportPlayerPoster } from './share-image.js';
import { escapeHtml as _escape, localize } from '../tools/string-utils.js';
import { MODULE_ID } from '../tools/constants.js';
import { inkOn } from '../tools/color-utils.js';

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
    '.battelog-pcol-fav.has-tip',
    '.battelog-pcol-topact.has-tip',
    '.battelog-pcol-medal',
    '.battelog-pcol-gearlost.has-lost',
    '.battelog-hcard-scan-btn.has-tip',
    '.battelog-hcard-scan-state.has-tip',
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
    const telemetryBattle = { ...battle, players: sorted };
    const telemetryTabHtml = _telemetryTabHtml(telemetryBattle);

    const content = `
        <div class="battelog-recap-head">
            <div class="battelog-recap-head-left">
                <div class="battelog-recap-kicker">INCOMING TRANSMISSION : DECRYPTED</div>
                <div class="battelog-recap-title">Battle Log</div>
                <div class="battelog-recap-meta">
                    <span class="battelog-recap-meta-item"><i class="fas fa-calendar-day"></i> ${_escape(date)}</span>
                    <span class="battelog-recap-meta-dot">·</span>
                    <span class="battelog-recap-meta-item">${_escape(rounds)} ROUNDS${mission.turns ? ` / ${_escape(mission.turns)} TURNS` : ''}</span>
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
        title: localize('LA.dialogTitle.battleLogRecap'),
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

            const markMedalOverflow = () =>
            {
                const grid = $root[0]?.querySelector('.battelog-recap-squad-grid');
                if (!grid)
                    return;
                grid.querySelectorAll('.battelog-pcol-medals').forEach((block) =>
                {
                    block.parentElement?.classList.toggle('has-overflow', block.scrollHeight > block.clientHeight + 1);
                });
            };
            globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(markMedalOverflow));
            globalThis.setTimeout(markMedalOverflow, 500);

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
                    medals.scrollBy({ top: Number(/** @type {HTMLElement} */ (this).dataset.dir || 1) * 44, behavior: 'smooth' });
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
                if (($panel[0]?.scrollHeight ?? 0) <= ($panel[0]?.clientHeight ?? 0))
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
                { label: localize('LA.recap.panelGroup.offense'), titles: new Set(['confirmed kills', 'assisted kills', 'damage dealt', 'attacks & tech', 'accuracy', 'weapons used']) },
                { label: localize('LA.recap.panelGroup.defense'), titles: new Set(['damage taken', 'attacks avoided', 'h.a.s.e', 'grit', 'equipment destroyed']) },
                { label: localize('LA.recap.panelGroup.operations'), titles: new Set(['actions used', 'movement', 'repairs', 'awards']) },
            ];
            const buildFocusDetail = (card) =>
            {
                const detail = document.createElement('div');
                detail.className = 'battelog-focus-detail';
                const wideRow = document.createElement('div');
                wideRow.className = 'battelog-focus-wide';
                const grouped = PANEL_GROUPS.map(() => []);
                const linkByKey = new Map();
                const attacksPanelTitle = localize('LA.recap.panel.attacksAndTech').toLowerCase();
                let attacksPanelLink = '';
                const face = card.querySelector(card.classList.contains('is-flipped') ? '.battelog-pcol-face.is-back' : '.battelog-pcol-face.is-front') ?? card;
                face.querySelectorAll('.has-tip, .battelog-pcol-medals, .battelog-pcol-gearlost').forEach((anchor) =>
                {
                    if (attacksPanelLink && anchor.classList.contains('battelog-pcol-fav'))
                    {
                        anchor.setAttribute('data-tip-link', attacksPanelLink);
                        return;
                    }
                    // __scanTip: the stat tip lives in <body> once it has been hovered
                    const tip = /** @type {any} */ (anchor).__scanTip
                        ?? (anchor.classList.contains('battelog-pcol-medals')
                            ? face.querySelector('.battelog-awards-tip')
                            : anchor.querySelector('.battelog-tip-panel'));
                    if (!(tip instanceof HTMLElement))
                        return;
                    const key = (tip.textContent ?? '').replaceAll(/\s+/g, ' ').trim();
                    if (!key)
                        return;
                    // duplicates (top action) just link to the first copy
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
                    if (title === attacksPanelTitle)
                        attacksPanelLink = String(panelIndex);
                    const groupIndex = PANEL_GROUPS.findIndex(group => group.titles.has(title));
                    grouped[groupIndex >= 0 ? groupIndex : PANEL_GROUPS.length - 1].push(panelClone);
                });
                if (wideRow.childElementCount)
                    detail.appendChild(wideRow);
                const colsWrap = document.createElement('div');
                colsWrap.className = 'battelog-focus-cols';
                PANEL_GROUPS.forEach((group, groupIndex) =>
                {
                    const colEl = document.createElement('div');
                    colEl.className = 'battelog-focus-col';
                    colsWrap.appendChild(colEl);
                    if (!grouped[groupIndex].length)
                        return;
                    const head = document.createElement('div');
                    head.className = 'battelog-focus-colhead';
                    head.textContent = group.label;
                    colEl.appendChild(head);
                    grouped[groupIndex].forEach(panel => colEl.appendChild(panel));
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
                const crumb = $root[0].querySelector('.battelog-focus-crumb');
                if (crumb)
                    crumb.textContent = `› ${(card.querySelector('.battelog-pcol-ribbon-text')?.textContent ?? '').split('·')[0].trim()}`;
                buildFocusDetail(card);
                suppressBooting($panel);
            });
            $root.on('click', '.battelog-focus-back', () =>
            {
                playUiSound('battleLogClick');
                if (closeFocus())
                    suppressBooting($root.find('.battelog-recap-tab-panel[data-tab-panel="squad"]'));
            });
            const onFocusEscape = (ev) =>
            {
                if (ev.key !== 'Escape' || !$root[0].querySelector('.battelog-recap-tab-panel.is-active .battelog-recap-squad-grid.is-focus'))
                    return;
                ev.preventDefault();
                ev.stopPropagation();
                closeFocus();
                suppressBooting($root.find('.battelog-recap-tab-panel[data-tab-panel="squad"]'));
            };
            document.addEventListener('keydown', onFocusEscape, true);
            const flipHolds = new WeakMap();
            const holdScrollbars = (el) =>
            {
                for (const container of [el.closest('.battelog-recap-squad-scroll'), el.closest('.battelog-hostiles-grid'), el.closest('.battelog-recap-tab-panel')])
                {
                    if (!container || (!container.classList.contains('is-flipping') && container.scrollHeight > container.clientHeight))
                        continue;
                    container.classList.add('is-flipping');
                    clearTimeout(flipHolds.get(container));
                    flipHolds.set(container, setTimeout(() => container.classList.remove('is-flipping'), 650));
                }
            };
            $root.on('click', '.battelog-pcol [data-flip]', function (ev)
            {
                ev.stopPropagation();
                const card = /** @type {HTMLElement} */ (this).closest('.battelog-pcol');
                if (!card)
                    return;
                holdScrollbars(card);
                card.classList.toggle('is-flipped');
                playUiSound('battleLogHover');
                if (!card.classList.contains('is-focus-target'))
                    return;
                card.querySelectorAll('[data-tip-link]').forEach(anchor => anchor.removeAttribute('data-tip-link'));
                card.parentElement?.querySelector('.battelog-focus-detail')?.remove();
                buildFocusDetail(card);
                suppressBooting($root.find('.battelog-recap-tab-panel[data-tab-panel="squad"]'));
                card.classList.replace('stagger', 'stagger-done');
            });
            $root.on('click', '.battelog-hcard [data-flip]', function (ev)
            {
                ev.stopPropagation();
                const hcard = /** @type {HTMLElement} */ (this).closest('.battelog-hcard');
                if (!hcard)
                    return;
                holdScrollbars(hcard);
                hcard.classList.toggle('is-flipped');
                playUiSound('battleLogHover');
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
                $tel.html(_telemetryInnerHtml(telemetryBattle, view, highlight, showTotal, chartSize));
                $root.find('.battelog-recap-tab-panel[data-tab-panel="telemetry"] > .battelog-recap-section-title').replaceWith(_telemetrySectionHtml(battle, view));
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
                suppressBooting($root.find('.battelog-recap-tab-panel[data-tab-panel="encounter"]'));
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
                const variant = el.matches('.battelog-hcard-scan-btn.has-tip, .battelog-hcard-scan-state.has-tip, .battelog-pcol-frame-name.has-tip')
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
            $root.on('mouseenter', '.battelog-hcard-scan-btn.has-tip, .battelog-hcard-scan-state.has-tip, .battelog-pcol-frame-name.has-tip', function ()
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
            $root.on('mouseleave', '.battelog-hcard-scan-btn.has-tip, .battelog-hcard-scan-state.has-tip, .battelog-pcol-frame-name.has-tip', function ()
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
                document.removeEventListener('keydown', onFocusEscape, true);
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
    const icon = tone === 'win' ? 'fa-trophy' : tone === 'lose' ? 'fa-skull' : 'fa-scale-balanced';
    return `<div class="battelog-outcome-stamp ${tone}"><i class="fas ${icon}"></i> ${word}</div>`;
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
        const aKills = a.kills ?? 0;
        const bKills = b.kills ?? 0;
        if (bKills !== aKills)
            return bKills - aKills;
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
    const cascading = Array.isArray(gearObj.cascading) ? gearObj.cascading : [];
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
            ${_tipPanelHtml({ title: localize('LA.recap.panel.equipmentDestroyed'), rows: [...weapons, ...systems].map(item => ({ k: item, v: '' })), extraClass: 'battelog-gear-tip' })}
            ${hasLost ? `
                <div class="battelog-pcol-gearlost-tip">
                    ${groupHtml('Destroyed Weapons', 'systems/lancer/assets/icons/weapon.svg', weapons)}
                    ${groupHtml('Destroyed Systems', 'systems/lancer/assets/icons/mech_system.svg', systems)}
                </div>
            ` : ''}
        </div>
        ${cascading.length ? `
            <div class="battelog-pcol-gearlost battelog-pcol-gearlost--cascading has-lost" data-count="${cascading.length}">
                <i class="la-cascading-icon"></i>
                <span class="battelog-pcol-gearlost-label">AI CASCADING</span>
                <span class="battelog-pcol-gearlost-count">${cascading.length}</span>
                <div class="battelog-pcol-gearlost-tip">
                    ${groupHtml('Cascading', `modules/${MODULE_ID}/icons/eye-of-ra.svg`, cascading)}
                </div>
            </div>
        ` : ''}
    `;
}

const _EXPAND_GLYPH = '<span class="battelog-pcol-expand"><i class="fas fa-up-right-and-down-left-from-center"></i><i class="fas fa-down-left-and-up-right-to-center"></i></span>';

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
    if (!(total.attempts > 0))
        return [];
    const row = (label, rate, count, icon) => (count > 0 ? {
        k: `${label} ×${count}`,
        v: rate != null ? rate + '%' : '-',
        kIcon: `modules/lancer-automations/icons/stats/${icon}`,
    } : null);
    return [
        row('HULL',        hase?.H, attempts.hull, 'hull.svg'),
        row('AGILITY',     hase?.A, attempts.agi,  'agi.svg'),
        row('SYSTEMS',     hase?.S, attempts.sys,  'sys.svg'),
        row('ENGINEERING', hase?.E, attempts.eng,  'eng.svg'),
        {
            k: `TOTAL ×${total.attempts}`,
            v: total.rate != null ? total.rate + '%' : '-',
            sep: true,
        },
    ].filter(Boolean);
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
        { k: `EVASION ×${evasionRolled}`, v: evaVal,   kIcon: 'modules/lancer-automations/icons/stats/evasion.svg', n: evasionRolled },
        { k: `E-DEFENSE ×${edefRolled}`,  v: edefVal,  tone: 'var(--la-tech)', kColor: 'var(--la-tech)', kIcon: 'modules/lancer-automations/icons/stats/edef.svg', n: edefRolled },
        { k: `TOTAL ×${totalRolled}`,     v: totalVal, sep: true },
    ].filter(row => row.n !== 0);
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
    return [...counts.entries()].map(([name, count]) => ({ k: name, v: '×' + count }));
}

const _PILOT_ICON = 'systems/lancer/assets/icons/pilot.svg';

function _splitKillRows(list, pilotList)
{
    const pilotLeft = [...(pilotList ?? [])];
    const mechList = [];
    for (const name of list ?? [])
    {
        const at = pilotLeft.indexOf(name);
        if (at >= 0)
            pilotLeft.splice(at, 1);
        else
            mechList.push(name);
    }
    return [
        ..._killListRows(mechList),
        ..._killListRows(pilotList).map(row => ({ ...row, kIcon: _PILOT_ICON })),
    ];
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
        if (players.length < 2)
            return new Set();
        const scores = players.map(fn);
        const bestVal = Math.max(...scores);
        if (!(bestVal > 0))
            return new Set();
        return new Set(players.filter((player, idx) => scores[idx] === bestVal).map(player => player.id));
    };
    return {
        dmgDealt: top(player => player.dmgDealt ?? 0),
        dmgTaken: top(player => player.dmgTaken ?? 0),
        attacks:  top(player => player.attacks ?? 0),
        techAtk:  top(player => player.techAtk ?? 0),
        kills:    top(player => player.kills ?? 0),
        assists:  top(player => player.assists ?? 0),
        accuracy: top(player => _accAvg(player)),
        evasion:  top((player) =>
        {
            const rolled = player.bd?.dmgIn?.evasionRolledAgainst ?? 0;
            return rolled >= 3 ? Math.round((player.bd?.dmgIn?.evaded ?? 0) / rolled * 100) : -1;
        }),
        hase:     top(player => player.bd?.acc?.hase ?? 0),
    };
}

const _CROWN = '<i class="fas fa-crown battelog-pcol-crown" title="Squad best"></i>';
function _crown(on)
{
    return on ? _CROWN : '';
}

function _sampleHtml(count)
{
    return count > 0 ? `<span class="n">×${count}</span>` : '';
}

function _nullHtml(value)
{
    return value === '-' ? '<span class="null">-</span>' : value;
}

function _pairCellHtml({ crown = '', left, right, tip })
{
    return `
        <div class="battelog-pcol-stat-cell has-tip is-cols">
            ${crown}
            <div class="battelog-pcol-stat-col">
                <div class="battelog-pcol-stat-value">${left.value}</div>
                <div class="battelog-pcol-stat-label">${left.label}</div>
            </div>
            <span class="battelog-pcol-stat-coldiv"></span>
            <div class="battelog-pcol-stat-col">
                <div class="battelog-pcol-stat-value">${right.value}</div>
                <div class="battelog-pcol-stat-label">${right.label}</div>
            </div>
            ${tip}
        </div>`;
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
            <span class="battelog-focus-crumb"></span>
            <span class="battelog-recap-section-rule"></span>
            <span class="battelog-recap-section-note">${count} PILOT${count === 1 ? '' : 'S'}</span>
            <button type="button" class="battelog-focus-back"><i class="fas fa-chevron-left"></i> ${localize('LA.recap.allPilots')}</button>
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
    const pilot = player.pilotSide?.callsign ?? player.pilot ?? '';
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

    const pilotSide = player.pilotSide ?? null;
    const pilotLine = pilotSide?.killed ? 'PILOT KILLED' : `PILOT ${pilotSide?.hpEnd ?? 0}/${pilotSide?.hpMax ?? 0} HP`;
    const flipBtnHtml = pilotSide
        ? `<button type="button" class="battelog-pcol-portrait-mfr battelog-pcol-flip-btn" data-flip>${pilotLine} <i class="fas fa-rotate"></i></button>`
        : '';

    const medalsWrapHtml = `
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
                </div>`;

    const killsHtml = `
            <div class="battelog-pcol-kills">
                <div class="battelog-pcol-kills-block has-tip">
                    ${_crown(best.kills?.has(player.id))}
                    <span class="battelog-pcol-kills-icon battelog-icon-mask battelog-icon-destroyed"></span>
                    <span class="battelog-pcol-kills-num">${kills}</span>
                    <div>
                        <div class="battelog-pcol-kills-label"><span class="confirmed">CONFIRMED</span></div>
                        <div class="battelog-pcol-kills-label">KILLS</div>
                    </div>
                    ${_tipPanelHtml({ title: localize('LA.recap.panel.confirmedKills'), rows: _splitKillRows(player.killedList, player.pilotKilledList) })}
                </div>
                <div class="battelog-pcol-assists-block has-tip">
                    ${_crown(best.assists?.has(player.id))}
                    <span class="battelog-pcol-assists-num">${assists}</span>
                    <span class="battelog-pcol-assists-label">ASSISTS</span>
                    ${_tipPanelHtml({ title: localize('LA.recap.panel.assistedKills'), align: 'right', rows: _splitKillRows(player.assistedList, player.pilotAssistedList) })}
                </div>
            </div>`;

    const frontHtml = `
            <div class="battelog-pcol-ribbon">
                <span class="battelog-pcol-ribbon-icon">${ribbonIcon}</span>
                <span class="battelog-pcol-ribbon-text">${_escape(pilot)}${_escape(ribbonSuffix)}</span>
            </div>

            <div class="battelog-pcol-portrait">
                <img class="battelog-pcol-portrait-img" src="${_escape(img)}" alt="" onerror="this.style.display='none'"/>
                ${dead ? '<div class="battelog-pcol-portrait-tape"><span class="tape a"></span><span class="tape b"></span></div>' : ''}
                <div class="battelog-pcol-portrait-frame">${_escape(mechName)}</div>
                ${flipBtnHtml}
            </div>

            <div class="battelog-pcol-name">
                <div class="battelog-pcol-name-row">
                    <div class="battelog-pcol-callsign"><span class="battelog-pcol-frame-name ${statTip ? 'has-tip' : ''}">${_escape(frame)}${statTip}</span></div>
                    <span class="battelog-pcol-ll" title="License Level ${ll}">
                        <span class="battelog-pcol-ll-lbl">LL</span>
                        <span class="battelog-pcol-ll-num">${ll}</span>
                    </span>
                </div>
                ${medalsWrapHtml}
            </div>

            ${killsHtml}

            <div class="battelog-pcol-activity">
                <div class="battelog-pcol-activity-cell has-tip">
                    <div class="battelog-pcol-activity-top">
                        <span class="battelog-pcol-activity-icon"><span class="battelog-icon-mask battelog-icon-activation"></span></span>
                        <span class="battelog-pcol-activity-value">${skills}</span>
                    </div>
                    <span class="battelog-pcol-activity-label">ACTIONS</span>
                    ${_tipPanelHtml({
                        title: localize('LA.recap.panel.actionsUsed'),
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
                        title: localize('LA.recap.panel.movement'),
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
                        title: localize('LA.recap.panel.repairs'),
                        rows: [
                            { k: 'HP RESTORED', v: player.hpRestored ? `+${player.hpRestored}` : '0', kIcon: 'modules/lancer-automations/icons/stats/hp.svg' },
                            { k: 'HEAT COOLED', v: player.heatCooled ? `-${player.heatCooled}` : '0', tone: player.heatCooled ? 'var(--la-heat)' : undefined, kIcon: 'modules/lancer-automations/icons/stats/heat.svg', kColor: 'var(--la-heat)' },
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
                    ${_crown(best.dmgDealt?.has(player.id))}
                    <div class="battelog-pcol-stat-value">${dmgDealt}<span class="heat-sub">${player.heatDmgDealt ?? 0} HEAT</span></div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-burst"></i> DEALT</div>
                    ${_tipPanelHtml({
                        title: localize('LA.recap.panel.damageDealt'),
                        rows: [
                            ..._damageTypeRows(battleData.dmgOut),
                            ..._mitigatedRows(battleData.dmgOut),
                            { k: 'TOTAL', v: String(dmgDealt), sep: true },
                        ],
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    ${_crown(best.dmgTaken?.has(player.id))}
                    <div class="battelog-pcol-stat-value">${dmgTaken}<span class="heat-sub">${player.heatDmgTaken ?? 0} HEAT</span></div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-heart-crack"></i> TAKEN</div>
                    ${_tipPanelHtml({
                        title: localize('LA.recap.panel.damageTaken'),
                        align: 'right',
                        rows: [
                            ..._damageTypeRows(battleData.dmgIn),
                            ..._mitigatedRows(battleData.dmgIn),
                            { k: 'TOTAL', v: String(dmgTaken), sep: true },
                        ],
                    })}
                </div>
                ${_pairCellHtml({
                    crown: _crown(best.techAtk?.has(player.id)),
                    left: { value: attacks, label: '<span class="battelog-icon-mask battelog-icon-weapon"></span> ATK' },
                    right: { value: `<span class="tech">${techAtk}</span>`, label: '<span class="tech"><span class="battelog-icon-mask battelog-icon-tech-quick"></span> TECH</span>' },
                    tip: _tipPanelHtml({
                        title: localize('LA.recap.panel.attacksAndTech'),
                        rows: [
                            ...(battleData.weapons  ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })),
                            ...(battleData.techActs ?? []).map(techAct => ({ k: techAct.k, v: '×' + techAct.n, tone: 'var(--la-tech)', dot: 'var(--la-tech)' })),
                            { k: 'TOTAL', v: '×' + (attacks + techAtk), sep: true },
                        ],
                    }),
                })}
                ${_pairCellHtml({
                    crown: _crown(best.evasion?.has(player.id)),
                    left: { value: `<span class="eva">${_nullHtml(_evaPct(battleData))}</span>${_sampleHtml(battleData.dmgIn?.evasionRolledAgainst ?? 0)}`, label: '<span class="battelog-icon-mask battelog-icon-evasion"></span> EVA' },
                    right: { value: `<span class="edef">${_nullHtml(_edefPct(battleData))}</span>${_sampleHtml(battleData.dmgIn?.edefRolledAgainst ?? 0)}`, label: '<span class="edef"><span class="battelog-icon-mask battelog-icon-edef"></span> E-DEF</span>' },
                    tip: _tipPanelHtml({
                        title: localize('LA.recap.panel.attacksAvoided'),
                        align: 'right',
                        rows: _dodgedEfficiencyRows(battleData),
                    }),
                })}
                <div class="battelog-pcol-stat-cell has-tip">
                    ${_crown(best.accuracy?.has(player.id))}
                    <div class="battelog-pcol-stat-value">${accuracy}%${_sampleHtml(battleData.acc?.totalShots ?? 0)}</div>
                    <div class="battelog-pcol-stat-label"><i class="fas fa-crosshairs"></i> ACCURACY</div>
                    ${_tipPanelHtml({
                        title: localize('LA.recap.panel.accuracy'),
                        rows: [
                            { k: `RANGED ×${battleData.acc?.rangedShots ?? 0}`, v: battleData.acc?.ranged != null ? battleData.acc.ranged + '%' : '-', n: battleData.acc?.rangedShots ?? 0 },
                            { k: `MELEE ×${battleData.acc?.meleeShots ?? 0}`,   v: battleData.acc?.melee  != null ? battleData.acc.melee  + '%' : '-', n: battleData.acc?.meleeShots ?? 0 },
                            { k: `TECH ×${battleData.acc?.techShots ?? 0}`,     v: battleData.acc?.tech   != null ? battleData.acc.tech   + '%' : '-', tone: battleData.acc?.tech != null ? 'var(--la-tech)' : undefined, n: battleData.acc?.techShots ?? 0 },
                            { k: `TOTAL ×${battleData.acc?.totalShots ?? 0}`,   v: battleData.acc?.total  != null ? battleData.acc.total  + '%' : '-', sep: true },
                            { k: 'CRITICAL HITS', v: String(battleData.acc?.crits ?? 0) },
                        ].filter(row => row.n !== 0),
                    })}
                </div>
                <div class="battelog-pcol-stat-cell has-tip">
                    ${_crown(best.hase?.has(player.id))}
                    <div class="battelog-pcol-stat-value">${_nullHtml(haseAcc)}${_sampleHtml(battleData.hase?.total?.attempts ?? 0)}</div>
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
                    ${_tipPanelHtml({ title: localize('LA.recap.panel.weaponsUsed'), rows: (battleData.weapons ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })) })}
                </div>
                <div class="battelog-pcol-topact has-tip">
                    <span class="battelog-icon-mask battelog-icon-activation"></span>
                    <span class="battelog-pcol-fs-label">TOP ACT</span>
                    <span class="battelog-pcol-fs-value">${_escape(topAction)}</span>
                    ${_tipPanelHtml({ title: localize('LA.recap.panel.actionsUsed'), rows: (battleData.skills ?? []).map(action => ({ k: action.k, v: '×' + action.n })) })}
                </div>
            </div>
    `;
    const cardClass = `battelog-pcol stagger ${isMvp ? 'is-mvp' : ''} ${dead ? 'is-dead' : ''}`;
    const cardStyle = `--accent:${accent}; --i:${rank};`;
    if (player.pilotOnly)
    {
        const soloClass = `battelog-pcol stagger ${isMvp ? 'is-mvp' : ''} ${pilotSide?.killed ? 'is-dead' : ''}`;
        return `<div class="${soloClass}" style="${cardStyle}">${_pilotFaceHtml(player, medalsWrapHtml, killsHtml, isMvp, true)}${_EXPAND_GLYPH}</div>`;
    }
    if (!pilotSide)
        return `<div class="${cardClass}" style="${cardStyle}">${frontHtml}${_EXPAND_GLYPH}</div>`;
    return `
        <div class="battelog-pcol stagger ${isMvp ? 'is-mvp' : ''} has-pilot" style="${cardStyle}">
            <div class="battelog-pcol-faces">
                <div class="battelog-pcol-face is-front ${dead ? 'is-dead' : ''}">${frontHtml}${_EXPAND_GLYPH}</div>
                <div class="battelog-pcol-face is-back ${pilotSide.killed ? 'is-dead' : ''}">${_pilotFaceHtml(player, medalsWrapHtml, killsHtml, isMvp)}${_EXPAND_GLYPH}</div>
            </div>
        </div>
    `;
}

function _pilotFaceHtml(player, medalsWrapHtml, killsHtml, isMvp, solo = false)
{
    const side = player.pilotSide;
    const killed = !!side.killed;
    const flipBack = solo
        ? ''
        : `<button type="button" class="battelog-pcol-portrait-mfr battelog-pcol-flip-btn" data-flip>MECH <i class="fas fa-rotate"></i></button>`;
    let ribbonSuffix = '';
    if (isMvp && killed)
        ribbonSuffix = ' · MVP · KILLED';
    else if (isMvp)
        ribbonSuffix = ' · MVP';
    else if (killed)
        ribbonSuffix = ' · KILLED';
    const ribbonIcon = `${isMvp ? '<i class="fas fa-star"></i>' : ''}${killed ? '<i class="fas fa-skull"></i>' : ''}`;
    const statTip = _playerStatTipHtml({ actorId: side.actorId });
    const head = `
        <div class="battelog-pcol-ribbon">
            <span class="battelog-pcol-ribbon-icon">${ribbonIcon}</span>
            <span class="battelog-pcol-ribbon-text">${_escape(side.callsign)}${ribbonSuffix}</span>
        </div>
        <div class="battelog-pcol-portrait">
            <img class="battelog-pcol-portrait-img" src="${_escape(side.img)}" alt="" onerror="this.style.display='none'"/>
            ${killed ? '<div class="battelog-pcol-portrait-tape"><span class="tape a"></span><span class="tape b"></span></div>' : ''}
            <div class="battelog-pcol-portrait-frame">${_escape(side.name)}</div>
            ${flipBack}
        </div>
        <div class="battelog-pcol-name">
            <div class="battelog-pcol-name-row">
                <div class="battelog-pcol-callsign"><span class="battelog-pcol-frame-name ${statTip ? 'has-tip' : ''}">PILOT${statTip}</span></div>
                <span class="battelog-pcol-ll" title="License Level ${side.ll}">
                    <span class="battelog-pcol-ll-lbl">LL</span>
                    <span class="battelog-pcol-ll-num">${side.ll}</span>
                </span>
            </div>
            ${medalsWrapHtml}
        </div>
        ${killsHtml}
    `;
    const battleData = side.bd ?? {};
    const hpPct = Math.max(0, Math.min(100, Math.round((side.hpEnd / Math.max(1, side.hpMax)) * 100)));
    const grit = side.grit ?? { attempts: 0, rate: null };
    return head + `
        <div class="battelog-pcol-activity" style="grid-template-columns:repeat(2, 1fr);">
            <div class="battelog-pcol-activity-cell has-tip">
                <div class="battelog-pcol-activity-top">
                    <span class="battelog-pcol-activity-icon"><span class="battelog-icon-mask battelog-icon-activation"></span></span>
                    <span class="battelog-pcol-activity-value">${side.skills ?? 0}</span>
                </div>
                <span class="battelog-pcol-activity-label">ACTIONS</span>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.actionsUsed'), rows: (battleData.skills ?? []).map(skill => ({ k: skill.k, v: '×' + skill.n })) })}
            </div>
            <div class="battelog-pcol-activity-cell has-tip">
                <div class="battelog-pcol-activity-top">
                    <span class="battelog-pcol-activity-icon"><i class="fas fa-shoe-prints"></i></span>
                    <span class="battelog-pcol-activity-value">${side.moves ?? 0}</span>
                </div>
                <span class="battelog-pcol-activity-label">MOVES</span>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.movement'), rows: _movementRows(battleData) })}
            </div>
        </div>
        <div class="battelog-pcol-stats">
            <div class="battelog-pcol-stat-cell has-tip">
                <div class="battelog-pcol-stat-value">${side.dmgDealt ?? 0}<span class="heat-sub">${side.heatDmgDealt ?? 0} HEAT</span></div>
                <div class="battelog-pcol-stat-label"><i class="fas fa-burst"></i> DEALT</div>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.damageDealt'), rows: [..._damageTypeRows(battleData.dmgOut), ..._mitigatedRows(battleData.dmgOut), { k: 'TOTAL', v: String(side.dmgDealt ?? 0), sep: true }] })}
            </div>
            <div class="battelog-pcol-stat-cell has-tip">
                <div class="battelog-pcol-stat-value">${side.dmgTaken ?? 0}<span class="heat-sub">${side.heatDmgTaken ?? 0} HEAT</span></div>
                <div class="battelog-pcol-stat-label"><i class="fas fa-heart-crack"></i> TAKEN</div>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.damageTaken'), align: 'right', rows: [..._damageTypeRows(battleData.dmgIn), ..._mitigatedRows(battleData.dmgIn), { k: 'TOTAL', v: String(side.dmgTaken ?? 0), sep: true }] })}
            </div>
            ${_pairCellHtml({
                left: { value: side.attacks ?? 0, label: '<span class="battelog-icon-mask battelog-icon-weapon"></span> ATK' },
                right: { value: `<span class="tech">${side.techAtk ?? 0}</span>`, label: '<span class="tech"><span class="battelog-icon-mask battelog-icon-tech-quick"></span> TECH</span>' },
                tip: _tipPanelHtml({ title: localize('LA.recap.panel.attacksAndTech'), rows: [...(battleData.weapons ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })), ...(battleData.techActs ?? []).map(techAct => ({ k: techAct.k, v: '×' + techAct.n, tone: 'var(--la-tech)', dot: 'var(--la-tech)' })), { k: 'TOTAL', v: '×' + ((side.attacks ?? 0) + (side.techAtk ?? 0)), sep: true }] }),
            })}
            ${_pairCellHtml({
                left: { value: `<span class="eva">${_nullHtml(_evaPct(battleData))}</span>${_sampleHtml(battleData.dmgIn?.evasionRolledAgainst ?? 0)}`, label: '<span class="battelog-icon-mask battelog-icon-evasion"></span> EVA' },
                right: { value: `<span class="edef">${_nullHtml(_edefPct(battleData))}</span>${_sampleHtml(battleData.dmgIn?.edefRolledAgainst ?? 0)}`, label: '<span class="edef"><span class="battelog-icon-mask battelog-icon-edef"></span> E-DEF</span>' },
                tip: _tipPanelHtml({ title: localize('LA.recap.panel.attacksAvoided'), align: 'right', rows: _dodgedEfficiencyRows(battleData) }),
            })}
            <div class="battelog-pcol-stat-cell has-tip">
                <div class="battelog-pcol-stat-value">${_nullHtml(battleData.acc?.totalShots ? _accAvg(side) + '%' : '-')}${_sampleHtml(battleData.acc?.totalShots ?? 0)}</div>
                <div class="battelog-pcol-stat-label"><i class="fas fa-crosshairs"></i> ACCURACY</div>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.accuracy'), rows: [{ k: `TOTAL ×${battleData.acc?.totalShots ?? 0}`, v: battleData.acc?.total != null ? battleData.acc.total + '%' : '-' }, { k: 'CRITICAL HITS', v: String(battleData.acc?.crits ?? 0) }] })}
            </div>
            <div class="battelog-pcol-stat-cell has-tip">
                <div class="battelog-pcol-stat-value">${_nullHtml(grit.rate == null ? '-' : grit.rate + '%')}${_sampleHtml(grit.attempts ?? 0)}</div>
                <div class="battelog-pcol-stat-label"><span class="battelog-icon-mask battelog-icon-save"></span> GRIT</div>
                ${_tipPanelHtml({ title: 'GRIT', align: 'right', rows: [{ k: `SAVES ×${grit.attempts}`, v: grit.rate == null ? '-' : grit.rate + '%' }] })}
            </div>
        </div>
        <div class="battelog-pcol-survival">
            <div class="battelog-pcol-survival-row">
                <div class="battelog-pcol-meter">
                    <div class="battelog-pcol-meter-header">
                        <span class="battelog-pcol-meter-label">HP</span>
                        <span class="battelog-pcol-meter-value">${side.hpEnd}/${side.hpMax}</span>
                    </div>
                    <div class="battelog-pcol-meter-track"><div class="battelog-pcol-meter-fill" style="width:${hpPct}%;background:${_BAR_HP};"></div></div>
                </div>
            </div>
        </div>
        <div class="battelog-pcol-footer-strip">
            <div class="battelog-pcol-fav has-tip">
                <span class="battelog-icon-mask battelog-icon-weapon"></span>
                <span class="battelog-pcol-fs-label">FAV WPN</span>
                <span class="battelog-pcol-fs-value">${_escape(side.favWeapon ?? '-')}</span>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.weaponsUsed'), rows: (battleData.weapons ?? []).map(weapon => ({ k: weapon.k, v: '×' + weapon.n })) })}
            </div>
            <div class="battelog-pcol-topact has-tip">
                <span class="battelog-icon-mask battelog-icon-activation"></span>
                <span class="battelog-pcol-fs-label">TOP ACT</span>
                <span class="battelog-pcol-fs-value">${_escape(side.topAction ?? '-')}</span>
                ${_tipPanelHtml({ title: localize('LA.recap.panel.actionsUsed'), rows: (battleData.skills ?? []).map(skill => ({ k: skill.k, v: '×' + skill.n })) })}
            </div>
        </div>`;
}

function _groupHostiles(entries)
{
    const map = new Map();
    const groups = [];
    for (const entry of entries)
    {
        const hasLicense = entry.actorType === 'mech' || entry.actorType === 'pilot';
        const key = [
            entry.side ?? 'hostile',
            entry.actorType ?? 'npc',
            hasLicense ? (entry.frameName ?? '') : entry.cls,
            hasLicense ? (entry.ll ?? 0) : entry.tier,
            (entry.templates ?? []).join(','),
            entry.scanned !== false,
            entry.actorId ?? '',
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
    if (getLAFlag(actor, 'scannedByAll'))
        return true;
    // Unlinked tokens carry the flag on their delta actor, not the base sheet recap reads.
    const tokens = /** @type {any} */ (actor).getActiveTokens?.() ?? [];
    return tokens.some((token) => getLAFlag(token?.actor, 'scannedByAll'));
}

function _tierTone(tier)
{
    if (tier >= 3)
        return 't3';
    if (tier === 2)
        return 't2';
    return 't1';
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

function _hostileKillersHtml(instances, players)
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
                mechRows.push({ k: player.callsign, v: `×${count}`, n: count, dot: player.accent });
                continue;
            }
        }
        const team = key.startsWith('player:') ? 'unknown' : key;
        teamRows.push({
            k: _KILLER_TEAM_LABEL[team] ?? _KILLER_TEAM_LABEL.unknown,
            v: `×${count}`,
            n: count,
            dot: _KILLER_TEAM_COLOR[team] ?? _KILLER_TEAM_COLOR.unknown,
            sep: false,
        });
    }
    if (mechRows.length && teamRows.length)
        teamRows[0].sep = true;
    const rows = [...mechRows, ...teamRows];
    const top = rows.reduce((best, row) => (row.n > best.n ? row : best), rows[0]);
    const topHtml = top
        ? `<span class="battelog-hcard-killers-top"><span class="battelog-tip-dot" style="background:${top.dot};"></span>${_escape(top.k)}</span>${rows.length > 1 ? `<span class="battelog-hcard-killers-more">+${rows.length - 1}</span>` : ''}`
        : '';
    return topHtml + _tipPanelHtml({ title: localize('LA.recap.panel.destroyedBy'), rows, extraClass: 'battelog-hcard-killers-tip' });
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
    const killedCount = instances.filter(instance => instance.killed !== false).length;
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
    const isMech = group.actorType === 'mech' || group.actorType === 'pilot';
    const pilotSide = count === 1 ? (instances[0].pilotSide ?? null) : null;
    const flipTag = pilotSide ? '<button type="button" class="battelog-pcol-portrait-mfr battelog-pcol-flip-btn" data-flip>PILOT <i class="fas fa-rotate"></i></button>' : '';

    const tagsHtml = isMech
        ? `
            <span class="battelog-pcol-ll">
                <span class="battelog-pcol-ll-lbl">LL</span>
                <span class="battelog-pcol-ll-num">${_escape(group.ll ?? 0)}</span>
            </span>
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
                <span class="battelog-hcard-killers-icon battelog-icon-mask battelog-icon-destroyed"></span> ${_escape(localize('LA.recap.panel.destroyedBy'))}
            </span>
            ${_hostileKillersHtml(instances, players)}
        </div>
    `;

    const scanTipHtml = scanned ? _hostileScanTipHtml(group) : '';
    const actionHtml = scanJournal ? `
        <button type="button" class="battelog-hcard-scan-btn ${scanTipHtml ? 'has-tip' : ''}" data-journal-uuid="${scanJournal.uuid}">
            <i class="fas fa-satellite-dish"></i> Show Scan Data
            ${scanTipHtml}
        </button>
    ` : scanned ? `
        <span class="battelog-hcard-scan-state ${scanTipHtml ? 'has-tip' : ''}">
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
            ? `<div class="battelog-hcard-marker top has-tip"><i class="fas fa-triangle-exclamation"></i> TOP THREAT${_hcardBadgeTipHtml('TOP THREAT', 'Highest combined damage, Nemesis excluded.')}</div>`
            : '';
    const metaHtml = `<span class="battelog-hcard-meta">SIZE <b>${_escape(size)}</b></span>`;
    const cardClass = `battelog-hcard stagger is-side-${_escape(group.side ?? 'hostile')} ${allKilled ? 'is-killed' : 'is-active'} ${scanned ? '' : 'is-unscanned'} ${isDanger ? 'is-danger' : ''} ${isNemesis ? 'is-nemesis' : ''} ${group.team?.color ? 'on-team' : ''}`;
    const cardStyle = `--i:${idx};${group.team?.color ? ` --team:${_escape(group.team.color)};` : ''}`;
    const frontHtml = `
            ${badgeHtml}
            <div class="battelog-hcard-portrait">
                ${flipTag}
                <img class="battelog-hcard-portrait-img" src="${_escape(img)}" alt="" onerror="this.style.display='none'"/>
                ${allKilled ? '<div class="battelog-pcol-portrait-tape"><span class="tape a"></span></div>' : ''}
                ${count > 1 ? _hostileCountBadgeHtml(count, killedCount) : ''}
            </div>
            <div class="battelog-hcard-main">
                <div class="battelog-hcard-nameline">
                    <span class="battelog-hcard-name">${_escape(title)}</span>
                    ${count > 1 ? `<span class="battelog-hcard-count">×${count}</span>` : ''}
                    ${metaHtml}
                </div>
                <div class="battelog-hcard-tags">${tagsHtml}</div>
                <div class="battelog-hcard-status">${statusHtml}</div>
                ${actionHtml ? `<div class="battelog-hcard-action">${actionHtml}</div>` : ''}
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
    `;
    if (!pilotSide)
        return `<div class="${cardClass}" style="${cardStyle}">${frontHtml}</div>`;
    return `
        <div class="${cardClass} has-pilot" style="${cardStyle}">
            <div class="battelog-hcard-faces">
                <div class="battelog-hcard-face is-front">${frontHtml}</div>
                <div class="battelog-hcard-face is-back">${_hostilePilotFaceHtml(pilotSide, scanned)}</div>
            </div>
        </div>
    `;
}

function _hostilePilotFaceHtml(side, scanned)
{
    const statusHtml = side.killed
        ? '<div class="battelog-hcard-killers"><span class="battelog-hcard-killers-label"><span class="battelog-hcard-killers-icon battelog-icon-mask battelog-icon-destroyed"></span> KILLED</span></div>'
        : '<div class="battelog-hcard-notkilled"><i class="fas fa-person-running"></i> NOT DESTROYED</div>';
    const dmgHtml = `
            <div class="battelog-hcard-dmg">
                <div class="battelog-hcard-dmg-cell dealt">
                    <span class="battelog-hcard-dmg-val">
                        <i class="fas fa-burst" title="Physical"></i><span class="phys">${side.physicalDmgDealt ?? 0}</span>
                        <span class="sep">/</span>
                        <i class="fas fa-thermometer-half heat" title="Heat"></i><span class="heat">${side.heatDmgDealt ?? 0}</span>
                    </span>
                    <span class="battelog-hcard-dmg-lbl">DMG DEALT</span>
                </div>
                <div class="battelog-hcard-dmg-cell taken">
                    <span class="battelog-hcard-dmg-val">
                        <i class="fas fa-burst" title="Physical"></i><span class="phys">${side.physicalDmgTaken ?? 0}</span>
                        <span class="sep">/</span>
                        <i class="fas fa-thermometer-half heat" title="Heat"></i><span class="heat">${side.heatDmgTaken ?? 0}</span>
                    </span>
                    <span class="battelog-hcard-dmg-lbl">DMG TAKEN</span>
                </div>
            </div>`;
    return `
            <div class="battelog-hcard-portrait">
                <img class="battelog-hcard-portrait-img" src="${_escape(side.img)}" alt="" onerror="this.style.display='none'"/>
                <button type="button" class="battelog-pcol-portrait-mfr battelog-pcol-flip-btn" data-flip>MECH <i class="fas fa-rotate"></i></button>
            </div>
            <div class="battelog-hcard-main">
                <div class="battelog-hcard-nameline">
                    <span class="battelog-hcard-name">${_escape(scanned ? side.name : 'UNIDENTIFIED')}</span>
                    <span class="battelog-hcard-meta">SIZE <b>0.5</b></span>
                </div>
                <div class="battelog-hcard-tags">
                    <span class="battelog-pcol-ll">
                        <span class="battelog-pcol-ll-lbl">LL</span>
                        <span class="battelog-pcol-ll-num">${_escape(side.ll)}</span>
                    </span>
                    <span class="battelog-hcard-tag frame">PILOT</span>
                </div>
                <div class="battelog-hcard-status">${statusHtml}</div>
            </div>
            ${dmgHtml}
    `;
}

const DISPO_MAP = {
    hostile:  { label: 'LA.recap.dispo.hostile',  icon: 'fa-skull-crossbones',   color: '#c62828' },
    friendly: { label: 'LA.recap.dispo.friendly', icon: 'fa-shield-halved',      color: '#2c7f40' },
    neutral:  { label: 'LA.recap.dispo.neutral',  icon: 'fa-circle-half-stroke', color: '#9c6c1b' },
    secret:   { label: 'LA.recap.dispo.secret',   icon: 'fa-user-secret',        color: '#6b45a8' },
};

function _encounterTabHtml(encounter, players)
{
    const initial = _encounterFilters(encounter)[0].key;
    return `
        <div class="battelog-encounter" data-dispo="${_escape(initial)}">
            ${_encounterInnerHtml(encounter, players, initial)}
        </div>
    `;
}

function _encounterFilters(encounter)
{
    const filters = [];
    for (const [side, dispoConfig] of Object.entries(DISPO_MAP))
    {
        const entries = encounter.filter(entry => (entry.side ?? 'hostile') === side);
        const teams = new Map();
        for (const entry of entries)
        {
            if (entry.team && !teams.has(entry.team.id))
                teams.set(entry.team.id, entry.team);
        }
        for (const team of [...teams.values()].sort((a, b) => (a.order ?? 0) - (b.order ?? 0)))
        {
            filters.push({
                key: `${side}:${team.id}`,
                side,
                teamId: team.id,
                label: team.name,
                color: team.color || dispoConfig.color,
                count: entries.filter(entry => entry.team?.id === team.id).length,
            });
        }
        filters.push({
            key: side,
            side,
            teamId: null,
            label: localize(dispoConfig.label),
            color: dispoConfig.color,
            count: entries.filter(entry => !entry.team).length,
        });
    }
    return encounter.some(entry => entry.team) ? filters.filter(filter => filter.count > 0) : filters;
}

function _encounterFilterHtml(filters, activeKey)
{
    const teamMode = filters.some(filter => filter.teamId);
    const btns = filters.map((filter, idx) =>
    {
        const sep = teamMode && idx > 0 && filters[idx - 1].side !== filter.side ? '<span class="battelog-encounter-filter-sep"></span>' : '';
        return `${sep}
            <button type="button"
                class="battelog-encounter-filter-btn ${filter.key === activeKey ? 'is-active' : ''}"
                data-dispo="${_escape(filter.key)}"
                ${filter.teamId ? `data-team="${_escape(filter.teamId)}"` : ''}
                ${filter.count === 0 ? 'disabled' : ''}
                style="--dispo:${_escape(filter.color)}; --dispo-ink:${inkOn(filter.color)};">
                <i class="fas ${DISPO_MAP[filter.side].icon}"></i>
                <span class="battelog-encounter-filter-lbl">${_escape(filter.label)}</span>
                <span class="battelog-encounter-filter-count">${filter.count}</span>
            </button>
        `;
    }).join('');
    return `<div class="battelog-encounter-filter">${btns}</div>`;
}

function _encounterInnerHtml(encounter, players, dispo)
{
    const filters = _encounterFilters(encounter);
    const activeFilter = filters.find(filter => filter.key === dispo) ?? filters[0];
    const filtered = encounter.filter(entry => (entry.side ?? 'hostile') === activeFilter.side && (entry.team?.id ?? null) === activeFilter.teamId);
    const isHostileView = activeFilter.side === 'hostile';

    // dmgDealt/dmgTaken are already filtered by counterparty in derive, per the side rules.
    const total       = filtered.length;
    const killedCount = filtered.filter(entry => entry.killed !== false).length;
    // Scan intel is per actor prototype (same actorId = same sheet).
    const uniqueActorIds = [...new Set(filtered.map(entry => entry.actorId))];
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
        let nemesisMax = 0;
        for (const group of _groupHostiles(encounter.filter(entry => (entry.side ?? 'hostile') === 'hostile')))
        {
            for (const inst of group.instances ?? [])
            {
                const dmg = inst.dmgDealt ?? 0;
                if (dmg > nemesisMax)
                {
                    nemesisMax = dmg;
                    nemesisInstance = inst;
                }
            }
        }
        const nemesisParent = nemesisInstance ? groups.find(group => (group.instances ?? []).includes(nemesisInstance)) : null;
        if (nemesisParent)
        {
            nemesisGroup = { ...nemesisParent, instances: [nemesisInstance] };
            nemesisParent.instances = nemesisParent.instances.filter(instance => instance !== nemesisInstance);
        }
        let dangerMax = 0;
        for (const group of groups)
        {
            if ((group.instances?.length ?? 0) < 2)
                continue;
            const gTotal = (group.instances ?? []).reduce((sum, inst) => sum + (inst.dmgDealt ?? 0), 0);
            if (gTotal > dangerMax)
            {
                dangerMax = gTotal;
                dangerGroup = group;
            }
        }
    }
    const remainingGroups = groups.filter(group => (group.instances?.length ?? 0) > 0);

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

    const dispoConfig = DISPO_MAP[activeFilter.side] ?? DISPO_MAP.hostile;

    return `
        <div class="battelog-recap-section-title">
            <i class="fas ${dispoConfig.icon}"></i> Encounter · Contact Log
            <span class="battelog-recap-section-rule"></span>
            <span class="battelog-recap-section-note">${totalTypes} TYPE${totalTypes === 1 ? '' : 'S'} · ${total} UNIT${total === 1 ? '' : 'S'}</span>
        </div>
        ${_encounterFilterHtml(filters, activeFilter.key)}
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
        ${orderedGroups.length === 0
            ? '<div class="battelog-encounter-empty">No contacts match this filter.</div>'
            : `<div class="battelog-hostiles-grid">${cardsHtml}</div>`}
    `;
}

const TELEMETRY_CHART = { w: 660, h: 300, pl: 42, pr: 150, pt: 18, pb: 30 };

const TELEMETRY_METRICS = [
    { key: 'hp',    field: 'line',     turnField: 'lineTurns',     label: 'LA.recap.metric.hp',    title: 'LA.recap.metricTitle.hp',    icon: 'fa-heart-pulse', startField: 'startHp' },
    { key: 'heat',  field: 'heatLine', turnField: 'heatLineTurns', label: 'LA.recap.metric.heat',  title: 'LA.recap.metricTitle.heat',  icon: 'fa-thermometer-half', startField: 'startHeat' },
    { key: 'dmg',   field: 'dmgLine',  turnField: 'dmgLineTurns',  label: 'LA.recap.metric.dmg',   title: 'LA.recap.metricTitle.dmg',   icon: 'fa-burst',  cumulative: true },
    { key: 'kills', field: 'killAssistLine', turnField: 'killAssistLineTurns', label: 'LA.recap.metric.kills', title: 'LA.recap.metricTitle.kills', icon: 'fa-skull', cumulative: true },
];

// Turn-resolution mode: each turn is a chart column instead of each round. Dense fights fall back to rounds.
const TELEMETRY_MAX_TURN_COLUMNS = 60;
function _telemetryTurnAxis(battle)
{
    const turnAxis = battle.turnAxis ?? [];
    return turnAxis.length >= 2 && turnAxis.length <= TELEMETRY_MAX_TURN_COLUMNS ? turnAxis : null;
}

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

function _telemetryScale(rawMin, rawMax)
{
    const rough = Math.max(rawMax * 1.1, 1) / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const step = Math.max(1, [1, 2, 2.5, 5, 10].map(factor => factor * magnitude).find(candidate => candidate >= rough) ?? 10 * magnitude);
    const yMax = Math.ceil(rawMax * 1.1 / step) * step;
    const truncated = rawMin > yMax * 0.35;
    const yMin = truncated ? Math.floor(rawMin * 0.9 / step) * step : 0;
    const ticks = [];
    for (let tick = yMin; tick <= yMax + 1e-9; tick += step)
        ticks.push(Math.round(tick * 100) / 100);
    return { yMin, yMax, ticks, truncated };
}

function _telemetryInk(color)
{
    if (!/^#[0-9a-f]{6}$/i.test(String(color)))
        return color;
    const toLinear = (offset) =>
    {
        const unit = parseInt(String(color).slice(offset, offset + 2), 16) / 255;
        return unit <= 0.04045 ? unit / 12.92 : Math.pow((unit + 0.055) / 1.055, 2.4);
    };
    const red = toLinear(1);
    const green = toLinear(3);
    const blue = toLinear(5);
    const coneL = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
    const coneM = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
    const coneS = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
    const lightness = Math.min(0.56, 0.2104542553 * coneL + 0.7936177850 * coneM - 0.0040720468 * coneS);
    const okA = 1.9779984951 * coneL - 2.4285922050 * coneM + 0.4505937099 * coneS;
    const okB = 0.0259040371 * coneL + 0.7827717662 * coneM - 0.8086757660 * coneS;
    const outL = Math.pow(lightness + 0.3963377774 * okA + 0.2158037573 * okB, 3);
    const outM = Math.pow(lightness - 0.1055613458 * okA - 0.0638541728 * okB, 3);
    const outS = Math.pow(lightness - 0.0894841775 * okA - 1.2914855480 * okB, 3);
    const toHex = (linear) =>
    {
        const clamped = Math.max(0, Math.min(1, linear));
        const gamma = clamped <= 0.0031308 ? 12.92 * clamped : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
        return Math.round(255 * gamma).toString(16).padStart(2, '0');
    };
    return '#' + [
        4.0767416621 * outL - 3.3077115913 * outM + 0.2309699292 * outS,
        -1.2684380046 * outL + 2.6097574011 * outM - 0.3413193965 * outS,
        -0.0041960863 * outL - 0.7034186147 * outM + 1.7076147010 * outS,
    ].map(toHex).join('');
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
            <text x="${tx + tw - 9}" y="${ry + 7}" text-anchor="end" fill="${it.color}" font-family="var(--bl-mono)" font-size="10" font-weight="700">${_escape(String(it.value))}</text>
        `;
    }).join('');
    return `
        <circle cx="${payload.x}" cy="${payload.y}" r="5" fill="${payload.color}" stroke="#fdfdfd" stroke-width="2" pointer-events="none"/>
        <rect x="${tx}" y="${ty}" width="${tw}" height="${th}" rx="3" fill="rgba(13,13,13,0.98)" stroke="#666" stroke-width="1" pointer-events="none"/>
        <text x="${tx + 9}" y="${ty + 12}" fill="color-mix(in srgb, #fff 55%, transparent)" font-family="var(--bl-mono)" font-size="8" font-weight="700" letter-spacing="1px" pointer-events="none">ROUND ${_escape(String(payload.round))}</text>
        ${rows}
    `;
}

function _telemetrySectionHtml(battle, view)
{
    const count = (battle.players ?? []).length;
    return `<div class="battelog-recap-section-title">
            <i class="fas fa-chart-line"></i> Telemetry · ${_escape(localize(_telemetryMetric(view).label))}
            <span class="battelog-recap-section-rule"></span>
            <span class="battelog-recap-section-note">PER ROUND · ${count} PILOT${count === 1 ? '' : 'S'}</span>
        </div>`;
}

function _telemetryTabHtml(battle)
{
    return `
        ${_telemetrySectionHtml(battle, 'hp')}
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
            <span class="battelog-telemetry-metric-label">${_escape(localize(m.label))}</span>
        </button>
    `).join('');
    const turns = battle.mission?.turns ?? null;
    const noteText = highlight
        ? 'ISOLATED · click again to reset'
        : `click a name to isolate · ${rounds} ROUNDS${turns ? ` · ${turns} TURNS` : ''}`;
    return `
        <div class="battelog-telemetry-metrics">${metricButtons}</div>
        <div class="battelog-telemetry-panel">
            <div class="battelog-telemetry-panel-head">
                <span class="battelog-telemetry-panel-title"><i class="fas fa-chart-line"></i> ${_escape(localize(metric.title))}</span>
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

    const roundCount = rawRounds.length;
    const turnAxis = _telemetryTurnAxis(battle);
    const turnMode = !!turnAxis && players.length > 0
        && players.every(player => (player[metric.turnField]?.length ?? 0) === turnAxis.length);
    // Column 0 is the combat-start state: full HP, zero heat/damage/kills.
    const columnCount = (turnMode ? turnAxis.length : roundCount) + 1;
    const rounds = [0, ...Array.from({ length: roundCount }, (_, i) => rawRounds[i] ?? (i + 1))];
    const columns = turnMode
        ? [{ label: 'R0', tip: '0' }, ...turnAxis.map((slot, slotIdx) => ({
            label: slotIdx === 0 || turnAxis[slotIdx - 1].round !== slot.round ? `R${slot.round}` : '',
            tip: `${slot.round} · T${slot.turn + 1}`,
        }))]
        : rounds.map(roundNo => ({ label: `R${roundNo}`, tip: String(roundNo) }));
    const dataFor = player => (turnMode ? player[metric.turnField] : player[metric.field]) ?? [];
    const splitAFor = player => (turnMode ? player.killLineTurns : player.killLine) ?? [];
    const splitBFor = player => (turnMode ? player.assistLineTurns : player.assistLine) ?? [];
    const measuredW = Math.max(0, chartSize?.w ?? 0);
    const measuredH = Math.max(0, chartSize?.h ?? 0);
    const w = measuredW > 0 ? measuredW : TELEMETRY_CHART.w;
    const h = measuredH > 40 ? measuredH : TELEMETRY_CHART.h;
    const innerW = w - pl - pr;
    const gridRight = w - 6;
    const innerH = h - pt - pb;
    const cumulative = !!metric.cumulative;

    const isKills = metric.key === 'kills';
    const cum = arr => cumulative ? _telemetryCum(arr) : arr;
    const startValue = player => metric.startField ? (player[metric.startField] ?? 0) : 0;
    const playerSeries = players.map(player => ({
        key: player.id,
        label: String(player.callsign ?? '').toUpperCase(),
        color: player.accent,
        data: [startValue(player), ...cum(dataFor(player))],
        splitA: isKills ? [0, ...cum(splitAFor(player))] : null,
        splitB: isKills ? [0, ...cum(splitBFor(player))] : null,
    }));
    const dataCols = Array.from({ length: columnCount - 1 }, (_, colIdx) => colIdx);
    const totalRaw = dataCols.map(colIdx => players.reduce((acc, player) => acc + (dataFor(player)[colIdx] ?? 0), 0));
    const totalStart = players.reduce((acc, player) => acc + startValue(player), 0);
    const totalSplitA = isKills ? dataCols.map(colIdx => players.reduce((acc, player) => acc + (splitAFor(player)[colIdx] ?? 0), 0)) : null;
    const totalSplitB = isKills ? dataCols.map(colIdx => players.reduce((acc, player) => acc + (splitBFor(player)[colIdx] ?? 0), 0)) : null;
    const totalSeries = {
        key: 'total',
        label: localize('LA.recap.total'),
        color: 'var(--la-ink, #0a0a0a)',
        data: [totalStart, ...cum(totalRaw)],
        splitA: isKills ? [0, ...cum(totalSplitA)] : null,
        splitB: isKills ? [0, ...cum(totalSplitB)] : null,
        dashed: true,
        thick: true,
    };
    const series = showTotal ? [...playerSeries, totalSeries] : playerSeries;
    const visible = highlight ? series.filter(ser => ser.key === highlight) : series;
    const rawMax = Math.max(1, ...visible.flatMap(entry => entry.data));

    // A floor far above zero (flat HP graphs) truncates the axis: 0 stays visible below a break marker.
    const rawMin = Math.min(...visible.flatMap(entry => entry.data));
    const { yMin, yMax, ticks, truncated } = _telemetryScale(rawMin, rawMax);
    const breakZone = truncated ? 18 : 0;
    const plotH = innerH - breakZone;
    const baseY = pt + plotH;

    const xOf = idx => pl + (columnCount === 1 ? innerW / 2 : (idx / (columnCount - 1)) * innerW);
    const yOf = value => pt + plotH - ((value - yMin) / (yMax - yMin)) * plotH;

    const gridY = ticks.map(tick => `
        <line x1="${pl}" x2="${gridRight}" y1="${yOf(tick)}" y2="${yOf(tick)}" class="battelog-telemetry-grid" ${tick === yMin && !truncated ? '' : 'stroke-dasharray="2 3"'} />
        <text x="${pl - 7}" y="${yOf(tick) + 3}" text-anchor="end" class="battelog-telemetry-axis-text">${tick}</text>
    `).join('');
    const axisBreak = truncated ? `
        <line x1="${pl}" x2="${gridRight}" y1="${pt + innerH}" y2="${pt + innerH}" class="battelog-telemetry-grid" />
        <text x="${pl - 7}" y="${pt + innerH + 3}" text-anchor="end" class="battelog-telemetry-axis-text">0</text>
        <line x1="${pl - 5}" x2="${pl + 5}" y1="${baseY + 12}" y2="${baseY + 6}" class="battelog-telemetry-grid" stroke-width="1.3" />
        <line x1="${pl - 5}" x2="${pl + 5}" y1="${baseY + 15}" y2="${baseY + 9}" class="battelog-telemetry-grid" stroke-width="1.3" />` : '';
    const gridX = columns.map((col, colIdx) => `
        <line x1="${xOf(colIdx)}" x2="${xOf(colIdx)}" y1="${pt}" y2="${pt + innerH}" class="battelog-telemetry-grid dim" ${col.label ? 'stroke-dasharray="2 4"' : 'stroke-dasharray="1 6" opacity="0.35" stroke-width="0.7"'}/>
        ${col.label ? `<text x="${xOf(colIdx)}" y="${h - 10}" text-anchor="middle" class="battelog-telemetry-tick-text">${col.label}</text>` : ''}
    `).join('');

    const lightPlate = !document.documentElement.classList.contains('la-dark');
    const inkOf = color => lightPlate ? _telemetryInk(color) : color;
    const jitterFor = (seriesIdx) => highlight ? 0 : (seriesIdx - (series.length - 1) / 2) * 1.7;

    // Monotone cubic (Fritsch-Carlson): smooth curve that never overshoots the data points.
    const smoothPathD = (pts) =>
    {
        if (pts.length < 2)
            return pts.length === 1 ? `M ${pts[0][0]} ${pts[0][1]}` : '';
        const dx = [];
        const slope = [];
        for (let idx = 0; idx < pts.length - 1; idx++)
        {
            const run = pts[idx + 1][0] - pts[idx][0];
            dx.push(run);
            slope.push(run !== 0 ? (pts[idx + 1][1] - pts[idx][1]) / run : 0);
        }
        const tangent = [slope[0]];
        for (let idx = 1; idx < pts.length - 1; idx++)
        {
            if (slope[idx - 1] * slope[idx] <= 0)
                tangent.push(0);
            else
            {
                const wLeft = 2 * dx[idx] + dx[idx - 1];
                const wRight = dx[idx] + 2 * dx[idx - 1];
                tangent.push((wLeft + wRight) / (wLeft / slope[idx - 1] + wRight / slope[idx]));
            }
        }
        tangent.push(slope.at(-1));
        const fmt = (value) => Math.round(value * 100) / 100;
        let pathD = `M ${fmt(pts[0][0])} ${fmt(pts[0][1])}`;
        for (let idx = 0; idx < pts.length - 1; idx++)
        {
            const step = dx[idx] / 3;
            pathD += ` C ${fmt(pts[idx][0] + step)} ${fmt(pts[idx][1] + tangent[idx] * step)}, ${fmt(pts[idx + 1][0] - step)} ${fmt(pts[idx + 1][1] - tangent[idx + 1] * step)}, ${fmt(pts[idx + 1][0])} ${fmt(pts[idx + 1][1])}`;
        }
        return pathD;
    };

    const seriesSvg = series.map((ser, seriesIdx) =>
    {
        const dim = highlight && ser.key !== highlight;
        const emph = highlight === ser.key;
        const groupOpacity = dim ? 0.12 : 1;
        const jitter = jitterFor(seriesIdx);
        const points = ser.data.map((value, idx) => [xOf(idx), yOf(value) + jitter]);
        const strokeWidth = (ser.thick ? 3.4 : 2.2) + (emph ? 1.2 : 0);
        const lineColor = ser.dashed ? ser.color : inkOf(ser.color);
        const lineD = smoothPathD(points);
        // Area fill ends at the last real data point, not the axis end, so short battles don't smear right.
        const lastX = ser.data.length > 0 ? xOf(ser.data.length - 1) : pl;
        const areaPoly = ser.thick ? '' : `<path class="battelog-telemetry-area" d="${lineD} L ${lastX} ${baseY} L ${pl} ${baseY} Z" fill="${ser.color}" pointer-events="none"/>`;
        // Keep in sync with the CSS timings below: linear line draw makes each dot's fade finish as the polyline sweeps past it.
        const lineStartDelay = 0.04;
        const lineDuration = 0.6;
        const dotDuration = 0.1;
        const dotSpacing = points.length > 1 ? lineDuration / (points.length - 1) : 0;
        const dots = points.map((point, colIdx) =>
        {
            const arrivalTime = lineStartDelay + colIdx * dotSpacing;
            const delay = (arrivalTime - dotDuration).toFixed(3);
            // Turn columns are subdivisions: smaller marks than the round starts.
            const minor = !columns[colIdx]?.label;
            const radius = ser.thick ? (minor ? 2.1 : 3.5) : (minor ? 1.6 : 2.8);
            const dotStroke = ser.thick ? (minor ? 1.4 : 2.4) : (minor ? 1 : 1.8);
            return `<circle cx="${point[0]}" cy="${point[1]}" r="${radius}" class="battelog-telemetry-dot" stroke="${lineColor}" stroke-width="${dotStroke}" pointer-events="none" style="animation-delay:${delay}s" />`;
        }).join('');
        return `
            <g style="opacity:${groupOpacity};">
                ${areaPoly}
                <path class="${ser.dashed ? 'battelog-telemetry-line-dashed' : 'battelog-telemetry-line'}" d="${lineD}" ${ser.dashed ? '' : 'pathLength="1"'} fill="none" stroke="${lineColor}" stroke-width="${strokeWidth}" stroke-linejoin="round" stroke-linecap="round" pointer-events="none" ${ser.dashed ? 'stroke-dasharray="7 4"' : ''}/>
                ${dots}
            </g>
        `;
    }).join('');

    const endLabels = series.map((ser, seriesIdx) =>
    {
        const lastIdx = ser.data.length - 1;
        const lastY = yOf(ser.data[lastIdx]) + jitterFor(seriesIdx);
        return {
            x: xOf(lastIdx),
            anchorY: lastY,
            y: lastY,
            text: `${ser.label} ${ser.data[lastIdx]}`,
            color: ser.dashed ? 'var(--la-ink)' : inkOf(ser.color),
            dim: !!highlight && ser.key !== highlight,
        };
    }).sort((first, second) => first.y - second.y);
    for (let labelIdx = 1; labelIdx < endLabels.length; labelIdx++)
    {
        if (endLabels[labelIdx].y - endLabels[labelIdx - 1].y < 13)
            endLabels[labelIdx].y = endLabels[labelIdx - 1].y + 13;
    }
    let labelFloor = h - 6;
    for (let labelIdx = endLabels.length - 1; labelIdx >= 0; labelIdx--)
    {
        endLabels[labelIdx].y = Math.min(endLabels[labelIdx].y, labelFloor);
        labelFloor = endLabels[labelIdx].y - 13;
    }
    const endLabelSvg = endLabels.map(label => `
        <polyline points="${label.x + 4},${label.anchorY} ${label.x + 12},${label.anchorY} ${label.x + 22},${label.y}" fill="none" stroke="${label.color}" stroke-width="1.4" stroke-dasharray="2 2" opacity="${label.dim ? 0.25 : 0.8}" pointer-events="none"/>
        <text x="${label.x + 26}" y="${label.y + 4}" class="battelog-telemetry-endlabel" fill="${label.color}" opacity="${label.dim ? 0.25 : 1}" pointer-events="none">${_escape(label.text)}</text>
    `).join('');

    const hitCircles = series.flatMap((ser, seriesIdx) =>
    {
        if (highlight && highlight !== ser.key)
            return [];
        const jitter = jitterFor(seriesIdx);
        return ser.data.map((value, i) =>
        {
            const bucket = (highlight ? series.filter(entry => entry.key === highlight) : series)
                .filter(entry => entry.data[i] === value)
                .map(entry => ({
                    label: entry.label,
                    value: entry.splitA ? `${entry.splitA[i] ?? 0}K · ${entry.splitB[i] ?? 0}A = ${entry.data[i]}` : entry.data[i],
                    color: entry.dashed ? '#f2f2f2' : entry.color,
                }));
            const payload = encodeURIComponent(JSON.stringify({ round: columns[i]?.tip ?? String(i), items: bucket, x: xOf(i), y: yOf(value) + jitter, color: ser.color }));
            return `<circle class="battelog-telemetry-hit" cx="${xOf(i)}" cy="${yOf(value) + jitter}" r="11" fill="transparent" data-hover="${payload}"/>`;
        });
    }).join('');

    return `
        <svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" style="display:block; width:100%; height:100%;" data-chart-w="${w}" data-chart-h="${h}" data-chart-pl="${pl}" data-chart-pr="${pr}" data-chart-pt="${pt}">
            <defs><clipPath id="battelog-telemetry-clip"><rect x="${pl - 6}" y="${pt - 3}" width="${innerW + 12}" height="${innerH + 6}"/></clipPath></defs>
            ${gridY}
            ${metric.key === 'hp' ? `<text x="${pl}" y="${pt - 6}" class="battelog-telemetry-axis-text">${_escape(localize('LA.recap.effectiveHp'))}</text>` : ''}
            ${axisBreak}
            ${gridX}
            <g clip-path="url(#battelog-telemetry-clip)">${seriesSvg}</g>
            ${endLabelSvg}
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
        const roundValues = player[metric.field] ?? [];
        let sub;
        if (isHp && player.pilotOnly)
            sub = `${player.hpEnd ?? 0}/${player.hpMax ?? 0}`;
        else if (isHp)
            sub = `S${player.structEnd ?? 0} · ${player.hpEnd ?? 0}/${player.hpMax ?? 0}`;
        else if (isHeat)
            sub = `ST${player.stressEnd ?? 0} · ${player.heatEnd ?? 0}/${player.heatMax ?? 0}`;
        else if (isKills)
            sub = `${player.kills ?? 0}K · ${player.assists ?? 0}A`;
        else
            sub = `${roundValues.reduce((a, b) => a + b, 0)} DMG`;
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
        totalLabel = String(players.reduce((total, player) => total + (player.effectiveHpEnd ?? 0), 0));
    else if (isHeat)
        totalLabel = String(players.reduce((total, player) => total + (player.heatConsumedEnd ?? 0), 0));
    else if (isKills)
    {
        const totalKills = players.reduce((total, player) => total + (player.kills ?? 0), 0);
        const totalAssists = players.reduce((total, player) => total + (player.assists ?? 0), 0);
        totalLabel = `${totalKills}K · ${totalAssists}A`;
    }
    else
    {
        const totalRaw = rounds.map((_, i) => players.reduce((sum, player) => sum + (player[metric.field]?.[i] ?? 0), 0));
        totalLabel = `${totalRaw.reduce((a, b) => a + b, 0)} DMG`;
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
