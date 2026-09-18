// TAH portrait: the artwork floating above the HUD name band.

import { getLAFlag } from '../tools/flag-utils.js';
import { getModuleSetting } from '../tools/settings-utils.js';

export const FLAG_PORTRAIT_MODE = 'tahPortraitMode';
export const FLAG_PORTRAIT_IMG = 'tahPortraitImg';
export const FLAG_PORTRAIT_MECH_PILOT = 'tahPortraitMechPilot';

export const PORTRAIT_PILOT = {
    DEFAULT: '',
    YES: 'yes',
    NO: 'no',
};

/** Per-token override values. `''` means follow the world setting. */
export const PORTRAIT_MODES = {
    DEFAULT: '',
    TOKEN: 'token',
    ACTOR: 'actor',
    CUSTOM: 'custom',
    OFF: 'off',
};

const SCOPE_MECH_PILOT = 'mechPilot';

/**
 * Actor types the HUD portrait is allowed to draw for, per scope setting.
 * @param {any} actor Actor backing the HUD.
 * @returns {boolean} Whether this actor type is covered.
 */
function inScope(actor)
{
    const type = actor?.type;
    if (!type)
        return false;
    if (type === 'mech' || type === 'pilot')
        return true;
    return (getModuleSetting('tah.portrait.scope') ?? SCOPE_MECH_PILOT) !== SCOPE_MECH_PILOT;
}

/**
 * Whether a mech should be drawn with its pilot's art, honouring the per-token override.
 * @param {any} tokenDoc Token document carrying the override flag.
 * @returns {boolean}
 */
function usePilotArt(tokenDoc)
{
    const override = getLAFlag(tokenDoc, FLAG_PORTRAIT_MECH_PILOT) ?? PORTRAIT_PILOT.DEFAULT;
    if (override === PORTRAIT_PILOT.YES)
        return true;
    if (override === PORTRAIT_PILOT.NO)
        return false;
    return !!getModuleSetting('tah.portrait.mechUsePilot');
}

/**
 * Resolve a mech to the pilot whose art should stand in for it.
 * @param {any} actor Actor to resolve.
 * @param {any} tokenDoc Token document carrying the override flag.
 * @returns {any} The linked pilot, or the actor unchanged.
 */
function withPilotSubstitution(actor, tokenDoc)
{
    if (actor?.type !== 'mech' || !usePilotArt(tokenDoc))
        return actor;
    const pilot = actor.system?.pilot;
    return pilot?.status === 'resolved' ? (pilot.value ?? actor) : actor;
}

/**
 * Image path for the HUD portrait, honouring the per-token override.
 * @param {any} token Placed token (null in narrative mode).
 * @param {any} actor Actor backing the HUD.
 * @returns {string|null} Image path, or null when no portrait should show.
 */
export function resolvePortraitSrc(token, actor)
{
    const tokenDoc = token?.document ?? token;
    const override = getLAFlag(tokenDoc, FLAG_PORTRAIT_MODE) ?? PORTRAIT_MODES.DEFAULT;
    if (override === PORTRAIT_MODES.OFF)
        return null;
    if (override === PORTRAIT_MODES.CUSTOM)
        return getLAFlag(tokenDoc, FLAG_PORTRAIT_IMG) || null;

    const worldMode = getModuleSetting('tah.portrait.mode') ?? PORTRAIT_MODES.OFF;
    const mode = override || worldMode;
    if (mode === PORTRAIT_MODES.OFF)
        return null;

    if (!inScope(actor))
        return null;
    const subject = withPilotSubstitution(actor, tokenDoc);
    // Placed token art only applies when the HUD is showing that token's own actor.
    if (mode === PORTRAIT_MODES.TOKEN)
    {
        const art = subject === actor ? tokenDoc?.texture?.src : null;
        return art || subject?.prototypeToken?.texture?.src || subject?.img || null;
    }
    return subject?.img || null;
}

/** Height in px the portrait is drawn at, before the HUD's own ui scale. */
export function portraitHeight()
{
    const scale = Number(getModuleSetting('tah.portrait.scale')) || 1;
    return Math.round(180 * scale);
}

// Aspect ratios are only known once an image has loaded, so the first render of a
// given portrait guesses and corrects itself; later renders are right immediately.
const DEFAULT_RATIO = 1;
const _ratioCache = new Map();

const TRIM_SCAN_WIDTH = 128;
const TRIM_ALPHA = 8;
const TRIM_MARGIN = 4;
const _trimCache = new Map();

/**
 * Bounding box of the non-transparent pixels, as fractions of the image, or null when there is nothing to trim.
 * @param {HTMLImageElement} node Loaded image.
 * @returns {{ x: number, y: number, w: number, h: number }|null}
 */
function measureTrim(node)
{
    const naturalWidth = node.naturalWidth;
    const naturalHeight = node.naturalHeight;
    if (!naturalWidth || !naturalHeight)
        return null;
    // A downscaled copy is ~60x cheaper to scan and still lands the box within a pixel of the real one.
    const scanWidth = Math.min(naturalWidth, TRIM_SCAN_WIDTH);
    const scanHeight = Math.max(1, Math.round(scanWidth * (naturalHeight / naturalWidth)));
    let data;
    try
    {
        const canvasEl = document.createElement('canvas');
        canvasEl.width = scanWidth;
        canvasEl.height = scanHeight;
        const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
        if (!ctx)
            return null;
        ctx.drawImage(node, 0, 0, scanWidth, scanHeight);
        data = ctx.getImageData(0, 0, scanWidth, scanHeight).data;
    }
    catch
    {
        // Cross-origin art taints the canvas; show it untrimmed rather than not at all.
        return null;
    }
    let minCol = scanWidth;
    let minRow = scanHeight;
    let maxCol = -1;
    let maxRow = -1;
    for (let row = 0; row < scanHeight; row++)
    {
        for (let col = 0; col < scanWidth; col++)
        {
            if (data[(((row * scanWidth) + col) * 4) + 3] <= TRIM_ALPHA)
                continue;
            if (col < minCol) minCol = col;
            if (col > maxCol) maxCol = col;
            if (row < minRow) minRow = row;
            if (row > maxRow) maxRow = row;
        }
    }
    if (maxCol < 0)
        return null;
    const box = {
        x: minCol / scanWidth,
        y: minRow / scanHeight,
        w: (maxCol - minCol + 1) / scanWidth,
        h: (maxRow - minRow + 1) / scanHeight,
    };
    if (box.w > 0.98 && box.h > 0.98)
        return null;
    return box;
}

/**
 * Crop the portrait to the trimmed box, keeping the element's overall height.
 * @param {JQuery} el Portrait container.
 * @param {JQuery} img Image inside it.
 * @param {{ x: number, y: number, w: number, h: number }} box Trim box in image fractions.
 * @param {number} naturalRatio Height over width of the untrimmed image.
 * @param {number} height Height the portrait is drawn at.
 */
function applyTrim(el, img, box, naturalRatio, height)
{
    const inner = Math.max(1, height - (TRIM_MARGIN * 2));
    const drawnHeight = inner / box.h;
    const drawnWidth = drawnHeight / naturalRatio;
    el.css({ width: `${Math.round((drawnWidth * box.w) + (TRIM_MARGIN * 2))}px`, overflow: 'hidden' });
    img.css({
        position: 'absolute',
        width: `${drawnWidth}px`,
        height: `${drawnHeight}px`,
        maxWidth: 'none',
        objectFit: 'fill',
        left: `${TRIM_MARGIN - (box.x * drawnWidth)}px`,
        top: `${TRIM_MARGIN - (box.y * drawnHeight)}px`,
    });
}

/**
 * Build the portrait element, or null when this token has none.
 * @param {any} token Placed token (null in narrative mode).
 * @param {any} actor Actor backing the HUD.
 * @param {(height: number) => void} [onMeasured] Called with 0 when the image fails to load and reserves no height.
 * @returns {{ el: JQuery, height: number }|null} Element plus the vertical space it needs.
 */
export function buildPortrait(token, actor, onMeasured)
{
    const src = resolvePortraitSrc(token, actor);
    if (!src)
        return null;
    const height = portraitHeight();
    const trimOn = !!getModuleSetting('tah.portrait.trim');
    const knownRatio = _ratioCache.get(src) ?? DEFAULT_RATIO;
    const knownTrim = trimOn ? _trimCache.get(src) : null;
    const width = Math.round(height / knownRatio);
    const el = $('<div class="la-hud-portrait"></div>');
    el.css({ width: `${width}px`, height: `${height}px` });
    const isVideo = foundry.helpers.media.VideoHelper.hasVideoExtension(src);
    const img = isVideo
        ? $('<video>').prop({ autoplay: true, muted: true, loop: true, playsInline: true })
        : $('<img>').attr('alt', '');
    img.attr('src', src);
    if (knownTrim)
        applyTrim(el, img, knownTrim, knownRatio, height);
    img.on(isVideo ? 'loadeddata' : 'load', function ()
    {
        const node = /** @type {HTMLImageElement & HTMLVideoElement} */ (this);
        const naturalWidth = isVideo ? node.videoWidth : node.naturalWidth;
        const naturalHeight = isVideo ? node.videoHeight : node.naturalHeight;
        const natural = naturalWidth ? naturalHeight / naturalWidth : DEFAULT_RATIO;
        _ratioCache.set(src, natural);
        if (!el[0].isConnected)
            return;
        if (trimOn && !isVideo)
        {
            const box = _trimCache.has(src) ? _trimCache.get(src) : measureTrim(node);
            _trimCache.set(src, box);
            if (box)
            {
                applyTrim(el, img, box, natural, height);
                return;
            }
        }
        const real = Math.round(height / natural);
        if (real !== width)
            el.css('width', `${real}px`);
    });
    // A missing file would otherwise leave a broken-image glyph hanging over the HUD.
    img.on('error', () =>
    {
        const live = el[0].isConnected;
        el.remove();
        if (live)
            onMeasured?.(0);
    });
    el.append(img);
    return { el, height };
}
