const MODULE_ID = 'lancer-automations';
export const DOWNTIME_TYPE = 'lancer-automations.downtime';
export const DOWNTIME_PACK = 'la-downtime-activities';
const DOWNTIME_ICON = 'systems/lancer/assets/icons/white/downtime.svg';

class DowntimeItemModel extends foundry.abstract.TypeDataModel
{
    full_update_data(data)
    {
        return data;
    }

    static defineSchema()
    {
        const fields = foundry.data.fields;
        return {
            lid: new fields.StringField({ initial: '' }),
            description: new fields.HTMLField({ initial: '' }),
            rollable: new fields.BooleanField({ initial: false }),
            hidden: new fields.BooleanField({ initial: false }),
            results: new fields.ArrayField(new fields.SchemaField({
                min: new fields.NumberField({ integer: true, initial: 0 }),
                max: new fields.NumberField({ integer: true, initial: 0 }),
                short: new fields.StringField({ initial: '' }),
                long: new fields.StringField({ initial: '' }),
                info: new fields.StringField({ initial: '' }),
            }), { initial: [] }),
        };
    }
}

const BaseItemSheet = foundry.appv1?.sheets?.ItemSheet ?? globalThis.ItemSheet;

class DowntimeItemSheet extends BaseItemSheet
{
    static get defaultOptions()
    {
        return foundry.utils.mergeObject(super.defaultOptions, {
            classes: ['lancer', 'sheet', 'item', 'la-downtime-sheet'],
            template: `modules/${MODULE_ID}/templates/downtime-item.hbs`,
            width: 700,
            height: 700,
            resizable: true,
        });
    }

    getData(options)
    {
        const data = super.getData(options);
        data.system = this.item.system;
        return data;
    }

    activateListeners(html)
    {
        super.activateListeners(html);
        if (!this.isEditable)
            return;
        html.find('.la-add-result').on('click', () =>
        {
            const results = [...(this.item.system.results ?? []), { min: 0, max: 0, short: '', long: '', info: '' }];
            this.item.update({ 'system.results': results });
        });
        html.find('.la-del-result').on('click', (event) =>
        {
            const index = Number(event.currentTarget.dataset.index);
            const results = (this.item.system.results ?? []).filter((_, itemIndex) => itemIndex !== index);
            this.item.update({ 'system.results': results });
        });
    }

    _updateObject(event, formData)
    {
        const expanded = foundry.utils.expandObject(formData);
        const raw = expanded.system?.results;
        if (raw && !Array.isArray(raw))
            expanded.system.results = Object.keys(raw).sort((a, b) => Number(a) - Number(b)).map(key => raw[key]);
        return this.item.update(expanded);
    }
}

export function initDowntimeItems()
{
    CONFIG.Item.dataModels[DOWNTIME_TYPE] = DowntimeItemModel;
    const ItemsCollection = foundry.documents?.collections?.Items ?? globalThis.Items;
    ItemsCollection.registerSheet(MODULE_ID, DowntimeItemSheet, {
        types: [DOWNTIME_TYPE],
        makeDefault: true,
        label: 'Downtime Activity',
    });
}

export async function ensureDowntimePack()
{
    const existing = game.packs.get(`world.${DOWNTIME_PACK}`);
    if (existing)
        return existing;
    const Compendium = foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;
    const pack = await Compendium.createCompendium({ type: 'Item', name: DOWNTIME_PACK, label: 'LA - Downtime Activities' });
    await pack.configure({ locked: true });
    return pack;
}

/**
 * Import downtime actions from an LCP actions.json. Entries with activation "Downtime" become
 * downtime items in the world compendium, replacing by lid (name fallback). `la_results` on an
 * entry supplies roll bands.
 * @param {string} text
 * @returns {Promise<number>} imported count
 */
export async function importDowntimeActionsJson(text)
{
    let data;
    try
    {
        data = JSON.parse(text);
    }
    catch
    {
        ui.notifications.error('Downtime import: invalid JSON.');
        return 0;
    }
    const list = Array.isArray(data) ? data : (Array.isArray(data?.actions) ? data.actions : []);
    const entries = list.filter(entry => entry?.activation === 'Downtime');
    if (!entries.length)
    {
        ui.notifications.warn('Downtime import: no downtime actions in this file.');
        return 0;
    }

    const pack = await ensureDowntimePack();
    const wasLocked = pack.locked;
    if (wasLocked)
        await pack.configure({ locked: false });
    const docs = await pack.getDocuments();
    for (const entry of entries)
    {
        const bands = Array.isArray(entry.la_results) && entry.la_results.length
            ? entry.la_results.map(result => ({
                min: Number(result.min ?? result.RollRange?.[0] ?? 0) || 0,
                max: Number(result.max ?? result.RollRange?.at?.(-1) ?? 0) || 0,
                short: result.short ?? result.ShortDesc ?? '',
                long: result.long ?? result.LongDesc ?? '',
                info: result.info ?? result.Info ?? '',
            }))
            : [{ min: 0, max: 0, short: 'Result', long: '', info: entry.detail ?? '' }];
        const itemData = {
            name: entry.name ?? 'Downtime Action',
            type: DOWNTIME_TYPE,
            img: DOWNTIME_ICON,
            system: {
                lid: entry.id ?? '',
                description: entry.terse || entry.detail || '',
                rollable: bands.some(band => band.max > 0),
                results: bands,
                hidden: false,
            },
        };
        const found = docs.find(doc => (itemData.system.lid && doc.system?.lid === itemData.system.lid) || doc.name === itemData.name);
        if (found)
            await found.update(itemData);
        else
            await Item.create(itemData, { pack: pack.collection });
    }
    await pack.configure({ locked: true });
    ui.notifications.info(`Downtime import: ${entries.length} activities in "${pack.title ?? 'Downtime Activities'}".`);
    return entries.length;
}

async function readZipEntry(buffer, suffix)
{
    const view = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    let eocd = -1;
    for (let index = buffer.byteLength - 22; index >= 0; index--)
    {
        if (view.getUint32(index, true) === 0x06054b50)
        {
            eocd = index;
            break;
        }
    }
    if (eocd < 0)
        return null;
    const count = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const decoder = new TextDecoder();
    for (let index = 0; index < count; index++)
    {
        if (view.getUint32(offset, true) !== 0x02014b50)
            break;
        const method = view.getUint16(offset + 10, true);
        const compSize = view.getUint32(offset + 20, true);
        const nameLen = view.getUint16(offset + 28, true);
        const extraLen = view.getUint16(offset + 30, true);
        const commentLen = view.getUint16(offset + 32, true);
        const localOffset = view.getUint32(offset + 42, true);
        const name = decoder.decode(bytes.subarray(offset + 46, offset + 46 + nameLen));
        offset += 46 + nameLen + extraLen + commentLen;
        if (!name.toLowerCase().endsWith(suffix))
            continue;
        const localNameLen = view.getUint16(localOffset + 26, true);
        const localExtraLen = view.getUint16(localOffset + 28, true);
        const dataStart = localOffset + 30 + localNameLen + localExtraLen;
        const compressed = bytes.subarray(dataStart, dataStart + compSize);
        if (method === 0)
            return decoder.decode(compressed);
        if (method === 8)
        {
            const stream = new Blob([compressed]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
            return new Response(stream).text();
        }
    }
    return null;
}

export function openDowntimeImportDialog()
{
    if (!game.user.isGM)
        return;
    new Dialog({
        title: 'Import Downtime Actions',
        content: '<p>Select an <code>.lcp</code> file. Actions with activation "Downtime" become items in the "Downtime Activities" compendium.</p><input type="file" accept=".lcp,.json,application/json,application/zip" style="margin-bottom:6px;">',
        buttons: {
            import: {
                label: 'Import',
                icon: '<i class="fas fa-file-import"></i>',
                callback: async (html) =>
                {
                    const file = html.find('input[type=file]')[0]?.files?.[0];
                    if (!file)
                        return ui.notifications.warn('Downtime import: no file selected.');
                    let text;
                    if (file.name.toLowerCase().endsWith('.json'))
                        text = await file.text();
                    else
                    {
                        text = await readZipEntry(await file.arrayBuffer(), 'actions.json');
                        if (text == null)
                            return ui.notifications.warn('Downtime import: no actions.json in this LCP.');
                    }
                    await importDowntimeActionsJson(text);
                },
            },
            cancel: { label: 'Cancel' },
        },
        default: 'import',
    }, { classes: ['lancer-dialog-base'], width: 460 }).render(true);
}
