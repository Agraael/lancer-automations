/* global game */

import * as cards from './cards.js';
import * as canvas from './canvas.js';
import * as network from './network.js';
import * as deployables from './deployables.js';
import * as combat from './combat.js';

export * from './cards.js';
export * from './canvas.js';
export * from './network.js';
export * from './deployables.js';
export * from './combat.js';

export const InteractiveAPI = {
    ...cards,
    ...canvas,
    ...network,
    ...deployables,
    ...combat,
};
