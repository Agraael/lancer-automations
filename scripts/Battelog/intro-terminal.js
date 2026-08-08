import { playBattleLogSound, playBattleLogTheme } from '../tah/sound.js';

const INTRO_SPEED = 1.95;

// Letters+digits only so per-frame scramble doesn't reflow the fixed-width slot.
const SCRAMBLE_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

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
 * @param {'VICTORY'|'DEFEAT'} [opts.outcome]
 * @param {object} [opts.battle]
 * @param {string|null} [opts.mvpId]
 * @param {Array<{label:string, result:string}>} [opts.extraLines]
 * @param {number} [opts.speed]
 * @returns {Promise<void>}
 */
export function playTerminalIntro({ outcome = 'VICTORY', battle = {}, mvpId = null, extraLines = [], speed = INTRO_SPEED } = {})
{
    return new Promise(resolve =>
    {
        const tone = outcome === 'VICTORY' ? 'win' : outcome === 'DEFEAT' ? 'lose' : 'partial';
        const color = tone === 'win' ? '#2e7d32' : tone === 'lose' ? '#c62828' : '#c68f0a';
        const rounds = battle?.mission?.rounds ?? 0;
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
        let controller = { cancel: () =>
        {} };
        let overlay = null;

        const finish = () =>
        {
            if (done)
                return;
            done = true;
            clearTimeout(bgTimer);
            clearTimeout(swapTimer);
            bgSound.stop();
            controller.cancel();
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
            playBattleLogTheme(outcome);
            bgTimer = setTimeout(() =>
            {
                bgSound = playBattleLogSound('loopBackground', { loop: true });
            }, 350);
            overlay = document.createElement('div');
            overlay.className = 'battelog-intro-terminal';
            overlay.innerHTML = `
                <div class="battelog-intro-crt-flash"></div>
                <div class="battelog-intro-crt-noise"></div>
                <div class="battelog-intro-crt">
                    <div class="battelog-intro-scan"></div>
                    ${_dressingHtml(color, rounds)}
                    <div class="battelog-intro-inner">
                        ${emblemSrc ? `<img class="battelog-intro-emblem" src="${emblemSrc}" alt=""/>` : ''}
                    </div>
                </div>
            `;
            document.body.appendChild(overlay);
            preamble.remove();
            overlay.addEventListener('click', finish);
            controller = _run(overlay, { outcome, battle, mvpId, extraLines, speed, onDone: finish });
        }, 2600 / speed);
    });
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

function _run(overlay, { outcome, battle, mvpId, extraLines = [], speed, onDone })
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
        { label: 'LANCER // BATTLE LOG ANALYSIS', head: true },
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

    const inner = overlay.querySelector('.battelog-intro-inner');
    const lineEls = [];

    let cur = 0;
    let charIdx = 0;
    let cancelled = false;
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
        const el = document.createElement('div');
        el.className = 'battelog-intro-line' + (lines[cur].head ? ' head' : '');
        // Caret inside the label span so it sits flush with the text.
        el.innerHTML = '<span class="battelog-intro-label"></span>';
        inner.appendChild(el);
        lineEls[cur] = el;
    };

    const setLabelText = (lineIdx, txt, showCaret) =>
    {
        const el = lineEls[lineIdx];
        if (!el)
            return;
        const labelSpan = el.querySelector('.battelog-intro-label');
        labelSpan.innerHTML = _escape(txt) + (showCaret ? '<span class="battelog-intro-caret">▊</span>' : '');
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

        if (line.head)
        {
            setLabelText(cur, line.label, false);
            if (players.length > 0)
            {
                const chips = players.map(player =>
                    `<span class="battelog-mechs-deployed-chip">${_escape(player.callsign)}</span>`,
                ).join('');
                const row = document.createElement('div');
                row.className = 'battelog-mechs-deployed';
                row.innerHTML = `<span class="battelog-mechs-deployed-label">◇ MECHS DEPLOYED</span>${chips}`;
                inner.appendChild(row);
            }
            later(afterLine, 360 / speed);
            return;
        }

        if (charIdx < line.label.length)
        {
            if (charIdx === 0)
                typingSound = playBattleLogSound('typingLoop', { loop: true });
            const ch = line.label[charIdx];
            charIdx++;
            setLabelText(cur, line.label.slice(0, charIdx), true);
            later(typeChar, keyDelay(ch));
        }
        else
        {
            setLabelText(cur, line.label, false);
            typingSound.stop();
            if (line.result)
            {
                later(() =>
                {
                    if (cancelled)
                        return;
                    appendResult(cur, line.resultHtml ?? line.result, !!line.resultHtml);
                    // Whitespace in result means multiple tokens, which get the longer sfx.
                    const isLong = line.sfx ? line.sfx === 'long' : /\s/.test(String(line.result).trim());
                    playBattleLogSound(isLong ? 'longResult' : 'shortResult');
                    later(afterLine, 520 / speed);
                }, 600 / speed);
            }
            else
                later(afterLine, 500 / speed);
        }
    };

    const afterLine = () =>
    {
        if (cancelled)
            return;
        if (cur >= lines.length - 1)
        {
            revealFinal();
            return;
        }
        cur++;
        charIdx = 0;
        later(typeChar, 240 / speed);
    };

    const revealFinal = () =>
    {
        if (cancelled)
            return;
        const word = { win: 'SUCCESS', lose: 'FAILURE', partial: 'PARTIAL' }[tone];
        const subtitle = {
            win: 'ENGAGEMENT WON : ALL OBJECTIVES SECURED',
            lose: 'ENGAGEMENT LOST : TACTICAL WITHDRAWAL',
            partial: 'ENGAGEMENT INCONCLUSIVE : PARTIAL OBJECTIVES',
        }[tone];
        const wrap = document.createElement('div');
        wrap.className = 'battelog-intro-final-wrap';
        const bar = '═'.repeat(60);
        wrap.innerHTML = `
            <div class="battelog-intro-hr">${bar}</div>
            <div class="battelog-intro-final">
                <span class="battelog-intro-final-label">RESULT &gt;&gt;</span>
                <span class="battelog-intro-final-nowrap">
                    <span class="battelog-intro-final-word ${tone}" data-text="${word}">${word}</span>
                    <span class="battelog-intro-final-caret">▊</span>
                </span>
            </div>
            <div class="battelog-intro-final-subtitle ${tone}">${subtitle}</div>
            <div class="battelog-intro-hr">${bar}</div>
        `;
        inner.appendChild(wrap);

        playBattleLogSound(/** @type {any} */ ({ win: 'resultImpactGood', lose: 'resultImpactBad', partial: 'resultImpact' }[tone]));

        overlay.classList.add('battelog-flash-' + tone);

        const wordEl = /** @type {HTMLElement} */ (wrap.querySelector('.battelog-intro-final-word'));
        // Lock width so per-frame char swaps don't reflow the caret. No overflow:hidden (would clip glow).
        const naturalWidth = wordEl.offsetWidth;
        wordEl.style.width = naturalWidth + 'px';
        wordEl.style.textAlign = 'left';
        wordEl.style.whiteSpace = 'nowrap';
        wordEl.classList.add('on');
        const start = Date.now();
        const dur = 750;
        const id = interval(() =>
        {
            const progress = Math.min(1, (Date.now() - start) / dur);
            const reveal = progress * word.length;
            let scrambled = '';
            for (let i = 0; i < word.length; i++)
            {
                if (word[i] === ' ')
                {
                    scrambled += ' '; continue;
                }
                scrambled += i < reveal ? word[i] : SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
            }
            wordEl.textContent = scrambled;
            wordEl.dataset.text = scrambled;
            if (progress >= 1)
            {
                wordEl.textContent = word;
                wordEl.dataset.text = word;
                clearInterval(id);
                intervals.delete(id);
            }
        }, 45);
        later(() =>
        {
            wordEl.classList.remove('on');
        }, 850);

        const hint = document.createElement('div');
        hint.className = 'battelog-intro-hint';
        hint.innerHTML = '<i class="fas fa-satellite-dish"></i>Compiling battle log report, click to continue';
        inner.appendChild(hint);

        later(onDone, 3600);
    };

    later(typeChar, 820);

    return {
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

function _dressingHtml(color, rounds)
{
    // Each child must exceed viewport width for a seamless -50% translate loop (~7px/char at fs 9px + ls 1.5px).
    const singleCopy = '◇ TELEMETRY UPLINK STABLE   ◇ DECRYPTING COMBAT LEDGER   ◇ PILOT TRANSPONDERS SYNCED   ◇ NHP CORE NOMINAL   ◇ COMPILING BATTLE LOG REPORT   ';
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
                <span>SECURE CHANNEL</span>
                <span class="battelog-dress-sep">│</span>
                <span>NODE 07-Δ</span>
                <span class="battelog-dress-spacer"></span>
                <span class="battelog-dress-eqrow">${eqBars}</span>
                <span class="battelog-dress-sep">│</span>
                <span class="battelog-dress-rec">
                    <span class="battelog-dress-recdot"></span>REC
                </span>
            </div>

            <div class="battelog-dress-tickrail">${ticks}</div>

            <div class="battelog-dress-readout">
                <div>GRID 07-Δ</div>
                <div>LAT 62.4°N</div>
                <div>LON 129.7°E</div>
                <div>RND ${_escape(rounds)}</div>
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
