const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error('Please select your token first!');
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Search",
    action: {
        name: "Search",
        activation: "Quick",
    },
    detail: "To SEARCH in a mech, choose a character within your SENSORS that you suspect is HIDDEN and make a contested SYSTEMS check against their AGILITY. To SEARCH as a pilot on foot, make a contested skill check, adding bonuses from triggers as normal. This can be used to reveal characters within RANGE 5. Once a HIDDEN character has been found using SEARCH, they immediately lose HIDDEN and can be located again by any character."
});
