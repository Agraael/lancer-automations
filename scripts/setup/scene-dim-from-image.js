/* global Hooks, ui, Image, document */

const BTN_CLASS = "la-match-image-size";

function _findInput(root, names)
{
    for (const name of names)
    {
        const el = root.querySelector(`input[name="${name}"]`);
        if (el)
            return el;
    }
    return null;
}

function _setInput(input, value)
{
    if (!input)
        return;
    input.value = String(value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
}

function _getBackgroundSrc(app, root)
{
    const fromForm = root.querySelector('[name="background.src"]')?.value
        ?? root.querySelector('file-picker[name="background.src"]')?.getAttribute("value")
        ?? root.querySelector('[name="img"]')?.value;
    if (fromForm)
        return String(fromForm).trim();
    const doc = app?.document ?? app?.object;
    return (doc?.background?.src ?? doc?.img ?? "").trim();
}

async function _applyImageSize(app, root)
{
    const src = _getBackgroundSrc(app, root);
    if (!src)
    {
        ui.notifications?.warn("No background image set on this scene.");
        return;
    }
    const img = new Image();
    await new Promise((resolve, reject) =>
    {
        img.onload = resolve;
        img.onerror = () => reject(new Error("image load failed"));
        img.src = src;
    }).catch(() =>
    {
        ui.notifications?.warn(`Couldn't load image: ${src}`);
    });
    if (!img.naturalWidth || !img.naturalHeight)
        return;
    const linkBtn = _findLinkBtn(root);
    const wasLinked = !!linkBtn?.querySelector("i.fa-link-simple");
    if (wasLinked)
        linkBtn.click();
    _setInput(_findInput(root, ["width"]), img.naturalWidth);
    _setInput(_findInput(root, ["height"]), img.naturalHeight);
    if (wasLinked)
        linkBtn.click();
    ui.notifications?.info(`Scene dimensions set to ${img.naturalWidth} × ${img.naturalHeight}.`);
}

function _findLinkBtn(root)
{
    const icon = root.querySelector("i.fa-link-simple, i.fa-link-simple-slash");
    return icon?.closest("button") ?? null;
}

function _applyScale(root, wPct, hPct)
{
    const widthInput = _findInput(root, ["width"]);
    const heightInput = _findInput(root, ["height"]);
    if (!widthInput || !heightInput)
        return;
    const curW = Number(widthInput.value) || 0;
    const curH = Number(heightInput.value) || 0;
    if (!curW || !curH)
    {
        ui.notifications?.warn("Current scene dimensions are empty. Set Width and Height first.");
        return;
    }
    const newW = Math.max(1, Math.round(curW * (wPct / 100)));
    const newH = Math.max(1, Math.round(curH * (hPct / 100)));

    // Foundry's linked-dimensions validator rejects non-integer ratios on per-input change.
    // Unlink while we write, then relink if it was linked.
    const linkBtn = _findLinkBtn(root);
    const wasLinked = !!linkBtn?.querySelector("i.fa-link-simple");
    if (wasLinked)
        linkBtn.click();
    _setInput(widthInput, newW);
    _setInput(heightInput, newH);
    if (wasLinked)
        linkBtn.click();

    ui.notifications?.info(`Scene dimensions scaled to ${newW} × ${newH}.`);
}

function _buildScaleRow(root)
{
    const row = document.createElement("div");
    row.style.cssText = "display:flex; align-items:center; gap:6px; margin-top:6px; font-size:0.85em;";

    const widthInput = document.createElement("input");
    widthInput.type = "number";
    widthInput.value = "100";
    widthInput.min = "1";
    widthInput.step = "1";
    widthInput.style.cssText = "width:64px;";

    const heightInput = document.createElement("input");
    heightInput.type = "number";
    heightInput.value = "100";
    heightInput.min = "1";
    heightInput.step = "1";
    heightInput.style.cssText = "width:64px;";

    const link = document.createElement("button");
    link.type = "button";
    link.dataset.linked = "1";
    link.style.cssText = "padding:2px 6px; cursor:pointer;";
    link.innerHTML = `<i class="fa-solid fa-link"></i>`;
    link.title = "Linked: typing one mirrors the other. Click to unlink.";

    const setLinked = (on) =>
    {
        link.dataset.linked = on ? "1" : "0";
        link.innerHTML = on ? `<i class="fa-solid fa-link"></i>` : `<i class="fa-solid fa-link-slash"></i>`;
        link.title = on
            ? "Linked: typing one mirrors the other. Click to unlink."
            : "Unlinked: scale Width and Height separately. Click to link.";
    };
    link.addEventListener("click", (ev) =>
    {
        ev.preventDefault();
        const on = link.dataset.linked !== "1";
        setLinked(on);
        if (on)
            heightInput.value = widthInput.value;
    });

    widthInput.addEventListener("input", () =>
    {
        if (link.dataset.linked === "1")
            heightInput.value = widthInput.value;
    });
    heightInput.addEventListener("input", () =>
    {
        if (link.dataset.linked === "1")
            widthInput.value = heightInput.value;
    });

    const apply = document.createElement("button");
    apply.type = "button";
    apply.style.cssText = "padding:2px 10px; cursor:pointer;";
    apply.innerHTML = `<i class="fa-solid fa-check"></i> Apply`;
    apply.addEventListener("click", (ev) =>
    {
        ev.preventDefault();
        const wPct = Number(widthInput.value) || 100;
        const hPct = link.dataset.linked === "1" ? wPct : (Number(heightInput.value) || 100);
        _applyScale(root, wPct, hPct);
    });

    const label = document.createElement("span");
    label.style.cssText = "opacity:0.7;";
    label.textContent = "Scale W/H %";

    row.append(label, widthInput, link, heightInput, apply);
    return row;
}

function _inject(app, htmlOrEl)
{
    const root = htmlOrEl instanceof HTMLElement ? htmlOrEl : htmlOrEl?.[0];
    if (!root)
        return;
    if (root.querySelector(`.${BTN_CLASS}`))
        return;
    const widthInput = _findInput(root, ["width"]);
    const group = widthInput?.closest(".form-group");
    if (!group)
        return;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = BTN_CLASS;
    btn.style.cssText = "margin-top: 4px; padding: 4px 8px; font-size: 0.85em;";
    btn.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> Match background image`;
    btn.addEventListener("click", (ev) =>
    {
        ev.preventDefault();
        _applyImageSize(app, root);
    });
    group.appendChild(btn);
    group.appendChild(_buildScaleRow(root));
}

Hooks.on("renderSceneConfig", _inject);
