// LaSossis template presets for the Template Macro library, imported from the settings menu.

const TMAC = 'templatemacro';

function _jb2aModule()
{
    return game.modules.get('jb2a_patreon')?.active ? 'jb2a_patreon' : 'JB2A_DnD5e';
}

/** The "Smoke" preset fill pattern, also used by the smoke automations via `tmacGraphics`. */
export function smokeZoneGraphics()
{
    return {
        useCustomRender: true,
        lineType: 2,
        lineWidth: 3,
        lineColor: '#8f8f8f',
        lineOpacity: 0.8,
        fillType: 2,
        fillColor: '#ebebeb',
        fillOpacity: 0.25,
        fillTexture: `modules/${_jb2aModule()}/Library/Generic/Template/Circle/Smoke/Smoke001/001/SmokeCircleLoop001_001_White_15ft_800x800.webm`,
        fillTextureOffset: { x: 0, y: 0 },
        fillTextureOffsetAnimation: null,
        fillTextureScale: { x: 35, y: 35 },
        fillTextureCentered: true,
        fillTextureScaleWithSize: true,
        aboveTokens: true
    };
}

function _statusActions(statusId)
{
    const action = (id, trigger, effectMode) => ({
        id,
        trigger,
        effectMode,
        actionType: 'effect',
        targetFilter: 'ALL',
        asGM: false,
        code: '',
        macroUuid: '',
        effectName: statusId
    });
    return [
        action('laPresetCreated0', 'whenCreated', 'apply'),
        action('laPresetEntered0', 'whenEntered', 'apply'),
        action('laPresetLeft0000', 'whenLeft', 'remove'),
        action('laPresetDeleted0', 'whenDeleted', 'remove')
    ];
}

function _presetEntries()
{
    return [
        {
            id: 'la-preset-smoke',
            name: 'Smoke',
            icon: 'fa-smog',
            folder: '',
            protected: false,
            protectedKind: null,
            graphicsState: {
                ...smokeZoneGraphics(),
                radiusOffset: 0,
                lineDashSize: 15,
                lineGapSize: 10,
                lineDashOffsetAnimation: 0,
                lineColorAnimation: null,
                fillColorAnimation: null,
                centerLabel: 'Smoke',
                movementPenalty: 0,
                flatMovementPenalty: true,
                elevationGated: true,
                actions: _statusActions('cover_soft')
            }
        }
    ];
}

/** Add or refresh the LaSossis presets in the Template Macro library. */
export async function importTemplateMacroPresets()
{
    if (!game.modules.get(TMAC)?.active)
    {
        ui.notifications.warn('Template Macro is not active.');
        return;
    }
    const library = /** @type {any[]} */ (foundry.utils.deepClone(game.settings.get(TMAC, 'templateLibrary') ?? []));
    let added = 0;
    let updated = 0;
    for (const preset of _presetEntries())
    {
        const idx = library.findIndex(entry => entry.id === preset.id);
        if (idx >= 0)
        {
            library[idx] = preset;
            updated++;
        }
        else
        {
            library.push(preset);
            added++;
        }
    }
    await game.settings.set(TMAC, 'templateLibrary', library);
    ui.notifications.info(`LaSossis template presets: ${added} added, ${updated} updated.`);
}
