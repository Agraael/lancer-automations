import { getPendingUpdate } from "./version-check.js";

const NEWS_MODULE_ID = "lancer-automations";
const NEWS_REPO = "Agraael/lancer-automations";
const NEWS_URL = `modules/lancer-automations/news.json`;
const RELEASES_URL = `https://api.github.com/repos/${NEWS_REPO}/releases`;
const SEEN_SETTING = "seenNewsIds";
const NEWS_CONSENT_KEY = "dataConsent";
const NEWS_PENDING = "pending";
const HISTORY_HINT = `<p style="margin-top: 12px; padding: 8px 10px; background: rgba(120,46,34,0.08); border-left: 3px solid #782e22; border-radius: 2px; font-size: 0.9em;">
    <i class="fas fa-info-circle"></i> Past news and release notes are available under
    <b>Configure Settings → Module Settings → Lancer Automations → Tools & Extras → News & Releases</b>.
</p>`;

function _getRole() {
    try {
        const c = game.settings.get(NEWS_MODULE_ID, NEWS_CONSENT_KEY);
        if (c === "gm" || c === "player") return c;
    } catch { /* not registered yet */ }
    return null;
}

async function _fetchNews() {
    try {
        const res = await fetch(NEWS_URL, { cache: "no-store" });
        if (!res.ok) return null;
        return await res.json();
    } catch (err) {
        console.warn("Lancer Automations | News fetch failed:", err);
        return null;
    }
}

async function _fetchReleases() {
    try {
        const res = await fetch(RELEASES_URL);
        if (!res.ok) return [];
        return await res.json();
    } catch (err) {
        console.warn("Lancer Automations | Releases fetch failed:", err);
        return [];
    }
}

function _filterEntries(entries, { seen, role, version, isGM }) {
    return entries.filter(e => {
        if (!e?.id || seen.has(e.id)) return false;
        if (e.minVersion && foundry.utils.isNewerVersion(e.minVersion, version)) return false;
        if (e.maxVersion && foundry.utils.isNewerVersion(version, e.maxVersion)) return false;
        if (e.gmOnly && !isGM) return false;
        if (Array.isArray(e.roles) && e.roles.length) {
            if (!role || !e.roles.includes(role)) return false;
        }
        return true;
    });
}

function _renderEntry(e) {
    const dateLine = e.date ? `<div style="opacity:0.7; font-size:0.85em; margin-bottom:4px;">${e.date}</div>` : "";
    const body = Array.isArray(e.body) ? e.body.join("") : (e.body ?? "");
    return `
        <div style="border-bottom: 1px solid rgba(120,46,34,0.2); padding: 10px 4px;">
            <div style="font-weight: bold; font-size: 1.1em; color: #782e22;">${e.title ?? ""}</div>
            ${dateLine}
            <div style="line-height: 1.5;">${body}</div>
        </div>
    `;
}

function _renderRelease(r) {
    const date = r.published_at ? r.published_at.split("T")[0] : "";
    let bodyHtml = "";
    if (r.body) {
        try {
            bodyHtml = new window.showdown.Converter().makeHtml(r.body);
        } catch { bodyHtml = `<pre>${r.body}</pre>`; }
    }
    return `
        <div style="border-bottom: 1px solid rgba(120,46,34,0.2); padding: 10px 4px;">
            <div style="font-weight: bold; font-size: 1.1em; color: #782e22;">${r.tag_name ?? ""}</div>
            <div style="opacity:0.7; font-size:0.85em; margin-bottom:4px;">${date}</div>
            <div style="line-height: 1.5;">${bodyHtml}</div>
        </div>
    `;
}

async function _markSeen(entries) {
    const current = new Set(game.settings.get(NEWS_MODULE_ID, SEEN_SETTING) || []);
    for (const e of entries) current.add(e.id);
    await game.settings.set(NEWS_MODULE_ID, SEEN_SETTING, [...current]);
}

function _renderUpdate(update) {
    const { module, newVersion, releaseNotes } = update;
    let notesHtml = "";
    if (releaseNotes) {
        try { notesHtml = new globalThis.showdown.Converter().makeHtml(releaseNotes); }
        catch { notesHtml = `<pre>${releaseNotes}</pre>`; }
    }
    return `
        <div style="padding: 10px 4px;">
            <p>A new version of <b>${module.title}</b> is available: <span style="color: #782e22;"><b>v${newVersion}</b></span> (current: v${module.version}).</p>
            <p>You can update via the Foundry VTT Module Manager.</p>
            <p style="margin-top: 8px;">Support development on <a href="https://www.patreon.com/cw/LaSossis" target="_blank" rel="noopener"><b>Patreon</b></a>.</p>
            ${notesHtml ? `<div style="margin-top: 10px; padding: 10px; border: 1px solid #999; border-radius: 4px; background: rgba(0,0,0,0.05); max-height: 35vh; overflow-y: auto;">${notesHtml}</div>` : ""}
        </div>
    `;
}

const SCROLL_STYLE = "max-height: 60vh; overflow-y: auto; padding: 6px 10px;";

function _showCombinedDialog({ news, update, firstRun }) {
    const hasNews = news.length > 0;
    const hasUpdate = !!update;
    if (!hasNews && !hasUpdate) return;

    const newsBody = hasNews
        ? news.map(_renderEntry).join("") + (firstRun ? HISTORY_HINT : "")
        : "";
    const updateBody = hasUpdate ? _renderUpdate(update) : "";

    let title = "Lancer Automations";
    if (hasNews && hasUpdate) title += " - Update & News";
    else if (hasUpdate) title += " - Update Available";
    else title += " - News";

    let content;
    let bindTabs = false;
    if (hasNews && hasUpdate) {
        bindTabs = true;
        content = `
            <nav class="sheet-tabs tabs" data-group="lancer-news-popup-tabs" style="margin-bottom: 6px;">
                <a class="item active" data-tab="news"><i class="fas fa-newspaper"></i> News</a>
                <a class="item" data-tab="update"><i class="fas fa-tag"></i> Update Available</a>
            </nav>
            <section class="tab active" data-tab="news" style="${SCROLL_STYLE}">${newsBody}</section>
            <section class="tab" data-tab="update" style="${SCROLL_STYLE} display: none;">${updateBody}</section>
        `;
    } else if (hasNews) {
        const heading = firstRun ? "LATEST NEWS" : "WHAT'S NEW";
        content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">${heading}</div>
            </div>
            <div style="${SCROLL_STYLE}">${newsBody}</div>
        `;
    } else {
        content = `
            <div class="lancer-dialog-header">
                <div class="lancer-dialog-title">UPDATE AVAILABLE</div>
            </div>
            <div style="${SCROLL_STYLE}">${updateBody}</div>
        `;
    }

    const ackUpdate = () => {
        if (hasUpdate) game.settings.set(update.module.id, "lastNotifiedVersion", update.newVersion);
    };
    const ackNews = () => {
        if (hasNews && !firstRun) _markSeen(news);
    };

    const dialog = new Dialog({
        title,
        content,
        buttons: {
            ok: {
                icon: '<i class="fas fa-check"></i>',
                label: "Got it",
                callback: () => { ackNews(); ackUpdate(); },
            },
        },
        default: "ok",
        close: () => { ackNews(); /* don't auto-ack update on X — let it remind next time */ },
        render: bindTabs ? (html) => {
            const root = /** @type {HTMLElement} */ (html instanceof jQuery ? html[0] : html);
            root.querySelectorAll(".tabs .item").forEach(/** @param {HTMLElement} item */ (item) => {
                item.addEventListener("click", () => {
                    const tab = item.dataset.tab;
                    root.querySelectorAll(".tabs .item").forEach(/** @param {HTMLElement} i */ (i) => i.classList.toggle("active", i.dataset.tab === tab));
                    root.querySelectorAll("section.tab").forEach(/** @param {HTMLElement} s */ (s) => {
                        const match = s.dataset.tab === tab;
                        s.classList.toggle("active", match);
                        s.style.display = match ? "" : "none";
                    });
                    if (dialog.position) {
                        dialog.setPosition({ height: "auto", left: dialog.position.left, top: dialog.position.top });
                    }
                });
            });
        } : undefined,
    }, { width: hasNews && hasUpdate ? 720 : 600, height: "auto", classes: ["lancer-dialog-base", "lancer-no-title"] });
    dialog.render(true);
}

async function _runNews() {
    if (!game.user?.isGM) return;

    let consent = NEWS_PENDING;
    try { consent = game.settings.get(NEWS_MODULE_ID, NEWS_CONSENT_KEY) || NEWS_PENDING; } catch { /* not registered */ }
    if (consent === NEWS_PENDING) return;

    const [payload, update] = await Promise.all([_fetchNews(), getPendingUpdate(NEWS_MODULE_ID)]);
    const entries = Array.isArray(payload?.entries) ? payload.entries : [];

    const seenRaw = game.settings.get(NEWS_MODULE_ID, SEEN_SETTING) || [];
    const role = _getRole();
    const version = game.modules.get(NEWS_MODULE_ID)?.version || "0.0.0";
    const isGM = !!game.user?.isGM;

    let news = [];
    let firstRun = false;
    if (!seenRaw.length) {
        firstRun = true;
        const allIds = entries.map(e => e.id).filter(Boolean);
        const visible = _filterEntries(entries, { seen: new Set(), role, version, isGM });
        const sorted = [...visible].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
        if (sorted[0]) news = [sorted[0]];
        if (allIds.length) await game.settings.set(NEWS_MODULE_ID, SEEN_SETTING, allIds);
    } else {
        news = _filterEntries(entries, { seen: new Set(seenRaw), role, version, isGM });
    }

    _showCombinedDialog({ news, update, firstRun });
}

export async function openNewsHistory() {
    const [newsPayload, releases] = await Promise.all([_fetchNews(), _fetchReleases()]);

    const newsEntries = Array.isArray(newsPayload?.entries) ? newsPayload.entries : [];
    const newsHtml = newsEntries.length
        ? newsEntries.map(_renderEntry).join("")
        : '<p style="padding: 10px; opacity: 0.7;">No news yet.</p>';
    const releasesHtml = releases.length
        ? releases.map(_renderRelease).join("")
        : '<p style="padding: 10px; opacity: 0.7;">Could not load releases (offline or rate-limited).</p>';

    const content = `
        <nav class="sheet-tabs tabs" data-group="lancer-news-tabs" style="margin-bottom: 6px;">
            <a class="item active" data-tab="news"><i class="fas fa-newspaper"></i> News</a>
            <a class="item" data-tab="releases"><i class="fas fa-tag"></i> Releases</a>
        </nav>
        <section class="tab active" data-tab="news" style="height: 70vh; overflow-y: auto; padding: 0 6px;">${newsHtml}</section>
        <section class="tab" data-tab="releases" style="height: 70vh; overflow-y: auto; padding: 0 6px; display: none;">${releasesHtml}</section>
    `;

    new Dialog({
        title: "Lancer Automations - News & Releases",
        content,
        buttons: {
            close: { icon: '<i class="fas fa-times"></i>', label: "Close" }
        },
        default: "close",
        render: (html) => {
            const root = /** @type {HTMLElement} */ (html instanceof jQuery ? html[0] : html);
            root.querySelectorAll(".tabs .item").forEach(/** @param {HTMLElement} item */ (item) => {
                item.addEventListener("click", () => {
                    const tab = item.dataset.tab;
                    root.querySelectorAll(".tabs .item").forEach(/** @param {HTMLElement} i */ (i) => i.classList.toggle("active", i.dataset.tab === tab));
                    root.querySelectorAll("section.tab").forEach(/** @param {HTMLElement} s */ (s) => {
                        const match = s.dataset.tab === tab;
                        s.classList.toggle("active", match);
                        s.style.display = match ? "" : "none";
                    });
                });
            });
        }
    }, { width: 900, height: 720, resizable: true, classes: ["lancer-dialog-base", "lancer-no-title"] }).render(true);
}

Hooks.once("setup", () => {
    game.settings.register(NEWS_MODULE_ID, SEEN_SETTING, {
        scope: "client",
        config: false,
        type: Array,
        default: [],
    });
});

Hooks.on("ready", async () => {
    if (!game.user?.id) return;
    await _runNews();
});
