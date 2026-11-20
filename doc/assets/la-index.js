function collectEntries()
{
    const out = [];
    for (const details of document.querySelectorAll(".md-typeset > details[id]"))
    {
        const summary = details.querySelector("summary");
        if (!summary)
            continue;
        const names = [...summary.querySelectorAll(".la-sig-name, b > code")].map(node => node.textContent.trim());
        if (names.length)
            out.push({ details, names });
    }
    return out;
}

function buildIndex(entries)
{
    const bar = document.createElement("div");
    bar.className = "la-fn-bar";

    const search = document.createElement("input");
    search.type = "search";
    search.className = "la-fn-filter";
    search.placeholder = `Filter ${entries.length} functions...`;
    bar.append(search);

    const empty = document.createElement("p");
    empty.className = "la-fn-empty";
    empty.textContent = "No function matches.";
    bar.append(empty);

    search.addEventListener("input", () =>
    {
        const query = search.value.trim().toLowerCase();
        let shown = 0;
        for (const entry of entries)
        {
            const hit = !query || entry.names.some(name => name.toLowerCase().includes(query));
            entry.details.hidden = !hit;
            if (hit)
                shown++;
        }
        bar.classList.toggle("la-fn-none", shown === 0);
    });

    return bar;
}

document$.subscribe(() =>
{
    if (document.querySelector(".la-fn-bar"))
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
