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
import { FilterSliceTear } from './effects/sliceTear.js';
import { FilterToonFlames } from './effects/toonFlames.js';
import { FilterNaniteSwarm } from './effects/naniteSwarm.js';
import { FilterFeverThrob } from './effects/feverThrob.js';
import { FilterCodeRain } from './effects/codeRain.js';
import { FilterDataBleed } from './effects/dataBleed.js';
import { FilterFilmEcho } from './effects/filmEcho.js';
import { FilterTeslaTremor } from './effects/teslaTremor.js';
import { FilterSignalCut } from './effects/signalCut.js';
import { FilterOutOfFocus } from './effects/outOfFocus.js';
import { FilterChromaRotPlus } from './effects/chromaRotPlus.js';
import { FilterChainSets } from './effects/chainSets.js';
import { FilterRecoil } from './effects/recoil.js';
import { FilterForgeSeams } from './effects/forgeSeams.js';
import { FilterHeatPurge } from './effects/heatPurge.js';
import { FilterThermalScan } from './effects/thermalScan.js';
import { FilterShedPlates } from './effects/shedPlates.js';
import { FilterPlatingDrip } from './effects/platingDrip.js';
import { FilterWireFrame } from './effects/wireFrame.js';
import { FilterGrindSparks } from './effects/grindSparks.js';
import { FilterCutTorch } from './effects/cutTorch.js';
import { FilterCrackShell } from './effects/crackShell.js';

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
    FilterConvectionChurn,
    FilterSliceTear,
    FilterToonFlames,
    FilterNaniteSwarm,
    FilterFeverThrob,
    FilterCodeRain,
    FilterDataBleed,
    FilterFilmEcho,
    FilterTeslaTremor,
    FilterSignalCut,
    FilterOutOfFocus,
    FilterChromaRotPlus,
    FilterChainSets,
    FilterRecoil,
    FilterForgeSeams,
    FilterHeatPurge,
    FilterThermalScan,
    FilterShedPlates,
    FilterPlatingDrip,
    FilterWireFrame,
    FilterGrindSparks,
    FilterCutTorch,
    FilterCrackShell
};

const LA_FILTERS = {
    fracture: FilterFracture,
    chains: FilterChains,
    chromaRot: FilterChromaRot,
    openSeams: FilterOpenSeams,
    trackingGhost: FilterTrackingGhost,
    seamBeat: FilterSeamBeat,
    doubleShell: FilterDoubleShell,
    ventColumn: FilterVentColumn,
    guidingLight: FilterGuidingLight,
    ablativeCrust: FilterAblativeCrust,
    noDrift: FilterNoDrift,
    shatterSeams: FilterShatterSeams,
    thermalSplit: FilterThermalSplit,
    slicePlane: FilterSlicePlane,
    overflowWrap: FilterOverflowWrap,
    errorCorrection: FilterErrorCorrection,
    coldSoak: FilterColdSoak,
    ricochetLip: FilterRicochetLip,
    convectionChurn: FilterConvectionChurn,
    sliceTear: FilterSliceTear,
    toonFlames: FilterToonFlames,
    naniteSwarm: FilterNaniteSwarm,
    feverThrob: FilterFeverThrob,
    codeRain: FilterCodeRain,
    dataBleed: FilterDataBleed,
    filmEcho: FilterFilmEcho,
    teslaTremor: FilterTeslaTremor,
    signalCut: FilterSignalCut,
    outOfFocus: FilterOutOfFocus,
    chromaRotPlus: FilterChromaRotPlus,
    chainSets: FilterChainSets,
    recoil: FilterRecoil,
    forgeSeams: FilterForgeSeams,
    heatPurge: FilterHeatPurge,
    thermalScan: FilterThermalScan,
    shedPlates: FilterShedPlates,
    platingDrip: FilterPlatingDrip,
    wireFrame: FilterWireFrame,
    grindSparks: FilterGrindSparks,
    cutTorch: FilterCutTorch,
    crackShell: FilterCrackShell,
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

    Object.assign(FilterType, LA_FILTERS);
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
            Object.assign(bundleFT, LA_FILTERS);
            console.log('lancer-automations | Registered custom filters on bundle FilterType');
        }
    }
    catch (e)
    {
        console.warn('lancer-automations | Bundle FilterType patch failed; updateToken reconstruction may still log errors.', e);
    }
});

