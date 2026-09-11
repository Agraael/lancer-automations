// Shared CRT shell: playTerminal + typeTerminalLines are reused by seasonal/annual.js.
import { playBattleLogSound, playBattleLogTheme } from '../tah/sound.js';
import { getModuleSetting } from '../tools/settings-utils.js';

const INTRO_SPEED = 1.7;

// How early the theme comes in ahead of the result reveal, when that anchor is picked.
const THEME_LEAD_MS = 500;

function _themeStart()
{
    return getModuleSetting('tah.battleLog.themeStart') || 'intro';
}

// Letters+digits only so per-frame scramble doesn't reflow the fixed-width slot.
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

const RAIL_SEGMENTS = 16;
// Stop following the typing once the reader has scrolled up past this.
const RAIL_STICK_PX = 80;
// Below this the content is treated as fitting, so no rail flicker mid-type.
const RAIL_MIN_OVERFLOW_PX = 24;

function _mountScroller(overlay)
{
    const scrollBox = overlay.querySelector('.battelog-intro-scroll');
    const body = overlay.querySelector('.battelog-intro-body');
    const rail = overlay.querySelector('.battelog-intro-rail');
    const segments = [];
    for (let index = 0; index < RAIL_SEGMENTS; index++)
    {
        const segment = document.createElement('span');
        if (index % 5 === 0)
            segment.classList.add('long');
        rail.appendChild(segment);
        segments.push(segment);
    }

    // Offset metrics ignore transforms, so pop-in scale animations can't
    // register as phantom overflow the way scrollHeight does.
    const layoutOverflow = () =>
    {
        let bottom = 0;
        for (const child of body.children)
        {
            const edge = child.offsetTop + child.offsetHeight;
            if (edge > bottom)
                bottom = edge;
        }
        return bottom - body.clientHeight;
    };

    const sync = () =>
    {
        const max = layoutOverflow();
        const scrollable = max > RAIL_MIN_OVERFLOW_PX;
        const top = body.scrollTop;

        rail.classList.toggle('on', scrollable);
        scrollBox.classList.toggle('more-up', scrollable && top > 4);
        scrollBox.classList.toggle('more-down', scrollable && top < max - 4);

        const lit = scrollable
            ? Math.max(0, Math.min(segments.length - 1, Math.round((top / max) * (segments.length - 1))))
            : -1;
        segments.forEach((segment, index) => segment.classList.toggle('lit', index === lit));
    };

    let pinned = true;
    const onScroll = () =>
    {
        pinned = layoutOverflow() - body.scrollTop < RAIL_STICK_PX;
        sync();
    };

    const follow = () =>
    {
        const max = layoutOverflow();
        if (max > 0 && pinned)
            body.scrollTop = max;
        sync();
    };

    body.addEventListener('scroll', onScroll, { passive: true });
    body.addEventListener('animationend', follow);

    const observer = new MutationObserver(follow);
    observer.observe(body, { childList: true, subtree: true, characterData: true });

    const resizeObserver = new ResizeObserver(follow);
    resizeObserver.observe(body);
    for (const child of body.children)
        resizeObserver.observe(child);
    const childWatcher = new MutationObserver(mutations =>
    {
        for (const mutation of mutations)
        {
            for (const node of Array.from(mutation.addedNodes))
            {
                if (node.nodeType === 1)
                    resizeObserver.observe(/** @type {any} */ (node));
            }
        }
    });
    childWatcher.observe(body, { childList: true, subtree: true });

    return {
        body,
        disconnect: () =>
        {
            observer.disconnect();
            childWatcher.disconnect();
            resizeObserver.disconnect();
        },
    };
}

function _lancerPauseIconSrc()
{
    try
    {
        const value = game.settings.get('lancer', 'pauseIcon');
        if (!value)
            return null;
        return `systems/lancer/assets/faction-logos/${value}.svg`;
    }
    catch
    {
        return null;
    }
}

/**
 * @param {object} opts
 * @param {string} [opts.color]
 * @param {string} [opts.textColor]
 * @param {'VICTORY'|'DEFEAT'|'PARTIAL'|null} [opts.theme]
 * @param {number} [opts.speed]
 * @param {boolean} [opts.dismissOnClick]
 * @param {object} [opts.dress]
 * @param {string} [opts.header]
 * @param {string[]} [opts.extraClasses]
 * @param {(overlay: any, ctx: {finish: () => void, speed: number, body: any}) => {cancel: () => void, skip?: () => void}} opts.run
 * @returns {Promise<void>}
 */
export function playTerminal({
    color = '#2e7d32',
    textColor = '#ffaa00',
    theme = null,
    speed = INTRO_SPEED,
    dismissOnClick = true,
    dress = {},
    header = '',
    extraClasses = [],
    run,
} = /** @type {any} */ ({}))
{
    return new Promise(resolve =>
    {
        const emblemSrc = _lancerPauseIconSrc();

        const preamble = document.createElement('div');
        preamble.className = 'battelog-intro-preamble';
        preamble.innerHTML = _preambleHtml(color);
        document.body.appendChild(preamble);

        playBattleLogSound('incomingTrans');
        let bgSound = { stop: () =>
        {} };
        let bgTimer = /** @type {any} */ (null);

        let done = false;
        let controller = /** @type {{cancel: () => void, skip?: () => void}} */ ({ cancel: () =>
        {} });
        let overlay = null;
        let scroller = null;

        const finish = () =>
        {
            if (done)
                return;
            done = true;
            clearTimeout(bgTimer);
            clearTimeout(swapTimer);
            bgSound.stop();
            controller.cancel();
            scroller?.disconnect();
            playBattleLogSound('fadeOut');
            if (preamble.isConnected)
            {
                preamble.remove();
                resolve();
                return;
            }
            const crt = overlay?.querySelector('.battelog-intro-crt');
            if (crt)
                crt.classList.add('battelog-intro-crt-off');
            const offFlash = document.createElement('div');
            offFlash.className = 'battelog-intro-crt-flash off';
            overlay?.appendChild(offFlash);
            setTimeout(() =>
            {
                overlay?.remove();
                resolve();
            }, 500);
        };
        const swapTimer = setTimeout(() =>
        {
            playBattleLogSound('fadeIn');
            if (theme && _themeStart() === 'intro')
                playBattleLogTheme(theme);
            bgTimer = setTimeout(() =>
            {
                bgSound = playBattleLogSound('loopBackground', { loop: true });
            }, 350);
            overlay = document.createElement('div');
            overlay.className = ['battelog-intro-terminal', ...(dismissOnClick ? [] : ['no-dismiss']), ...extraClasses].join(' ');
            overlay.style.setProperty('--terminal-accent', color);
            overlay.style.setProperty('--terminal-text', textColor);
            overlay.innerHTML = `
                <div class="battelog-intro-crt-flash"></div>
                <div class="battelog-intro-crt-noise"></div>
                <div class="battelog-intro-crt">
                    <div class="battelog-intro-scan"></div>
                    ${_dressingHtml(color, dress)}
                    <div class="battelog-intro-inner">
                        ${emblemSrc ? `<img class="battelog-intro-emblem" src="${emblemSrc}" alt=""/>` : ''}
                        ${header ? `<div class="battelog-intro-head">${_escape(header)}</div>` : ''}
                        <div class="battelog-intro-scroll">
                            <div class="battelog-intro-body"></div>
                            <div class="battelog-intro-edge top"></div>
                            <div class="battelog-intro-edge bot"></div>
                            <div class="battelog-intro-rail" aria-hidden="true"></div>
                        </div>
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            scroller = _mountScroller(overlay);
            preamble.remove();
            overlay.addEventListener('click', () => controller.skip?.());
            if (dismissOnClick)
            {
                overlay.addEventListener('contextmenu', (/** @type {any} */ ev) =>
                {
                    ev.preventDefault();
                    finish();
                });
            }
            controller = run(overlay, { finish, speed, body: scroller.body });
        }, 2600 / speed);
    });
}

/**
 * @param {object} opts
 * @param {'VICTORY'|'DEFEAT'} [opts.outcome]
 * @param {object} [opts.battle]
 * @param {string|null} [opts.mvpId]
 * @param {Array<{label:string, result:string}>} [opts.extraLines]
 * @param {number} [opts.speed]
 * @returns {Promise<void>}
 */
export function playTerminalIntro({ outcome = 'VICTORY', battle = {}, mvpId = null, extraLines = [], speed = INTRO_SPEED } = {})
{
    const tone = outcome === 'VICTORY' ? 'win' : outcome === 'DEFEAT' ? 'lose' : 'partial';
    const color = tone === 'win' ? '#2e7d32' : tone === 'lose' ? '#c62828' : '#c68f0a';
    const rounds = battle?.mission?.rounds ?? 0;
    return playTerminal({
        color,
        theme: outcome,
        speed,
        header: 'LANCER // BATTLE LOG ANALYSIS',
        dress: { readout: ['GRID 07-Δ', 'LAT 62.4°N', 'LON 129.7°E', `RND ${_escape(rounds)}`] },
        run: (overlay, { finish, body }) => _run(overlay, { outcome, battle, mvpId, extraLines, speed, onDone: finish, body }),
    });
}

/**
 * Big scrambled verdict word with subtitle and screen flash, shared by every terminal ending.
 * @param {any} pane
 * @param {object} opts
 * @param {'win'|'lose'|'partial'} opts.tone
 * @param {string} opts.word
 * @param {string} opts.subtitle
 * @param {string} [opts.label]
 * @param {Function} opts.later
 * @param {Function} opts.interval
 */
export function revealVerdict(pane, { tone, word, subtitle, label = 'RESULT >>', later, interval })
{
    const bar = '═'.repeat(60);
    const wrap = document.createElement('div');
    wrap.className = 'battelog-intro-final-wrap';
    wrap.innerHTML = `
        <div class="battelog-intro-hr">${bar}</div>
        <div class="battelog-intro-final">
            <span class="battelog-intro-final-label">${_escape(label)}</span>
            <span class="battelog-intro-final-nowrap">
                <span class="battelog-intro-final-word ${tone}" data-text="${_escape(word)}">${_escape(word)}</span>
                <span class="battelog-intro-final-caret">▊</span>
            </span>
        </div>
        <div class="battelog-intro-final-subtitle ${tone}">${_escape(subtitle)}</div>
        <div class="battelog-intro-hr">${bar}</div>
    `;
    pane.appendChild(wrap);
    pane.closest('.battelog-intro-terminal')?.classList.add('battelog-flash-' + tone);

    const wordEl = /** @type {any} */ (wrap.querySelector('.battelog-intro-final-word'));
    // Lock width so per-frame char swaps don't reflow the caret. No overflow:hidden (would clip glow).
    wordEl.style.width = wordEl.offsetWidth + 'px';
    wordEl.style.textAlign = 'left';
    wordEl.style.whiteSpace = 'nowrap';
    wordEl.classList.add('on');
    const startedAt = Date.now();
    const scrambleId = interval(() =>
    {
        const progress = Math.min(1, (Date.now() - startedAt) / 750);
        const reveal = progress * word.length;
        let scrambled = '';
        for (let idx = 0; idx < word.length; idx++)
        {
            if (word[idx] === ' ')
            {
                scrambled += ' ';
                continue;
            }
            scrambled += idx < reveal ? word[idx] : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        }
        wordEl.textContent = scrambled;
        wordEl.dataset.text = scrambled;
        if (progress >= 1)
        {
            wordEl.textContent = word;
            wordEl.dataset.text = word;
            clearInterval(scrambleId);
        }
    }, 45);
    later(() => wordEl.classList.remove('on'), 850);
    return wrap;
}

export function dottedRow(text, column = 42)
{
    const head = '> ' + text;
    return head + ' ' + '.'.repeat(Math.max(1, column - head.length - 1));
}

export function horusText(text)
{
    return `<s class="horus--subtle battelog-horus">${_escape(text)}</s>`;
}

/** @param {string} color */
function _preambleHtml(color)
{
    return `
        <div class="battelog-intro-preamble-inner">
            <div class="battelog-intro-preamble-row">
                <span class="battelog-intro-preamble-dot" style="background:${color};box-shadow:0 0 10px ${color};"></span>
                <span class="battelog-intro-preamble-title">INCOMING TRANSMISSION</span>
            </div>
            <span class="battelog-intro-preamble-sub battelog-intro-preamble-dots">ESTABLISHING SECURE UPLINK</span>
            <div class="battelog-intro-preamble-track">
                <div class="battelog-intro-preamble-track-fill" style="background:linear-gradient(90deg, transparent, ${color}, transparent);"></div>
            </div>
        </div>
    `;
}

function _run(overlay, { outcome, battle, mvpId, extraLines = [], speed, onDone, body })
{
    const battleData = battle ?? {};
    const tone = outcome === 'VICTORY' ? 'win' : outcome === 'DEFEAT' ? 'lose' : 'partial';
    const players = battleData?.players ?? [];
    const hostiles = battleData?.hostiles ?? [];
    const rounds = battleData?.mission?.rounds ?? 0;
    const squad = (battleData?.mission?.squadStatus ?? '').replace(' / ', '/');
    const squadRatio = squad.split(' ')[0];

    const totalKills = players.reduce((a, player) => a + (player.kills ?? 0), 0);
    // General efficiency: avg of each pilot's accuracy and HASE save rate; accuracy-only if the pilot has no HASE saves.
    const perPilotEfficiency = players.map(player =>
    {
        const acc = player.accuracy ?? 0;
        const hase = player.bd?.hase?.total?.rate ?? null;
        return hase != null ? (acc + hase) / 2 : acc;
    });
    const avgEff = perPilotEfficiency.length
        ? Math.round(perPilotEfficiency.reduce((a, b) => a + b, 0) / perPilotEfficiency.length)
        : 0;
    // HP: current HP + remaining structure lives, over the full mech pool (hpMax * structMax).
    const hpSumEnd = players.reduce((a, player) => a + (player.effectiveHpEnd ?? player.hpEnd ?? 0), 0);
    const hpSumMax = players.reduce((a, player) => a + (player.effectiveHpMax ?? (player.hpMax ?? 0) * (player.structMax ?? 1)), 0);
    const hullPct = hpSumMax > 0 ? Math.round((hpSumEnd / hpSumMax) * 100) : 0;
    // Reactor: 100 % when no heat has been consumed anywhere; drops as heat + reactor breaches accumulate.
    const heatConsumed = players.reduce((a, player) => a + (player.heatConsumedEnd ?? 0), 0);
    const heatCapacity = players.reduce((a, player) => a + (player.heatCapacityMax ?? (player.heatMax ?? 0) * (player.stressMax ?? 1)), 0);
    const reactorPct = heatCapacity > 0 ? Math.max(0, Math.round((1 - heatConsumed / heatCapacity) * 100)) : 100;
    const mvpPlayer = mvpId ? players.find(player => player.id === mvpId) ?? null : null;

    const lines = [
        { label: '> parsing battlefield telemetry ..........', result: 'OK' },
        { label: '> reconstructing engagement timeline .....', result: rounds + ' ROUNDS' },
        { label: '> hostiles encountered ...................', result: hostiles.length + ' CONTACTS' },
        {
            label: '> tallying confirmed kills ...............',
            result: String(totalKills),
            resultHtml: String(totalKills) + ' <span class="battelog-icon-mask battelog-icon-destroyed battelog-intro-result-icon kills"></span>',
        },
        {
            label: '> squad general efficiency ...............',
            result: avgEff + '% AVG',
            resultHtml: avgEff + '% <i class="fas fa-crosshairs battelog-intro-result-icon accuracy"></i>',
        },
        {
            label: '> structural integrity ...................',
            result: hullPct + '% HP / ' + reactorPct + '% HEAT',
            resultHtml: hullPct + '% <i class="fas fa-heart-pulse battelog-intro-result-icon hp"></i>'
                + ' / ' + reactorPct + '% <i class="fas fa-thermometer-half battelog-intro-result-icon heat"></i>',
            sfx: 'long',
        },
        {
            label: '> squad integrity check ..................',
            result: squad,
            resultHtml: squadRatio + ' <i class="cci cci-frame battelog-intro-result-icon squad"></i>',
            sfx: 'long',
        },
        mvpPlayer ? { label: '> designating match MVP ..................', result: mvpPlayer.callsign, sfx: 'short' } : null,
        { label: '> computing engagement result ............', result: null },
    ].filter(Boolean);

    if (extraLines.length > 0)
    {
        const LABEL_COL = 42;
        const formatted = extraLines
            .filter(row => (row?.label ?? '').trim() || (row?.result ?? '').trim())
            .map(row =>
            {
                const head = '> ' + String(row.label ?? '').trim().toLowerCase();
                const dots = Math.max(1, LABEL_COL - head.length - 1);
                return {
                    label: `${head} ${'.'.repeat(dots)}`,
                    result: String(row.result ?? '').trim().toUpperCase() || 'OK',
                };
            });
        lines.splice(-1, 0, ...formatted);
    }

    if (players.length > 0)
    {
        const chips = players.map(player =>
            `<span class="battelog-mechs-deployed-chip">${_escape(player.callsign)}</span>`,
        ).join('');
        const deployed = document.createElement('div');
        deployed.className = 'battelog-mechs-deployed';
        deployed.innerHTML = `<span class="battelog-mechs-deployed-label">◇ MECHS DEPLOYED</span>${chips}`;
        body.appendChild(deployed);
    }

    const revealFinal = ({ later, interval }) =>
    {
        const word = { win: 'SUCCESS', lose: 'FAILURE', partial: 'PARTIAL' }[tone];
        const subtitle = {
            win: 'ENGAGEMENT WON : ALL OBJECTIVES SECURED',
            lose: 'ENGAGEMENT LOST : TACTICAL WITHDRAWAL',
            partial: 'ENGAGEMENT INCONCLUSIVE : PARTIAL OBJECTIVES',
        }[tone];
        revealVerdict(body, { tone, word, subtitle, later, interval });

        playBattleLogSound(/** @type {any} */ ({ win: 'resultImpactGood', lose: 'resultImpactBad', partial: 'resultImpact' }[tone]));

        const hint = document.createElement('div');
        hint.className = 'battelog-intro-hint';
        hint.innerHTML = '<i class="fas fa-satellite-dish"></i>Compiling battle log report, right click to continue';
        body.appendChild(hint);

        later(onDone, 3600);
    };

    return typeTerminalLines(body, lines, {
        speed,
        onLastLineTyped: ({ line, later }) =>
        {
            if (_themeStart() !== 'result')
                return;
            const toReveal = line.result ? 1120 / speed : 500 / speed;
            later(() => playBattleLogTheme(outcome), Math.max(0, toReveal - THEME_LEAD_MS));
        },
        onDone: revealFinal,
    });
}

/**
 * @param {any} inner
 * @param {any[]} lines
 * @param {object} [opts]
 * @param {number} [opts.speed]
 * @param {(ctx: {later: Function, interval: Function}) => void} [opts.onDone]
 * @param {(ctx: {line: any, later: Function}) => void} [opts.onLastLineTyped]
 * @returns {{cancel: () => void, skip: () => void}}
 */
export function typeTerminalLines(inner, lines, { speed = INTRO_SPEED, onDone, onLastLineTyped } = {})
{
    const lineEls = [];

    let cur = 0;
    let charIdx = 0;
    let cancelled = false;
    // Collapses the current line's delays, cleared once it is done.
    let rush = false;
    let typingSound = { stop: () =>
    {} };
    const timers = new Set();
    const intervals = new Set();
    const later = (fn, ms) =>
    {
        const id = setTimeout(() =>
        {
            timers.delete(id); if (!cancelled)
                fn();
        }, ms);
        timers.add(id);
        return id;
    };
    const interval = (fn, ms) =>
    {
        const id = setInterval(() =>
        {
            if (cancelled)
            {
                clearInterval(id); intervals.delete(id); return;
            } fn();
        }, ms);
        intervals.add(id);
        return id;
    };

    // The typing chain schedules through step so skip() can fire the pending hop early.
    let stepId = null;
    let stepFn = null;
    const step = (fn, ms) =>
    {
        stepFn = fn;
        stepId = later(() =>
        {
            stepId = null;
            stepFn = null;
            fn();
        }, rush ? 0 : ms);
    };

    const skip = () =>
    {
        if (cancelled || stepId == null)
            return;
        rush = true;
        clearTimeout(stepId);
        timers.delete(stepId);
        stepId = null;
        const fn = stepFn;
        stepFn = null;
        fn();
    };

    const keyDelay = (ch) =>
    {
        const base = Math.max(8, 1000 / (46 * speed));
        let delay = base * (0.45 + Math.random() * 1.2);
        if (ch === ' ')
            delay += base * 0.6;
        if (ch === '.')
            delay = base * (0.12 + Math.random() * 0.4);
        if (Math.random() < 0.05)
            delay += base * (2 + Math.random() * 3);
        return delay;
    };

    const ensureLineEl = () =>
    {
        if (lineEls[cur])
            return;
        const line = lines[cur];
        const el = document.createElement('div');
        el.className = 'battelog-intro-line' + (line.head ? ' head' : '') + (line.cls ? ' ' + line.cls : '');
        el.innerHTML = '<span class="battelog-intro-label"></span>';
        inner.appendChild(el);
        lineEls[cur] = el;
    };

    const labelParts = (line) => line.parts ?? [line.label ?? ''];

    const labelPlain = (line) => labelParts(line).map(part => (typeof part === 'string' ? part : part.text)).join('');

    const setLabelText = (lineIdx, count, showCaret) =>
    {
        const el = lineEls[lineIdx];
        if (!el)
            return;
        let left = count;
        let html = '';
        for (const part of labelParts(lines[lineIdx]))
        {
            if (left <= 0)
                break;
            const text = typeof part === 'string' ? part : part.text;
            const slice = _escape(text.slice(0, left));
            html += typeof part === 'string' ? slice : `<span class="${part.cls}">${slice}</span>`;
            left -= text.length;
        }
        const labelSpan = el.querySelector('.battelog-intro-label');
        labelSpan.innerHTML = html + (showCaret ? '<span class="battelog-intro-caret">▊</span>' : '');
    };

    const appendResult = (lineIdx, txt, html = false) =>
    {
        const el = lineEls[lineIdx];
        if (!el)
            return;
        const resultSpan = document.createElement('span');
        resultSpan.className = 'battelog-intro-result';
        if (html)
            resultSpan.innerHTML = txt;
        else
            resultSpan.textContent = txt;
        el.appendChild(resultSpan);
    };

    const typeChar = () =>
    {
        if (cancelled)
            return;
        ensureLineEl();
        const line = lines[cur];
        const text = labelPlain(line);

        if (line.head)
        {
            setLabelText(cur, text.length, false);
            line.render?.(inner);
            step(afterLine, 360 / speed);
            return;
        }

        if (!rush && charIdx < text.length)
        {
            if (charIdx === 0)
            {
                typingSound.stop();
                typingSound = playBattleLogSound('typingLoop', { loop: true });
            }
            const ch = text[charIdx];
            charIdx++;
            setLabelText(cur, charIdx, true);
            step(typeChar, keyDelay(ch));
        }
        else
        {
            charIdx = text.length;
            setLabelText(cur, text.length, false);
            typingSound.stop();
            if (cur >= lines.length - 1)
                onLastLineTyped?.({ line, later });
            if (line.result)
            {
                step(() =>
                {
                    appendResult(cur, line.resultHtml ?? line.result, !!line.resultHtml);
                    const isLong = line.sfx ? line.sfx === 'long' : /\s/.test(String(line.result).trim());
                    playBattleLogSound(isLong ? 'longResult' : 'shortResult');
                    step(afterLine, 520 / speed);
                }, 600 / speed);
            }
            else
                step(afterLine, (line.pause ?? 500) / speed);
        }
    };

    const afterLine = () =>
    {
        if (cancelled)
            return;
        rush = false;
        if (cur >= lines.length - 1)
        {
            typingSound.stop();
            onDone?.({ later, interval });
            return;
        }
        cur++;
        charIdx = 0;
        step(typeChar, 240 / speed);
    };

    step(typeChar, 820);

    return {
        skip,
        cancel: () =>
        {
            cancelled = true;
            typingSound.stop();
            for (const id of timers)
                clearTimeout(id);
            for (const id of intervals)
                clearInterval(id);
            timers.clear();
            intervals.clear();
        },
    };
}

const _escape = str => String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;');

function _dressingHtml(color, {
    channel = 'SECURE CHANNEL',
    node = 'NODE 07-Δ',
    readout = [],
    ticker = '◇ TELEMETRY UPLINK STABLE   ◇ DECRYPTING COMBAT LEDGER   ◇ PILOT TRANSPONDERS SYNCED   ◇ NHP CORE NOMINAL   ◇ COMPILING BATTLE LOG REPORT   ',
} = {})
{
    // Each child must exceed viewport width for a seamless -50% translate loop (~7px/char at fs 9px + ls 1.5px).
    const singleCopy = ticker;
    const copyPx = singleCopy.length * 7;
    const copies = Math.max(2, Math.ceil((window.innerWidth * 1.25) / copyPx));
    const tickerPayload = singleCopy.repeat(copies);
    // Scale duration with copies to hold ~67 px/s scroll speed regardless of copy count.
    const tickerDurationS = Math.round((copies * copyPx) / 67);
    const eqBars = [0, 1, 2, 3, 4].map(i =>
        `<span class="battelog-dress-eq" style="background:${color};animation-delay:${i * 0.12}s;"></span>`,
    ).join('');
    const ticks = Array.from({ length: 11 }).map((_, i) =>
        `<span class="battelog-dress-tick${i % 5 === 0 ? ' long' : ''}"></span>`,
    ).join('');
    return `
        <div class="battelog-dress">
            <div class="battelog-dress-corner tl"></div>
            <div class="battelog-dress-corner tr"></div>
            <div class="battelog-dress-corner bl"></div>
            <div class="battelog-dress-corner br"></div>
            <div class="battelog-dress-inner-frame"></div>

            <div class="battelog-dress-topbar">
                <span class="battelog-dress-brand">
                    <span class="battelog-dress-dot" style="border-color:${color};box-shadow:0 0 8px color-mix(in srgb,${color} 60%,transparent);">
                        <span style="background:${color};"></span>
                    </span>
                    LANCER//NET
                </span>
                <span class="battelog-dress-sep">│</span>
                <span>${_escape(channel)}</span>
                <span class="battelog-dress-sep">│</span>
                <span>${_escape(node)}</span>
                <span class="battelog-dress-spacer"></span>
                <span class="battelog-dress-eqrow">${eqBars}</span>
                <span class="battelog-dress-sep">│</span>
                <span class="battelog-dress-rec">
                    <span class="battelog-dress-recdot"></span>REC
                </span>
            </div>

            <div class="battelog-dress-tickrail">${ticks}</div>

            <div class="battelog-dress-readout">
                ${readout.map(row => `<div>${_escape(row)}</div>`).join('')}
            </div>

            <div class="battelog-dress-vscan" style="background:linear-gradient(90deg, transparent, color-mix(in srgb,${color} 55%,transparent), transparent);"></div>

            <div class="battelog-dress-ticker">
                <div class="battelog-dress-ticker-inner" style="animation-duration:${tickerDurationS}s;">
                    <span>${tickerPayload}</span>
                    <span>${tickerPayload}</span>
                </div>
            </div>
        </div>
    `;
}
