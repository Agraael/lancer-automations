import { getLAFlag } from '../tools/flag-utils.js';

export const grappleState = token => (token ? getLAFlag(token.document, 'grappleState') || {} : {});

export const isGrappling = token => (grappleState(token).grappledIds?.length ?? 0) > 0;

export const isGrappled = token => (grappleState(token).grapplerIds?.length ?? 0) > 0;
