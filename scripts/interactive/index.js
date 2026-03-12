/* global game */

export * from './cards.js';
export * from './canvas.js';
export * from './network.js';
export * from './deployables.js';
export * from './combat.js';

import { chooseToken, placeZone, knockBackToken, placeToken, getGridDistance, drawRangeHighlight, drawMovementTrace } from './canvas.js';
import { startChoiceCard, showUserIdControlledChoiceCard, resolveGMChoiceCard, showMultiUserControlledChoiceCard, cancelBroadcastChoiceCard, startVoteCard, showVoteCardOnVoter, receiveVoteSubmission, updateVoteCardOnVoter, confirmVoteCardOnVoter, cancelVoteCardOnVoter } from './network.js';
import { deployWeaponToken, pickupWeaponToken, resolveDeployable, placeDeployable, deployDeployable, beginDeploymentCard, openDeployableMenu, recallDeployable, addItemFlags, addExtraDeploymentLids, getItemDeployables, getItemFlags, setItemAsActivated, getActivatedItems, endItemActivation, openEndActivationMenu, pickItem, reloadOneWeapon, getWeapons, findItemByLid } from './deployables.js';
import { openThrowMenu, revertMovement, clearMovementHistory, openChoiceMenu, choseMount, chooseInvade, choseSystem, choseTrait } from './combat.js';

export const InteractiveAPI = {
    chooseToken,
    placeZone,
    knockBackToken,
    placeToken,
    startChoiceCard,
    deployWeaponToken,
    pickupWeaponToken,
    resolveDeployable,
    placeDeployable,
    deployDeployable,
    beginDeploymentCard,
    openDeployableMenu,
    recallDeployable,
    addItemFlags,
    addExtraDeploymentLids,
    getItemDeployables,
    getItemFlags,
    openThrowMenu,
    getGridDistance,
    drawRangeHighlight,
    revertMovement,
    clearMovementHistory,
    showUserIdControlledChoiceCard,
    resolveGMChoiceCard,
    showMultiUserControlledChoiceCard,
    cancelBroadcastChoiceCard,
    drawMovementTrace,
    pickItem,
    reloadOneWeapon,
    getWeapons,
    findItemByLid,
    setItemAsActivated,
    getActivatedItems,
    endItemActivation,
    openEndActivationMenu,
    openChoiceMenu,
    startVoteCard,
    showVoteCardOnVoter,
    receiveVoteSubmission,
    updateVoteCardOnVoter,
    confirmVoteCardOnVoter,
    cancelVoteCardOnVoter,
    choseMount,
    chooseInvade,
    choseSystem,
    choseTrait
};
