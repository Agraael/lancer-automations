/**
 * Card Stack Test Suite
 * Run via:  api.tests.cardStack.runAll()
 *   or individual tests:  api.tests.cardStack.orBasic()
 */

/* global game, ui, $ */

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function countVisibleCards() {
    return $('.la-info-card:visible').length;
}

function countAllCards() {
    return $('.la-info-card').length;
}

function pass(name) {
    console.log(`%c✅ PASS: ${name}`, 'color:limegreen; font-weight:bold;');
}

function fail(name, reason) {
    console.error(`❌ FAIL: ${name} — ${reason}`);
}

function assert(condition, name, reason) {
    if (condition)
        pass(name);
    else
        fail(name, reason);
}

function getApi() {
    return game.modules.get('lancer-automations')?.api;
}

// ─── Test 1: OR mode — card closes immediately on choice ──────────────
async function orBasic() {
    const api = getApi();
    console.log('%c── Test: OR basic ──', 'color:cyan;');
    let callbackRan = false;

    const p = api.startChoiceCard({
        title: "TEST OR",
        mode: "or",
        choices: [
            { text: "Option A",
                callback: async () => {
                    callbackRan = true;
                } },
            { text: "Option B" }
        ]
    });

    await delay(300);
    assert(countVisibleCards() === 1, "OR card visible", `expected 1, got ${countVisibleCards()}`);

    $('.la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(400);

    assert(callbackRan, "OR callback ran", "callback did not run");
    assert(countVisibleCards() === 0, "OR card removed after choice", `expected 0, got ${countVisibleCards()}`);
    await p;
}

// ─── Test 2: AND mode — both choices required ────────────────────────
async function andBasic() {
    const api = getApi();
    console.log('%c── Test: AND basic ──', 'color:cyan;');
    let cbA = false, cbB = false;

    const p = api.startChoiceCard({
        title: "TEST AND",
        mode: "and",
        choices: [
            { text: "Step A",
                callback: async () => {
                    cbA = true;
                } },
            { text: "Step B",
                callback: async () => {
                    cbB = true;
                } }
        ]
    });

    await delay(300);
    assert(countVisibleCards() === 1, "AND card visible", `got ${countVisibleCards()}`);

    $('.la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(400);
    assert(cbA, "AND Step A callback ran", "Step A callback did not run");
    assert(countVisibleCards() === 1, "AND card still visible after first choice", `got ${countVisibleCards()}`);

    $('.la-choice-item[data-choice-index="1"]:not(.la-choice-done)').trigger('click');
    await delay(400);
    assert(cbB, "AND Step B callback ran", "Step B callback did not run");
    assert(countVisibleCards() === 0, "AND card removed after all choices", `got ${countVisibleCards()}`);
    await p;
}

// ─── Test 3: AND mode — callback opens a sub-card (STACK PUSH) ──────
async function andSubCard() {
    const api = getApi();
    console.log('%c── Test: AND + sub-card (stack push) ──', 'color:cyan;');
    let subCardResult = null;

    const p = api.startChoiceCard({
        title: "TEST AND PARENT",
        mode: "and",
        choices: [
            {
                text: "Open Sub-Card",
                callback: async () => {
                    subCardResult = await api.startChoiceCard({
                        title: "TEST SUB-CARD",
                        mode: "or",
                        choices: [
                            { text: "Sub-Option 1" },
                            { text: "Sub-Option 2" }
                        ]
                    });
                }
            },
            {
                text: "Simple Step",
                callback: async () => { /* no-op */ }
            }
        ]
    });

    await delay(300);
    assert(countVisibleCards() === 1, "Parent AND card visible", `got ${countVisibleCards()}`);

    // Pick "Open Sub-Card"
    $('.la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);

    const visibleCards = countVisibleCards();
    const totalCards = countAllCards();
    assert(totalCards === 2, "Two cards in DOM (parent + sub)", `got ${totalCards}`);
    assert(visibleCards === 1, "Only sub-card visible", `got ${visibleCards}`);

    const visibleTitle = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(visibleTitle === "TEST SUB-CARD", "Sub-card is on top", `visible title: "${visibleTitle}"`);

    // Pick sub-option to close sub-card
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);

    assert(subCardResult === true, "Sub-card resolved with true", `got ${subCardResult}`);
    assert(countVisibleCards() === 1, "Parent AND card visible again", `got ${countVisibleCards()}`);

    const parentTitle = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(parentTitle === "TEST AND PARENT", "Parent card is back on top", `visible title: "${parentTitle}"`);

    // Complete remaining AND choice
    $('.la-choice-item[data-choice-index="1"]:not(.la-choice-done)').trigger('click');
    await delay(400);
    assert(countVisibleCards() === 0, "All cards cleaned up", `got ${countVisibleCards()}`);
    await p;
}

// ─── Test 4: External card queues behind active card ─────────────────
async function externalQueues() {
    const api = getApi();
    console.log('%c── Test: External card queues behind ──', 'color:cyan;');
    let firstDone = false;

    const p1 = api.startChoiceCard({
        title: "CARD FIRST",
        mode: "or",
        choices: [
            { text: "Done",
                callback: async () => {
                    firstDone = true;
                } }
        ]
    });

    await delay(300);

    let secondDone = false;
    const p2 = api.startChoiceCard({
        title: "CARD SECOND",
        mode: "or",
        choices: [
            { text: "Done",
                callback: async () => {
                    secondDone = true;
                } }
        ]
    });

    await delay(300);

    assert(countVisibleCards() === 1, "Only first card visible", `got ${countVisibleCards()}`);
    const title1 = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title1 === "CARD FIRST", "First card is active", `visible: "${title1}"`);

    // Close first card
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);
    assert(firstDone, "First card callback ran", "first callback missing");
    await p1;

    await delay(300);
    assert(countVisibleCards() === 1, "Second card now visible", `got ${countVisibleCards()}`);
    const title2 = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title2 === "CARD SECOND", "Second card is active", `visible: "${title2}"`);

    // Close second card
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(400);
    assert(secondDone, "Second card callback ran", "second callback missing");
    assert(countVisibleCards() === 0, "All cards cleaned up", `got ${countVisibleCards()}`);
    await p2;
}

// ─── Test 5: Cancel AND card ─────────────────────────────────────────
async function andCancel() {
    const api = getApi();
    console.log('%c── Test: AND cancel ──', 'color:cyan;');

    const p = api.startChoiceCard({
        title: "TEST AND CANCEL",
        mode: "and",
        choices: [
            { text: "Step A", callback: async () => {} },
            { text: "Step B", callback: async () => {} }
        ]
    });

    await delay(300);
    assert(countVisibleCards() === 1, "AND card visible", `got ${countVisibleCards()}`);

    $('.la-info-card:visible [data-action="cancel"]').trigger('click');
    await delay(400);

    const result = await p;
    assert(result === null, "AND cancelled returns null", `got ${result}`);
    assert(countVisibleCards() === 0, "Card removed on cancel", `got ${countVisibleCards()}`);
}

// ─── Test 6: Nested stack (A → B → C) ────────────────────────────────
async function nestedStack() {
    const api = getApi();
    console.log('%c── Test: Nested stack A → B → C ──', 'color:cyan;');

    const p = api.startChoiceCard({
        title: "STACK A",
        mode: "and",
        choices: [
            {
                text: "Open B",
                callback: async () => {
                    await api.startChoiceCard({
                        title: "STACK B",
                        mode: "and",
                        choices: [
                            {
                                text: "Open C",
                                callback: async () => {
                                    await api.startChoiceCard({
                                        title: "STACK C",
                                        mode: "or",
                                        choices: [{ text: "Close C" }]
                                    });
                                }
                            },
                            { text: "Close B step 2" }
                        ]
                    });
                }
            },
            { text: "Close A step 2" }
        ]
    });

    await delay(400);
    assert(countVisibleCards() === 1, "A visible", `got ${countVisibleCards()}`);

    // Click "Open B" on A
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);
    assert(countAllCards() === 2, "A + B in DOM", `got ${countAllCards()}`);
    let title = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title === "STACK B", "B is on top", `visible: "${title}"`);

    // Click "Open C" on B
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);
    assert(countAllCards() === 3, "A + B + C in DOM", `got ${countAllCards()}`);
    title = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title === "STACK C", "C is on top", `visible: "${title}"`);

    // Close C
    $('.la-info-card:visible .la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(500);
    title = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title === "STACK B", "B is back after C popped", `visible: "${title}"`);
    assert(countAllCards() === 2, "A + B remain", `got ${countAllCards()}`);

    // Close B step 2
    $('.la-info-card:visible .la-choice-item[data-choice-index="1"]:not(.la-choice-done)').trigger('click');
    await delay(500);
    title = $('.la-info-card:visible .lancer-header span').first().text().trim();
    assert(title === "STACK A", "A is back after B popped", `visible: "${title}"`);
    assert(countAllCards() === 1, "Only A remains", `got ${countAllCards()}`);

    // Close A step 2
    $('.la-info-card:visible .la-choice-item[data-choice-index="1"]:not(.la-choice-done)').trigger('click');
    await delay(500);
    assert(countVisibleCards() === 0, "All cards cleaned up", `got ${countVisibleCards()}`);
    await p;
}

// ─── Test 7: Custom Validation (Barrage Mock) ──────────────────────
async function barrageValidation() {
    const api = getApi();
    console.log('%c── Test: Custom Validation (Barrage Mock) ──', 'color:cyan;');

    // Mock the Barrage validator
    const barrageValidator = (selected) => {
        if (selected.length === 0)
            return { valid: false, message: "Select 1 SH or 2 non-SH" };
        if (selected.length === 1) {
            const isSH = selected[0].sh;
            return isSH ? { valid: true, message: "SH selected" } : { valid: false, message: "Need SH or 2 mounts" };
        }
        if (selected.length === 2) {
            const anySH = selected.some(s => s.sh);
            return anySH ? { valid: false, message: "Cannot mix SH" } : { valid: true, message: "2 mounts selected" };
        }
        return { valid: false };
    };

    const p = api.startChoiceCard({
        title: "BARRAGE SELECTION",
        mode: "vote", // We use vote so we can select multiple before confirming
        numberToChoose: 2,
        selectionValidator: barrageValidator,
        choices: [
            { text: "Mount A (Main)", value: { sh: false }, icon: "A" },
            { text: "Mount B (Flex)", value: { sh: false }, icon: "B" },
            { text: "Mount C (Superheavy)", value: { sh: true }, icon: "C" }
        ]
    });

    await delay(300);
    assert(countVisibleCards() === 1, "Validation card visible", `got ${countVisibleCards()}`);

    const $card = $('.la-info-card:visible');
    const $msg = $card.find('.la-validation-message');
    const $confirm = $card.find('button.la-confirm-vote');

    // Initial state: 0 selected
    assert($msg.text() === "Select 1 SH or 2 non-SH", "Initial message correct", `got ${$msg.text()}`);
    assert($confirm.prop('disabled') === true, "Confirm disabled initially", "");

    // Select Mount A (invalid)
    $card.find('.la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(200);
    assert($msg.text() === "Need SH or 2 mounts", "1 non-SH message correct", `got ${$msg.text()}`);
    assert($confirm.prop('disabled') === true, "Confirm disabled with 1 non-SH", "");

    // Select Mount B (valid: 2 non-SH)
    $card.find('.la-choice-item[data-choice-index="1"]').trigger('click');
    await delay(200);
    assert($msg.text() === "2 mounts selected", "2 non-SH message correct", `got ${$msg.text()}`);
    assert($confirm.prop('disabled') === false, "Confirm enabled with 2 non-SH", "");

    // Deselect B, select C (invalid: mixed)
    $card.find('.la-choice-item[data-choice-index="1"]').trigger('click');
    $card.find('.la-choice-item[data-choice-index="2"]').trigger('click');
    await delay(200);
    assert($msg.text() === "Cannot mix SH", "Mixed message correct", `got ${$msg.text()}`);
    assert($confirm.prop('disabled') === true, "Confirm disabled with mix", "");

    // Deselect A (valid: 1 SH)
    $card.find('.la-choice-item[data-choice-index="0"]').trigger('click');
    await delay(200);
    assert($msg.text() === "SH selected", "1 SH message correct", `got ${$msg.text()}`);
    assert($confirm.prop('disabled') === false, "Confirm enabled with 1 SH", "");

    // Confirm choice
    $confirm.trigger('click');
    await delay(400);

    // In "vote" mode, startChoiceCard returns an array of selected choices
    /** @type {any} */
    const result = await p;
    assert(Array.isArray(result) && result.length === 1 && result[0].sh, "Result returned correctly", `got ${JSON.stringify(result)}`);
    assert(countVisibleCards() === 0, "Card cleaned up", `got ${countVisibleCards()}`);
}

// ─── Run All ─────────────────────────────────────────────────────────
async function runAll() {
    console.log('%c╔══════════════════════════════════════╗', 'color:gold;');
    console.log('%c║   Card Stack Test Suite              ║', 'color:gold;');
    console.log('%c╚══════════════════════════════════════╝', 'color:gold;');

    // Clean up any leftover cards
    $('.la-info-card').remove();
    await delay(300);

    await orBasic();
    await delay(500);

    await andBasic();
    await delay(500);

    await andSubCard();
    await delay(500);

    await externalQueues();
    await delay(500);

    await andCancel();
    await delay(500);

    await nestedStack();
    await delay(500);

    await barrageValidation();
    await delay(500);

    console.log('%c╔══════════════════════════════════════╗', 'color:gold;');
    console.log('%c║   All tests complete!                ║', 'color:gold;');
    console.log('%c╚══════════════════════════════════════╝', 'color:gold;');
}

export const CardStackTests = { orBasic, andBasic, andSubCard, externalQueues, andCancel, nestedStack, barrageValidation, runAll };
