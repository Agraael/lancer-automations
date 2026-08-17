function collectEntries()
{
    const out = [];
    for (const details of document.querySelectorAll(".md-typeset > details[id]"))
    {
        const summary = details.querySelector("summary");
        if (!summary)
            continue;
        const names = [...summary.querySelectorAll("b > code")].map(node => node.textContent.trim());
        if (names.length)
            out.push({ details, names });
    }
    return out;
}

function buildIndex(entries)
{
    const box = document.createElement("div");
    box.className = "la-fn-index";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "la-fn-filter";
    search.placeholder = `Filter ${entries.length} functions...`;
    box.append(search);

    const grid = document.createElement("div");
    grid.className = "la-fn-grid";
    for (const entry of entries)
    {
        for (const name of entry.names)
        {
            const chip = document.createElement("a");
            chip.className = "la-fn-chip";
            chip.href = `#${entry.details.id}`;
            chip.textContent = name;
            chip.dataset.name = name.toLowerCase();
            grid.append(chip);
        }
    }
    box.append(grid);

    const empty = document.createElement("p");
    empty.className = "la-fn-empty";
    empty.textContent = "No function matches.";
    box.append(empty);

    search.addEventListener("input", () =>
    {
        const query = search.value.trim().toLowerCase();
        let shown = 0;
        for (const chip of grid.children)
        {
            const hit = !query || chip.dataset.name.includes(query);
            chip.hidden = !hit;
            if (hit)
                shown++;
        }
        for (const entry of entries)
        {
            const hit = !query || entry.names.some(name => name.toLowerCase().includes(query));
            entry.details.hidden = !hit;
        }
        box.classList.toggle("la-fn-none", shown === 0);
    });

    return box;
}

document$.subscribe(() =>
{
    if (document.querySelector(".la-fn-index"))
        return;
    const entries = collectEntries();
    if (entries.length < 6)
        return;
    let anchor = entries[0].details;
    for (let node = anchor; node; node = node.previousElementSibling)
        if (node.tagName === "H2")
        {
            anchor = node;
            break;
        }
    anchor.parentElement.insertBefore(buildIndex(entries), anchor);
});
