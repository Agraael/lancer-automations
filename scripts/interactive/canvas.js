// Re-export façade. All implementation lives in canvas-helpers.js (utilities)
// and tools/*.js (one file per interactive tool). The cross-module API
// (`interactive/index.js` -> `export * from './canvas.js'`) keeps working through here.

export {
    pointerToWorld,
    drawRangeHighlight,
    createPulsingRangeHighlight,
    drawMovementTrace,
    getGridDistance,
    showOverlapStackPicker,
    cancelRulerDrag,
    applyKnockbackMoves,
} from "./canvas-helpers.js";

export { chooseToken } from "./tools/chooseToken.js";
export { placeZone } from "./tools/placeZone.js";
export { moveToken } from "./tools/moveToken.js";
export { knockBackToken } from "./tools/knockBackToken.js";
export { placeToken } from "./tools/placeToken.js";
export { pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker } from "./tools/pickSingleTargetToggle.js";
export { pickAreaTargetToggle, isAreaPickerActive, cancelAreaPicker, clearAreaTargetShape } from "./tools/pickAreaTargetToggle.js";
export { clearSingleTargetShape, beginTargetSession } from "./target-shapes.js";
