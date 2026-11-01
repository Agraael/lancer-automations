export function inkOn(color)
{
    const hex = String(color ?? '');
    const red = Number.parseInt(hex.slice(1, 3), 16) || 0;
    const green = Number.parseInt(hex.slice(3, 5), 16) || 0;
    const blue = Number.parseInt(hex.slice(5, 7), 16) || 0;
    return (red * 0.299 + green * 0.587 + blue * 0.114) > 150 ? '#111' : '#fff';
}

/** Blend two packed hex colors, ratio 0 keeps `from`, ratio 1 gives `to`. */
export function mixColor(from, to, ratio)
{
    const clamped = Math.max(0, Math.min(1, ratio));
    const channel = shift => Math.round(((from >> shift) & 0xff) + ((((to >> shift) & 0xff) - ((from >> shift) & 0xff)) * clamped));
    return (channel(16) << 16) | (channel(8) << 8) | channel(0);
}

export function cssHex(color)
{
    return `#${color.toString(16).padStart(6, '0')}`;
}

export function overchargeColor(step, max)
{
    return mixColor(0xccaa32, 0xf44336, max > 0 ? step / max : 1);
}

// HP: red → yellow → green (two-stop, avoids brown midpoint). Over max (OS boost) → cyan/teal.
export function hpColorCss(value, max)
{
    if (max <= 0)
        return '#cccccc';
    const ratio = value / max;
    if (ratio > 1)
        return '#5ec0c5';
    return cssHex(ratio < 0.5 ? mixColor(0xf44336, 0xffd700, ratio * 2) : mixColor(0xffd700, 0x4caf50, (ratio - 0.5) * 2));
}

// Heat: grey → yellow → orange → red (3-segment)
export function heatColorCss(value, max)
{
    if (max <= 0)
        return '#888888';
    const ratio = value / max;
    if (ratio < 1 / 3)
        return cssHex(mixColor(0x888888, 0xffd700, ratio * 3));
    if (ratio < 2 / 3)
        return cssHex(mixColor(0xffd700, 0xff8c00, (ratio - 1 / 3) * 3));
    return cssHex(mixColor(0xff8c00, 0xf44336, (ratio - 2 / 3) * 3));
}

export function dangerHeatColorCss(value, max)
{
    const first = Math.ceil(max / 2);
    return cssHex(mixColor(0xffb000, 0xfa671b, (value - first) / Math.max(1, max - 1 - first)));
}

// grey at 0 -> #d9b800 at max
export function pilotStressColorCss(value, max)
{
    return cssHex(mixColor(0x888888, 0xd9b800, max > 0 ? value / max : 0));
}

export function haseValueColor(value)
{
    if (value > 0)
        return '#e6e6e6';
    return value < 0 ? '#ff8a80' : '#7c7c7c';
}

export const REPAIR_COLOR = 0x3fd4b0;
export const REPAIR_COLOR_CSS = cssHex(REPAIR_COLOR);
