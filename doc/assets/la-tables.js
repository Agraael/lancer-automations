function isParamTable(table)
{
    const head = table.querySelector("thead th");
    return !!head && head.textContent.trim().toLowerCase() === "param";
}

function wrap(table)
{
    if (table.closest(".la-params"))
        return table.closest(".la-params");

    const box = document.createElement("details");
    box.className = "la-params";

    const label = document.createElement("summary");
    label.textContent = "Parameters";
    box.append(label);

    table.parentNode.insertBefore(box, table);
    box.append(table);
    return box;
}

function clampRows(table)
{
    for (const row of table.querySelectorAll("tbody tr"))
    {
        const cell = row.cells[row.cells.length - 1];
        if (!cell || cell.querySelector(".la-clamp"))
            continue;

        const span = document.createElement("span");
        span.className = "la-clamp";
        while (cell.firstChild)
            span.append(cell.firstChild);
        cell.append(span);
    }
}

function markClampable(table)
{
    for (const row of table.querySelectorAll("tbody tr"))
    {
        const span = row.querySelector(".la-clamp");
        if (!span || row.classList.contains("la-clampable"))
            continue;

        if (span.scrollHeight - span.clientHeight > 1)
        {
            row.classList.add("la-clampable");
            row.addEventListener("click", () => row.classList.toggle("la-open"));
        }
    }
}

function markZipped(table)
{
    const th = [...table.querySelectorAll("thead th")].map(e => e.textContent.trim());
    if (th.length === 4 && th[1] === th[3])
        table.dataset.laZipped = "1";
}

function markBagDividers(table)
{
    for (const row of table.querySelectorAll("tbody tr"))
    {
        const first = row.cells[0];
        if (first && first.querySelector("strong") && /^inside\s/.test(first.textContent.trim()))
            row.classList.add("la-bag-divider");
    }
}

function openHashTarget()
{
    const id = decodeURIComponent(location.hash.slice(1));
    if (!id)
        return;
    const el = document.getElementById(id);
    if (!el)
        return;
    for (let n = el; n; n = n.parentElement)
        if (n.tagName === "DETAILS")
            n.open = true;
    el.scrollIntoView();
}

window.addEventListener("hashchange", openHashTarget);

document.addEventListener("click", (e) =>
{
    const summary = e.target.closest(".md-typeset details > summary");
    if (!summary || e.defaultPrevented)
        return;
    const details = summary.parentElement;
    if (!details.open || details.classList.contains("la-closing"))
        return;
    e.preventDefault();
    details.classList.add("la-closing");
    setTimeout(() =>
    {
        details.open = false;
        details.classList.remove("la-closing");
    }, 150);
});

document$.subscribe(() =>
{
    document.querySelectorAll(".md-typeset table:not([class])").forEach(markZipped);
    document.querySelectorAll(".md-typeset table:not([class])").forEach(markBagDividers);
    setTimeout(openHashTarget, 0);
    const tables = [...document.querySelectorAll(".md-typeset table:not([class])")].filter(isParamTable);
    for (const table of tables)
    {
        clampRows(table);
        const box = wrap(table);
        if (box.open)
            markClampable(table);
        else
            box.addEventListener("toggle", () => box.open && markClampable(table), { once: true });
    }
});
