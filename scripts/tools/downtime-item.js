import { MODULE_ID } from './constants.js';
import { localize, localizeFormat } from './string-utils.js';
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
        label: 'LA.downtime.sheetLabel',
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

function parseDowntimeList(text)
{
    const data = JSON.parse(text);
    return Array.isArray(data) ? data : (Array.isArray(data?.actions) ? data.actions : []);
}

function v2DowntimeItem(entry)
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
    return { name: entry.name, lid: entry.id, description: entry.terse || entry.detail || '', bands };
}

function v3DowntimeItem(entry)
{
    const results = Array.isArray(entry.table?.results) ? entry.table.results : [];
    const top = Math.max(0, ...results.map(result => Number(result.max) || 0));
    const bands = results.length
        ? results.map(result =>
        {
            const min = Number(result.min) || 0;
            const max = Number(result.max) || 0;
            if (max === top)
                return { min, max: 100, short: `${min}+`, long: '', info: result.text ?? '' };
            return { min, max, short: min === max ? String(min) : `${min}-${max}`, long: '', info: result.text ?? '' };
        })
        : [{ min: 0, max: 0, short: 'Result', long: '', info: entry.detail ?? '' }];
    const prompt = entry.table?.detail ? `<p><b>${entry.table.detail}</b></p>` : '';
    return { name: entry.name, lid: entry.id, description: `${entry.detail || entry.terse || ''}${prompt}`, bands };
}

function downtimeItems(list)
{
    return list.flatMap(entry =>
    {
        if (entry?.activation === 'Downtime')
            return [v2DowntimeItem(entry)];
        if (entry && !entry.activation && entry.name && (entry.table || entry.detail || entry.terse))
            return [v3DowntimeItem(entry)];
        return [];
    });
}

async function importDowntimeItems(items)
{
    if (!items.length)
    {
        ui.notifications.warn(localize('LA.notify.downtimeImportNoDowntimeActionsInThis'));
        return 0;
    }

    const pack = await ensureDowntimePack();
    const wasLocked = pack.locked;
    if (wasLocked)
        await pack.configure({ locked: false });
    const docs = await pack.getDocuments();
    for (const entry of items)
    {
        const itemData = {
            name: entry.name ?? 'Downtime Action',
            type: DOWNTIME_TYPE,
            img: DOWNTIME_ICON,
            system: {
                lid: entry.lid ?? '',
                description: entry.description,
                rollable: entry.bands.some(band => band.max > 0),
                results: entry.bands,
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
    ui.notifications.info(localizeFormat('LA.notify.downtimeImported', { count: items.length, pack: pack.title ?? localize('LA.downtime.activitiesPack') }));
    return items.length;
}

/**
 * Import downtime actions from an LCP actions.json (v2, entries with activation "Downtime", `la_results`
 * supplies roll bands) or downtime_actions.json (v3, `table.results` supplies roll bands). Items land in
 * the world compendium, replacing by lid (name fallback).
 * @param {string} text
 * @returns {Promise<number>} imported count
 */
export async function importDowntimeActionsJson(text)
{
    let list;
    try
    {
        list = parseDowntimeList(text);
    }
    catch
    {
        ui.notifications.error(localize('LA.notify.downtimeImportInvalidJson'));
        return 0;
    }
    return importDowntimeItems(downtimeItems(list));
}

async function readZipEntry(buffer, fileName)
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
        if (name.toLowerCase().split('/').pop() !== fileName)
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
        title: localize('LA.downtime.importTitle'),
        content: `<p>${localize('LA.downtime.importBody')}</p><input type="file" accept=".lcp,.json,application/json,application/zip" style="margin-bottom:6px;">`,
        buttons: {
            import: {
                label: localize('LA.common.import'),
                icon: '<i class="fas fa-file-import"></i>',
                callback: async (html) =>
                {
                    const file = html.find('input[type=file]')[0]?.files?.[0];
                    if (!file)
                        return ui.notifications.warn(localize('LA.notify.downtimeImportNoFileSelected'));
                    let text;
                    if (file.name.toLowerCase().endsWith('.json'))
                        text = await file.text();
                    else
                    {
                        const buffer = await file.arrayBuffer();
                        text = await readZipEntry(buffer, 'downtime_actions.json') ?? await readZipEntry(buffer, 'actions.json');
                        if (text == null)
                            return ui.notifications.warn(localize('LA.notify.downtimeImportNoActionsJsonInThis'));
                    }
                    await importDowntimeActionsJson(text);
                },
            },
            cancel: { label: localize('LA.common.cancel') },
        },
        default: 'import',
    }, { classes: ['lancer-dialog-base'], width: 460 }).render(true);
}
