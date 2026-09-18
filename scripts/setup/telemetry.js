import { getSupabase } from "./supabase-client.js";
import { localize, localizeFormat } from "../tools/string-utils.js";
import { getModuleSetting } from "../tools/settings-utils.js";

import { MODULE_ID } from '../tools/constants.js';
const INSTALL_ID_SETTING = "dataInstallId";
const CONSENT_SETTING = "dataConsent";
const LAST_PING_SETTING = "dataLastPing";

const ROLE_GM = "gm";
const ROLE_PLAYER = "player";
const ROLE_UNKNOWN = "unknown";
const CONSENT_DECLINED = "declined";
const CONSENT_PENDING = "pending";

const TABLE = "seen_users";

/** @returns {Promise<string>} the client's random install id, created on first use */
export async function getOrCreateInstallId()
{
    try
    {
        let id = getModuleSetting(INSTALL_ID_SETTING) || "";
        if (!id)
        {
            id = foundry.utils.randomID();
            await game.settings.set(MODULE_ID, INSTALL_ID_SETTING, id);
        }
        return id;
    }
    catch
    {
        return foundry.utils.randomID();
    }
}

async function _upsertUser(userHash, role)
{
    const moduleVersion = game.modules.get(MODULE_ID)?.version || "unknown";
    const language = game.i18n.lang || "unknown";

    try
    {
        const { error } = await getSupabase()
            .from(TABLE)
            .upsert({
                user_hash: userHash,
                role,
                module_version: moduleVersion,
                language,
                updated_at: new Date().toISOString(),
            }, { onConflict: "user_hash" });
        if (error)
            throw error;
    }
    catch (err)
    {
        console.error("lancer-automations | Supabase error:", err);
    }
}

async function _pingDaily(_userHash, role)
{
    try
    {
        const { error } = await getSupabase().rpc("record_ping", { p_role: role });
        if (error)
            throw error;
    }
    catch (err)
    {
        console.error("lancer-automations | Supabase daily ping error:", err);
    }
}

async function _maybeDailyTouch(userHash, role)
{
    const today = new Date().toISOString().slice(0, 10);
    const last = getModuleSetting(LAST_PING_SETTING) || "";
    if (last === today)
        return;
    await _pingDaily(userHash, role);
    // Unknown users have no id to upsert; they only count towards the daily total.
    if (userHash)
        await _upsertUser(userHash, role);
    try
    {
        await game.settings.set(MODULE_ID, LAST_PING_SETTING, today);
    }
    catch
    {
        // Setting not registered yet.
    }
}

// Modal: re-shows itself if dismissed without a button.
async function _showFirstLaunchPopup()
{
    return new Promise((resolve) =>
    {
        let answered = false;
        const pick = (value) =>
        {
            answered = true;
            resolve(value);
        };
        new Dialog({
            title: localize('LA.dialogTitle.lancerAutomations'),
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">Hi there!</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p>I'd love to know roughly how many people use this module. If you're up for it, just pick the role you usually play.</p>
                    <p>What gets sent: a random ID generated here, your module version, and your Foundry language. That's it.</p>
                    <p>Already counted somewhere else (another world or another machine)? Pick <em>"I'm already counted"</em> so you're not double-counted.</p>
                    <p>You can change your mind anytime in module settings.</p>
                </div>
            `,
            buttons: {
                gm: {
                    icon: '<i class="fas fa-crown"></i>',
                    label: localize("LA.telemetry.imGm"),
                    callback: () => pick(ROLE_GM),
                },
                player: {
                    icon: '<i class="fas fa-user"></i>',
                    label: localize("LA.telemetry.imPlayer"),
                    callback: () => pick(ROLE_PLAYER),
                },
                decline: {
                    icon: '<i class="fas fa-times"></i>',
                    label: localize("LA.telemetry.alreadyCounted"),
                    callback: () => pick(CONSENT_DECLINED),
                },
            },
            default: "gm",
            close: () =>
            {
                if (!answered)
                    pick(CONSENT_DECLINED);
            },
        }, { width: 550, classes: ["lancer-dialog-base", "lancer-no-title"] }).render(true);
    });
}

async function _runFirstLaunch()
{
    const role = await _showFirstLaunchPopup();
    if (role === CONSENT_DECLINED)
    {
        await game.settings.set(MODULE_ID, CONSENT_SETTING, CONSENT_DECLINED);
        await _maybeDailyTouch("", ROLE_UNKNOWN);
        console.log("lancer-automations | User declined; counted as unknown only.");
        return;
    }
    const installId = foundry.utils.randomID();
    await game.settings.set(MODULE_ID, INSTALL_ID_SETTING, installId);
    await game.settings.set(MODULE_ID, CONSENT_SETTING, role);
    await _upsertUser(installId, role);
    console.log(`lancer-automations | Counted as ${role}.`);
}

async function _handleStartup()
{
    if (!game.user?.id)
        return;

    let consent = getModuleSetting(CONSENT_SETTING) || CONSENT_PENDING;

    // Old 'allowed'/'denied' used a different ID scheme; re-prompt for a clean baseline.
    if (consent === "allowed" || consent === "denied")
        consent = CONSENT_PENDING;

    if (consent === CONSENT_DECLINED)
    {
        await _maybeDailyTouch("", ROLE_UNKNOWN);
        return;
    }

    if (consent === ROLE_GM || consent === ROLE_PLAYER)
    {
        await _maybeDailyTouch(await getOrCreateInstallId(), consent);
        return;
    }

    await _runFirstLaunch();
}

class ConsentMenu extends FormApplication
{
    render()
    {
        const current = getModuleSetting(CONSENT_SETTING);
        const label = current === ROLE_GM ? "currently counted as GM"
            : current === ROLE_PLAYER ? "currently counted as Player"
                : current === CONSENT_DECLINED ? "currently opted out"
                    : "not decided";

        const switchTo = async (role) =>
        {
            const installId = await getOrCreateInstallId();
            await game.settings.set(MODULE_ID, CONSENT_SETTING, role);
            await _upsertUser(installId, role);
            ui.notifications.info(localizeFormat('LA.notify.nowCountedAs', { role }));
        };

        new Dialog({
            title: localize('LA.dialogTitle.changeDataConsent'),
            content: localizeFormat('LA.telemetry.currentRolePrompt', { label }),
            buttons: {
                gm: { icon: '<i class="fas fa-crown"></i>', label: localize("LA.telemetry.countAsGm"), callback: () => switchTo(ROLE_GM) },
                player: { icon: '<i class="fas fa-user"></i>', label: localize("LA.telemetry.countAsPlayer"), callback: () => switchTo(ROLE_PLAYER) },
                decline: {
                    icon: '<i class="fas fa-times"></i>',
                    label: localize("LA.telemetry.optOut"),
                    callback: async () =>
                    {
                        await game.settings.set(MODULE_ID, CONSENT_SETTING, CONSENT_DECLINED);
                        ui.notifications.info(localize('LA.notify.optedOutNoMoreDataWillBe'));
                    },
                },
            },
        }, { width: 420 }).render(true);
        return this;
    }
    async _updateObject()
    {}
}

Hooks.once("setup", () =>
{
    // client scope: per browser; random per install.
    game.settings.register(MODULE_ID, INSTALL_ID_SETTING, {
        scope: "client",
        config: false,
        type: String,
        default: "",
    });
    game.settings.register(MODULE_ID, CONSENT_SETTING, {
        name: "LA.settings.dataConsent.name",
        hint: "LA.settings.dataConsent.hint",
        scope: "client",
        config: false,
        type: String,
        default: CONSENT_PENDING,
    });
    game.settings.register(MODULE_ID, LAST_PING_SETTING, {
        scope: "client",
        config: false,
        type: String,
        default: "",
    });

    game.settings.registerMenu(MODULE_ID, "consentMenu", {
        name: "LA.settings.consentMenu.name",
        label: "LA.settings.consentMenu.label",
        hint: "LA.settings.consentMenu.hint",
        icon: "fas fa-user-shield",
        type: ConsentMenu,
        restricted: false,
    });
});

Hooks.on("ready", async () =>
{
    if (!game.user?.id)
        return;
    await _handleStartup();
});
