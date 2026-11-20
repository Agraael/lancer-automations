import { laRenderWeaponBody, laRenderDeployables } from '../interactive/detail-renderers.js';
import { getWeaponProfiles_WithBonus } from '../tools/weapon-bonus-utils.js';
import { executeProfileSwitch } from '../tools/misc-tools.js';
import { getItemDeployables } from '../interactive/extra-deployables.js';
import { getDeployableInfoSync } from '../interactive/deployable-lookup.js';
import { withV3Chips } from './hud-popups.js';
import { playUiSound } from './sound.js';

function weaponProfiles(weapon, actor)
{
    const sys = weapon.system;
    const profiles = getWeaponProfiles_WithBonus(weapon, actor);
    if (profiles.length)
        return profiles;

    if (weapon.type === 'npc_feature')
    {
        const tierOverride = sys.tier_override ?? 0;
        const tier = tierOverride > 0 ? tierOverride : (actor?.system?.tier ?? 1);
        const tierIdx = Math.max(0, Math.min(2, tier - 1));
        const atkBonus = Array.isArray(sys.attack_bonus) ? (sys.attack_bonus[tierIdx] ?? 0) : 0;
        const atkAcc = Array.isArray(sys.accuracy) ? (sys.accuracy[tierIdx] ?? 0) : 0;
        return [{ name: null, damage: (sys.damage ?? [])[tierIdx] ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '', attack_bonus: atkBonus, accuracy: atkAcc, tech_attack: sys.tech_attack ?? false, weapon_type: sys.weapon_type ?? '' }];
    }

    if (weapon.type === 'pilot_weapon')
        return [{ name: null, damage: sys.damage ?? [], range: sys.range ?? [], tags: sys.tags ?? [], effect: sys.effect || '', on_hit: sys.on_hit || '' }];
    return profiles;
}

export function weaponPopupOptions(weapon, modItem, actor)
{
    const buildBody = () =>
    {
        const sys = weapon.system;
        return laRenderWeaponBody(weaponProfiles(weapon, actor), {
            actions: sys.actions ?? [],
            modName: modItem?.name ?? null,
            modItem: modItem ?? null,
            activeProfileIndex: sys.selected_profile_index ?? 0,
            switchable: (sys.profiles?.length ?? 0) > 1,
        });
    };

    const weaponSubtitle = () =>
    {
        const sys = weapon.system;
        const profileType = sys.profiles?.[sys.selected_profile_index ?? 0]?.type;
        return [sys.mount_type ?? sys.size, profileType ?? sys.weapon_type].filter(Boolean).join(' · ');
    };

    const bindProfileSwitch = (popup) =>
    {
        popup.data('laRebuild', () =>
        {
            popup.find('.la-weapon-body').html(withV3Chips(buildBody(), weapon));
            popup.find('.la-detail-subtitle').text(weaponSubtitle());
            bindProfileSwitch(popup);
        });
        popup.find('.la-profile-set[data-profile-idx]').on('click', async function (ev)
        {
            ev.stopPropagation();
            const idx = Number(this.dataset.profileIdx);
            if (idx === (weapon.system?.selected_profile_index ?? 0))
                return;
            playUiSound('toggle');
            await executeProfileSwitch(weapon, idx);
        });
    };

    const depActors = getItemDeployables(weapon, actor).map(lid => getDeployableInfoSync(lid, actor)).filter(Boolean);
    const deployablesHtml = depActors.length ? laRenderDeployables(depActors) : '';

    return {
        cssClass: 'la-hud-popup la-hud-weapon-popup',
        dataKey: 'weapon-id',
        dataValue: weapon.id,
        title: weapon.name,
        subtitle: weaponSubtitle(),
        bodyHtml: `<div class="la-weapon-body">${buildBody()}</div>` + deployablesHtml,
        theme: 'weapon',
        item: weapon,
        postRender: bindProfileSwitch,
    };
}
