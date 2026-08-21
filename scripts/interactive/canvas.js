// Re-export façade. All implementation lives in canvas-helpers.js (utilities)
// and tools/*.js (one file per interactive tool). The cross-module API
// (`interactive/index.js` -> `export * from './canvas.js'`) keeps working through here.

export {
    pointerToWorld,
    drawRangeHighlight,
    createPulsingRangeHighlight,
    createMergedRangeHighlight,
    drawMovementTrace,
    getGridDistance,
    showOverlapStackPicker,
    cancelRulerDrag,
    applyKnockbackMoves,
    gridLineWidth,
    RANGE_GLOW,
} from "./canvas-helpers.js";

export { chooseToken } from "./tools/chooseToken.js";
export { placeZone, tokensInTemplate } from "./tools/placeZone.js";
export { moveToken } from "./tools/moveToken.js";
export { placeToken } from "./tools/placeToken.js";
export { pickSingleTargetToggle, isSingleTargetPickerActive, cancelSingleTargetPicker } from "./tools/pickSingleTargetToggle.js";
export { pickTokensCardless, isCardlessTokenPickerActive, cancelCardlessTokenPicker } from "./tools/pickTokensCardless.js";
export { pickAreaTargetToggle, isAreaPickerActive, cancelAreaPicker, clearAreaTargetShape } from "./tools/pickAreaTargetToggle.js";
export { clearSingleTargetShape, beginTargetSession, isTargetSessionActive, createTokenMark, createChanceLabel } from "./target-shapes.js";
export { rangePulse, RANGE_PULSE_PRIORITY } from "./range-pulse-manager.js";
export {
    toggleAdvancedMeasure, openAdvancedMeasure, closeAdvancedMeasure,
    isAdvancedMeasureActive, initAdvancedMeasureAutoClose, resetAdvancedMeasureState,
} from "./tools/advancedMeasure.js";
