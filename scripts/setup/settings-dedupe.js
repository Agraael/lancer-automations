// get() returns the first document per key, duplicates freeze the value.
export async function dedupeWorldSettings()
{
    if (!game.user?.isGM)
        return;
    const byKey = new Map();
    for (const setting of game.settings.storage.get('world'))
    {
        const mapKey = `${setting.key}|${setting.user ?? ''}`;
        if (!byKey.has(mapKey))
            byKey.set(mapKey, []);
        byKey.get(mapKey).push(setting);
    }
    const staleIds = [];
    for (const docs of byKey.values())
    {
        if (docs.length < 2)
            continue;
        docs.sort((left, right) => (right._stats?.modifiedTime ?? 0) - (left._stats?.modifiedTime ?? 0));
        for (const doc of docs.slice(1))
            staleIds.push(doc.id);
    }
    if (staleIds.length === 0)
        return;
    await Setting.deleteDocuments(staleIds);
    console.warn(`lancer-automations | removed ${staleIds.length} duplicate world setting document(s)`);
}
