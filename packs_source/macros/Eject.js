const myActor = canvas.tokens.controlled[0]?.actor;

if (!myActor)
    return ui.notifications.error('Please select your mech first!');

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Eject",
    action: { name: "Eject", activation: "Quick" },
    detail: "EJECT as a quick action, flying 6 spaces in the direction of your choice; however, this is a single-use system for emergency use only – it leaves your mech IMPAIRED. Your mech remains IMPAIRED and you cannot EJECT again until your next FULL REPAIR."
});
