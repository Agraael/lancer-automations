const myActor = ParamActor || canvas.tokens.controlled[0]?.actor;

if (!myActor) {
    return ui.notifications.error("⚠️ Please select your mech first!");
}

const api = game.modules.get('lancer-automations').api;
await api.executeSimpleActivation(myActor, {
    title: "Handle",
    action: { name: "HANDLE", activation: "Protocol/Quick" },
    detail: `As a protocol or quick action, a character may start to handle an adjacent object or willing character by lifting or dragging them. A character may choose to stop handling an object as a free action.<br><br>
    Mechs can drag characters or objects up to twice their SIZE but are SLOWED while doing so. They can also lift characters or objects of equal or lesser SIZE overhead but are IMMOBILIZED while doing so. While dragging or lifting, characters can't take reactions. The same rules apply to pilots and other characters on foot, but they can't drag or lift anything above SIZE 1/2.<br><br>
    If a character starts to handle an object handled by a hostile character, the object does not move until it is only handled by characters allied with each other. If a character handling an object is involuntarily moved such that they are no longer adjacent to the object, they cease to handle the object. As a quick action, a handler may roll a single HULL check. All hostile handlers must succeed on a contested HULL check or cease to handle the object.`
});
