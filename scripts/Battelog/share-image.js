const MODULE = 'lancer-automations';
const CSS_PATH = `modules/${MODULE}/styles/battelog.css`;

// The SVG can't see document @font-face, so every font rides along as a data uri.
const FONT_SOURCES = [
    { family: 'Font Awesome 6 Pro', weight: 900, path: 'fonts/fontawesome/webfonts/fa-solid-900.woff2' },
    { family: 'Signika', weight: 400, path: 'fonts/signika/signika-regular.woff2' },
    { family: 'Signika', weight: 500, path: 'fonts/signika/signika-medium.woff2' },
    { family: 'Signika', weight: 600, path: 'fonts/signika/signika-semibold.woff2' },
    { family: 'Signika', weight: 700, path: 'fonts/signika/signika-bold.woff2' },
    { family: 'compcon', weight: 400, path: 'systems/lancer/fonts/compcon/compcon.ttf', format: 'truetype' },
    { family: 'Material Design Icons', weight: 400, path: 'https://cdn.jsdelivr.net/npm/@mdi/font@7.4.47/fonts/materialdesignicons-webfont.woff2' },
];

const CARD_WIDTH = 260;
const CARD_GAP = 10;
const EXPORT_SCALE = 2;
const MAX_CANVAS_PIXELS = 25e6;

let _assetsPromise = null;

function _blobToDataUri(blob)
{
    return new Promise((resolve, reject) =>
    {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}

async function _dataUri(url)
{
    const response = await fetch(url);
    if (!response.ok)
        throw new Error(`${response.status} ${url}`);
    return await _blobToDataUri(await response.blob());
}

/** Rewrite every url() in a stylesheet to a data uri, resolved against the sheet's own location. */
async function _inlineCssUrls(css, baseHref)
{
    const urlRefs = [...new Set([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(match => match[1]))]
        .filter(ref => !ref.startsWith('data:'));

    const resolvedPairs = await Promise.all(urlRefs.map(async (ref) =>
    {
        try
        {
            return [ref, await _dataUri(new URL(ref, baseHref).href)];
        }
        catch
        {
            return null;
        }
    }));

    let rewritten = css;
    for (const [ref, dataUri] of resolvedPairs.filter(Boolean))
        rewritten = rewritten.replaceAll(ref, dataUri);
    return rewritten;
}

/** Fetch and cache the stylesheet and icon font the isolated SVG cannot reach on its own. */
async function _loadAssets()
{
    if (!_assetsPromise)
    {
        _assetsPromise = (async () =>
        {
            const cssHref = new URL(CSS_PATH, document.baseURI).href;
            const response = await fetch(cssHref);
            if (!response.ok)
                throw new Error(`Could not read battelog.css (${response.status})`);
            const css = await _inlineCssUrls(await response.text(), cssHref);

            const faces = await Promise.all(FONT_SOURCES.map(async (font) =>
            {
                try
                {
                    const fontData = await _dataUri(new URL(font.path, document.baseURI).href);
                    return `@font-face{font-family:"${font.family}";font-style:normal;font-weight:${font.weight};src:url(${fontData}) format("${font.format ?? 'woff2'}");}`;
                }
                catch (err)
                {
                    console.warn(`${MODULE} | Battle Log share: could not embed ${font.family} ${font.weight}.`, err);
                    return '';
                }
            }));
            return { css, fontFace: faces.join('') };
        })().catch((err) =>
        {
            _assetsPromise = null;
            throw err;
        });
    }
    return _assetsPromise;
}

/** Custom properties come from :root and the recap dialog, so resolve them off the live card. */
function _snapshotVars(el, css)
{
    const names = [...new Set([...css.matchAll(/--[\w-]+/g)].map(match => match[0]))];
    const style = getComputedStyle(el);
    return names
        .map(name => [name, style.getPropertyValue(name).trim()])
        .filter(pair => pair[1] !== '')
        .map(pair => `${pair[0]}:${pair[1]}`)
        .join(';');
}

/** Bake ::before icon glyphs (FA, compcon, MDI) into the clone as real text. */
function _bakeIcons(liveRoot, cloneRoot)
{
    const liveNodes = liveRoot.querySelectorAll('*');
    const cloneNodes = cloneRoot.querySelectorAll('*');
    for (let idx = 0; idx < liveNodes.length && idx < cloneNodes.length; idx++)
    {
        const liveEl = liveNodes[idx];
        if (!/\bfa[srbldt]?\b|\bfa-|\bcci\b|\bcci-|\bmdi\b|\bmdi-/.test(String(liveEl.className || '')))
            continue;
        const beforeStyle = getComputedStyle(liveEl, '::before');
        const content = beforeStyle.content;
        if (!content || content === 'none' || content === 'normal')
            continue;
        const glyph = content.replaceAll(/^["']|["']$/g, '');
        if (!glyph)
            continue;
        const target = /** @type {HTMLElement} */ (cloneNodes[idx]);
        target.textContent = glyph;
        target.style.fontFamily = beforeStyle.fontFamily;
        target.style.fontWeight = beforeStyle.fontWeight;
        target.style.fontStyle = 'normal';
    }
}

/** Tip-row mask icons carry their url() in the style attribute, out of _inlineCssUrls' reach. */
async function _inlineStyleUrls(root)
{
    await Promise.all([...root.querySelectorAll('[style*="url("]')].map(async (el) =>
    {
        const styleText = el.getAttribute('style') ?? '';
        const urlRefs = [...new Set([...styleText.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map(match => match[1]))]
            .filter(ref => !ref.startsWith('data:'));
        if (!urlRefs.length)
            return;
        let rewritten = styleText;
        for (const ref of urlRefs)
        {
            try
            {
                rewritten = rewritten.replaceAll(ref, await _dataUri(new URL(ref, document.baseURI).href));
            }
            catch
            {
                // icon stays blank
            }
        }
        el.setAttribute('style', rewritten);
    }));
}

/** Inline every portrait; one hosted on a remote origin cannot be embedded, so it is dropped. */
async function _inlineImages(root)
{
    let droppedCount = 0;
    await Promise.all([...root.querySelectorAll('img')].map(async (img) =>
    {
        const src = img.getAttribute('src');
        if (!src || src.startsWith('data:'))
            return;
        try
        {
            img.setAttribute('src', await _dataUri(new URL(src, document.baseURI).href));
            img.removeAttribute('onerror');
        }
        catch
        {
            img.remove();
            droppedCount++;
        }
    }));
    return droppedCount;
}

// Applied to the off-screen measurement and inside the SVG alike; they must match.
function _posterCss()
{
    return `
        .la-share-poster,.la-share-poster *,.la-share-poster *::before,.la-share-poster *::after{
            animation:none !important;transition:none !important;box-sizing:border-box;}
        .la-share-poster .battelog-recap-kicker::after{display:none !important;}
        .la-share-poster{display:inline-flex;flex-direction:column;align-items:stretch;width:max-content;
            box-sizing:border-box;background:var(--la-plate);color:var(--la-ink);}
        .la-share-poster .battelog-recap-head{flex:0 0 auto;}
        .la-share-cards{display:flex;align-items:flex-start;gap:${CARD_GAP}px;padding:16px 20px 0;}
        .la-share-cards .battelog-pcol{width:${CARD_WIDTH}px;flex:0 0 ${CARD_WIDTH}px;}
        .la-share-poster .battelog-focus-detail{pointer-events:none;}
        .la-share-foot{margin:16px 20px 0;padding:9px 0 14px;
            border-top:1px solid color-mix(in srgb,var(--la-ink),transparent 88%);
            font-family:'Space Mono','Consolas',monospace;font-size:8px;letter-spacing:1.5px;opacity:0.5;
            text-transform:uppercase;}
    `;
}

/** Load the SVG through an Image so the browser does the layout and painting. */
function _rasterize(svg, width, height)
{
    return new Promise((resolve, reject) =>
    {
        const img = new Image();
        img.onload = async () =>
        {
            // Trade scale for area rather than hand the encoder a canvas it will refuse.
            const scaleBudget = Math.sqrt(MAX_CANVAS_PIXELS / Math.max(1, width * height));
            const scale = Math.max(1, Math.min(EXPORT_SCALE, scaleBudget));
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(1, Math.round(width * scale));
            canvas.height = Math.max(1, Math.round(height * scale));
            const canvasSize = `${canvas.width}x${canvas.height}`;
            try
            {
                // CPU-backed canvas; the desktop app's GPU readback often returns an empty blob.
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx)
                    throw new Error('No 2d context');
                ctx.scale(scale, scale);
                ctx.drawImage(img, 0, 0);
                const blob = await new Promise(done => canvas.toBlob(done, 'image/png'));
                if (blob)
                {
                    resolve(blob);
                    return;
                }
                // toDataURL reports why (tainted canvas throws) where toBlob only yields null.
                const dataUrl = canvas.toDataURL('image/png');
                resolve(await (await fetch(dataUrl)).blob());
            }
            catch (err)
            {
                reject(new Error(`Canvas export failed at ${canvasSize}: ${err.message}`));
            }
        };
        img.onerror = () => reject(new Error('Poster could not be rendered'));
        img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    });
}

async function _copyToClipboard(blob)
{
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined')
        throw new Error('image clipboard unavailable here');
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
    ui.notifications.info('Battle Log card copied to clipboard.');
}

/** Native save dialog; the desktop app hands plain blob downloads to the OS instead of saving. */
async function _saveToFile(blob, filename)
{
    const picker = /** @type {any} */ (window).showSaveFilePicker;
    if (picker)
    {
        const handle = await picker.call(window, {
            suggestedName: filename,
            types: [{ description: 'PNG image', accept: { 'image/png': ['.png'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        return handle.name ?? filename;
    }

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
}

function _showPreview(dataUri, blob, filename)
{
    const dlg = new Dialog({
        title: 'Battle Log · Share Card',
        content: `
            <div style="text-align:center;">
                <img src="${dataUri}" alt="" style="max-width:100%;max-height:60vh;border:none;"/>
            </div>`,
        buttons: {
            copy: {
                icon: '<i class="fas fa-clipboard"></i>',
                label: 'Copy',
                callback: () => _copyToClipboard(blob).catch((err) =>
                {
                    console.warn(`${MODULE} | Clipboard write refused.`, err);
                    ui.notifications.warn(`Clipboard copy failed: ${err.message}`);
                }),
            },
            save: {
                icon: '<i class="fas fa-floppy-disk"></i>',
                label: 'Save to File',
                callback: () => _saveToFile(blob, filename)
                    .then(name => ui.notifications.info(`Saved ${name}.`))
                    .catch((err) =>
                    {
                        if (err?.name === 'AbortError')
                            return;
                        console.error(`${MODULE} | Battle Log card save failed:`, err);
                        ui.notifications.error(`Could not save the file: ${err.message}`);
                    }),
            },
            close: { icon: '<i class="fas fa-times"></i>', label: 'Close' },
        },
        default: 'copy',
    }, { classes: ['lancer-dialog-base'], width: 760 });
    dlg.render(true);
}

async function _deliver(blob, filename, toClipboard)
{
    if (toClipboard)
    {
        try
        {
            await _copyToClipboard(blob);
            return;
        }
        catch (err)
        {
            console.warn(`${MODULE} | Clipboard write refused, showing preview instead.`, err);
        }
    }
    _showPreview(await _blobToDataUri(blob), blob, filename);
}

async function _exportPoster(rootEl, cards, { detailEl = null, filename, toClipboard })
{
    const host = document.createElement('div');
    try
    {
        if (!cards.length)
            throw new Error('No squad cards to export');
        const { css, fontFace } = await _loadAssets();

        const clone = (source) =>
        {
            const copy = /** @type {HTMLElement} */ (source.cloneNode(true));
            // stagger would capture a mid-fade frame
            copy.classList.remove('stagger');
            copy.querySelectorAll('.stagger').forEach(node => node.classList.remove('stagger'));
            // baking pairs live/clone nodes by index, so it runs before any removal
            _bakeIcons(source, copy);
            copy.querySelectorAll('.battelog-pcol-medals-nav').forEach(node => node.remove());
            return copy;
        };

        const poster = document.createElement('div');
        poster.className = 'la-share-poster';
        // fonts come from .lancer-dialog-base, which the clone leaves behind
        const rootStyle = getComputedStyle(rootEl);
        poster.setAttribute('style', `${_snapshotVars(cards[0], css)};font-family:${rootStyle.fontFamily};font-size:${rootStyle.fontSize}`);
        const headEl = rootEl.querySelector('.battelog-recap-head');
        if (headEl)
            poster.appendChild(clone(headEl));
        const row = document.createElement('div');
        row.className = 'la-share-cards';
        cards.forEach(card => row.appendChild(clone(card)));
        if (detailEl)
        {
            // cloned as laid out so the capture matches the screen
            const detailClone = clone(detailEl);
            detailClone.removeAttribute('style');
            detailClone.querySelectorAll('.is-linked, .stagger-done').forEach((panel) =>
            {
                panel.classList.remove('is-linked', 'stagger-done');
            });
            row.querySelectorAll('.battelog-pcol .battelog-tip-panel').forEach(tip => tip.remove());
            row.appendChild(detailClone);
        }
        poster.appendChild(row);
        const foot = document.createElement('div');
        foot.className = 'la-share-foot';
        foot.textContent = 'Lancer Automations · Battle Log';
        poster.appendChild(foot);
        const droppedImages = await _inlineImages(poster);
        await _inlineStyleUrls(poster);

        // the mech-stats tip is styled by tokenStatHint's runtime sheet, not battelog.css
        const hintCss = document.getElementById('la-stat-hint-styles')?.textContent ?? '';
        const sheet = fontFace + css + hintCss + _posterCss();

        // measured live, so the poster rules have to be live here too
        const liveStyle = document.createElement('style');
        liveStyle.textContent = hintCss + _posterCss();
        host.appendChild(liveStyle);
        host.style.cssText = 'position:fixed;left:-30000px;top:0;width:30000px;pointer-events:none;opacity:0;';
        host.appendChild(poster);
        document.body.appendChild(host);
        const rect = poster.getBoundingClientRect();
        const width = Math.ceil(rect.width);
        const height = Math.ceil(rect.height);

        // CDATA, because XMLSerializer would escape > and break child selectors
        const markup = new XMLSerializer().serializeToString(poster);
        const body = `<div xmlns="http://www.w3.org/1999/xhtml">`
            + `<style><![CDATA[${sheet}]]></style>${markup}</div>`;

        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`
            + `<foreignObject x="0" y="0" width="100%" height="100%">${body}</foreignObject></svg>`;

        const blob = await _rasterize(svg, width, height);
        await _deliver(blob, filename, toClipboard);

        if (droppedImages)
            ui.notifications.warn('Portrait could not be embedded (remote image); card exported without it.');
    }
    catch (err)
    {
        console.error(`${MODULE} | Battle Log share failed:`, err);
        ui.notifications.error(`Battle Log card export failed: ${err.message}`);
    }
    finally
    {
        host.remove();
    }
}

const _slug = value => String(value ?? '').toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '');

/**
 * Export the whole squad as one PNG poster, rendered through an SVG foreignObject
 * (canvas-painting libraries mangle the card's color-mix/gradient/clip-path CSS).
 * @param {HTMLElement} rootEl the live recap dialog root
 * @param {object} meta {date}
 * @param {object} [options]
 * @param {boolean} [options.toClipboard] copy straight to the clipboard
 * @returns {Promise<void>}
 */
export async function exportSquadPoster(rootEl, meta = {}, { toClipboard = false } = {})
{
    const cards = Array.from(rootEl?.querySelectorAll('.battelog-pcol') ?? []);
    const slug = _slug(meta.date);
    return _exportPoster(rootEl, cards, {
        filename: `battle-log-squad${slug ? `-${slug}` : ''}.png`,
        toClipboard,
    });
}

/**
 * Export one pilot's card with the focused-view detail layout beside it.
 * @param {HTMLElement} rootEl the live recap dialog root
 * @param {HTMLElement} cardEl the pilot's .battelog-pcol node
 * @param {object} meta {pilot}
 * @param {object} [options]
 * @param {boolean} [options.toClipboard] copy straight to the clipboard
 * @param {HTMLElement} [options.detailEl] a laid-out .battelog-focus-detail to embed as-is
 * @returns {Promise<void>}
 */
export async function exportPlayerPoster(rootEl, cardEl, meta = {}, { toClipboard = false, detailEl = null } = {})
{
    const slug = _slug(meta.pilot);
    return _exportPoster(rootEl, cardEl ? [cardEl] : [], {
        detailEl,
        filename: `battle-log-${slug || 'pilot'}.png`,
        toClipboard,
    });
}
