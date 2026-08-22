function addPermalinks()
{
    for (const details of document.querySelectorAll(".md-typeset details[id]"))
    {
        const summary = details.querySelector("summary");
        if (!summary || summary.querySelector(".la-permalink"))
            continue;
        const link = document.createElement("a");
        link.className = "la-permalink";
        link.href = `#${details.id}`;
        link.title = "Copy link to this entry";
        link.setAttribute("aria-label", `Copy link to ${details.id}`);
        summary.append(link);
    }
}

// capture: la-tables.js binds its summary handler first
document.addEventListener("click", async (event) =>
{
    const link = event.target.closest(".la-permalink");
    if (!link)
        return;
    event.preventDefault();
    event.stopPropagation();
    const url = new URL(link.getAttribute("href"), location.href).href;
    history.replaceState(null, "", url);
    try
    {
        await navigator.clipboard.writeText(url);
        link.classList.add("la-copied");
        setTimeout(() => link.classList.remove("la-copied"), 1200);
    }
    catch
    {
        // blocked; the address bar still has it
    }
}, true);

document$.subscribe(addPermalinks);
