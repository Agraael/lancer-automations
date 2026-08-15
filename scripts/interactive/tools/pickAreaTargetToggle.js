/* global canvas, PIXI, game, setInterval, clearInterval */
// Cardless AoE target picker built on the shared shape-placement engine. style:ignore

import { getInRangeOffsets } from "../../combat/grid-helpers.js";
import {
    destroyGraphics, gridLineWidth, makeHitLabel,
    gridTextResolution, applyTargetInfoLabel, TG,
} from "../canvas-helpers.js";
import { createShapePlacement, createPlacedShapeStore, buildAreaLabels } from "../shape-placement-engine.js";
import { broadcastToolPresence, clearToolPresence } from "../presence.js";
import { playUiSound } from "../../tah/sound.js";

let _activeCancel = null;
export function isAreaPickerActive()
{
    return !!_activeCancel;
}
export function cancelAreaPicker()
{
    if (_activeCancel)
        _activeCancel();
}

// Placed shapes + targeted ids, kept after the picker exits (cleared on restart/HUD-close/scene-change).
let _placedStore = null;
const _persistTargetIds = new Set();
let _persistRelated = null;
let _persistBeat = null;
function ensurePlacedStore()
{
    if (!_placedStore)
        _placedStore = createPlacedShapeStore();
    return _placedStore;
}
function startPersistBeat()
{
    if (_persistBeat)
        return;
    _persistBeat = setInterval(() =>
    {
        if (!_placedStore?.cells.length)
        {
            stopPersistBeat();
            return;
        }
        broadcastToolPresence('areaPick', { placedCells: _placedStore.cells, labels: _placedStore.labels, relatedToken: _persistRelated });
    }, 1200);
}
function stopPersistBeat()
{
    if (_persistBeat)
    {
        clearInterval(_persistBeat);
        _persistBeat = null;
    }
}
export function clearAreaTargetShape()
{
    stopPersistBeat();
    if (_placedStore)
    {
        _placedStore.destroy();
        _placedStore = null;
    }
    _persistTargetIds.clear();
    _persistRelated = null;
    clearToolPresence('areaPick');
}
function releasePickerTargets()
{
    for (const id of _persistTargetIds)
    {
        const token = canvas.tokens.get(id);
        if (token)
            token.setTarget(false, { releaseOthers: false });
    }
    _persistTargetIds.clear();
}

export function pickAreaTargetToggle(casterToken = null, opts = {})
{
    const {
        pattern = 'blast',
        areaRange = 1,
        size = 1,
        includeSelf = true,
        includeHidden = true,
        keepExisting = false,
        getToggles = () => ({ elevationAware: true, autoElevation: true, propagation: true }),
        hitChanceFor = null,
        castRange = -1,
    } = opts;
    playUiSound('targeting');

    return new Promise((resolve) =>
    {
        if (!keepExisting)
        {
            releasePickerTargets();
            clearAreaTargetShape();
        }
        _persistRelated = casterToken;
        const store = ensurePlacedStore();

        const hitLabelLayer = new PIXI.Container();
        canvas.stage.addChild(hitLabelLayer).eventMode = 'none';
        const hitLabels = new Map();
        const updateHitLabels = (caught) =>
        {
            if (!hitChanceFor)
                return;
            const wanted = new Set();
            for (const token of caught)
            {
                const chance = hitChanceFor(token);
                if (!chance)
                    continue;
                wanted.add(token.id);
                let label = hitLabels.get(token.id);
                if (!label)
                {
                    label = makeHitLabel(hitLabelLayer);
                    hitLabels.set(token.id, label);
                }
                applyTargetInfoLabel(label, chance);
                label.resolution = gridTextResolution();
                label.position.set(token.center.x, token.bounds.top - gridLineWidth(3));
            }
            for (const [id, label] of hitLabels)
            {
                if (!wanted.has(id))
                {
                    label.destroy();
                    hitLabels.delete(id);
                }
            }
        };

        // Red unless the whole shape fits within reach (base range + shape size).
        const colorFor = (result) =>
        {
            if (castRange < 0 || !casterToken || !result?.affected)
                return TG.inRange;
            const inRangeSet = getInRangeOffsets(casterToken, castRange, { includeSelf: true, elevationAware: false });
            return [...result.affected].some(cell => !inRangeSet.has(cell)) ? TG.outOfRange : TG.inRange;
        };

        const onHover = (result) =>
        {
            if (!result)
            {
                updateHitLabels([]);
                broadcastToolPresence('areaPick', { cells: [], tokens: [], placedCells: store.cells, labels: store.labels, relatedToken: _persistRelated });
                return;
            }
            updateHitLabels(result.caught);
            broadcastToolPresence('areaPick', {
                cells: [...result.affected],
                tokens: result.caught.map(token => token.id),
                placedCells: store.cells,
                labels: [...store.labels, ...buildAreaLabels(result)],
                relatedToken: _persistRelated,
            });
        };

        const onPlace = (result) =>
        {
            for (const token of result.caught)
            {
                const already = Array.from(game.user.targets ?? []).some(target => target.id === token.id);
                if (already)
                    continue;
                token.setTarget(true, { releaseOthers: false });
                _persistTargetIds.add(token.id);
            }
        };

        const onDispose = () =>
        {
            _activeCancel = null;
            if (store.cells.length)
            {
                broadcastToolPresence('areaPick', { placedCells: store.cells, labels: store.labels, relatedToken: _persistRelated });
                startPersistBeat();
            }
            else
                clearToolPresence('areaPick');
            for (const label of hitLabels.values())
                label.destroy();
            hitLabels.clear();
            destroyGraphics(hitLabelLayer);
        };

        const controller = createShapePlacement({
            casterToken,
            pattern,
            areaRange,
            size,
            includeSelf,
            includeHidden,
            getToggles,
            placedStore: store,
            colorFor,
            onHover,
            onPlace,
            onResolve: (result) =>
            {
                playUiSound('targetingConfirm');
                resolve(result.caught);
            },
            onCancel: () =>
            {
                playUiSound('toggle');
                resolve(null);
            },
            onDispose,
        });
        _activeCancel = () =>
        {
            playUiSound('toggle');
            controller.dispose();
            resolve(null);
        };
        controller.start();
    });
}
