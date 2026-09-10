// Uplink bar: top-right notification bar showing ongoing rolls, click a chip
// to watch that roll's mirror card live. Refresh is a fail-safe only.

import { buildMirrorCard } from './mirror-card.js';
import { getLiveRolls } from './live-rolls.js';
import { drawSightlines, clearSightlines } from '../vision/sightlines.js';
import { rangePulse, RANGE_PULSE_PRIORITY, RANGE_GLOW, createChanceLabel } from '../interactive/canvas.js';
import { rollHitCritChance } from '../interactive/canvas-helpers.js';
import { targetInfoAllowed, haseSuccessChance, contestWinChance } from '../activations/targeting-ui.js';
import { getSettingEnabled } from '../setup/settings-register.js';

const PANEL_ID = 'la-uplink-panel';
const LIVE_TICK_MS = 400;
const HOVER_KEY = 'la-uplink';
const KIND_SHORT = { attack: 'ATK', tech: 'TECH', damage: 'DMG', hase: 'HASE' };
const KIND_CHIP = { attack: 'lancer-weapon', tech: 'lancer-tech', damage: 'lancer-weapon', hase: 'lancer-weapon' };

let _liveHook = null;
let _collapseHook = null;
let _resizeObserver = null;
let _onWindowResize = null;
let _liveTick = null;
let _selectedId = null;
let _lastSelected = null;
let _lastRenderKey = null;
let _hoveredControl = null;
let _chanceHandles = [];
const _seenRolls = new Set();
const _formulaBounds = new Map();

function formulaBounds(formula)
{
    let bounds = _formulaBounds.get(formula);
    if (!bounds)
    {
        try
        {
            bounds = {
                min: Number(new Roll(formula).evaluateSync({ minimize: true }).total) || 0,
                max: Number(new Roll(formula).evaluateSync({ maximize: true }).total) || 0
            };
        }
        catch
        {
            bounds = { min: 0, max: 0 };
        }
        _formulaBounds.set(formula, bounds);
    }
    return bounds;
}

function selectedSnapshot()
{
    const entry = _selectedId ? getLiveRolls().find(candidate => candidate.id === _selectedId) : null;
    return entrySnapshot(entry);
}

function attackChanceFn(uuid)
{
    return () =>
    {
        try
        {
            const snapshot = selectedSnapshot();
            const target = snapshot?.raw?.targets?.find(entry => entry.targetUuid === uuid);
            const actor = fromUuidSync(uuid)?.actor;
            if (!target || !actor?.system)
                return null;
            const base = snapshot.raw.base || {};
            const weapon = snapshot.raw.weapon || {};
            const bonus = (Number(base.grit) || 0) + (Number(base.flatBonus) || 0);
            const defense = weapon.smart ? (Number(actor.system.edef) || 8) : (Number(actor.system.evasion) || 5);
            const total = snapshot.totals?.targets?.find(entry => entry.uuid === uuid)?.total;
            const result = rollHitCritChance(bonus, Number(total) || 0, defense);
            if (target.invisible)
            {
                result.hit /= 2;
                result.crit /= 2;
            }
            if (weapon.tech)
                result.crit = 0;
            return result;
        }
        catch
        {
            return null;
        }
    };
}

function damageRangeFn(uuid)
{
    return () =>
    {
        try
        {
            const snapshot = selectedSnapshot();
            const target = snapshot?.raw?.targets?.find(entry => entry.targetUuid === uuid);
            if (!target)
                return null;
            if (Number(target.quality) === 0)
            {
                const reliable = Number(snapshot.raw.weapon?.reliableValue) || 0;
                return reliable > 0 ? { label: `${reliable}`, fill: 0xb0763a } : null;
            }
            const entries = [
                ...(snapshot.raw.weapon?.damage || []), ...(snapshot.raw.weapon?.bonusDamage || []),
                ...(snapshot.raw.base?.damage || []), ...(snapshot.raw.base?.bonusDamage || []),
                ...(target.bonusDamage || [])
            ];
            let min = 0;
            let max = 0;
            for (const entry of entries)
            {
                const formula = String(entry?.val ?? '').trim();
                if (!formula)
                    continue;
                const bounds = formulaBounds(formula);
                min += bounds.min;
                max += bounds.max;
            }
            if (max <= 0)
                return null;
            return { label: min === max ? `${max}` : `${min}-${max}`, fill: 0xff9a4d };
        }
        catch
        {
            return null;
        }
    };
}

function haseChanceFn()
{
    return () =>
    {
        try
        {
            const snapshot = selectedSnapshot();
            const actor = snapshot?.rollerTokenUuid ? fromUuidSync(snapshot.rollerTokenUuid)?.actor : null;
            if (!actor)
                return null;
            const base = snapshot.raw.base || {};
            const netAcc = (Number(base.accuracy) || 0) - (Number(base.difficulty) || 0);
            let chance = null;
            if (snapshot.contest?.actorUuid)
            {
                const opponent = fromUuidSync(snapshot.contest.actorUuid);
                const opponentActor = opponent?.actor ?? opponent;
                chance = opponentActor ? contestWinChance(actor, snapshot.checkLabel, opponentActor, snapshot.contest.stat, { netAcc }) : null;
            }
            else
                chance = haseSuccessChance(actor, snapshot.checkLabel, Number(snapshot.check?.targetVal) || 10, { netAcc, applyStatuses: false });
            if (typeof chance === 'number')
                return { label: `${Math.round(chance * 100)}%` };
            return chance;
        }
        catch
        {
            return null;
        }
    };
}

function clearChanceLabels()
{
    for (const handle of _chanceHandles)
        handle.destroy();
    _chanceHandles = [];
}

function entrySnapshot(entry)
{
    return entry?.snapshot ?? null;
}

// Hover visuals need the roller's token on this client's canvas (same scene).
function rollerToken(snapshot)
{
    return snapshot?.rollerTokenUuid ? fromUuidSync(snapshot.rollerTokenUuid)?.object || null : null;
}

function clearHover()
{
    if (!_hoveredControl)
        return;
    _hoveredControl = null;
    clearSightlines(HOVER_KEY);
    rangePulse.clear(HOVER_KEY);
    clearChanceLabels();
}

// crlngn resizes and collapses the sidebar live, so the offset comes from its rect.
function placePanel(panel)
{
    const sidebar = document.querySelector('#sidebar');
    let right = 60;
    if (sidebar)
    {
        const rect = sidebar.getBoundingClientRect();
        if (rect.width > 0)
            right = Math.max(0, window.innerWidth - rect.left) + 12;
    }
    panel.style.right = `${right}px`;
}

function renderBar(panel)
{
    const bar = panel.querySelector('.lau-bar');
    const liveRolls = getLiveRolls();
    if (_selectedId && !liveRolls.some(entry => entry.id === _selectedId))
        _selectedId = null;

    const newcomers = liveRolls.filter(entry => !_seenRolls.has(entry.id));
    for (const id of _seenRolls)
    {
        if (!liveRolls.some(entry => entry.id === id))
            _seenRolls.delete(id);
    }
    for (const entry of newcomers)
        _seenRolls.add(entry.id);
    if (!_selectedId && newcomers.length && getSettingEnabled('uplinkAutoOpen'))
        _selectedId = newcomers[0].id;

    const chips = liveRolls.map(entry =>
    {
        const kindLabel = entry.kind === 'hase' ? (entry.checkLabel || KIND_SHORT.hase) : (KIND_SHORT[entry.kind] || entry.kind);
        const label = `${entry.actorName || entry.userName} · ${kindLabel}`;
        const selectedClass = entry.id === _selectedId ? ' on' : '';
        return `<button type="button" class="lau-roll-chip lancer-chip ${KIND_CHIP[entry.kind] || 'lancer-dark'}${selectedClass}" data-roll="${entry.id}"><span>${label}</span></button>`;
    }).join('');

    bar.innerHTML = `
        <span>Uplink · ${liveRolls.length}</span>
        ${chips}
        <span class="lau-spacer"></span>
        <button type="button" data-action="refresh" title="Fail-safe refresh">↻</button>
        <button type="button" data-action="close">✕</button>`;
    renderView(panel, _selectedId !== _lastSelected);
    _lastSelected = _selectedId;
}

function renderView(panel, animate = false)
{
    const view = panel.querySelector('.lau-view');
    const entry = _selectedId ? getLiveRolls().find(candidate => candidate.id === _selectedId) : null;
    const snapshot = entrySnapshot(entry);
    let renderKey = null;
    if (snapshot)
    {
        const stable = { ...snapshot };
        delete stable.id;
        delete stable.ts;
        renderKey = `${_selectedId}|${JSON.stringify(stable)}`;
    }
    if (!animate && renderKey !== null && renderKey === _lastRenderKey)
        return;
    _lastRenderKey = renderKey;
    // The re-render replaces the DOM, so an active hover is rebound to the
    // equivalent new element instead of cleared, or the canvas pulse restarts.
    const hoveredRef = _hoveredControl ? { tgt: _hoveredControl.dataset.hoverTgt, range: _hoveredControl.dataset.hoverRange } : null;
    view.classList.toggle('lau-anim', !!animate);
    view.replaceChildren();
    if (snapshot)
        view.appendChild(buildMirrorCard(snapshot));
    if (!hoveredRef)
        return;
    const selector = hoveredRef.tgt ? `[data-hover-tgt="${hoveredRef.tgt}"]` : `[data-hover-range="${hoveredRef.range}"]`;
    const rebound = view.querySelector(selector);
    if (rebound)
        _hoveredControl = rebound;
    else
        clearHover();
}

export function openUplinkPanel()
{
    closeUplinkPanel();

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.innerHTML = `<div class="lau-bar"></div><div class="lau-view"></div>`;

    panel.addEventListener('click', (event) =>
    {
        const panSource = /** @type {HTMLElement} */ (event.target)?.closest?.('[data-hover-tgt], [data-pan-uuid]');
        if (panSource)
        {
            const uuid = panSource.dataset.hoverTgt || panSource.dataset.panUuid;
            const token = uuid ? fromUuidSync(uuid)?.object : null;
            if (token)
                canvas.animatePan({ x: token.center.x, y: token.center.y, duration: 500 });
            return;
        }
        const button = /** @type {HTMLElement} */ (event.target)?.closest?.('button');
        if (!button)
            return;
        const rollId = button.dataset.roll;
        if (rollId)
        {
            _selectedId = _selectedId === rollId ? null : rollId;
            renderBar(panel);
        }
        else if (button.dataset.action === 'refresh')
            renderBar(panel);
        else if (button.dataset.action === 'close')
            closeUplinkPanel(true);
    });

    panel.addEventListener('mouseover', (event) =>
    {
        const hovered = /** @type {HTMLElement} */ (event.target)?.closest?.('[data-hover-tgt], [data-hover-range], [data-pan-uuid]');
        if (hovered === _hoveredControl)
            return;
        clearHover();
        if (!hovered)
            return;
        const entry = getLiveRolls().find(candidate => candidate.id === _selectedId);
        const snapshot = entrySnapshot(entry);
        const roller = rollerToken(snapshot);
        if (!roller)
            return;
        _hoveredControl = hovered;
        if (hovered.dataset.hoverTgt)
        {
            const uuid = hovered.dataset.hoverTgt;
            const targetToken = fromUuidSync(uuid)?.object;
            if (!targetToken)
                return;
            drawSightlines(HOVER_KEY, roller, [targetToken]);
            if (targetInfoAllowed())
            {
                const labelFn = snapshot?.kind === 'damage' ? damageRangeFn(uuid) : attackChanceFn(uuid);
                _chanceHandles.push(createChanceLabel(targetToken, labelFn));
            }
        }
        else if (hovered.dataset.panUuid)
        {
            if (snapshot?.kind === 'hase' && targetInfoAllowed())
                _chanceHandles.push(createChanceLabel(roller, haseChanceFn()));
        }
        else
        {
            const range = Number(hovered.dataset.hoverRange) || 0;
            if (range > 0)
                rangePulse.setRange(HOVER_KEY, { token: roller, range, includeSelf: true, priority: RANGE_PULSE_PRIORITY.UPLINK, glowColor: RANGE_GLOW.weapon, los: !!snapshot?.losActive });
        }
    });
    panel.addEventListener('mouseleave', clearHover);

    renderBar(panel);
    document.body.appendChild(panel);
    placePanel(panel);

    const sidebar = document.querySelector('#sidebar');
    if (sidebar && window.ResizeObserver)
    {
        _resizeObserver = new ResizeObserver(() => placePanel(panel));
        _resizeObserver.observe(sidebar);
    }
    _onWindowResize = () => placePanel(panel);
    window.addEventListener('resize', _onWindowResize);
    _collapseHook = Hooks.on('collapseSidebar', () => setTimeout(() => placePanel(panel), 350));

    _liveHook = Hooks.on('lancer-automations.uplinkLiveRolls', () => renderBar(panel));
    _liveTick = setInterval(() =>
    {
        if (panel.isConnected && _selectedId)
            renderView(panel, false);
    }, LIVE_TICK_MS);
    return panel;
}

// Ephemeral and GM-only: a visible roll opens the panel, the last one closing
// closes it. Player clients only broadcast, they never see the panel.
Hooks.on('lancer-automations.uplinkLiveRolls', () =>
{
    if (!game.user?.isGM)
        return;
    const liveCount = getLiveRolls().length;
    const panel = document.getElementById(PANEL_ID);
    const open = !!panel && !panel.classList.contains('lau-out');
    if (liveCount > 0 && !open && getSettingEnabled('uplinkAutoOpen'))
        openUplinkPanel();
    else if (liveCount === 0 && open)
        closeUplinkPanel(true);
});

export function closeUplinkPanel(animate = false)
{
    clearHover();
    clearChanceLabels();
    if (_liveHook !== null)
    {
        Hooks.off('lancer-automations.uplinkLiveRolls', _liveHook);
        _liveHook = null;
    }
    if (_collapseHook !== null)
    {
        Hooks.off('collapseSidebar', _collapseHook);
        _collapseHook = null;
    }
    if (_resizeObserver)
    {
        _resizeObserver.disconnect();
        _resizeObserver = null;
    }
    if (_onWindowResize)
    {
        window.removeEventListener('resize', _onWindowResize);
        _onWindowResize = null;
    }
    if (_liveTick !== null)
    {
        clearInterval(_liveTick);
        _liveTick = null;
    }
    _selectedId = null;
    _lastSelected = null;
    _lastRenderKey = null;
    const panel = document.getElementById(PANEL_ID);
    if (!panel)
        return;
    if (!animate)
    {
        panel.remove();
        return;
    }
    panel.classList.add('lau-out');
    const removePanel = () => panel.remove();
    panel.addEventListener('animationend', removePanel, { once: true });
    setTimeout(removePanel, 400);
}
