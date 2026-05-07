const SUPABASE_URL = "https://exglsurpdbmpkvqdfvid.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV4Z2xzdXJwZGJtcGt2cWRmdmlkIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzc5MTcyNzAsImV4cCI6MjA5MzQ5MzI3MH0.p6oLn61mhe9hxThh-bwkVIADvSU6oyG4VnAkhkJmHJU";
const HASH_SALT = "a-random-secret-string-change-this";
const MODULE_NAMESPACE = "lancer-automations";
const CONSENT_SETTING = "dataConsent";
const CONSENT_ALLOWED = "allowed";
const CONSENT_DENIED = "denied";

async function hashUserId(userId, salt) {
    const data = new TextEncoder().encode(userId + salt);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function _countThisUser() {
    if (!game.user?.id)
        return;

    const isGM = game.user.isGM;
    const userHash = await hashUserId(game.user.id, HASH_SALT);

    const moduleInfo = game.modules.get(MODULE_NAMESPACE);
    const moduleVersion = moduleInfo?.version || "unknown";
    const language = game.i18n.lang || "unknown";

    const { createClient } = window.supabase;
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    try {
        if (isGM) {
            const { data: existing, error: selectErr } = await supabase
                .from("seen_gms")
                .select("user_hash")
                .eq("user_hash", userHash)
                .maybeSingle();
            if (selectErr)
                throw selectErr;

            if (!existing) {
                const { data: counter, error: getErr } = await supabase
                    .from("counters")
                    .select("gm_count")
                    .eq("id", 1)
                    .single();
                if (getErr)
                    throw getErr;

                const newCount = counter.gm_count + 1;
                const { error: updateErr } = await supabase
                    .from("counters")
                    .update({ gm_count: newCount })
                    .eq("id", 1);
                if (updateErr)
                    throw updateErr;

                const { error: insertErr } = await supabase
                    .from("seen_gms")
                    .insert({
                        user_hash: userHash,
                        module_version: moduleVersion,
                        language: language
                    });
                if (insertErr)
                    throw insertErr;
            } else {
                // Refresh version + language for an already-counted GM.
                const { error: updateErr } = await supabase
                    .from("seen_gms")
                    .update({
                        module_version: moduleVersion,
                        language: language
                    })
                    .eq("user_hash", userHash);
                if (updateErr)
                    throw updateErr;
            }
        } else {
            const { data: existing, error: selectErr } = await supabase
                .from("seen_players")
                .select("user_hash")
                .eq("user_hash", userHash)
                .maybeSingle();
            if (selectErr)
                throw selectErr;

            if (!existing) {
                const { data: counter, error: getErr } = await supabase
                    .from("counters")
                    .select("player_count")
                    .eq("id", 1)
                    .single();
                if (getErr)
                    throw getErr;

                const newCount = counter.player_count + 1;
                const { error: updateErr } = await supabase
                    .from("counters")
                    .update({ player_count: newCount })
                    .eq("id", 1);
                if (updateErr)
                    throw updateErr;

                const { error: insertErr } = await supabase
                    .from("seen_players")
                    .insert({
                        user_hash: userHash,
                        module_version: moduleVersion,
                        language: language
                    });
                if (insertErr)
                    throw insertErr;
            } else {
                const { error: updateErr } = await supabase
                    .from("seen_players")
                    .update({
                        module_version: moduleVersion,
                        language: language
                    })
                    .eq("user_hash", userHash);
                if (updateErr)
                    throw updateErr;
            }
        }
    } catch (err) {
        console.error(`Lancer Automation | Supabase error:`, err);
    }
}

async function _showConsentDialog() {
    return new Promise((resolve) => {
        new Dialog({
            title: "Data Collection Consent",
            content: `
                <div class="lancer-dialog-header">
                    <div class="lancer-dialog-title">Collecting Data</div>
                </div>
                <div style="padding: 8px 10px; line-height: 1.5;">
                    <p>Hi there! As the project grows, I'm curious to know how many users and players are using this module.</p>
                    <p><strong>To be accurate, I can't do it anonymously.</strong><br>
                    I take your <code>game.userId</code> and <strong>hash</strong> it before storing it in my database.<br>
                    I cannot reverse the hash to get your username or any personal data.</p>
                    <p>I also collect <strong>your module version and Foundry language setting</strong>
                    <p>No other data (IP, character names, etc.) is ever collected.</p>
                    <p>You can change your mind later in the module settings.</p>
                </div>
            `,
            buttons: {
                yes: {
                    icon: '<i class="fas fa-check"></i>',
                    label: "Yes, allow counting",
                    callback: () => resolve(true),
                },
                no: {
                    icon: '<i class="fas fa-times"></i>',
                    label: "No, thanks",
                    callback: () => resolve(false),
                },
            },
            default: "yes",
            close: () => resolve(false),
        }, { width: 550, classes: ["lancer-dialog-base", "lancer-no-title"] }).render(true);
    });
}

async function _requestConsentAndMaybeCount() {
    const allowed = await _showConsentDialog();
    const decision = allowed ? CONSENT_ALLOWED : CONSENT_DENIED;
    await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, decision);
    if (allowed) {
        console.log("Lancer Automation | Consent given → counting this user.");
        await _countThisUser();
    } else {
        console.log("Lancer Automation | Consent denied → no data sent.");
    }
}

async function _handleConsentAndCounting() {
    if (!game.user?.id)
        return;

    let consent = null;
    try {
        consent = game.settings.get(MODULE_NAMESPACE, CONSENT_SETTING);
    } catch (err) {
        // Setting not registered yet; treat as undecided.
        console.warn("Lancer Automation | Consent setting not ready, defaulting to undecided.");
    }

    if (consent === CONSENT_ALLOWED) {
        await _countThisUser();
    } else if (consent === CONSENT_DENIED) {
        console.log("Lancer Automation | User previously denied consent, skipping count.");
    } else {
        await _requestConsentAndMaybeCount();
    }
}

class ConsentMenu extends FormApplication {
    render() {
        const current = game.settings.get(MODULE_NAMESPACE, CONSENT_SETTING);
        new Dialog({
            title: "Change Data Collection Consent",
            content: `
                <p>You previously <strong>${current === CONSENT_ALLOWED ? "allowed" : current === CONSENT_DENIED ? "denied" : "not decided"}</strong> sending a hashed user ID for counting unique users.</p>
                <p>What would you like to do now?</p>
            `,
            buttons: {
                allow: {
                    label: "Allow counting",
                    callback: async () => {
                        await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, CONSENT_ALLOWED);
                        await _countThisUser();
                        ui.notifications.info("Consent given. Thank you!");
                    }
                },
                deny: {
                    label: "Deny counting",
                    callback: async () => {
                        await game.settings.set(MODULE_NAMESPACE, CONSENT_SETTING, CONSENT_DENIED);
                        ui.notifications.info("Consent denied. No data will be sent.");
                    }
                }
            }
        }, { width: 400 }).render(true);
        return this;
    }
    async _updateObject() {}
}

Hooks.once("setup", () => {
    // client scope: per user across all worlds.
    game.settings.register(MODULE_NAMESPACE, CONSENT_SETTING, {
        name: "Data Collection Consent",
        hint: "Allow sending a hashed user ID to count unique users of this module.",
        scope: "client",
        config: false,
        type: String,
        default: null,
    });

    game.settings.registerMenu(MODULE_NAMESPACE, "consentMenu", {
        name: "Change Data Consent",
        label: "Update Consent",
        hint: "Change your decision about anonymous counting. You can allow or deny at any time.",
        icon: "fas fa-user-shield",
        type: ConsentMenu,
        restricted: false,
    });
});

Hooks.on("ready", async () => {
    if (!game.user?.id)
        return;
    await _handleConsentAndCounting();
});
