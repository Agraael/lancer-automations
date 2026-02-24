export async function checkModuleUpdate(moduleId) {
    if (!game.user.isGM) {
        return;
    }

    const module = game.modules.get(moduleId);
    if (!module) {
        return;
    }

    let manifestUrl = module.manifest;
    if (!manifestUrl) {
        return;
    }

    try {
        let remoteVersion;
        let releaseNotes = "";

        if (manifestUrl.includes("github.com") && manifestUrl.includes("/releases/")) {
            const parts = manifestUrl.split("/");
            const owner = parts[3];
            const repo = parts[4];
            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases/latest`;

            const apiResponse = await fetch(apiUrl);
            if (apiResponse.ok) {
                const data = await apiResponse.json();
                remoteVersion = data.tag_name.replace(/^v/, "");
                releaseNotes = data.body || "";
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

        if (remoteVersion && isNewerVersion(remoteVersion, module.version)) {
            const lastNotified = game.settings.get(moduleId, 'lastNotifiedVersion');
            if (lastNotified !== remoteVersion) {
                showUpdateDialog(module, remoteVersion, releaseNotes);
            }
        }
    } catch (error) {
        console.error(`${moduleId} | Version check failed:`, error);
    }
}

function showUpdateDialog(module, newVersion, releaseNotes = "") {
    let notesHtml = "";
    if (releaseNotes) {
        const converter = new showdown.Converter();
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
        classes: ["lancer-dialog-base"],
        width: 500
    }).render(true);
}
