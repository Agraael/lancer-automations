const myActor = (typeof ParamActor !== 'undefined' ? ParamActor : null) || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Interact",
    action: { name: "INTERACT", activation: "Protocol/Quick" },
    detail: `When you Interact, you manipulate an object in some way, such as pushing a button, knocking it over, or ripping out wires. You may only Interact 1/turn, regardless of whether it is used as a protocol or quick action.<br><br>
    If there are no hostile characters adjacent to the object when you Interact with it, you automatically succeed. If there is at least one hostile character adjacent to the object, you must succeed on a contested skill check in order to Interact with the object. The skill check is context-dependent. For example, you may attempt to reset a computer with a Systems check while an opponent is roughhousing you with a Hull check. Pilot skill triggers may be used in place of mech skills when the context is appropriate.`
});
