// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function sort_features(a, b) {
    return b.system.origin.base - a.system.origin.base;
}

function construct_features(items, origin) {
    let sc_list = ``;
    sc_list += `<p>${origin}</p>`;
    let sc_features = items.filter(f => f.system.origin && f.system.origin.name === origin).sort(sort_features);
    sc_features.forEach(i => {
        let sc_name = ``;
        let sc_desc = ``;
        if (i.system.origin.name === "EXOTIC" && !i.system.origin.base) {
            sc_name = '<code class="horus--subtle">UNKNOWN EXOTIC SYSTEM</code>';
            sc_desc = "???";
        } else {
            sc_name = i.name;
            if (i.system.effect) {
                sc_desc = i.system.effect;
            } else {
                sc_desc = "No description given.";
            }
            if (i.system.trigger) {
                sc_desc = `Trigger: ${i.system.trigger}<br>${sc_desc}`;
            }
        }
        if (!sc_desc.startsWith("<p>") && !sc_desc.startsWith("<P>"))
            sc_desc = `<p>${sc_desc}</p>`;
        let sc_entry = `<details><summary>${sc_name}</summary>${sc_desc}</details>`;
        sc_list += sc_entry;
    });
    return sc_list;
}

function construct_weapons(items, origin, tier) {
    let sc_weapons = ``;
    let sc_features = items
        .filter(i => i.system.origin && i.system.origin.name === origin && i.system.type === "Weapon")
        .sort(sort_features);
    sc_features.forEach(i => {
        let sc_name = ``;
        let sc_desc = ``;
        let sc_entry = ``;
        let sc_range = ``;
        let sc_damage = ``;
        let sc_accuracy = ``;
        if (!i.type) {
            return sc_weapons;
        }
        sc_weapons += `<table>`;
        if (i.system.origin.name === "EXOTIC" && !i.system.origin.base) {
            sc_name = '<tr><th><code class="horus--subtle">UNKNOWN EXOTIC WEAPON</code></th></tr>';
            sc_desc = "<tr><td>???</td></tr>";
            sc_entry = sc_name + sc_desc;
        } else {
            sc_name = `<tr><th colspan="4">${i.name}</th></tr>`;
            sc_entry += sc_name;
            sc_desc = `<tr>`;
            sc_desc += `<td>+${i.system.attack_bonus[tier - 1]} ATTACK</td>`;
            if (i.system.accuracy[tier - 1]) {
                let acc = i.system.accuracy[tier - 1];
                sc_accuracy = `${acc > 0 ? "+" : ""}${acc} ${acc > 0 ? "ACCURACY" : "DIFFICULTY"}`;
            }
            sc_desc += `<td>${sc_accuracy}</td>`;
            if (i.system.range.length > 0) {
                i.system.range.forEach(r => (sc_range += r.type + " " + r.val + "&nbsp&nbsp&nbsp"));
            }
            sc_desc += `<td>${sc_range}</td>`;
            if (i.system.damage.length > 0) {
                i.system.damage[tier - 1].forEach(d => (sc_damage += d.val + " " + d.type + "&nbsp&nbsp&nbsp"));
            }
            sc_desc += `<td>${sc_damage}</td>`;
            if (i.system.tags.some(t => t.is_loading)) {
                if (i.system.loaded) {
                    sc_desc += `<td>LOADED</td>`;
                } else {
                    sc_desc += `<td>UNLOADED</td>`;
                }
            } else {
                sc_desc += `<td></td>`;
            }
            if (i.system.uses.max > 0) {
                sc_desc += `<td>USES: ${i.system.uses.value}/${i.system.uses.max}</td>`;
            }
            sc_desc += `<tr>`;
            if (i.system.trigger) {
                sc_desc += `<tr><td colspan="6"><details><summary>Trigger</summary><p>${i.system.trigger}</p></details></td></tr>`;
            }
            if (i.system.on_hit) {
                sc_desc += `<tr><td colspan="6"><details><summary>On Hit</summary><p>${i.system.on_hit}</p></details></td></tr>`;
            }
            if (i.system.effect) {
                sc_desc += `<tr><td colspan="6">${i.system.effect}</td></tr>`;
            }
            if (i.system.tags.length > 0) {
                sc_desc += `<tr><td colspan="6">Tags: `;
                sc_desc += i.system.tags.map(t => `${t.name.replace("{VAL}", t.val)}`).join(", ");
                sc_desc += `</td></tr>`;
            }
            sc_entry += sc_desc;
        }
        sc_weapons += sc_entry;
        sc_weapons += `</table>`;
    });
    return sc_weapons;
}

function construct_templates(items) {
    let sc_templates = ``;
    if (!items || items.length === 0) {
        sc_templates += "<p>NONE</p>";
    } else {
        items.forEach(i => {
            sc_templates += `<p>${i.name}</p>`;
        });
    }
    sc_templates += "<br>";
    return sc_templates;
}

function zeroPad(num, places) {
    return String(num).padStart(places, "0");
}

function getAllJournalsInFolder(folder) {
    let journals = [...folder.contents];
    const subfolders = game.folders.filter(f => f.type === "JournalEntry" && f.folder?.id === folder.id);
    subfolders.forEach(subfolder => {
        journals = journals.concat(getAllJournalsInFolder(subfolder));
    });
    return journals;
}

export async function performSystemScan(target, createJournal = false, customName = '') {
    const actor = target.actor;
    const items = actor.items;

    const isPlayerMech = actor.type === 'mech' && actor.system.loadout;
    const isNPC = actor.type === 'npc';

    let hase_table_html = `
<table>
  <tr>
    <th>HULL</th><th>AGI</th><th>SYS</th><th>ENG</th>
  </tr>
  <tr>
    <td>${actor.system.hull || 0}</td>
    <td>${actor.system.agi || 0}</td>
    <td>${actor.system.sys || 0}</td>
    <td>${actor.system.eng || 0}</td>
  </tr>
</table>`;

    let stat_table_html = `
<table>
  <tr>
    <th>Armor</th><th>HP</th><th>Heat</th><th>Speed</th>
  </tr>
  <tr>
    <td>${actor.system.armor}</td>
    <td>${actor.system.hp.value}/${actor.system.hp.max}</td>
    <td>${actor.system.heat.value || 0}/${actor.system.heat.max || 0}</td>
    <td>${actor.system.speed}</td>
  </tr>
  <tr>
    <th>Evasion</th><th>E-Def</th><th>Save</th><th>Sensors</th>
  </tr>
  <tr>
    <td>${actor.system.evasion}</td>
    <td>${actor.system.edef}</td>
    <td>${actor.system.save}</td>
    <td>${actor.system.sensor_range || 10}</td>
  </tr>
  <tr>
    <th>Size</th><th>Activ</th><th>Struct</th><th>Stress</th>
  </tr>
  <tr>
    <td>${actor.system.size}</td>
    <td>${actor.system.activations || 1}</td>
    <td>${actor.system.structure.value || 0}/${actor.system.structure.max || 0}</td>
    <td>${actor.system.stress.value || 0}/${actor.system.stress.max || 0}</td>
  </tr>
</table>`;

    console.log("Scanning", target);

    let sc_class = "";
    let sc_tier = "";
    let sc_templates = "";
    let sc_list = "";
    let sc_weapons = "";
    let sc_traits = "";
    let sc_core_bonuses = "";

    if (isPlayerMech) {
        const frameData = actor.system.loadout?.frame?.value;
        sc_class = frameData ? frameData.name : "UNKNOWN FRAME";

        let pilotActor = null;
        if (actor.system.pilot?.id) {
            pilotActor = fromUuidSync(actor.system.pilot.id);
        }
        sc_tier = pilotActor ? `LL${pilotActor.system.level || 0}` : "LL?";

        if (pilotActor && pilotActor.items) {
            const coreBonuses = pilotActor.items.filter(i => i.type === 'core_bonus');
            if (coreBonuses.length > 0) {
                coreBonuses.forEach(cb => {
                    let cb_name = cb.name;
                    let cb_desc = "";
                    if (cb.system.effect) cb_desc += `<strong>Effect:</strong> ${cb.system.effect}<br>`;
                    if (cb.system.description) cb_desc += cb.system.description;
                    if (!cb_desc.startsWith("<p>") && !cb_desc.startsWith("<P>")) cb_desc = `<p>${cb_desc}</p>`;
                    sc_core_bonuses += `<details><summary>${cb_name}</summary>${cb_desc}</details>`;
                });
            }
        }
        if (!sc_core_bonuses) sc_core_bonuses = "<p>NONE</p>";

        if (frameData && frameData.system.traits && frameData.system.traits.length > 0) {
            frameData.system.traits.forEach(trait => {
                let trait_name = trait.name;
                let trait_desc = trait.description || "";
                if (trait.actions && trait.actions.length > 0) {
                    trait.actions.forEach(action => {
                        trait_desc += `<br><br><strong>${action.name}</strong>`;
                        if (action.activation) trait_desc += ` (${action.activation})`;
                        if (action.trigger) trait_desc += `<br><em>Trigger:</em> ${action.trigger}`;
                        if (action.detail) trait_desc += `<br>${action.detail}`;
                    });
                }
                if (!trait_desc.startsWith("<p>") && !trait_desc.startsWith("<P>")) trait_desc = `<p>${trait_desc}</p>`;
                sc_traits += `<details><summary>${trait_name}</summary>${trait_desc}</details>`;
            });
        }
        if (!sc_traits) sc_traits = "<p>NONE</p>";

        if (actor.system.loadout.weapon_mounts && actor.system.loadout.weapon_mounts.length > 0) {
            actor.system.loadout.weapon_mounts.forEach(mount => {
                mount.slots.forEach(slot => {
                    if (slot.weapon && slot.weapon.value) {
                        const weaponData = slot.weapon.value;
                        const profile = weaponData.system.profiles?.[weaponData.system.selected_profile_index || 0];
                        if (profile) {
                            let wpn_name = weaponData.name;
                            let wpn_details = "";
                            let ranges = "";
                            if (profile.range && profile.range.length > 0) ranges = profile.range.map(r => `${r.type} ${r.val}`).join(", ");
                            if (ranges) wpn_details += `<strong>Range:</strong> ${ranges}<br>`;
                            let damages = "";
                            if (profile.damage && profile.damage.length > 0) damages = profile.damage.map(d => `${d.val} ${d.type}`).join(", ");
                            if (damages) wpn_details += `<strong>Damage:</strong> ${damages}<br>`;
                            if (profile.tags && profile.tags.length > 0) {
                                const tagStr = profile.tags.map(t => t.val ? `${t.lid.replace('tg_', '')} ${t.val}` : t.lid.replace('tg_', '')).join(", ");
                                wpn_details += `<strong>Tags:</strong> ${tagStr}<br>`;
                            }
                            if (profile.effect) wpn_details += `<strong>Effect:</strong> ${profile.effect}`;
                            if (!wpn_details.startsWith("<p>") && !wpn_details.startsWith("<P>")) wpn_details = `<p>${wpn_details}</p>`;
                            sc_weapons += `<details><summary>${wpn_name}</summary>${wpn_details}</details>`;

                            if (slot.mod && slot.mod.value) {
                                const modData = slot.mod.value;
                                let mod_details = "";
                                if (modData.system.effect) mod_details += `${modData.system.effect}<br>`;
                                if (modData.system.added_tags && modData.system.added_tags.length > 0) {
                                    const addedTagStr = modData.system.added_tags.map(t => t.val ? `${t.lid.replace('tg_', '')} ${t.val}` : t.lid.replace('tg_', '')).join(", ");
                                    mod_details += `<strong>Added Tags:</strong> ${addedTagStr}<br>`;
                                }
                                if (modData.system.actions && modData.system.actions.length > 0) {
                                    modData.system.actions.forEach(action => {
                                        mod_details += `<strong>${action.name}</strong> (${action.activation})`;
                                        if (action.detail) mod_details += `: ${action.detail}`;
                                        mod_details += `<br>`;
                                    });
                                }
                                if (!mod_details.startsWith("<p>") && !mod_details.startsWith("<P>")) mod_details = `<p>${mod_details}</p>`;
                                sc_weapons += `<details><summary>↳ MOD: ${modData.name}</summary>${mod_details}</details>`;
                            }
                        }
                    }
                });
            });
        }
        if (!sc_weapons) sc_weapons = "<p>NONE</p>";

        if (actor.system.loadout.systems && actor.system.loadout.systems.length > 0) {
            actor.system.loadout.systems.forEach(sysObj => {
                if (sysObj.value) {
                    const sysData = sysObj.value;
                    let sys_name = sysData.name;
                    let sys_desc = sysData.system.effect || "No description given.";
                    if (sysData.system.actions && sysData.system.actions.length > 0) {
                        sysData.system.actions.forEach(action => {
                            if (action.detail) sys_desc += `<br><strong>${action.name}:</strong> ${action.detail}`;
                        });
                    }
                    if (!sys_desc.startsWith("<p>") && !sys_desc.startsWith("<P>")) sys_desc = `<p>${sys_desc}</p>`;
                    sc_list += `<details><summary>${sys_name}</summary>${sys_desc}</details>`;
                }
            });
        } else {
            sc_list = "<p>NONE</p>";
        }

        sc_templates = "";

    } else if (isNPC) {
        const classes = items.filter(i => i.is_npc_class());
        sc_class = !classes || classes.length === 0 ? "NONE" : classes[0].name;
        sc_tier = actor.system.tier;
        const templates = items.filter(i => i.is_npc_template());
        sc_templates = construct_templates(templates);

        const features = items.filter(i => i.is_npc_feature());
        if (!features || features.length === 0) {
            sc_list += "<p>NONE</p>";
            sc_weapons += "<p>NONE</p>";
        } else {
            let sc_origins = [];
            features.forEach(f => {
                let origin = f.system.origin.name;
                if (!sc_origins.includes(origin)) sc_origins.push(origin);
            });
            sc_origins.forEach(origin => {
                sc_list += construct_features(features, origin);
                sc_weapons += construct_weapons(items, origin, sc_tier);
            });
        }
    }

    if (createJournal) {
        await createScanJournalEntry(target, actor, hase_table_html, stat_table_html, sc_class, sc_tier, sc_templates,
            sc_weapons, sc_list, sc_traits, sc_core_bonuses, isPlayerMech, customName);
    } else {
        const displayName = customName && customName.trim().length > 0 ? customName.trim() : actor.name;
        let content = `<h2>Scan results: ${displayName}</h2>`;
        if (isPlayerMech) {
            content += `<h3>Frame: ${sc_class} | ${sc_tier}</h3>`;
        } else {
            content += `<h3>Class: ${sc_class}, Tier ${sc_tier}</h3>`;
        }
        content += hase_table_html + stat_table_html;
        if (sc_templates) content += `<h3>Templates:</h3>` + sc_templates;
        if (sc_traits) content += `<h3>Frame Traits:</h3>` + sc_traits;
        if (sc_core_bonuses) content += `<h3>Core Bonuses:</h3>` + sc_core_bonuses;
        content += `<h3>Weapons:</h3>` + sc_weapons;
        content += `<h3>Systems:</h3>` + sc_list;

        ChatMessage.create({
            user: game.user._id,
            content: content,
            "flags.core.canPopout": true,
        });
    }
}

async function createScanJournalEntry(target, actor, hase_table_html, stat_table_html, sc_class, sc_tier, sc_templates, sc_weapons, sc_list, sc_traits, sc_core_bonuses, isPlayerMech = false, customName = '') {
    if (!JournalEntry.canUserCreate(game.user)) {
        ui.notifications.error(`${game.user.name} attempted to run SCAN to Journal but lacks proper permissions. Please correct and try again.`);
        return;
    }

    const journalFolderName = "SCAN Database";
    const nameTemplate = "SCAN: ";
    const numberLength = 3;
    const startingNumber = 1;
    const permissionLevel = CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER;
    const updateExisting = true;

    let journalFolder = game.folders.getName(journalFolderName);
    if (!journalFolder && journalFolderName.length > 0) {
        try {
            journalFolder = await Folder.create({ name: journalFolderName, type: "JournalEntry" });
        } catch (error) {
            ui.notifications.error(`${journalFolderName} does not exist and must be created manually by a user with permissions to do so.`);
            return;
        }
    }

    let hase_table_with_image = `
<p><img style="border: 3px dashed #000000; float: left; margin-right: 5px; margin-left: 5px;" src="${target.document.actor.img}" width="30%" height="30%" /></p>
<div style="color: #000000; width: 65%; float: right; text-align: left;">
<table>
  <tr>
    <th>HULL</th><th>AGI</th><th>SYS</th><th>ENG</th>
  </tr>
  <tr>
    <td>${actor.system.hull || 0}</td>
    <td>${actor.system.agi || 0}</td>
    <td>${actor.system.sys || 0}</td>
    <td>${actor.system.eng || 0}</td>
  </tr>
</table>`;

    const displayName = customName && customName.trim().length > 0 ? customName.trim() : actor.name;

    let scanContent = `<h2>Scan results: ${displayName}</h2>`;
    if (isPlayerMech) {
        scanContent += `<h3>Frame: ${sc_class} | ${sc_tier}</h3>`;
    } else {
        scanContent += `<h3>Class: ${sc_class}, Tier ${sc_tier}</h3>`;
    }
    scanContent += hase_table_with_image + stat_table_html;
    scanContent += `</div><div style="color: #000000; width: 100%; float: right; text-align: left;">`;
    if (sc_templates) scanContent += `<h3>Templates:</h3>` + sc_templates;
    if (sc_traits) scanContent += `<h3>Frame Traits:</h3>` + sc_traits;
    if (sc_core_bonuses) scanContent += `<h3>Core Bonuses:</h3>` + sc_core_bonuses;
    scanContent += `<h3>Weapons:</h3>` + sc_weapons;
    scanContent += `<h3>Systems:</h3>` + sc_list;
    scanContent += `</div>`;

    let scanEntry;
    let allJournals = getAllJournalsInFolder(journalFolder);
    let matchingJournalEntries = allJournals.filter(e => e.name.includes(actor.name));

    if (matchingJournalEntries.length === 1 && updateExisting === true) {
        console.log("Updating an existing scan");
        const scanName = matchingJournalEntries[0].name;
        scanEntry = game.journal.getName(scanName);
        let scanPage = scanEntry.pages.getName(scanName);
        await scanPage.update({ _id: matchingJournalEntries[0]._id, text: { content: scanContent } });
    } else {
        console.log("Creating a new scan");
        let scanCount = zeroPad(allJournals.filter(e => e.name.startsWith(nameTemplate)).length + startingNumber, numberLength);
        let scanName;
        if (customName && customName.trim().length > 0) {
            scanName = nameTemplate + scanCount + ` - ` + customName.trim();
        } else {
            scanName = nameTemplate + scanCount + ` - ` + actor.name;
        }
        let scanPage = new JournalEntryPage({ name: scanName, type: "text", text: { content: scanContent } });
        scanEntry = await JournalEntry.create({ folder: journalFolder.id, name: scanName });
        await scanEntry.createEmbeddedDocuments("JournalEntryPage", [scanPage]);
    }

    await scanEntry.update({ ownership: { default: permissionLevel } });
    scanEntry.sheet.render(false);
}

export async function performGMInputScan(targets, scanTitle, requestingUserName = null) {
    const targetArray = Array.isArray(targets) ? targets : [targets];
    const targetNames = targetArray.map(t => t.name).join(', ');

    new Dialog({
        title: `${scanTitle} - ${targetNames}`,
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">${scanTitle}</h2>
                <p class="lancer-dialog-subtitle">Target${targetArray.length > 1 ? 's' : ''}: ${targetNames}${requestingUserName ? ` | Requested by: ${requestingUserName}` : ''}</p>
            </div>
            <form>
                <div class="form-group">
                    <label style="font-weight: bold; margin-bottom: 8px; display: block;">Enter information discovered (leave empty if providing orally):</label>
                    <textarea id="scan-info" name="scan-info" rows="5" style="width: 100%; resize: vertical; padding: 8px; font-size: 14px; border: 2px solid #999; border-radius: 4px; font-family: inherit;"></textarea>
                </div>
            </form>
        `,
        buttons: {
            submit: {
                icon: '<i class="fas fa-check"></i>',
                label: "Send to Chat",
                callback: async (html) => {
                    const info = html.find('[name="scan-info"]').val().trim();
                    let content = `<h2>Scan results: ${targetNames}</h2>`;
                    content += `<h3>${scanTitle}</h3>`;
                    if (info) {
                        content += `<p>${info}</p>`;
                    } else {
                        content += `<p><em>Information provided orally by GM</em></p>`;
                    }
                    ChatMessage.create({
                        user: game.user._id,
                        content: content,
                        whisper: game.user.isGM ? [] : [game.user._id],
                        "flags.core.canPopout": true,
                    });
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "submit"
    }, { classes: ["lancer-dialog-base"], width: 500 }).render(true);
}

function showSystemScanDialog(targets) {
    const targetArray = Array.isArray(targets) ? targets : [targets];
    const targetNames = targetArray.map(t => t.name).join(', ');

    new Dialog({
        title: "System Scan Options",
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">System Scan Options</h2>
                <p class="lancer-dialog-subtitle">Target${targetArray.length > 1 ? 's' : ''}: ${targetNames}</p>
            </div>
            <form>
                <div class="lancer-toggle-card" data-create-journal="false">
                    <div class="lancer-toggle-card-icon"><i class="far fa-square"></i></div>
                    <div class="lancer-toggle-card-text">Create Journal Entry</div>
                </div>
                <div id="custom-name-field" style="display: none; margin-top: 12px;">
                    <label style="font-weight: bold; margin-bottom: 8px; display: block;">Custom Journal Name (optional):</label>
                    <input type="text" id="custom-journal-name" name="custom-journal-name" placeholder="Leave empty for auto-generated name" style="width: 100%; padding: 8px; font-size: 14px; border: 2px solid #999; border-radius: 4px;" />
                </div>
            </form>
        `,
        buttons: {
            scan: {
                icon: '<i class="fas fa-radar"></i>',
                label: "Execute Scan",
                callback: async (html) => {
                    const createJournal = html.find('.lancer-toggle-card').data('create-journal') === true;
                    const customName = html.find('[name="custom-journal-name"]').val().trim();

                    if (createJournal && !game.user.isGM) {
                        targetArray.forEach(target => {
                            game.socket.emit("module.lancer-automations", {
                                action: "scanSystemJournalRequest",
                                payload: {
                                    targetId: target.id, targetName: target.name,
                                    customName: customName,
                                    requestingUserId: game.user.id,
                                    requestingUserName: game.user.name
                                }
                            });
                        });
                        ui.notifications.info(`Journal creation request sent to GM for ${targetArray.length} target${targetArray.length > 1 ? 's' : ''}`);
                    }

                    for (const target of targetArray) {
                        await performSystemScan(target, createJournal && game.user.isGM, customName);
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "scan",
        render: (html) => {
            html.find('.lancer-toggle-card').click(function () {
                const $card = $(this);
                const currentState = $card.data('create-journal');
                const newState = !currentState;
                $card.data('create-journal', newState);
                if (newState) {
                    $card.addClass('active');
                    $card.find('.lancer-toggle-card-icon i').removeClass('far fa-square').addClass('fas fa-check-square');
                    html.find('#custom-name-field').show();
                } else {
                    $card.removeClass('active');
                    $card.find('.lancer-toggle-card-icon i').removeClass('fas fa-check-square').addClass('far fa-square');
                    html.find('#custom-name-field').hide();
                }
            });
        }
    }, { classes: ["lancer-dialog-base"], width: 450 }).render(true);
}

// ---------------------------------------------------------------------------
// Exported
// ---------------------------------------------------------------------------

/**
 * Called by the "Scan" reaction's activationCode.
 * Plays visual effects then shows the scan type dialog.
 */
export async function executeScanOnActivation(reactorToken) {
    const targets = Array.from(game.user.targets);
    if (!targets.length) return;

    const targetNames = targets.map(t => t.name).join(', ');

    if (typeof Sequencer !== 'undefined' && reactorToken) {
        await Sequencer.Preloader.preloadForClients([
            "modules/lancer-weapon-fx/soundfx/TechPrepare.ogg",
            "jb2a.extras.tmfx.inpulse.circle.02.normal",
        ]);

        for (const target of targets) {
            new Sequence()
                .sound()
                .file("modules/lancer-weapon-fx/soundfx/TechPrepare.ogg")
                .volume(game.modules.get("lancer-weapon-fx")?.api?.getEffectVolume(0.7) || 0.7)
                .effect()
                .file("jb2a.extras.tmfx.inpulse.circle.02.normal")
                .atLocation(target)
                .scaleToObject(2)
                .filter("Glow", { color: 0xfada89 })
                .playbackRate(1.3)
                .waitUntilFinished(-400)
                .play();
        }
    }

    new Dialog({
        title: "SCAN Action",
        content: `
            <div class="lancer-dialog-header">
                <h2 class="lancer-dialog-title">SCAN Action</h2>
                <p class="lancer-dialog-subtitle">Target${targets.length > 1 ? 's' : ''}: ${targetNames}</p>
            </div>
            <div style="margin-top: 12px;">
                <label style="font-weight: bold; margin-bottom: 8px; display: block;">Choose what to scan:</label>
                <select id="scan-type" name="scan-type" style="width: 100%; padding: 12px 8px; font-size: 14px; border: 2px solid #999; border-radius: 4px; height: 44px;">
                    <option value="system">Full Systems & Statistics (weapons, systems, HP, SPEED, EVASION, etc.)</option>
                    <option value="hidden">Hidden Information (confidential cargo, mission, pilot identity, etc.)</option>
                    <option value="generic">Generic/Public Information (model number, public records, etc.)</option>
                </select>
            </div>
        `,
        buttons: {
            scan: {
                icon: '<i class="fas fa-radar"></i>',
                label: "Scan",
                callback: async (html) => {
                    const scanType = html.find('[name="scan-type"]').val();
                    if (scanType === 'system') {
                        showSystemScanDialog(targets);
                    } else {
                        const scanTitle = scanType === 'hidden' ? 'Hidden Information' : 'Generic/Public Information';
                        if (game.user.isGM) {
                            performGMInputScan(targets, scanTitle);
                        } else {
                            targets.forEach(target => {
                                game.socket.emit("module.lancer-automations", {
                                    action: "scanInfoRequest",
                                    payload: {
                                        targetId: target.id,
                                        targetName: target.name,
                                        scanTitle: scanTitle,
                                        requestingUserId: game.user.id,
                                        requestingUserName: game.user.name
                                    }
                                });
                            });
                            ui.notifications.info(`Scan request sent to GM for ${targets.length} target${targets.length > 1 ? 's' : ''}`);
                        }
                    }
                }
            },
            cancel: {
                icon: '<i class="fas fa-times"></i>',
                label: "Cancel"
            }
        },
        default: "scan"
    }, { classes: ["lancer-dialog-base"], width: 500 }).render(true);
}
