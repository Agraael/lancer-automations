// Custom multi-bar hub drawn under Lancer tokens + resource grid in token HUD.
// Replaces vanilla bar1/bar2 for mech/npc/deployable actors. Disabled by default.

const MODULE_ID = 'lancer-automations';
const SETTING_ENABLED = 'tokenStatBar';

// ---------------------------------------------------------------------------
// Module-level state
// ---------------------------------------------------------------------------

let _altHeld = false;
const _lastValues = new Map();
const _flashingTokens = new Set();
const _fadeState = new Map();
let originalDrawBars = null;

const FLASH_HOLD_MS = 250;
const FLASH_SHRINK_MS = 1300;
const FLASH_TOTAL_MS = FLASH_HOLD_MS + FLASH_SHRINK_MS;
const FLASH_LINGER_MS = 600;

// Cap on hub width in pixels. Tokens larger than this get a centered hub
// instead of one that scales to the full token width.
const MAX_BAR_WIDTH = 500;

// ---------------------------------------------------------------------------
// Bar definitions
// ---------------------------------------------------------------------------

const BAR_DEFS = [
    {
        id: 'hp',
        label: 'HP',
        color: 0x66cc66,
        getValue: a => ({ value: a.system?.hp?.value ?? 0, max: getEffectiveMax(a, 'hp') }),
        editPath: 'system.hp.value',
    },
    {
        id: 'heat',
        label: 'Heat',
        color: 0xcc4422,
        getValue: a => ({ value: a.system?.heat?.value ?? 0, max: getEffectiveMax(a, 'heat') }),
        editPath: 'system.heat.value',
    },
    {
        id: 'structure',
        label: 'STR',
        color: 0xffd633,
        getValue: a => ({ value: a.system?.structure?.value ?? 0, max: a.system?.structure?.max ?? 0 }),
        editPath: 'system.structure.value',
        pips: true,
    },
    {
        id: 'stress',
        label: 'Stress',
        color: 0xff8822,
        getValue: a => ({ value: a.system?.stress?.value ?? 0, max: a.system?.stress?.max ?? 0 }),
        editPath: 'system.stress.value',
        pips: true,
    },
    {
        id: 'overshield',
        label: 'OS',
        color: 0x48dee0,
        getValue: a => ({ value: a.system?.overshield?.value ?? 0, max: a.system?.overshield?.max ?? 0 }),
        editPath: 'system.overshield.value',
        hideWhenZero: true,
    },
    {
        id: 'burn',
        label: 'Burn',
        color: 0xcc1a1a,
        getValue: a => ({ value: a.system?.burn ?? 0, max: 0 }),
        editPath: 'system.burn',
        softMax: 10,
        hideWhenZero: true,
    },
    {
        id: 'infection',
        label: 'Inf',
        color: 0x1a8844,
        getValue: a => ({ value: a.system?.infection ?? 0, max: 0 }),
        editPath: 'system.infection',
        softMax: 10,
        hideWhenZero: true,
    },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isEnabled() {
    try {
        return game.settings.get(MODULE_ID, SETTING_ENABLED) === true;
    } catch {
        return false;
    }
}

function isLancerCombatant(actor) {
    if (!actor) {
        return false;
    }
    const t = actor.type;
    return t === 'mech' || t === 'npc' || t === 'deployable' || t === 'pilot';
}

function hasMechStats(actor) {
    return actor?.type === 'mech' || actor?.type === 'npc';
}
function hasReaction(actor) {
    return actor?.type !== 'deployable';
}

const FLAG_HIDDEN = 'statBarHidden';
const FLAG_COMBAT_ONLY = 'statBarCombatOnly';
const FLAG_ROW_HEIGHT = 'statBarRowHeight';

function statBarHidden(tokenDoc) {
    return tokenDoc?.getFlag?.(MODULE_ID, FLAG_HIDDEN) === true;
}

function statBarCombatOnly(tokenDoc) {
    return tokenDoc?.getFlag?.(MODULE_ID, FLAG_COMBAT_ONLY) === true;
}

function statBarRowHeight(tokenDoc) {
    const v = tokenDoc?.getFlag?.(MODULE_ID, FLAG_ROW_HEIGHT);
    return Number.isFinite(v) && v > 0 ? Number(v) : 0;
}

function isTokenInCombat(token) {
    const id = token?.id;
    if (!id) {
        return false;
    }
    for (const combat of game.combats ?? []) {
        if (!combat.started) {
            continue;
        }
        if (combat.combatants.some(c => c.tokenId === id)) {
            return true;
        }
    }
    return false;
}

function isTokenVisible(token) {
    if (!token) {
        return false;
    }
    if (token.document?.hidden && !game.user.isGM) {
        return false;
    }
    return token.visible !== false;
}

function shouldShowBars(token) {
    if (!token) {
        return false;
    }
    if (statBarHidden(token.document)) {
        return false;
    }
    if (statBarCombatOnly(token.document) && !isTokenInCombat(token)) {
        return false;
    }
    if (_flashingTokens.has(token.id)) {
        return true;
    }
    if (token.hover) {
        return true;
    }
    if (token.controlled) {
        return true;
    }
    if (token.targeted?.has(game.user)) {
        return true;
    }
    if (_altHeld && isTokenVisible(token)) {
        return true;
    }
    return false;
}

function getVisibleBars(actor) {
    if (!actor) {
        return [];
    }
    const mechStats = hasMechStats(actor);
    return BAR_DEFS.filter(def => {
        // Pilots & deployables don't get structure/stress at all.
        if (!mechStats && (def.id === 'structure' || def.id === 'stress')) {
            return false;
        }
        const v = def.getValue(actor);
        const value = v.value ?? 0;
        const max = v.max ?? 0;
        if (def.pips && max <= 0) {
            return false;
        }
        // Heat: if the actor has no native heat track, only render the bar
        // when there is actual heat or infection to show.
        if (def.id === 'heat' && (actor.system?.heat?.max ?? 0) <= 0) {
            const infection = actor.system?.infection ?? 0;
            if (value <= 0 && infection <= 0) {
                return false;
            }
        }
        if (def.hideWhenZero && value <= 0) {
            return false;
        }
        if (def.hideWhenFull && max > 0 && value >= max) {
            return false;
        }
        return true;
    });
}

// Effective max for a host bar — if the current value (or, for HP, the
// HP+overshield total) exceeds the actor's nominal max, the bar grows to fit.
function getEffectiveMax(actor, hostId) {
    const sys = actor?.system;
    if (!sys) {
        return 0;
    }
    if (hostId === 'hp') {
        const max = sys.hp?.max ?? 0;
        const value = Math.max(0, sys.hp?.value ?? 0);
        const os = Math.max(0, sys.overshield?.value ?? 0);
        return Math.max(max, value + os, value);
    }
    if (hostId === 'heat') {
        const ownMax = sys.heat?.max ?? 0;
        const value = Math.max(0, sys.heat?.value ?? 0);
        const fallbackMax = ownMax > 0 ? ownMax : (sys.hp?.max ?? 0);
        return Math.max(fallbackMax, value);
    }
    return 0;
}

function snapshotValues(actor) {
    return {
        hp: actor.system?.hp?.value ?? 0,
        heat: actor.system?.heat?.value ?? 0,
        structure: actor.system?.structure?.value ?? 0,
        stress: actor.system?.stress?.value ?? 0,
        overshield: actor.system?.overshield?.value ?? 0,
        burn: actor.system?.burn ?? 0,
        infection: actor.system?.infection ?? 0,
        reaction: actor.system?.action_tracker?.reaction === true,
    };
}

function refreshVisibleLancerTokens() {
    if (!isEnabled()) {
        return;
    }
    if (!canvas?.tokens) {
        return;
    }
    for (const tok of canvas.tokens.placeables) {
        if (!isLancerCombatant(tok.actor)) {
            continue;
        }
        if (!tok.bars || tok.bars.children.length === 0) {
            continue;
        }
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    }
}

// ---------------------------------------------------------------------------
// Fade + flash animations
// ---------------------------------------------------------------------------

function fadeBars(token, targetAlpha) {
    if (!token?.bars) {
        return;
    }
    const id = token.id;
    const cur = _fadeState.get(id);
    if (cur && cur.target === targetAlpha) {
        return;
    }
    if (cur) {
        canvas.app.ticker.remove(cur.tick);
    }
    const startAlpha = token.bars.alpha ?? 1;
    const duration = 150;
    const startTime = performance.now();

    const tick = () => {
        if (!token.bars || token.destroyed) {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
            return;
        }
        const t = Math.min(1, (performance.now() - startTime) / duration);
        const eased = 1 - Math.pow(1 - t, 3);
        token.bars.alpha = startAlpha + (targetAlpha - startAlpha) * eased;
        if (t >= 1) {
            canvas.app.ticker.remove(tick);
            _fadeState.delete(id);
        }
    };

    _fadeState.set(id, { target: targetAlpha, tick });
    canvas.app.ticker.add(tick);
}

function runFlashAnimation(token, name, drawAt) {
    const flashGfx = new PIXI.Graphics();
    flashGfx.name = name;
    token.addChild(flashGfx);

    const flashStart = performance.now();
    const tick = () => {
        if (!flashGfx || flashGfx.destroyed) {
            canvas.app.ticker.remove(tick);
            return;
        }
        const elapsed = performance.now() - flashStart;
        flashGfx.clear();
        if (elapsed < FLASH_HOLD_MS) {
            drawAt(flashGfx, 0);
            return;
        }
        const t = Math.min(1, (elapsed - FLASH_HOLD_MS) / FLASH_SHRINK_MS);
        if (t >= 1) {
            flashGfx.destroy();
            canvas.app.ticker.remove(tick);
            return;
        }
        const eased = 1 - Math.pow(1 - t, 3);
        drawAt(flashGfx, eased);
    };
    canvas.app.ticker.add(tick);
}

function spawnFlash(token, barId, oldVal, newVal) {
    const geom = token._laBarsGeom;
    if (!geom || oldVal === newVal) {
        return;
    }

    const { layoutOffsetX, pipColW, rowHeight, rowGap, startY, indicatorW, rightColX, rightColW } = geom;
    const visibleIds = geom.visibleIds;

    if (barId === 'hp' || barId === 'heat') {
        if (!visibleIds.has(barId)) {
            return;
        }
        const rowIdx = barId === 'hp' ? 0 : 1;
        // Use the largest of pre/post values and the current effective max so
        // flashes positioned past the nominal cap (over-cap healing/damage)
        // still land inside the visible bar.
        const hostMax = Math.max(getEffectiveMax(token.actor, barId), oldVal, newVal);
        if (hostMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const y = startY + rowIdx * (rowHeight + rowGap) + 1;
        const h = rowHeight - 2;

        const lo = Math.min(oldVal, newVal);
        const hi = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (lo / hostMax) * barW;
        const initialFlashW = ((hi - lo) / hostMax) * barW;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, y, remainingW, h);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'structure' || barId === 'stress') {
        if (!visibleIds.has(barId)) {
            return;
        }
        const rowIdx = barId === 'structure' ? 0 : 1;
        const max = barId === 'structure'
            ? (token.actor?.system?.structure?.max ?? 0)
            : (token.actor?.system?.stress?.max ?? 0);
        if (max <= 0) {
            return;
        }
        const colX = layoutOffsetX;
        const colW = pipColW;
        const y = startY + rowIdx * (rowHeight + rowGap) + 1;
        const h = rowHeight - 2;

        const gap = 1;
        const inner = colW - 2;
        const segW = (inner - gap * (max - 1)) / max;
        const oldEmpty = max - oldVal;
        const newEmpty = max - newVal;
        const startIdx = Math.min(oldEmpty, newEmpty);
        const endIdx = Math.max(oldEmpty, newEmpty);
        if (endIdx <= startIdx) {
            return;
        }
        const isDamage = newVal < oldVal;
        const flashStartX = colX + 1 + startIdx * (segW + gap);
        const flashEndX = colX + 1 + endIdx * (segW + gap) - gap;
        const initialFlashW = flashEndX - flashStartX;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            // Pips drain from the left, so flash direction is reversed vs HP/Heat.
            const drawX = isDamage
                ? flashStartX + (initialFlashW - remainingW)
                : flashStartX;
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, y, remainingW, h);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'overshield') {
        if (!visibleIds.has('hp')) {
            return;
        }
        const hpMax = Math.max(getEffectiveMax(token.actor, 'hp'), oldVal, newVal);
        if (hpMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const y = startY + 1;
        const h = rowHeight - 2;

        const lo = Math.min(oldVal, newVal);
        const hi = Math.max(oldVal, newVal);
        const isDamage = newVal < oldVal;
        const initialFlashX = barX + (lo / hpMax) * barW;
        const initialFlashW = ((hi - lo) / hpMax) * barW;
        if (initialFlashW <= 0) {
            return;
        }
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            const drawX = isDamage
                ? initialFlashX
                : initialFlashX + (initialFlashW - remainingW);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, y, remainingW, h);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'burn' || barId === 'infection') {
        const hostId = barId === 'burn' ? 'hp' : 'heat';
        if (!visibleIds.has(hostId)) {
            return;
        }
        const hostMax = Math.max(getEffectiveMax(token.actor, hostId), oldVal, newVal);
        if (hostMax <= 0) {
            return;
        }
        const hostVal = barId === 'burn'
            ? (token.actor?.system?.hp?.value ?? 0)
            : (token.actor?.system?.heat?.value ?? 0);
        const rowIdx = barId === 'burn' ? 0 : 1;
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const y = startY + rowIdx * (rowHeight + rowGap) + 1;
        const h = rowHeight - 2;

        const isReduction = newVal < oldVal;
        const fillPx = (Math.max(0, hostVal) / hostMax) * barW;

        let flashStartX;
        let flashW;
        if (barId === 'burn') {
            const oldEdge = barX + Math.max(0, fillPx - (oldVal / hostMax) * barW);
            const newEdge = barX + Math.max(0, fillPx - (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        } else {
            const oldEdge = barX + Math.min(barW, fillPx + (oldVal / hostMax) * barW);
            const newEdge = barX + Math.min(barW, fillPx + (newVal / hostMax) * barW);
            flashStartX = Math.min(oldEdge, newEdge);
            flashW = Math.abs(newEdge - oldEdge);
        }
        if (flashW <= 0) {
            return;
        }

        const initialFlashX = flashStartX;
        const initialFlashW = flashW;
        runFlashAnimation(token, `la-flash-${barId}`, (gfx, eased) => {
            const remainingW = initialFlashW * (1 - eased);
            // Reversed vs host bars so the wipe reads as a different stat.
            let drawX;
            if (barId === 'burn') {
                drawX = isReduction
                    ? initialFlashX + (initialFlashW - remainingW)
                    : initialFlashX;
            } else {
                drawX = isReduction
                    ? initialFlashX
                    : initialFlashX + (initialFlashW - remainingW);
            }
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(drawX, y, remainingW, h);
            gfx.endFill();
        });
        return;
    }

    if (barId === 'reaction') {
        const x = 0;
        const y = startY + 1;
        const w = indicatorW - 2;
        const h = rowHeight - 2;
        if (w <= 0 || h <= 0) {
            return;
        }
        runFlashAnimation(token, 'la-flash-reaction', (gfx, eased) => {
            const remainingH = h * (1 - eased);
            const drawY = y + (h - remainingH);
            gfx.beginFill(0xffffff, 1);
            gfx.drawRect(x + 1, drawY, w, remainingH);
            gfx.endFill();
        });
    }
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function drawSegment(gfx, x, y, w, h, def, v) {
    const max = (v.max && v.max > 0) ? v.max : (def.softMax ?? 1);
    const value = Math.max(0, v.value ?? 0);
    const pct = Math.max(0, Math.min(1, value / max));

    gfx.lineStyle(0);
    gfx.beginFill(0x111111, 0.9);
    gfx.drawRect(x, y, w, h);
    gfx.endFill();
    // Slightly brighter interior so the 1px border reads as a frame.
    gfx.beginFill(0x222222, 0.9);
    gfx.drawRect(x + 1, y + 1, w - 2, h - 2);
    gfx.endFill();

    if (def.pips) {
        // Drains left to right: empty slots on the left, filled on the right.
        const gap = 1;
        const inner = w - 2;
        const segW = (inner - gap * (max - 1)) / max;
        const emptyCount = max - value;
        for (let s = 0; s < max; s++) {
            const filled = s >= emptyCount;
            gfx.beginFill(filled ? def.color : 0x333333, filled ? 1 : 0.6);
            gfx.drawRect(x + 1 + s * (segW + gap), y + 1, segW, h - 2);
            gfx.endFill();
        }
    } else {
        const fillW = Math.max(0, (w - 2) * pct);
        if (fillW > 0) {
            gfx.beginFill(def.color, 1);
            gfx.drawRect(x + 1, y + 1, fillW, h - 2);
            gfx.endFill();
        }
    }
}

function drawStatHub() {
    const token = this;
    const actor = token?.actor;

    token.bars.removeChildren();

    if (!isEnabled() || !isLancerCombatant(actor)) {
        if (originalDrawBars) {
            return originalDrawBars.call(token);
        }
        return;
    }

    // Override displayBars so our hub draws even when the doc says NEVER.
    token.displayBars = CONST.TOKEN_DISPLAY_MODES.ALWAYS;

    const visibleIds = new Set(getVisibleBars(actor).map(d => d.id));
    const find = id => BAR_DEFS.find(d => d.id === id);
    const mechStats = hasMechStats(actor);
    const reactionEnabled = hasReaction(actor);

    const rows = [];
    if (mechStats) {
        if (visibleIds.has('structure') || visibleIds.has('hp')) {
            rows.push([find('structure'), find('hp')]);
        }
        if (visibleIds.has('stress') || visibleIds.has('heat')) {
            rows.push([find('stress'), find('heat')]);
        }
    } else {
        // Pilots / deployables: full-width HP row, plus a heat row if heat
        // somehow ended up on them (e.g. infection ticking on a deployable).
        if (visibleIds.has('hp')) {
            rows.push([null, find('hp')]);
        }
        if (visibleIds.has('heat')) {
            rows.push([null, find('heat')]);
        }
    }

    if (rows.length === 0) {
        token.bars.visible = false;
        return;
    }

    const width = Math.min(token.w, MAX_BAR_WIDTH);
    const rowHeightOverride = statBarRowHeight(token.document);
    const rowHeight = rowHeightOverride > 0
        ? rowHeightOverride
        : Math.max(7, Math.floor(canvas.dimensions.size / 16));
    const rowGap = 1;
    const startY = token.h + 3 - rowHeight;

    // Reaction slot — square cell on the left edge (omitted for deployables).
    const indicatorW = reactionEnabled ? rowHeight : 0;
    const indicatorGap = reactionEnabled ? 1 : 0;
    const layoutOffsetX = indicatorW + indicatorGap;

    const usableW = width - layoutOffsetX;
    // Pilots/deployables: HP bar fills the whole row (no pip column).
    const pipColW = mechStats ? Math.floor(usableW * 0.32) : 0;
    const colGap = mechStats ? 1 : 0;

    // Armor ticks sit past the right edge of the HP bar. GM/owners only.
    const canSeeArmor = game.user?.isGM || actor.isOwner;
    const armorVal = canSeeArmor ? Math.max(0, Math.min(8, actor.system?.armor ?? 0)) : 0;
    const armorTickW = 2;
    const armorTickGap = 1;
    const armorW = armorVal > 0
        ? armorVal * armorTickW + (armorVal - 1) * armorTickGap + 2
        : 0;
    const armorGap = armorVal > 0 ? colGap : 0;

    const rightColX = layoutOffsetX + pipColW + colGap;
    const rightColW = usableW - pipColW - colGap;

    const container = new PIXI.Container();
    container.name = 'la-stat-hub';
    container.position.set((token.w - width) / 2, startY);
    token.bars.addChild(container);

    const gfx = new PIXI.Graphics();
    container.addChild(gfx);

    gfx.lineStyle(0);
    // Reaction indicator (row 0). Skipped entirely for deployables.
    if (reactionEnabled) {
        const reactionAvailable = actor.system?.action_tracker?.reaction === true;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(0, 0, indicatorW, rowHeight);
        gfx.endFill();
        gfx.beginFill(reactionAvailable ? 0x9944cc : 0x333333, reactionAvailable ? 1 : 0.6);
        gfx.drawRect(1, 1, indicatorW - 2, rowHeight - 2);
        gfx.endFill();
    }

    rows.forEach((row, rowIdx) => {
        const y = rowIdx * (rowHeight + rowGap);
        const [leftDef, rightDef] = row;
        if (leftDef && visibleIds.has(leftDef.id)) {
            drawSegment(gfx, layoutOffsetX, y, pipColW, rowHeight, leftDef, leftDef.getValue(actor));
        }
        if (rightDef && visibleIds.has(rightDef.id)) {
            drawSegment(gfx, rightColX, y, rightColW, rowHeight, rightDef, rightDef.getValue(actor));
        }
    });

    // Armor ticks (HP row, right side).
    if (armorVal > 0 && visibleIds.has('hp')) {
        const armorX = rightColX + rightColW + armorGap;
        const innerH = rowHeight - 2;
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(armorX, 0, armorW, rowHeight);
        gfx.endFill();
        for (let i = 0; i < armorVal; i++) {
            const tx = armorX + 1 + i * (armorTickW + armorTickGap);
            gfx.beginFill(0xc8c8c8, 1);
            gfx.drawRect(tx, 1, armorTickW, innerH);
            gfx.endFill();
        }
    }

    // Overshield overlay on the HP row. Sized against the same effective max
    // the HP bar uses, so it grows with the bar when HP is over-cap.
    const osVal = actor.system?.overshield?.value ?? 0;
    const hpMax = getEffectiveMax(actor, 'hp');
    if (osVal > 0 && hpMax > 0 && visibleIds.has('hp')) {
        const osPct = Math.min(1, osVal / hpMax);
        const osW = Math.max(0, Math.floor((rightColW - 2) * osPct));
        const osX = rightColX + 1;
        const osY = 1;
        const osH = rowHeight - 2;

        const osGfx = new PIXI.Graphics();
        osGfx.name = 'la-overshield';
        container.addChild(osGfx);

        const c1 = 0x2244ee;
        const c2 = 0x1133ee;
        const r1 = (c1 >> 16) & 0xff, g1 = (c1 >> 8) & 0xff, b1 = c1 & 0xff;
        const r2 = (c2 >> 16) & 0xff, g2 = (c2 >> 8) & 0xff, b2 = c2 & 0xff;
        const periodMs = 2200;

        const tick = () => {
            if (osGfx.destroyed || !osGfx.parent) {
                canvas.app.ticker.remove(tick);
                return;
            }
            osGfx.clear();
            const phase = (performance.now() % periodMs) / periodMs;
            for (let i = 0; i < osW; i++) {
                const base = osW > 1 ? i / (osW - 1) : 0;
                let t = (base + phase) % 1;
                if (t > 0.5) {
                    t = 1 - t;
                }
                t *= 2;
                const r = Math.round(r1 + (r2 - r1) * t);
                const g = Math.round(g1 + (g2 - g1) * t);
                const b = Math.round(b1 + (b2 - b1) * t);
                osGfx.beginFill((r << 16) | (g << 8) | b, 0.75);
                osGfx.drawRect(osX + i, osY, 1, osH);
                osGfx.endFill();
            }
            // Right-edge terminator
            osGfx.beginFill(0x000000, 1);
            osGfx.drawRect(osX + osW - 1, osY, 1, osH);
            osGfx.endFill();
        };
        canvas.app.ticker.add(tick);
        tick();
    }

    // Burn/Infection stripes — pulse over the host bar at next-tick width.
    const drawCounterStripe = (rowIdx, def, hostId, direction) => {
        if (!visibleIds.has(hostId)) {
            return;
        }
        const counterV = def.getValue(actor);
        if ((counterV.value ?? 0) <= 0) {
            return;
        }
        const hostV = find(hostId).getValue(actor);
        const hostMax = hostV.max ?? 0;
        if (hostMax <= 0) {
            return;
        }
        const barX = rightColX + 1;
        const barW = rightColW - 2;
        const stripeY = rowIdx * (rowHeight + rowGap) + 1;
        const stripeH = rowHeight - 2;

        const fillPx = (Math.max(0, hostV.value ?? 0) / hostMax) * barW;
        const counterPx = Math.min(barW, (counterV.value / hostMax) * barW);

        let stripeX;
        let stripeW;
        if (direction === 'left') {
            stripeX = barX + Math.max(0, fillPx - counterPx);
            stripeW = Math.min(counterPx, fillPx);
        } else {
            stripeX = barX + fillPx;
            stripeW = Math.min(counterPx, barW - fillPx);
        }
        if (stripeW <= 0) {
            return;
        }

        const stripeGfx = new PIXI.Graphics();
        stripeGfx.name = `la-counter-${def.id}`;
        container.addChild(stripeGfx);
        stripeGfx.beginFill(def.color, 1);
        stripeGfx.drawRect(stripeX, stripeY, stripeW, stripeH);
        stripeGfx.endFill();

        // 1px black edge on the side facing away from the host fill.
        stripeGfx.beginFill(0x000000, 1);
        const delimX = direction === 'left' ? stripeX : stripeX + stripeW - 1;
        stripeGfx.drawRect(delimX, stripeY, 1, stripeH);
        stripeGfx.endFill();

        const periodMs = 900;
        const pulse = () => {
            if (!stripeGfx || stripeGfx.destroyed) {
                canvas.app.ticker.remove(pulse);
                return;
            }
            const t = (performance.now() % periodMs) / periodMs;
            stripeGfx.alpha = 0.45 + 0.55 * (0.5 - 0.5 * Math.cos(t * Math.PI * 2));
        };
        canvas.app.ticker.add(pulse);
    };
    drawCounterStripe(0, find('burn'), 'hp', 'left');
    drawCounterStripe(1, find('infection'), 'heat', 'right');

    // Heat decorations on their own Graphics so they layer above the stripe.
    // Only render when the actor has a real native heat max — synthetic max
    // (HP-scaled) gets a plain bar with no fill terminator or danger zone.
    if (visibleIds.has('heat') && (actor.system?.heat?.max ?? 0) > 0) {
        const heatBarX = rightColX + 1;
        const heatBarW = rightColW - 2;
        const heatRowY = rowHeight + rowGap;
        const heatV = find('heat').getValue(actor);
        const heatMax = heatV.max ?? 0;
        if (heatMax > 0) {
            const heatGfx = new PIXI.Graphics();
            heatGfx.name = 'la-heat-decorations';
            container.addChild(heatGfx);

            const heatPct = Math.max(0, Math.min(1, (heatV.value ?? 0) / heatMax));
            const fillW = heatBarW * heatPct;
            if (fillW > 0) {
                heatGfx.beginFill(0x000000, 1);
                heatGfx.drawRect(heatBarX + fillW - 1, heatRowY + 1, 1, rowHeight - 2);
                heatGfx.endFill();
            }
            // Danger Zone tick at 50%.
            const dangerX = heatBarX + heatBarW * 0.5;
            heatGfx.beginFill(0x882222, 0.8);
            heatGfx.drawRect(dangerX, heatRowY + 1, 1, rowHeight - 2);
            heatGfx.endFill();
        }
    }

    // Stash geometry so spawnFlash() can position overlays without recomputing.
    token._laBarsGeom = {
        layoutOffsetX,
        pipColW,
        rowHeight,
        rowGap,
        startY,
        visibleIds,
        indicatorW,
        rightColX,
        rightColW,
    };

    // Seed the snapshot once; updateActor owns all later writes.
    if (!_lastValues.has(token.id)) {
        _lastValues.set(token.id, snapshotValues(actor));
    }

    const totalHeight = rows.length * (rowHeight + rowGap) - rowGap;
    token.bars.visible = true;
    // Only zero alpha on the very first draw — otherwise a redraw mid-hover
    // would briefly hide bars that are already visible.
    if (token.bars.alpha === undefined || token._laFirstDraw !== false) {
        token.bars.alpha = 0;
        token._laFirstDraw = false;
    }
    token.bars.height = totalHeight;

    // fvtt-perf-optim freezes our bars by caching them as bitmap. Undo it.
    const tok = token;
    setTimeout(() => {
        if (tok.destroyed || !tok.bars) {
            return;
        }
        const undoCache = (node) => {
            if (node instanceof PIXI.Graphics && node.cacheAsBitmap) {
                node.cacheAsBitmap = false;
            }
            if (node.children) {
                node.children.forEach(undoCache);
            }
        };
        undoCache(tok.bars);
    }, 0);
}

// ---------------------------------------------------------------------------
// Token HUD injection
// ---------------------------------------------------------------------------

function hex(c) {
    return '#' + c.toString(16).padStart(6, '0');
}

function resourceCell({ name, value, color, title }) {
    const border = hex(color);
    return `<input type="text" name="${name}" value="${value}" title="${title}" class="la-hud-resource" style="width: 40%; height: 30px; font-size: 20px; margin: 2px; min-width: 40px; padding-inline: 1px; text-align: center; border: 1px solid ${border};" />`;
}

function injectLancerHud(hud, html, actor) {
    const sys = actor.system;
    const $html = $(html);

    const findDef = id => BAR_DEFS.find(d => d.id === id);
    const COLORS = {
        hp: findDef('hp')?.color ?? 0x66cc66,
        heat: findDef('heat')?.color ?? 0xff7733,
        structure: findDef('structure')?.color ?? 0xffaa33,
        stress: findDef('stress')?.color ?? 0xcc4488,
        overshield: 0x3366ff,
        burn: findDef('burn')?.color ?? 0xff5522,
        infection: findDef('infection')?.color ?? 0x1a8844,
        reaction: 0x9944cc,
    };

    const cell = (name, value, color, title) => resourceCell({ name, value, color, title });

    // 100px wide → 2 inputs per row at 40% + margins.
    const containerStyle = 'display: flex; flex-direction: row; flex-wrap: wrap; justify-content: center; align-items: center; width: 100px; height: fit-content;';

    // Top: Overshield, Infection, Burn.
    const topInner =
        cell('system.overshield.value', sys?.overshield?.value ?? 0, COLORS.overshield, 'Overshield') +
        cell('system.infection',         sys?.infection ?? 0,         COLORS.infection,  'Infection') +
        cell('system.burn',              sys?.burn ?? 0,              COLORS.burn,       'Burn');
    const topAttribute = `<div class="attribute la-hud-top" style="${containerStyle} position: absolute; top: 44px; transform: translateY(-100%); left: 50%; margin-left: -50px;">${topInner}</div>`;

    // Bottom: Structure / HP / Stress / Heat. Pilots & deployables drop the
    // mech-only structure and stress cells.
    const mechStats = hasMechStats(actor);
    const bottomInner =
        (mechStats ? cell('system.structure.value', sys?.structure?.value ?? 0, COLORS.structure, `Structure (max ${sys?.structure?.max ?? 0})`) : '') +
        cell('system.hp.value',        sys?.hp?.value ?? 0,        COLORS.hp,        `HP (max ${sys?.hp?.max ?? 0})`) +
        (mechStats ? cell('system.stress.value',    sys?.stress?.value ?? 0,    COLORS.stress,    `Stress (max ${sys?.stress?.max ?? 0})`) : '') +
        cell('system.heat.value',      sys?.heat?.value ?? 0,      COLORS.heat,      `Heat (max ${sys?.heat?.max ?? 0})`);
    const bottomAttribute = `<div class="attribute la-hud-bottom" style="${containerStyle} position: absolute; top: calc(100% - 44px); left: 50%; margin-left: -50px;">${bottomInner}</div>`;

    const middleCol = $html.find('.col.middle');
    // Drop vanilla bar1/bar2 fields, we replace them.
    middleCol.find('div.attribute').remove();
    middleCol.append(topAttribute);
    middleCol.append(bottomAttribute);

    // Left: Reaction box centered next to the icon column. Skipped for deployables.
    if (hasReaction(actor)) {
        const reactionVal = sys?.action_tracker?.reaction === true ? 1 : 0;
        const reactionInput = resourceCell({
            name: 'system.action_tracker.reaction',
            value: reactionVal,
            color: COLORS.reaction,
            title: 'Reaction (1 = available, 0 = used)',
        });
        const reactionBox = `<div class="attribute la-hud-reaction" style="position: absolute; right: 100%; top: 50%; transform: translateY(-50%); width: 50px; display: flex; justify-content: center;">${reactionInput}</div>`;
        $html.find('.col.left').prepend(reactionBox);
    }

    // Foundry's _onAttributeUpdate writes to the token doc; we target actor.system.* instead.
    const focusOutHandler = async (ev) => {
        ev.preventDefault();
        const input = ev.currentTarget;
        const name = input.name;
        const raw = input.value.trim();
        let value;
        if (name === 'system.action_tracker.reaction') {
            value = Number(raw) > 0;
        } else {
            const num = Number(raw);
            if (!Number.isFinite(num)) {
                return;
            }
            // Delta input: "+2" / "-3".
            if (raw.startsWith('+') || raw.startsWith('-')) {
                const cur = foundry.utils.getProperty(actor, name) ?? 0;
                value = cur + num;
            } else {
                value = num;
            }
        }
        await actor.update({ [name]: value });
        hud.clear();
    };

    $html.find('input.la-hud-resource')
        .on('click', (ev) => {
            /** @type {HTMLInputElement} */ (ev.currentTarget).select();
        })
        .on('keydown', (ev) => {
            if (ev.code === 'Enter' || ev.code === 'NumpadEnter') {
                ev.currentTarget.blur();
            }
        })
        .on('focusout', focusOutHandler);
}

// ---------------------------------------------------------------------------
// Settings registration
// ---------------------------------------------------------------------------

export function registerTokenStatBarSettings() {
    game.settings.register(MODULE_ID, SETTING_ENABLED, {
        name: 'Custom Token Stat Bars',
        hint: 'Replaces default token bars with my custom token bar , very similar to Bar Brawl but with my own personal tweaks. Disabled when Bar Brawl is active.',
        scope: 'world',
        config: true,
        type: Boolean,
        default: false,
        requiresReload: true,
    });
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

export function initTokenStatBar() {
    // Bar Brawl handles bars itself, don't double-up.
    if (game.modules.get('barbrawl')?.active) {
        console.log(`${MODULE_ID} | Bar Brawl detected — skipping custom token stat bar registration.`);
        return;
    }

    originalDrawBars = CONFIG.Token.objectClass.prototype.drawBars;

    if (game.modules.get('lib-wrapper')?.active) {
        // MIXED so we can short-circuit on Lancer actors and chain otherwise.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.objectClass.prototype.drawBars',
            function (wrapped, ...args) {
                if (isEnabled() && isLancerCombatant(this.actor)) {
                    return drawStatHub.call(this);
                }
                return wrapped(...args);
            }, 'MIXED');

        // Kill vanilla bar attribute lookups so they can't fight us with stale data.
        libWrapper.register(MODULE_ID, 'CONFIG.Token.documentClass.prototype.getBarAttribute',
            function (wrapped, ...args) {
                if (isEnabled() && isLancerCombatant(this.actor)) {
                    return null;
                }
                return wrapped(...args);
            }, 'MIXED');
    } else {
        const origDrawBars = CONFIG.Token.objectClass.prototype.drawBars;
        CONFIG.Token.objectClass.prototype.drawBars = function (...args) {
            if (isEnabled() && isLancerCombatant(this.actor)) {
                return drawStatHub.call(this);
            }
            return origDrawBars.call(this, ...args);
        };
        const origGetBarAttribute = CONFIG.Token.documentClass.prototype.getBarAttribute;
        CONFIG.Token.documentClass.prototype.getBarAttribute = function (...args) {
            if (isEnabled() && isLancerCombatant(this.actor)) {
                return null;
            }
            return origGetBarAttribute.call(this, ...args);
        };
    }

    // Spawn damage/heal flashes when watched values change.
    Hooks.on('updateActor', (actor, change) => {
        if (!isEnabled() || !isLancerCombatant(actor)) {
            return;
        }
        const watched = ['hp', 'structure', 'heat', 'stress', 'overshield', 'burn', 'infection', 'action_tracker'];
        const sysChange = change?.system;
        if (!sysChange) {
            return;
        }
        if (!watched.some(k => k in sysChange)) {
            return;
        }

        for (const tok of actor.getActiveTokens()) {
            const prev = _lastValues.get(tok.id) ?? {};
            const next = snapshotValues(actor);

            try {
                tok.drawBars();
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars on update failed`, e);
            }

            let flashed = false;
            const FLASH_BARS = ['hp', 'heat', 'structure', 'stress', 'overshield', 'burn', 'infection'];
            for (const id of FLASH_BARS) {
                if (prev[id] !== undefined && prev[id] !== next[id]) {
                    spawnFlash(tok, id, prev[id], next[id]);
                    flashed = true;
                }
            }
            // Only flash reaction when it gets spent, not on turn reset.
            if (prev.reaction === true && next.reaction === false) {
                spawnFlash(tok, 'reaction', 1, 0);
                flashed = true;
            }

            _lastValues.set(tok.id, next);

            if (flashed && tok.bars) {
                _flashingTokens.add(tok.id);
                tok.bars.alpha = 1;
                setTimeout(() => {
                    _flashingTokens.delete(tok.id);
                    if (tok?.destroyed) {
                        return;
                    }
                    if (!shouldShowBars(tok)) {
                        fadeBars(tok, 0);
                    }
                }, FLASH_TOTAL_MS + FLASH_LINGER_MS);
            }
        }
    });

    // Visibility follows hover/control/target.
    Hooks.on('refreshToken', (token) => {
        if (!isEnabled() || !isLancerCombatant(token?.actor)) {
            return;
        }
        if (!token.bars) {
            return;
        }
        if (token.bars.children.length === 0) {
            try {
                token.drawBars();
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars on refresh failed`, e);
            }
        }
        if (token.bars.children.length === 0) {
            return;
        }
        token.bars.visible = true;
        fadeBars(token, shouldShowBars(token) ? 1 : 0);

        // Nudge the nameplate below the hub when the bars are showing, and
        // snap it back to its native position when they fade out.
        const nameplate = token.nameplate;
        if (nameplate?.visible) {
            const hub = token.bars.children.find(c => c.name === 'la-stat-hub');
            const barsShown = hub && shouldShowBars(token);
            if (token._laBaseNameplateY === undefined) {
                token._laBaseNameplateY = nameplate.position.y;
            }
            if (barsShown) {
                const desiredY = hub.position.y + token.bars.height + 4;
                nameplate.position.y = Math.max(token._laBaseNameplateY, desiredY);
            } else {
                nameplate.position.y = token._laBaseNameplateY;
            }
        }
    });

    // Hold Alt to peek at all visible Lancer tokens.
    window.addEventListener('keydown', (ev) => {
        if (ev.key !== 'Alt' || _altHeld) {
            return;
        }
        _altHeld = true;
        refreshVisibleLancerTokens();
    });
    window.addEventListener('keyup', (ev) => {
        if (ev.key !== 'Alt' || !_altHeld) {
            return;
        }
        _altHeld = false;
        refreshVisibleLancerTokens();
    });
    window.addEventListener('blur', () => {
        if (!_altHeld) {
            return;
        }
        _altHeld = false;
        refreshVisibleLancerTokens();
    });

    // Sweep existing tokens. Needed because canvasReady may have already fired
    // by the time our ready hook runs (other modules await before us).
    const sweepLancerTokens = () => {
        if (!isEnabled()) {
            return;
        }
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            try {
                tok.drawBars();
            } catch (e) {
                console.warn(`${MODULE_ID} | drawBars sweep failed`, e);
            }
        }
    };
    if (canvas?.ready) {
        sweepLancerTokens();
    }
    Hooks.on('canvasReady', sweepLancerTokens);

    Hooks.on('drawToken', (token) => {
        if (!isEnabled() || !isLancerCombatant(token?.actor)) {
            return;
        }
        try {
            token.drawBars();
        } catch (e) {
            console.warn(`${MODULE_ID} | drawBars on drawToken failed`, e);
        }
    });

    // Force displayBars=NONE on new Lancer tokens so the token config sheet
    // matches what we actually render.
    Hooks.on('preCreateToken', (tokenDoc, data) => {
        if (!isEnabled()) {
            return;
        }
        const actor = tokenDoc.actor ?? game.actors?.get(data?.actorId);
        if (!isLancerCombatant(actor)) {
            return;
        }
        tokenDoc.updateSource({ displayBars: CONST.TOKEN_DISPLAY_MODES.NONE });
    });

    // Same fix for tokens placed before the setting was enabled.
    const sweepDisplayBars = async () => {
        if (!isEnabled() || !canvas?.scene || !game.user?.isGM) {
            return;
        }
        const updates = [];
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            if (tok.document.displayBars !== CONST.TOKEN_DISPLAY_MODES.NONE) {
                updates.push({
                    _id: tok.document.id,
                    displayBars: CONST.TOKEN_DISPLAY_MODES.NONE,
                });
            }
        }
        if (updates.length > 0) {
            try {
                await canvas.scene.updateEmbeddedDocuments('Token', updates);
            } catch (e) {
                console.warn(`${MODULE_ID} | sweep displayBars failed`, e);
            }
        }
    };
    if (canvas?.ready) {
        sweepDisplayBars();
    }
    Hooks.on('canvasReady', sweepDisplayBars);

    // Replace the contents of the Token Config Resources tab with our own
    // toggles when the stat bar is managing this token.
    Hooks.on('renderTokenConfig', (app, html) => {
        if (!isEnabled()) {
            return;
        }
        const tokenDoc = app.token ?? app.object;
        if (!isLancerCombatant(tokenDoc?.actor)) {
            return;
        }
        const root = html instanceof HTMLElement ? html : html?.[0];
        const tab = root?.querySelector?.('.tab[data-tab="resources"]');
        if (!tab) {
            return;
        }
        const hidden = statBarHidden(tokenDoc);
        const combatOnly = statBarCombatOnly(tokenDoc);
        const rowHeight = statBarRowHeight(tokenDoc);
        // Foundry's submit handler reads bar1/bar2 attribute fields off the
        // form. Preserve the document values via hidden inputs so saving the
        // sheet doesn't crash with "Cannot read properties of undefined".
        const bar1Attr = tokenDoc.bar1?.attribute ?? '';
        const bar2Attr = tokenDoc.bar2?.attribute ?? '';
        tab.innerHTML = `
            <input type="hidden" name="bar1.attribute" value="${bar1Attr}"/>
            <input type="hidden" name="bar2.attribute" value="${bar2Attr}"/>
            <p class="notes">Lancer Automations is managing this token's bars.</p>
            <div class="form-group">
                <label>Hide Stat Bar</label>
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_HIDDEN}" ${hidden ? 'checked' : ''}/>
                <p class="notes">Completely hide the stat bar hub for this token.</p>
            </div>
            <div class="form-group">
                <label>Show Only In Combat</label>
                <input type="checkbox" name="flags.${MODULE_ID}.${FLAG_COMBAT_ONLY}" ${combatOnly ? 'checked' : ''}/>
                <p class="notes">Only display the stat bar hub while this token is part of an active combat encounter.</p>
            </div>
            <div class="form-group">
                <label>Row Height (px)</label>
                <input type="number" min="0" step="1" name="flags.${MODULE_ID}.${FLAG_ROW_HEIGHT}" value="${rowHeight || ''}" placeholder="auto"/>
                <p class="notes">Override the height of each bar row, in pixels. Leave blank for the default (scales with grid size).</p>
            </div>
        `;
        if (typeof app.setPosition === 'function') {
            app.setPosition({ height: 'auto' });
        }
    });

    // Token flags drive visibility — re-evaluate when they change.
    Hooks.on('updateToken', (tokenDoc, change) => {
        if (!isEnabled()) {
            return;
        }
        if (!isLancerCombatant(tokenDoc?.actor)) {
            return;
        }
        if (!foundry.utils.hasProperty(change, `flags.${MODULE_ID}`)) {
            return;
        }
        const tok = tokenDoc.object;
        if (!tok) {
            return;
        }
        try {
            tok.drawBars();
        } catch (e) {
            console.warn(`${MODULE_ID} | drawBars on flag update failed`, e);
        }
        fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
    });

    // Combat-only toggle: refresh visibility on combat lifecycle changes.
    const refreshAllForCombat = () => {
        if (!isEnabled()) {
            return;
        }
        for (const tok of canvas.tokens?.placeables ?? []) {
            if (!isLancerCombatant(tok.actor)) {
                continue;
            }
            if (!statBarCombatOnly(tok.document)) {
                continue;
            }
            fadeBars(tok, shouldShowBars(tok) ? 1 : 0);
        }
    };
    Hooks.on('combatStart', refreshAllForCombat);
    Hooks.on('deleteCombat', refreshAllForCombat);
    Hooks.on('createCombatant', refreshAllForCombat);
    Hooks.on('deleteCombatant', refreshAllForCombat);

    Hooks.on('renderTokenHUD', (hud, html, _data) => {
        if (!isEnabled()) {
            return;
        }
        const actor = hud.object?.actor;
        if (!isLancerCombatant(actor)) {
            return;
        }
        injectLancerHud(hud, html, actor);
    });
}
