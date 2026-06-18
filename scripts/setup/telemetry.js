import { getSupabase } from "./supabase-client.js";

const MODULE_NAMESPACE = "lancer-automations";
const INSTALL_ID_SETTING = "dataInstallId";
const CONSENT_SETTING = "dataConsent";
const LAST_PING_SETTING = "dataLastPing";

const ROLE_GM = "gm";
const ROLE_PLAYER = "player";
const CONSENT_DECLINED = "declined";
const CONSENT_PENDING = "pending";

const TABLE = "seen_users";

async function _upsertUser(userHash, role) {
    const moduleVersion = game.modules.get(MODULE_NAMESPACE)?.version || "unknown";
    const language = game.i18n.lang || "unknown";

    try {
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
    } catch (err) {
        console.error("Lancer Automation | Supabase error:", err);
    }
}

async function _pingDaily(_userHash, role) {
    try {
        const { error } = await getSupabase().rpc("record_ping", { p_role: role });
        if (error)
            throw error;
    } catch (err) {
        console.error("Lancer Automation | Supabase daily ping error:", err);
    }
}

async function _maybeDailyTouch(userHash, role) {
    const today = new Date().toISOString().slice(0, 10);
    let last = "";
    try {
        last = game.settings.get(MODULE_NAMESPACE, LAST_PING_SETTING) || "";
    } catch {
        // Setting not registered yet.
    }
    if (last === today)
        return;
    await _pingDaily(userHash, role);
    await _upsertUser(userHash, role);
    try {
        await game.settings.set(MODULE_NAMESPACE, LAST_PING_SETTING, today);
    } catch {
        // Setting not registered yet.
    }
}

// Modal: re-shows itself if dismissed without a button.
async function _showFirstLaunchPopup() {
    return new Promise((resolve) => {
        let answered = false;
        const pick = (value) => {
            answered = true;
            resolve(value);
        };
        new Dialog({
            title: "Lancer Automations",
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">Hi there!</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p>I'd love to know roughly how many people use this module. If you're up for it, just pick the role you usually play.</p>
                    <p>What gets sent: a random ID generated here, your module version, and your Foundry language. That's it.</p>
                    <p>Already counted somewhere else (another world or another machine)? Pick <em>"Don't count me"</em> here so you're not double-counted.</p>
                    <p>You can change your mind anytime in module settings.</p>
                </div>
            `,
            buttons: {
                gm: {
                    icon: '<i class="fas fa-crown"></i>',
                    label: "I'm a GM",
                    callback: () => pick(ROLE_GM),
                },
                player: {
                    icon: '<i class="fas fa-user"></i>',
                    label: "I'm a Player",
                    callback: () => pick(ROLE_PLAYER),
                },
                decline: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "I'm already counted (Or don't want to be)",
                    callback: () => pick(CONSENT_DECLINED),
                },
            },
            default: "gm",
            close: () => {
                if (!answered)
                    pick(CONSENT_DECLINED);
            },
        }, { width: 550, classes: ["lancer-dialog-base", "lancer-no-title"] }).render(true);
    });
}

async function _runFirstLaunch() {
    const role = await _showFirstLaunchPopup();
    if (role === CONSENT_DECLINED) {
        await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, CONSENT_DECLINED);
        console.log("Lancer Automation | User declined; no data sent.");
        return;
    }
    const installId = foundry.utils.randomID();
    await game.settings.set(MODULE_NAMESPACE, INSTALL_ID_SETTING, installId);
    await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, role);
    await _upsertUser(installId, role);
    console.log(`Lancer Automation | Counted as ${role}.`);
}

async function _handleStartup() {
    if (!game.user?.id)
        return;

    let consent = CONSENT_PENDING;
    try {
        consent = game.settings.get(MODULE_NAMESPACE, CONSENT_SETTING) || CONSENT_PENDING;
    } catch {
        // Setting not registered yet; treat as pending.
    }

    // Old scheme had 'allowed'/'denied' tied to a different ID and now-empty Supabase tables.
    // Re-prompt both groups so the new role-based count starts from a clean baseline.
    if (consent === "allowed" || consent === "denied")
        consent = CONSENT_PENDING;

    if (consent === CONSENT_DECLINED)
        return;

    if (consent === ROLE_GM || consent === ROLE_PLAYER) {
        let installId = "";
        try {
            installId = game.settings.get(MODULE_NAMESPACE, INSTALL_ID_SETTING) || "";
        } catch { /* not registered yet */ }
        if (!installId) {
            installId = foundry.utils.randomID();
            await game.settings.set(MODULE_NAMESPACE, INSTALL_ID_SETTING, installId);
        }
        await _maybeDailyTouch(installId, consent);
        return;
    }

    await _runFirstLaunch();
}

class ConsentMenu extends FormApplication {
    render() {
        const current = game.settings.get(MODULE_NAMESPACE, CONSENT_SETTING);
        const label = current === ROLE_GM ? "currently counted as GM"
            : current === ROLE_PLAYER ? "currently counted as Player"
                : current === CONSENT_DECLINED ? "currently opted out"
                    : "not decided";

        const switchTo = async (role) => {
            let installId = game.settings.get(MODULE_NAMESPACE, INSTALL_ID_SETTING) || "";
            if (!installId) {
                installId = foundry.utils.randomID();
                await game.settings.set(MODULE_NAMESPACE, INSTALL_ID_SETTING, installId);
            }
            await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, role);
            await _upsertUser(installId, role);
            ui.notifications.info(`Now counted as ${role}. Thank you!`);
        };

        new Dialog({
            title: "Change Data Consent",
            content: `<p>You are <strong>${label}</strong>.</p><p>What would you like?</p>`,
            buttons: {
                gm: { icon: '<i class="fas fa-crown"></i>', label: "Count me as GM", callback: () => switchTo(ROLE_GM) },
                player: { icon: '<i class="fas fa-user"></i>', label: "Count me as Player", callback: () => switchTo(ROLE_PLAYER) },
                decline: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "Opt out",
                    callback: async () => {
                        await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, CONSENT_DECLINED);
                        ui.notifications.info("Opted out. No more data will be sent.");
                    },
                },
            },
        }, { width: 420 }).render(true);
        return this;
    }
    async _updateObject() {}
}

Hooks.once("setup", () => {
    // client scope: per browser; random per install.
    game.settings.register(MODULE_NAMESPACE, INSTALL_ID_SETTING, {
        scope: "client",
        config: false,
        type: String,
        default: "",
    });
    game.settings.register(MODULE_NAMESPACE, CONSENT_SETTING, {
        name: "Data Collection Consent",
        hint: "Anonymous count of GM/Player installs (no game.userId, no IP).",
        scope: "client",
        config: false,
        type: String,
        default: CONSENT_PENDING,
    });
    game.settings.register(MODULE_NAMESPACE, LAST_PING_SETTING, {
        scope: "client",
        config: false,
        type: String,
        default: "",
    });

    game.settings.registerMenu(MODULE_NAMESPACE, "consentMenu", {
        name: "Change Data Consent",
        label: "Update Consent",
        hint: "Change your role or opt out at any time.",
        icon: "fas fa-user-shield",
        type: ConsentMenu,
        restricted: false,
    });
});

Hooks.on("ready", async () => {
    if (!game.user?.id)
        return;
    await _handleStartup();
});
