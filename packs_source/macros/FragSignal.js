const token = canvas.tokens.controlled[0];
const myActor = token?.actor;

if (!myActor) {
    return ui.notifications.error('⚠️ Please select your mech first!');
}
if (!['mech', 'npc'].includes(myActor.type)) {
    return ui.notifications.error('⚠️ Only mechs and NPCs can use tech attacks!');
}
if (game.user.targets.size === 0) {
    return ui.notifications.error('⚠️ Please target an enemy first!');
}

let effectDescription = "Target becomes IMPAIRED and SLOWED until the end of their next turn.";
if (myActor.type === 'npc') {
    effectDescription = "Target becomes IMPAIRED until the end of their next turn.";
}

const TechAttackFlow = game.lancer?.flows?.get("TechAttackFlow");
const flow = new TechAttackFlow(myActor, {
    title: "Fragment Signal",
    invade: true,
    effect: effectDescription,
    grit: myActor.system.tech_attack,
    attack_type: "Tech",
});
await flow.begin();
