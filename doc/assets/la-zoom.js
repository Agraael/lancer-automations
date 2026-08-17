let overlay = null;

function closeZoom()
{
    if (!overlay)
        return;
    overlay.remove();
    overlay = null;
    document.removeEventListener("keydown", onKey);
}

function onKey(event)
{
    if (event.key === "Escape")
        closeZoom();
}

function openZoom(source)
{
    closeZoom();
    overlay = document.createElement("div");
    overlay.className = "la-zoom";

    const full = document.createElement("img");
    full.src = source.currentSrc || source.src;
    full.alt = source.alt ?? "";
    overlay.append(full);

    overlay.addEventListener("click", closeZoom);
    document.addEventListener("keydown", onKey);
    document.body.append(overlay);
}

document$.subscribe(() =>
{
    closeZoom();
    for (const image of document.querySelectorAll(".md-content__inner img"))
    {
        if (image.closest("a") || image.classList.contains("la-zoomable"))
            continue;
        image.classList.add("la-zoomable");
        image.addEventListener("click", () => openZoom(image));
    }
});
