import { localize } from "../tools/string-utils.js";
import { isClockPinned, toggleClockPin } from "../tools/clock-pins.js";

const COUNTER_PATH = /^system\.bond_state\.(clocks|burdens)\.(\d+)$/;

function paintPin(pin, pilot)
{
    const on = isClockPinned(pilot, pin.dataset.laPinKind, Number(pin.dataset.laPinIndex));
    pin.classList.toggle('la-sheet-pin--off', !on);
    pin.dataset.tooltip = localize(on ? 'LA.clocks.unpin' : 'LA.clocks.pinHint');
    pin.firstElementChild.className = `mdi ${on ? 'mdi-pin' : 'mdi-pin-outline'}`;
}

function buildPin(menu, pilot, kind, index)
{
    const pin = document.createElement(menu.tagName);
    pin.className = `${menu.className.replace('lancer-context-menu', '')} la-sheet-pin`.trim();
    if (pin instanceof HTMLButtonElement)
        pin.type = 'button';
    pin.dataset.laPinKind = kind;
    pin.dataset.laPinIndex = String(index);
    pin.dataset.laPinActor = pilot.uuid;
    pin.append(document.createElement('i'));
    paintPin(pin, pilot);

    pin.addEventListener('click', async event =>
    {
        event.preventDefault();
        event.stopPropagation();
        await toggleClockPin(pilot, kind, index);
        paintPin(pin, pilot);
    });
    return pin;
}

export function injectSheetClockPins(app, html)
{
    const pilot = app?.actor;
    if (pilot?.type !== 'pilot' || !pilot.isOwner)
        return;

    const root = app.element?.[0] ?? (html instanceof HTMLElement ? html : html?.[0]);
    if (!root)
        return;

    for (const menu of root.querySelectorAll('.lancer-context-menu[data-path]'))
    {
        const match = COUNTER_PATH.exec(menu.dataset.path ?? '');
        if (!match || menu.previousElementSibling?.classList.contains('la-sheet-pin'))
            continue;
        menu.before(buildPin(menu, pilot, match[1], Number(match[2])));
    }
}

export function repaintSheetClockPins()
{
    for (const pin of document.querySelectorAll('.la-sheet-pin[data-la-pin-actor]'))
    {
        const pilot = fromUuidSync(/** @type {HTMLElement} */ (pin).dataset.laPinActor);
        if (pilot)
            paintPin(pin, pilot);
    }
}
