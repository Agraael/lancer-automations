export const HASE_CHIP_CSS = `
.la-hase-chip {
    font-style: normal;
    width: 15px;
    height: 14px;
    box-sizing: border-box;
    padding-left: 3px;
    display: grid;
    place-items: center;
    background: var(--primary-color);
    color: #fff;
    font: 700 8.5px/1 var(--bl-display, 'Orbitron', sans-serif);
    clip-path: polygon(0 0, 100% 0, 100% 100%, 4px 100%);
}
.la-hase-chip.la-grit {
    background: #a8641e;
}
`;

let _injected = false;

export function ensureHaseChipStyle()
{
    if (_injected)
        return;
    _injected = true;
    const styleEl = document.createElement('style');
    styleEl.id = 'la-hase-chip-styles';
    styleEl.textContent = HASE_CHIP_CSS;
    document.head.appendChild(styleEl);
}

export function statPipsHtml(cls, val, max, color)
{
    const last = val === 1 && max > 1;
    const list = Array.from({ length: max }, (_unused, index) => index < max - val
        ? `<i class="cci ${cls} la-stats-pip la-stats-pip--lost"></i>`
        : `<i class="cci ${cls} la-stats-pip" style="color:${last ? '#f44336' : color};"></i>`);
    return `<span class="la-stats-pips">${list.join('')}</span>`;
}
