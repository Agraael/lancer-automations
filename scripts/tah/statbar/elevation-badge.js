import { SETTING_MIN_ZOOM_SCALE, SETTING_ELEVATION_BADGE_SCALE, REF_GRID_SIZE } from './config.js';
import { _getIsoState, getWorldSetting } from './rules.js';

// Elevation badge: directional indicator, top-right of token

export function _elevationBadgeGrowth()
{
    const minZoom = getWorldSetting(SETTING_MIN_ZOOM_SCALE, 0);
    if (minZoom <= 0)
        return 1;
    const zoom = canvas.stage?.scale?.x || 1;
    const gridPx = canvas.dimensions?.size ?? REF_GRID_SIZE;
    return Math.max(1, (REF_GRID_SIZE * minZoom) / (gridPx * zoom));
}

export function _placeElevationBadge(token, badge, iso)
{
    const gridScale = (canvas.dimensions?.size ?? REF_GRID_SIZE) / REF_GRID_SIZE;
    const growth = _elevationBadgeGrowth();
    const badgeScale = gridScale * growth;
    const cellW = badge._laCellW * badgeScale;
    const cellH = badge._laCellH * badgeScale;
    const refSize = badge._laRefSize * gridScale;
    badge._laGrowth = growth;
    if (iso && token.mesh)
    {
        const isoScale = 0.76;
        badge.scale.set(isoScale * badgeScale, badgeScale / isoScale);
        const cosTheta = Math.cos(iso.reverseRotation);
        const sinTheta = Math.sin(iso.reverseRotation);
        const localX = token.w / 2 - refSize + cellW / 2;
        const localY = -token.h / 2 + refSize - cellH / 2;
        const offsetX = (cosTheta * isoScale * localX) + (-sinTheta * (1 / isoScale) * localY);
        const offsetY = (sinTheta * isoScale * localX) + (cosTheta * (1 / isoScale) * localY);
        const worldX = token.mesh.position.x + offsetX;
        const worldY = token.mesh.position.y + offsetY;
        badge.position.set(worldX - token.position.x, worldY - token.position.y);
        return;
    }
    badge.scale.set(badgeScale);
    badge.position.set(token.w - refSize, refSize - cellH - (badge._laPositive ? badge._laArrowH * badgeScale : 0));
}

export function drawElevationBadge(token)
{
    if (token.tooltip)
        token.tooltip.visible = false;

    const srcRaw = token.document?._source?.elevation;
    const derRaw = token.document?.elevation;
    let raw = Number.isFinite(srcRaw) && srcRaw !== derRaw ? srcRaw : derRaw;
    if (token?.isPreview && Number.isFinite(derRaw))
        raw = derRaw;
    const elevation = Number.isFinite(raw) ? Math.round(raw * 2) / 2 : raw;
    const noBadge = !Number.isFinite(elevation) || elevation === 0;

    const iso = _getIsoState(token);
    const isoActive = !!(iso && token.mesh);
    const cachedElev = token._laBadgeElev;
    const cachedIsoState = token._laBadgeIso;
    let prev = token._laBadge;
    if (prev && (prev.destroyed || prev.parent !== token))
        prev = token._laBadge = null;

    if (noBadge)
    {
        if (prev)
        {
            token.removeChild(prev);
            prev.destroy({ children: true });
            token._laBadge = null;
            token._laBadgeElev = undefined;
            token._laBadgeIso = undefined;
        }
        return;
    }

    if (prev && cachedElev === elevation && cachedIsoState === isoActive)
    {
        _placeElevationBadge(token, prev, isoActive ? iso : null);
        return;
    }

    if (prev)
    {
        token.removeChild(prev);
        prev.destroy({ children: true });
        token._laBadge = null;
    }

    const isPositive = elevation > 0;
    const label = Math.abs(elevation).toString();

    // Sized to match effect icons (_shrinkEffectIcons).
    const baseScale = Number(getWorldSetting(SETTING_ELEVATION_BADGE_SCALE, 1)) || 1;
    const refSize = Math.round(REF_GRID_SIZE * 0.1);
    const iconSize = Math.round(refSize * baseScale);
    const cellH = iconSize;
    const cellW = iconSize;
    let arrowH = Math.max(3, Math.round(cellH * 0.5));
    if (arrowH % 2 !== 0)
        arrowH += 1;
    const halfW = Math.round(cellW / 2);

    const badge = new PIXI.Container();
    badge.name = 'la-elevation-badge';
    badge.eventMode = 'none';

    const gfx = new PIXI.Graphics();
    badge.addChild(gfx);
    gfx.lineStyle(0);

    const arrowColor = isPositive ? 0x55aacc : 0xcc7744;

    if (isPositive)
    {
        // ▲ arrow then dark cell
        gfx.beginFill(arrowColor, 1);
        gfx.moveTo(halfW, 0);
        gfx.lineTo(cellW, arrowH);
        gfx.lineTo(0, arrowH);
        gfx.closePath();
        gfx.endFill();

        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(0, arrowH, cellW, cellH);
        gfx.endFill();
        gfx.beginFill(arrowColor, 0.7);
        gfx.drawRect(1, arrowH, cellW - 2, 1);
        gfx.endFill();
    }
    else
    {
        // Dark cell then ▼ arrow
        gfx.beginFill(0x111111, 0.9);
        gfx.drawRect(0, 0, cellW, cellH);
        gfx.endFill();
        gfx.beginFill(arrowColor, 0.7);
        gfx.drawRect(1, cellH - 1, cellW - 2, 1);
        gfx.endFill();

        gfx.beginFill(arrowColor, 1);
        gfx.moveTo(0, cellH);
        gfx.lineTo(cellW, cellH);
        gfx.lineTo(halfW, cellH + arrowH);
        gfx.closePath();
        gfx.endFill();
    }

    const fontSize = Math.max(7, Math.round(cellH * 0.85));
    const style = PreciseText.getTextStyle({
        fontFamily: CONFIG.canvasTextStyle?.fontFamily ?? 'Signika',
        fontSize,
        fontWeight: 'bold',
        fill: '#dddddd',
        align: 'center',
    });
    const txt = new PreciseText(label, style);
    txt.anchor.set(0.5, 0.5);
    const bodyCenterY = isPositive
        ? arrowH + Math.round(cellH / 2)
        : Math.round(cellH / 2);
    txt.position.set(halfW, bodyCenterY);
    badge.addChild(txt);

    Object.assign(badge, { _laCellW: cellW, _laCellH: cellH, _laArrowH: arrowH, _laPositive: isPositive, _laRefSize: refSize });

    if (isoActive)
    {
        badge.pivot.set(cellW / 2, cellH / 2);
        badge.rotation = iso.reverseRotation;
        badge.skew.set(iso.reverseSkewX, iso.reverseSkewY);
    }
    _placeElevationBadge(token, badge, isoActive ? iso : null);
    token.addChild(badge);

    token._laBadge = badge;
    token._laBadgeElev = elevation;
    token._laBadgeIso = isoActive;
}
