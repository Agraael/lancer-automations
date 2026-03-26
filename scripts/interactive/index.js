/* global game */

export * from './cards.js';
export * from './canvas.js';
export * from './network.js';
export * from './deployables.js';
export * from './combat.js';

import { chooseToken, placeZone, knockBackToken, placeToken, getGridDistance, drawRangeHighlight, drawMovementTrace } from './canvas.js';
import { startChoiceCard, showUserIdControlledChoiceCard, resolveGMChoiceCard, showMultiUserControlledChoiceCard, cancelBroadcastChoiceCard, startVoteCard, showVoteCardOnVoter, receiveVoteSubmission, updateVoteCardOnVoter, confirmVoteCardOnVoter, cancelVoteCardOnVoter, getTokenOwnerUserId } from './network.js';
import { deployWeaponToken, pickupWeaponToken, resolveDeployable, placeDeployable, deployDeployable, beginDeploymentCard, openDeployableMenu, recallDeployable, addItemFlags, addExtraDeploymentLids, addExtraActions, getItemDeployables, getItemActions, getItemFlags, setItemAsActivated, getActivatedItems, endItemActivation, openEndActivationMenu, pickItem, reloadOneWeapon, rechargeSystem, getWeapons, findItemByLid, getActorActions, removeExtraActions, spawnHardCover } from './deployables.js';
import { openThrowMenu, revertMovement, clearMovementHistory, openChoiceMenu, choseMount, chooseInvade, choseSystem, choseTrait } from './combat.js';

export const InteractiveAPI = {
    chooseToken,
    placeZone,
    knockBackToken,
    placeToken,
    startChoiceCard,
    getTokenOwnerUserId,
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
    addExtraActions,
    getItemDeployables,
    getItemActions,
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
    rechargeSystem,
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
    choseTrait,
    getActorActions,
    removeExtraActions,
    spawnHardCover
};
