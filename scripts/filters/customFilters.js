/**
 * Registers the LA custom filters on TokenMagic. FilterType isn't exported from the v13 bundle, so we
 * dynamic-import TokenMagic's source instead of re-importing the module, which would re-run its init
 * hook and crash on a duplicate libWrapper.register.
 *
 * Each filter lives in effects/, the shared vertex shader and apply() body in filter-core.js.
 */

import { FilterFracture } from './effects/fracture.js';
import { FilterChains } from './effects/chains.js';
import { FilterChromaRot } from './effects/chromaRot.js';
import { FilterOpenSeams } from './effects/openSeams.js';
import { FilterTrackingGhost } from './effects/trackingGhost.js';
import { FilterSeamBeat } from './effects/seamBeat.js';
import { FilterDoubleShell } from './effects/doubleShell.js';
import { FilterVentColumn } from './effects/ventColumn.js';
import { FilterGuidingLight } from './effects/guidingLight.js';
import { FilterAblativeCrust } from './effects/ablativeCrust.js';
import { FilterNoDrift } from './effects/noDrift.js';
import { FilterShatterSeams } from './effects/shatterSeams.js';
import { FilterThermalSplit } from './effects/thermalSplit.js';
import { FilterSlicePlane } from './effects/slicePlane.js';
import { FilterOverflowWrap } from './effects/overflowWrap.js';
import { FilterErrorCorrection } from './effects/errorCorrection.js';
import { FilterColdSoak } from './effects/coldSoak.js';
import { FilterRicochetLip } from './effects/ricochetLip.js';
import { FilterConvectionChurn } from './effects/convectionChurn.js';

export {
    FilterFracture,
    FilterChains,
    FilterChromaRot,
    FilterOpenSeams,
    FilterTrackingGhost,
    FilterSeamBeat,
    FilterDoubleShell,
    FilterVentColumn,
    FilterGuidingLight,
    FilterAblativeCrust,
    FilterNoDrift,
    FilterShatterSeams,
    FilterThermalSplit,
    FilterSlicePlane,
    FilterOverflowWrap,
    FilterErrorCorrection,
    FilterColdSoak,
    FilterRicochetLip,
    FilterConvectionChurn
};

let FilterType = null;

// Register the LA custom filters on both TMFX FilterType objects (source + minified bundle, found by shape), at init because TokenMagic rebuilds from flags on the first canvasReady.
Hooks.once('init', async () =>
{
    if (!game.modules.get('tokenmagic')?.active)
        return;

    // 1) Source-module patch (keeps the visual effect rendering).
    try
    {
        // @ts-expect-error a rooted URL import has no type source
        const mod = await import('/modules/tokenmagic/module/tokenmagic.js');
        FilterType = mod?.FilterType ?? null;
    }
    catch (e)
    {
        console.warn('lancer-automations | TokenMagic source import failed; custom filters disabled.', e);
        return;
    }
    if (!FilterType)
    {
        console.warn('lancer-automations | TokenMagic FilterType export not found; custom filters disabled.');
        return;
    }
    FilterType.fracture = FilterFracture;
    FilterType.chains = FilterChains;
    FilterType.chromaRot = FilterChromaRot;
    FilterType.openSeams = FilterOpenSeams;
    FilterType.trackingGhost = FilterTrackingGhost;
    FilterType.seamBeat = FilterSeamBeat;
    FilterType.doubleShell = FilterDoubleShell;
    FilterType.ventColumn = FilterVentColumn;
    FilterType.guidingLight = FilterGuidingLight;
    FilterType.ablativeCrust = FilterAblativeCrust;
    FilterType.noDrift = FilterNoDrift;
    FilterType.shatterSeams = FilterShatterSeams;
    FilterType.thermalSplit = FilterThermalSplit;
    FilterType.slicePlane = FilterSlicePlane;
    FilterType.overflowWrap = FilterOverflowWrap;
    FilterType.errorCorrection = FilterErrorCorrection;
    FilterType.coldSoak = FilterColdSoak;
    FilterType.ricochetLip = FilterRicochetLip;
    FilterType.convectionChurn = FilterConvectionChurn;
    console.log('lancer-automations | Registered custom filters on source FilterType');

    // 2) Bundle-internal patch: scan bundle module exports for the FilterType by shape (stock keys).
    try
    {
        const chunkArr = /** @type {any} */ (self).webpackChunktokenmagic;
        if (!Array.isArray(chunkArr))
            return;
        /** @type {any} */
        let webpackRequire = null;
        chunkArr.push([['__la_capture_tmfx_filterType__'], {}, (r) =>
        {
            webpackRequire = r;
        }]);
        if (!webpackRequire?.m)
            return;
        const STOCK_KEYS = ['adjustment', 'glow', 'outline', 'blur'];
        let bundleFT = null;
        for (const id of Object.keys(webpackRequire.m))
        {
            let mod;
            try
            {
                mod = webpackRequire(id);
            }
            catch
            {
                continue;
            }
            if (!mod)
                continue;
            for (const key of Object.keys(mod))
            {
                const exportVal = mod[key];
                if (!exportVal || typeof exportVal !== 'object')
                    continue;
                if (!STOCK_KEYS.every(k => k in exportVal))
                    continue;
                bundleFT = exportVal;
                console.log('lancer-automations | Found bundle FilterType (module', id, ', export', key, ')');
                break;
            }
            if (bundleFT)
                break;
        }
        if (bundleFT && bundleFT !== FilterType)
        {
            bundleFT.fracture = FilterFracture;
            bundleFT.chains = FilterChains;
            bundleFT.chromaRot = FilterChromaRot;
            bundleFT.openSeams = FilterOpenSeams;
            bundleFT.trackingGhost = FilterTrackingGhost;
            bundleFT.seamBeat = FilterSeamBeat;
            bundleFT.doubleShell = FilterDoubleShell;
            bundleFT.ventColumn = FilterVentColumn;
            bundleFT.guidingLight = FilterGuidingLight;
            bundleFT.ablativeCrust = FilterAblativeCrust;
            bundleFT.noDrift = FilterNoDrift;
            bundleFT.shatterSeams = FilterShatterSeams;
            bundleFT.thermalSplit = FilterThermalSplit;
            bundleFT.slicePlane = FilterSlicePlane;
            bundleFT.overflowWrap = FilterOverflowWrap;
            bundleFT.errorCorrection = FilterErrorCorrection;
            bundleFT.coldSoak = FilterColdSoak;
            bundleFT.ricochetLip = FilterRicochetLip;
            bundleFT.convectionChurn = FilterConvectionChurn;
            console.log('lancer-automations | Registered custom filters on bundle FilterType');
        }
    }
    catch (e)
    {
        console.warn('lancer-automations | Bundle FilterType patch failed; updateToken reconstruction may still log errors.', e);
    }
});

