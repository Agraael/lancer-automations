const tokens = canvas.tokens.controlled;
if (tokens.length === 0)
    return ui.notifications.warn('Please select at least one token.');

for (const token of tokens) {
    await token.actor.update({ "system.structure.value": 0, "system.stress.value": 0, "system.hp.value": 0 });
}
