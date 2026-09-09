import { playTerminal, typeTerminalLines, revealVerdict, dottedRow, horusText } from '../Battelog/intro-terminal.js';
import { playBattleLogSound } from '../tah/sound.js';
import { playSeasonalSound } from './sound.js';
import { getSupabase } from '../setup/supabase-client.js';

const MODULE = 'lancer-automations';
const SENT_SETTING = 'birthdayWishYear';
const DECLINED_SETTING = 'birthdayDeclinedYear';
const BALLOON_SETTING = 'birthdayBalloonState';
const WISH_TABLE = 'birthday_wishes';

const BALLOON_LIFE_MS = 60000;
const BALLOON_MAX_SHOWS = 4;

const BALLOON_W = 54;
const BALLOON_H = 70;
const BALLOON_HIT_SCALE = 0.5;
const BALLOON_KICK_SPEED = 760;
const BALLOON_BOUNCE = 0.72;
const BALLOON_MAX_SPEED = 900;
const BALLOON_BOING_GAP_MS = 140;

const START_DAY = 13;
const END_DAY = 16;

const ACCENT = '#2e9fd4';
const LOOKUP_TIMEOUT_MS = 1500;
const MAX_MESSAGE = 300;

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

const GLITCH = horusText('UNIDENTIFIED');

const BALLOON_HUES = [348, 32, 48, 168, 202, 268, 316];


// CONFIG.debug.laBirthday forces the event window + a 3s balloon on every load.
// CONFIG.debug.laBirthdayLost forces the UNIDENTIFIED registry path.
function _debugFlag(key)
{
    return /** @type {any} */ (CONFIG.debug)?.[key] === true;
}

function _isBirthdayWindow()
{
    if (_debugFlag('laBirthday'))
        return true;
    const now = new Date();
    return now.getMonth() === 8 && now.getDate() >= START_DAY && now.getDate() <= END_DAY;
}

function _setting(key, fallback = '')
{
    try
    {
        return game.settings.get(MODULE, key) ?? fallback;
    }
    catch
    {
        return fallback;
    }
}

function _alreadySent()
{
    return String(_setting(SENT_SETTING)) === String(new Date().getFullYear());
}

function _alreadyDeclined()
{
    return String(_setting(DECLINED_SETTING)) === String(new Date().getFullYear());
}

function _balloonState()
{
    try
    {
        const raw = JSON.parse(String(_setting(BALLOON_SETTING)) || '{}');
        if (raw.year === new Date().getFullYear())
            return raw;
    }
    catch
    {
        console.warn('Lancer Automations | bad birthday balloon state, resetting.');
    }
    return { year: new Date().getFullYear(), lastDay: '', count: 0 };
}

/**
 * @returns {Promise<number|null>} whole days since this install was first counted.
 */
async function _lookupDaysOnRecord()
{
    if (_debugFlag('laBirthdayLost'))
        return null;
    const installId = String(_setting('dataInstallId'));
    if (!installId)
        return null;
    try
    {
        const query = getSupabase()
            .from('seen_users')
            .select('created_at')
            .eq('user_hash', installId)
            .maybeSingle();
        const timeout = new Promise(resolve => setTimeout(() => resolve(null), LOOKUP_TIMEOUT_MS));
        const result = /** @type {any} */ (await Promise.race([query, timeout]));
        const createdAt = result?.data?.created_at;
        if (!createdAt)
            return null;
        const then = new Date(createdAt);
        if (Number.isNaN(then.getTime()))
            return null;
        return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
    }
    catch (err)
    {
        console.warn('Lancer Automations | birthday registry lookup failed:', err);
        return null;
    }
}

async function _markYear(key, label)
{
    try
    {
        await game.settings.set(MODULE, key, String(new Date().getFullYear()));
    }
    catch
    {
        console.warn(`Lancer Automations | ${label} setting not registered yet.`);
    }
}

async function _storeWish(message)
{
    if (!message)
        return true;
    try
    {
        const { error } = await getSupabase().from(WISH_TABLE).insert({
            user_hash: String(_setting('dataInstallId')) || null,
            message: message.slice(0, MAX_MESSAGE),
            module_version: game.modules.get(MODULE)?.version || 'unknown',
        });
        if (error)
            throw error;
        return true;
    }
    catch (err)
    {
        console.error('Lancer Automations | birthday wish not stored:', err);
        return false;
    }
}

function _birthdayLines(days)
{
    const now = new Date();
    const dateStr = `${MONTHS[now.getMonth()]} ${now.getDate()}, ${now.getFullYear()}`;
    const installId = _debugFlag('laBirthdayLost') ? '' : String(_setting('dataInstallId'));
    const dayWord = days === 1 ? ' DAY' : ' DAYS';
    const bdayLead = now.getDate() === START_DAY ? 'And it is my ' : `And ${MONTHS[8]} ${START_DAY} is my `;

    return [
        {
            label: dottedRow('establishing secure identity'),
            result: installId ? installId.slice(0, 8).toUpperCase() : 'UNIDENTIFIED',
            resultHtml: installId ? null : GLITCH,
        },
        { label: dottedRow('local timestamp'), result: dateStr.toUpperCase(), sfx: 'long' },
        {
            label: dottedRow('cross-referencing operator registry'),
            result: days == null ? 'UNIDENTIFIED' : `${days}${dayWord} ON RECORD`,
            resultHtml: days == null ? GLITCH : null,
            sfx: 'long',
        },
        { label: dottedRow('transmission origin'), result: 'LASOSSIS // AUTHOR NODE', sfx: 'long' },

        { label: `Hello user. It is ${dateStr}.`, cls: 'say gap', pause: 620 },
        {
            parts: [bdayLead, { text: 'Birthday', cls: 'horus--subtle battelog-horus' }, ' HAHAHAHA'],
            cls: 'say shout',
            pause: 700,
        },
        {
            label: days == null
                ? 'My estimation thing cannot find you. You are a ghost.'
                : `My estimation thing says you have been a user for ${days} ${days === 1 ? 'day' : 'days'}.`,
            cls: 'say',
            pause: 620,
        },
        { label: 'Many thanks to you.', cls: 'say', pause: 700 },
        { label: 'But now it is time to say something nice TO ME !!!!', cls: 'say shout', pause: 700 },
        { label: 'or else .....', cls: 'say menace horus--subtle battelog-horus', pause: 500 },
    ];
}

function _renderForm(inner, { finish, later, interval })
{
    playBattleLogSound('longResult');

    const form = document.createElement('div');
    form.className = 'battelog-intro-form';
    form.innerHTML = `
        <div>
            <label for="la-bday-msg">Your nice thing</label>
            <textarea id="la-bday-msg" maxlength="${MAX_MESSAGE}" placeholder="say something nice, or else ....."></textarea>
        </div>
        <div class="battelog-intro-form-row">
            <button type="button" class="battelog-intro-decline">Sorry, not right now</button>
            <span class="battelog-intro-form-actions">
                <span class="battelog-intro-count">0 / ${MAX_MESSAGE}</span>
                <button type="button" class="battelog-intro-send">Send it</button>
            </span>
        </div>
        <div class="battelog-intro-nags"></div>
    `;
    inner.appendChild(form);

    const msg = /** @type {any} */ (form.querySelector('#la-bday-msg'));
    const count = form.querySelector('.battelog-intro-count');
    const send = /** @type {any} */ (form.querySelector('.battelog-intro-send'));
    const decline = /** @type {any} */ (form.querySelector('.battelog-intro-decline'));
    const nags = form.querySelector('.battelog-intro-nags');

    const FILL_TEXT = 'Happy birthday LaSossis !!';
    const NAGS = [
        '> really nothing :(',
        '> not even a fart joke ?',
        '> alright alright, I put some text for you',
    ];
    let nagCount = 0;
    let autoFilled = false;

    const addNag = (text) =>
    {
        playBattleLogSound('fail');
        const line = document.createElement('div');
        line.className = 'battelog-intro-nag';
        line.textContent = text;
        nags.appendChild(line);
    };

    msg.addEventListener('input', () =>
    {
        if (autoFilled && !msg.value.trim())
        {
            addNag('> hehe you sneaky sneaky');
            msg.value = FILL_TEXT;
            msg.readOnly = true;
        }
        count.textContent = `${msg.value.length} / ${MAX_MESSAGE}`;
    });

    const nag = () =>
    {
        addNag(NAGS[Math.min(nagCount, NAGS.length - 1)]);
        if (nagCount >= NAGS.length - 1)
        {
            msg.value = FILL_TEXT;
            count.textContent = `${msg.value.length} / ${MAX_MESSAGE}`;
            autoFilled = true;
        }
        nagCount++;
        msg.focus();
    };

    let closed = false;
    const close = async (accepted) =>
    {
        if (closed)
            return;
        if (accepted && !msg.value.trim())
        {
            nag();
            return;
        }
        closed = true;
        send.disabled = true;
        decline.disabled = true;
        msg.disabled = true;
        playBattleLogSound(accepted ? 'confirm' : 'denied');

        revealVerdict(inner, {
            tone: accepted ? 'win' : 'lose',
            word: accepted ? 'THANK YOU' : 'NOOOO',
            subtitle: accepted
                ? 'TRANSMISSION LOGGED : GRATITUDE PROTOCOL ENGAGED'
                : 'TRANSMISSION REFUSED : THIS WILL BE REMEMBERED',
            label: 'VERDICT >>',
            later,
            interval,
        });

        later(finish, 3200);

        if (!accepted)
        {
            await _markYear(DECLINED_SETTING, 'birthday decline');
            return;
        }

        const stored = await _storeWish(msg.value.trim());
        if (!stored)
            ui.notifications.warn('Could not send your message. Thanks anyway.');
        await _markYear(SENT_SETTING, 'birthday');
        document.querySelector('.la-bday-btn')?.remove();
    };

    send.addEventListener('click', () => close(true));
    decline.addEventListener('click', () => close(false));
    msg.addEventListener('keydown', (/** @type {any} */ ev) =>
    {
        if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey))
        {
            ev.preventDefault();
            close(true);
        }
    });

    setTimeout(() => msg.focus(), 60);
}

let _introActive = false;

async function _playBirthdayIntro()
{
    if (_introActive)
        return;
    _introActive = true;
    const days = await _lookupDaysOnRecord();

    return playTerminal({
        color: ACCENT,
        textColor: ACCENT,
        theme: null,
        dismissOnClick: false,
        header: 'LANCER // PERSONAL TRANSMISSION',
        extraClasses: ['la-bday'],
        dress: {
            channel: 'PERSONAL CHANNEL',
            node: 'NODE 09-13',
            readout: ['GRID 09-13', 'LAT 62.4°N', 'LON 129.7°E', 'CAKE 1'],
            ticker: '◇ PERSONAL CHANNEL OPEN   ◇ ONE (1) BIRTHDAY DETECTED   ◇ CAKE INTEGRITY NOMINAL   ◇ AWAITING KIND WORDS   ◇ REFUSAL IS NOT AN OPTION   ',
        },
        run: (overlay, { finish, speed, body }) =>
        {
            overlay.addEventListener('contextmenu', (/** @type {any} */ ev) =>
            {
                ev.preventDefault();
                finish();
            });
            return typeTerminalLines(body, _birthdayLines(days), {
                speed,
                onDone: ({ later, interval }) => _renderForm(body, { finish, later, interval }),
            });
        },
    }).finally(() =>
    {
        _introActive = false;
    });
}

function _mountBalloons(host)
{
    if (host.querySelector('.la-bday-sky'))
        return;
    const sky = document.createElement('div');
    sky.className = 'la-bday-sky';
    sky.setAttribute('aria-hidden', 'true');
    for (let index = 0; index < 14; index++)
    {
        const balloon = document.createElement('span');
        balloon.className = 'la-bday-balloon';
        balloon.style.setProperty('--x', `${(Math.random() * 96).toFixed(1)}%`);
        balloon.style.setProperty('--size', `${(26 + Math.random() * 34).toFixed(0)}px`);
        balloon.style.setProperty('--dur', `${(13 + Math.random() * 12).toFixed(1)}s`);
        balloon.style.setProperty('--delay', `${(-Math.random() * 22).toFixed(1)}s`);
        balloon.style.setProperty('--hue', String(BALLOON_HUES[index % BALLOON_HUES.length]));
        sky.appendChild(balloon);
    }
    host.prepend(sky);
}

function _mountButton(footer)
{
    if (footer.querySelector('.la-bday-btn'))
        return;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'la-bday-btn';
    button.title = '?';
    button.setAttribute('aria-label', '?');
    button.innerHTML = '<span class="la-bday-glyph" aria-hidden="true">&#127880;</span>' + '<span class="la-bday-mark" aria-hidden="true">?</span>';
    button.addEventListener('click', () =>
    {
        _playBirthdayIntro().catch(err => console.error('Lancer Automations | birthday intro failed:', err));
    });
    footer.querySelector('.la-config-save')?.before(button);
}

function _spawnBalloon()
{
    if (_introActive || _alreadySent() || _alreadyDeclined() || document.querySelector('.la-bday-drifter'))
        return;

    if (!_debugFlag('laBirthday'))
    {
        const state = _balloonState();
        const today = new Date().toISOString().slice(0, 10);
        game.settings.set(MODULE, BALLOON_SETTING, JSON.stringify({
            year: state.year,
            lastDay: today,
            count: state.count + 1,
        })).catch(() => console.warn('Lancer Automations | birthday balloon state not saved.'));
    }

    const balloon = document.createElement('div');
    balloon.className = 'la-bday-drifter';
    balloon.title = '?';
    balloon.style.setProperty('--hue', String(BALLOON_HUES[Math.floor(Math.random() * BALLOON_HUES.length)]));
    balloon.innerHTML = '<span class="la-bday-drifter-body"></span>';
    document.body.appendChild(balloon);

    const margin = 90;
    const corners = [
        [-80, -80],
        [window.innerWidth + 80, -80],
        [-80, window.innerHeight + 80],
        [window.innerWidth + 80, window.innerHeight + 80],
    ];
    const [startX, startY] = corners[Math.floor(Math.random() * corners.length)];
    let posX = startX;
    let posY = startY;
    let velX = 0;
    let velY = 0;
    let targetVelX = 0;
    let targetVelY = 0;
    let phase = Math.random() * 10;
    let lastTime = performance.now();
    let entered = false;
    let pointerX = -9999;
    let pointerY = -9999;
    let contact = false;
    let lastBoing = 0;

    const onPointerMove = (ev) =>
    {
        pointerX = ev.clientX;
        pointerY = ev.clientY;
    };
    window.addEventListener('pointermove', onPointerMove);

    const boing = () =>
    {
        if (performance.now() - lastBoing < BALLOON_BOING_GAP_MS)
            return;
        lastBoing = performance.now();
        playSeasonalSound('boing', {volumeScale: 0.5});
    };

    const retarget = () =>
    {
        targetVelX = (Math.random() * 2 - 1) * 55;
        targetVelY = (Math.random() * 2 - 1) * 38 - 6;
    };
    retarget();
    const retargetTimer = setInterval(retarget, 2600);

    let frame = 0;
    const step = (now) =>
    {
        const delta = Math.min(0.05, (now - lastTime) / 1000);
        lastTime = now;
        phase += delta;

        const maxX = window.innerWidth - BALLOON_W;
        const maxY = window.innerHeight - BALLOON_H;

        let steerX = targetVelX;
        let steerY = targetVelY;
        if (!entered)
        {
            if (posX < margin)
                steerX += (margin - posX) * 1.5;
            if (posX > window.innerWidth - margin)
                steerX -= (posX - (window.innerWidth - margin)) * 1.5;
            if (posY < margin)
                steerY += (margin - posY) * 1.5;
            if (posY > window.innerHeight - margin)
                steerY -= (posY - (window.innerHeight - margin)) * 1.5;
        }

        velX += (steerX - velX) * Math.min(1, delta * 1.2);
        velY += (steerY - velY) * Math.min(1, delta * 1.2);

        const toX = posX + BALLOON_W / 2 - pointerX;
        const toY = posY + BALLOON_H / 2 - pointerY;
        const hitW = BALLOON_W / 2 * BALLOON_HIT_SCALE;
        const hitH = BALLOON_H / 2 * BALLOON_HIT_SCALE;
        const hit = (toX / hitW) ** 2 + (toY / hitH) ** 2 <= 1;
        if (hit && !contact)
        {
            const dist = Math.max(1, Math.hypot(toX, toY));
            velX = (toX / dist) * BALLOON_KICK_SPEED;
            velY = (toY / dist) * BALLOON_KICK_SPEED;
            boing();
        }
        contact = hit;

        const speed = Math.hypot(velX, velY);
        if (speed > BALLOON_MAX_SPEED)
        {
            velX = velX / speed * BALLOON_MAX_SPEED;
            velY = velY / speed * BALLOON_MAX_SPEED;
        }

        posX += velX * delta;
        posY += velY * delta;

        if (!entered && posX >= 0 && posY >= 0 && posX <= maxX && posY <= maxY)
            entered = true;

        if (entered)
        {
            if (posX < 0)
            {
                posX = 0;
                velX = Math.abs(velX) * BALLOON_BOUNCE;
                targetVelX = Math.abs(targetVelX);
                boing();
            }
            else if (posX > maxX)
            {
                posX = maxX;
                velX = -Math.abs(velX) * BALLOON_BOUNCE;
                targetVelX = -Math.abs(targetVelX);
                boing();
            }
            if (posY < 0)
            {
                posY = 0;
                velY = Math.abs(velY) * BALLOON_BOUNCE;
                targetVelY = Math.abs(targetVelY);
                boing();
            }
            else if (posY > maxY)
            {
                posY = maxY;
                velY = -Math.abs(velY) * BALLOON_BOUNCE;
                targetVelY = -Math.abs(targetVelY);
                boing();
            }
        }

        const swayX = Math.sin(phase * 1.7) * 14;
        const swayY = Math.sin(phase * 2.3) * 7;
        const tilt = Math.max(-14, Math.min(14, velX * 0.12 + Math.sin(phase * 1.7) * 5));
        balloon.style.transform =
            `translate(${Math.round(posX + swayX)}px, ${Math.round(posY + swayY)}px) rotate(${tilt.toFixed(1)}deg)`;

        frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);

    let gone = false;
    const stop = () =>
    {
        gone = true;
        cancelAnimationFrame(frame);
        clearInterval(retargetTimer);
        clearTimeout(lifeTimer);
        window.removeEventListener('pointermove', onPointerMove);
    };
    const lifeTimer = setTimeout(() =>
    {
        if (gone)
            return;
        stop();
        balloon.classList.add('la-bday-drifter-fade');
        setTimeout(() => balloon.remove(), 1400);
    }, BALLOON_LIFE_MS);

    balloon.addEventListener('click', () =>
    {
        if (gone)
            return;
        stop();
        playSeasonalSound('pop');
        balloon.classList.add('la-bday-drifter-popped');
        setTimeout(() => balloon.remove(), 400);
        setTimeout(() =>
        {
            _playBirthdayIntro().catch(err => console.error('Lancer Automations | birthday intro failed:', err));
        }, 350);
    });
}

function _maybeScheduleBalloon()
{
    if (_alreadySent() || _alreadyDeclined())
        return;
    const debug = _debugFlag('laBirthday');
    if (!debug)
    {
        const state = _balloonState();
        const today = new Date().toISOString().slice(0, 10);
        if (state.count >= BALLOON_MAX_SHOWS || state.lastDay === today)
            return;
    }
    setTimeout(_spawnBalloon, debug ? 3000 : 20000 + Math.random() * 40000);
}

Hooks.once('setup', () =>
{
    game.settings.register(MODULE, SENT_SETTING, {
        scope: 'client',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE, DECLINED_SETTING, {
        scope: 'client',
        config: false,
        type: String,
        default: '',
    });
    game.settings.register(MODULE, BALLOON_SETTING, {
        scope: 'client',
        config: false,
        type: String,
        default: '',
    });
});

Hooks.on('ready', () =>
{
    if (_isBirthdayWindow())
        _maybeScheduleBalloon();
});

Hooks.on(/** @type {any} */ ('renderLancerAutomationsConfig'), (/** @type {any} */ _app, /** @type {any} */ html) =>
{
    if (!_isBirthdayWindow())
        return;
    const root = html instanceof HTMLElement ? html : html?.[0];
    if (!root)
        return;
    const content = root.closest('.window-content') ?? root.querySelector('.window-content');
    if (content)
        _mountBalloons(content);
    const footer = root.querySelector('.la-config-footer');
    if (footer && !_alreadySent())
        _mountButton(footer);
});
