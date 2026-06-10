/*global game, console, fetch, Dialog, foundry, window */

export async function getPendingUpdate(moduleId) {
    if (!game.user.isGM)
        return null;

    const module = game.modules.get(moduleId);
    if (!module)
        return null;

    const manifestUrl = module.manifest;
    if (!manifestUrl)
        return null;

    try {
        let remoteVersion;
        let releaseNotes = "";

        if (manifestUrl.includes("github.com") && manifestUrl.includes("/releases/")) {
            const parts = manifestUrl.split("/");
            const owner = parts[3];
            const repo = parts[4];

            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
            const apiResponse = await fetch(apiUrl);
            if (apiResponse.ok) {
                const allReleases = await apiResponse.json();
                const missed = allReleases.filter(r => {
                    const v = r.tag_name.replace(/^v/, "");
                    return foundry.utils.isNewerVersion(v, module.version);
                });
                if (missed.length > 0) {
                    remoteVersion = missed[0].tag_name.replace(/^v/, "");
                    releaseNotes = missed
                        .map(r => `## ${r.tag_name}\n${r.body || ""}`)
                        .join("\n\n---\n\n");
                }
            } else {
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/module.json`;
                const rawResponse = await fetch(rawUrl);
                if (rawResponse.ok) {
                    const remoteManifest = await rawResponse.json();
                    remoteVersion = remoteManifest.version;
                }
            }
        } else {
            const response = await fetch(manifestUrl);
            if (response.ok) {
                const remoteManifest = await response.json();
                remoteVersion = remoteManifest.version;
            }
        }

        if (!remoteVersion || !foundry.utils.isNewerVersion(remoteVersion, module.version))
            return null;

        const lastNotified = game.settings.get(moduleId, 'lastNotifiedVersion');
        if (lastNotified === remoteVersion)
            return null;

        return { module, newVersion: remoteVersion, releaseNotes };
    } catch (error) {
        console.error(`${moduleId} | Version check failed:`, error);
        return null;
    }
}

export async function checkModuleUpdate(moduleId) {
    const pending = await getPendingUpdate(moduleId);
    if (!pending)
        return;
    showUpdateDialog(pending.module, pending.newVersion, pending.releaseNotes);
}

function showUpdateDialog(module, newVersion, releaseNotes = "") {
    let notesHtml = "";
    if (releaseNotes) {
        const converter = new window.showdown.Converter();
        const htmlNotes = converter.makeHtml(releaseNotes);
        notesHtml = `
            <div class="lancer-action-buttons" style="margin: 10px 0 5px 0;">
                <span class="lancer-section-title">RELEASE NOTES</span>
            </div>
            <div class="form-group lancer-item-details" style="max-height: 250px; overflow-y: auto; padding: 10px; border: 2px solid #999; border-radius: 4px; background: rgba(0,0,0,0.05);">
                ${htmlNotes}
            </div>
        `;
    }

    const dialogContent = `
        <div class="lancer-dialog-header">
            <h2 class="lancer-dialog-title">Update Available</h2>
            <p class="lancer-dialog-subtitle">${module.title}</p>
        </div>
        <div class="form-group" style="padding: 10px;">
            <p>A new version of <b>${module.title}</b> is available: <span class="lancer-text-red">v${newVersion}</span> (Current: v${module.version})</p>
            <p>You can update it via the Foundry VTT Module Manager.</p>
            <p style="margin-top: 8px;">More info, updates, and previews on <a href="https://www.patreon.com/cw/LaSossis" target="_blank" rel="noopener"><b>Patreon</b></a>.</p>
        </div>
        ${notesHtml}
    `;

    new Dialog({
        title: `${module.title} Update`,
        content: dialogContent,
        buttons: {
            dismiss: {
                icon: '<i class="fas fa-times"></i>',
                label: "Dismiss",
                callback: () => {
                    game.settings.set(module.id, 'lastNotifiedVersion', newVersion);
                }
            },
            later: {
                icon: '<i class="fas fa-clock"></i>',
                label: "Remind Me Later"
            }
        },
        default: "dismiss"
    }, {
        classes: ["lancer-dialog-base", "lancer-no-title"],
        width: 500
    }).render(true);
}
