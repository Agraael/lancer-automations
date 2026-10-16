import { getExternalSetting } from './settings-utils.js';

const _api = () => /** @type {any} */ (game.modules.get('token-factions'))?.api;

export const tfGetTeams = () => _api()?.getTeams?.() ?? [];

export const tfGetTeam = (tokenOrActor) => _api()?.getTeam?.(tokenOrActor) ?? null;

export const tfTeamsColorSides = () => _api()?.teamsEnabled?.() === true && getExternalSetting('token-factions', 'color-from') === 'advanced-factions';

export const tfGetDisposition = (viewer, target) => _api()?.getDisposition?.(viewer, target) ?? null;
