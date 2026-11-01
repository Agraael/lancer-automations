/*global game, console, fetch, Dialog, foundry, window */

export async function getPendingUpdate(moduleId)
{
    if (!game.user.isGM)
        return null;

    const module = game.modules.get(moduleId);
    if (!module)
        return null;

    const manifestUrl = module.manifest;
    if (!manifestUrl)
        return null;

    try
    {
        let remoteVersion;
        let releaseNotes = "";

        if (manifestUrl.includes("github.com") && manifestUrl.includes("/releases/"))
        {
            const parts = manifestUrl.split("/");
            const owner = parts[3];
            const repo = parts[4];

            const apiUrl = `https://api.github.com/repos/${owner}/${repo}/releases`;
            const apiResponse = await fetch(apiUrl);
            if (apiResponse.ok)
            {
                const allReleases = await apiResponse.json();
                const missed = allReleases.filter(r =>
                {
                    const v = r.tag_name.replace(/^v/, "");
                    return foundry.utils.isNewerVersion(v, module.version);
                });
                if (missed.length > 0)
                {
                    remoteVersion = missed[0].tag_name.replace(/^v/, "");
                    releaseNotes = missed
                        .map(r => `## ${r.tag_name}\n${r.body || ""}`)
                        .join("\n\n---\n\n");
                }
            }
            else
            {
                const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/main/module.json`;
                const rawResponse = await fetch(rawUrl);
                if (rawResponse.ok)
                {
                    const remoteManifest = await rawResponse.json();
                    remoteVersion = remoteManifest.version;
                }
            }
        }
        else
        {
            const response = await fetch(manifestUrl);
            if (response.ok)
            {
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
    }
    catch (error)
    {
        console.error(`${moduleId} | Version check failed:`, error);
        return null;
    }
}
