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

function makeChip(name, targetId)
{
    const chip = document.createElement("a");
    chip.className = "la-fn-chip";
    chip.href = `#${targetId}`;
    chip.textContent = name;
    chip.dataset.name = name.toLowerCase();
    return chip;
}

function buildIndex(entries)
{
    const box = document.createElement("div");
    box.className = "la-fn-index";

    const bar = document.createElement("div");
    bar.className = "la-fn-bar";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "la-fn-filter";
    search.placeholder = `Filter ${entries.length} functions...`;
    bar.append(search);

    const panel = document.createElement("div");
    panel.className = "la-fn-panel";
    bar.append(panel);

    const grid = document.createElement("div");
    grid.className = "la-fn-grid";
    for (const entry of entries)
        for (const name of entry.names)
            grid.append(makeChip(name, entry.details.id));
    box.append(grid);

    const empty = document.createElement("p");
    empty.className = "la-fn-empty";
    empty.textContent = "No function matches.";
    box.append(empty);

    let gridVisible = true;

    const apply = () =>
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
            entry.details.hidden = !!query && !entry.names.some(name => name.toLowerCase().includes(query));
        box.classList.toggle("la-fn-none", shown === 0);

        panel.textContent = "";
        const usePanel = !!query && !gridVisible;
        if (usePanel)
        {
            for (const entry of entries)
                for (const name of entry.names)
                    if (name.toLowerCase().includes(query))
                        panel.append(makeChip(name, entry.details.id));
            if (!panel.children.length)
            {
                const none = document.createElement("p");
                none.className = "la-fn-empty";
                none.textContent = "No function matches.";
                panel.append(none);
            }
        }
        panel.classList.toggle("la-fn-panel-open", usePanel);
    };

    search.addEventListener("input", apply);
    box.laBar = bar;
    panel.addEventListener("click", () =>
    {
        search.value = "";
        apply();
    });

    new IntersectionObserver((records) =>
    {
        gridVisible = records[0].isIntersecting;
        apply();
    }).observe(grid);

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
    const box = buildIndex(entries);
    anchor.parentElement.insertBefore(box.laBar, anchor);
    anchor.parentElement.insertBefore(box, anchor);
});
