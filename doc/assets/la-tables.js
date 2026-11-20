const SIDE_LINE_LIMIT = 48;

function isParamTable(table)
{
    const head = table.querySelector("thead th");
    return !!head && head.textContent.trim().toLowerCase() === "param";
}

function tableOf(node)
{
    if (node.tagName === "TABLE")
        return node;

    return node.classList.contains("md-typeset__scrollwrap") ? node.querySelector("table") : null;
}

function paramTableOf(node)
{
    const table = tableOf(node);
    return table && isParamTable(table) ? table : null;
}

function isParamsLine(node)
{
    const strong = node.firstElementChild;
    return node.tagName === "P" && !!strong && strong.tagName === "STRONG" && node.firstChild === strong && /^Params:?$/.test(strong.textContent.trim());
}

function isCodeBlock(node)
{
    return node.matches(".highlight, pre");
}

function isBlank(node)
{
    return node.tagName === "BR" || (node.tagName === "P" && !node.textContent.trim() && !node.querySelector("img"));
}

function make(tag, className, text)
{
    const el = document.createElement(tag);
    if (className)
        el.className = className;
    if (text !== undefined)
        el.textContent = text;
    return el;
}

function parseSummary(summary)
{
    const groups = [[]];
    for (const node of summary.childNodes)
    {
        if (node.nodeName === "BR")
            groups.push([]);
        else if (!node.classList?.contains("la-permalink"))
            groups[groups.length - 1].push(node);
    }

    const lines = [];
    for (const nodes of groups)
    {
        const names = nodes.filter(node => node.nodeName === "B").map(node => node.textContent.trim());
        if (!names.length)
            continue;

        const line = { names, isAsync: false, ret: "", desc: [] };
        let part = "name";
        for (const node of nodes)
        {
            if (node.nodeName === "B")
                continue;

            if (node.nodeName === "SUP")
            {
                line.isAsync ||= /async/.test(node.textContent);
                continue;
            }

            if (node.nodeType !== Node.TEXT_NODE)
            {
                if (part === "ret")
                    line.ret += node.textContent;
                else if (part === "desc")
                    line.desc.push(node.cloneNode(true));
                continue;
            }

            let text = node.textContent;
            if (part === "name" && text.includes("→"))
            {
                part = "ret";
                text = text.slice(text.indexOf("→") + 1);
            }

            const dash = text.search(/(^|\s)-\s/);
            if (part !== "desc" && dash >= 0)
            {
                if (part === "ret")
                    line.ret += text.slice(0, dash);
                part = "desc";
                text = text.slice(dash).replace(/^\s*-\s/, "");
            }

            if (part === "ret")
                line.ret += text;
            else if (part === "desc" && text)
                line.desc.push(document.createTextNode(text));
        }

        line.ret = line.ret.trim();
        lines.push(line);
    }
    return lines;
}

function callArgs(text, name)
{
    let at = -1;
    let length = 0;
    for (const probe of [`api.${name}(`, `.${name}(`, `${name}(`])
    {
        at = text.indexOf(probe);
        if (at >= 0)
        {
            length = probe.length;
            break;
        }
    }
    if (at < 0)
        return null;

    let index = at + length;
    let depth = 1;
    let out = "";
    while (index < text.length && depth > 0)
    {
        const ch = text[index];
        if ("({[".includes(ch))
            depth++;
        else if (")}]".includes(ch))
            depth--;
        if (depth > 0)
            out += ch;
        index++;
    }

    out = out.replace(/\s+/g, " ").trim();
    return out.length > 48 ? out.replace(/\{[^{}]*\}/g, "{…}") : out;
}

function buildSummary(summary, lines, text)
{
    const permalink = summary.querySelector(".la-permalink");
    const sig = make("span", "la-sig");
    for (const line of lines)
    {
        const head = make("span", "la-sig-head");
        line.names.forEach((name, index) =>
        {
            if (index)
                head.append(" / ");
            head.append(make("b", "la-sig-name", name));
        });

        const args = line.names.length === 1 ? callArgs(text, line.names[0]) : null;
        if (args !== null)
            head.append(make("span", "la-sig-args", `(${args})`));

        if (line.desc.length)
        {
            const desc = make("span", "la-sig-desc");
            desc.append(...line.desc);
            head.append(desc);
        }

        const tail = make("span", "la-sig-tail");
        if (line.isAsync)
            tail.append(make("span", "la-sig-async", "async"));
        if (line.ret)
            tail.append(make("span", "la-sig-ret", line.ret));

        const row = make("span", "la-sig-line");
        row.append(head, tail);
        sig.append(row);
    }

    summary.replaceChildren(sig);
    if (permalink)
        summary.append(permalink);
    summary.classList.toggle("la-multi", lines.length > 1);
}

function cellType(cell)
{
    return cell ? cell.textContent.trim().replace(/\s*\|\s*/g, " | ") : "";
}

function readRow(cells, heads)
{
    const defCell = cells[heads.indexOf("default")];
    const defText = defCell ? defCell.textContent.trim() : "";
    const required = /^required$/i.test(defText);
    return {
        name: cells[0].textContent.trim(),
        type: cellType(cells[heads.indexOf("type")]),
        def: required ? "" : defText,
        defCode: !!defCell?.querySelector("code"),
        req: required,
        desc: cells[cells.length - 1].innerHTML.trim()
    };
}

function tableHeads(table)
{
    return [...table.querySelectorAll("thead th")].map(th => th.textContent.trim().toLowerCase());
}

function readParamTable(table, model)
{
    const heads = tableHeads(table);
    let parent = null;
    let group = null;
    for (const row of table.querySelectorAll("tbody tr"))
    {
        const cells = [...row.cells];
        const first = cells[0];
        if (row.classList.contains("la-bag-divider"))
        {
            const bag = first.querySelector("code")?.textContent.trim() ?? first.textContent.replace(/^inside\s+/i, "").trim();
            parent = model.find(item => item.name === bag);
            if (!parent)
            {
                parent = { name: bag, type: "object", def: "", desc: "" };
                model.push(parent);
            }
            parent.kids ??= [];
            group = null;
            continue;
        }

        const label = first.querySelector("em");
        if (label && label.textContent.trim() === first.textContent.trim() && cells.slice(1).every(cell => !cell.textContent.trim()))
        {
            group = label.textContent.trim();
            continue;
        }

        const item = readRow(cells, heads);
        item.group = group;
        (parent ? parent.kids : model).push(item);
    }
}

function readParamsLine(para, model)
{
    const html = para.innerHTML.replace(/^\s*<strong>[^<]*<\/strong>\s*/, "");
    for (const part of html.split(/\s+·\s+/))
    {
        const holder = make("div");
        holder.innerHTML = part;
        const names = [...holder.querySelectorAll("kbd")].map(kbd => kbd.textContent.trim());
        holder.querySelectorAll("kbd").forEach(kbd => kbd.remove());
        const type = holder.querySelector("code");
        const typeText = cellType(type);
        type?.remove();
        const text = holder.innerHTML.replace(/^[\s/]+/, "").trim();
        const desc = /^[\s.,;:]*$/.test(text) ? "" : text;

        if (names.length)
            model.push({ name: names.join(" / "), type: typeText, def: "", desc });
        else if (model.length)
            model[model.length - 1].desc += ` ${part}`;
    }
}

function attachKeyTables(prose, model)
{
    for (const para of prose.filter(node => node.tagName === "P"))
    {
        const strong = para.firstElementChild;
        if (!strong || strong.tagName !== "STRONG" || para.firstChild !== strong)
            continue;

        const key = strong.textContent.replace(/:$/, "").trim().toLowerCase();
        const target = model.find(item => item.name.toLowerCase() === key);
        if (!target)
            continue;

        strong.remove();
        const next = para.nextElementSibling;
        const table = next && !paramTableOf(next) ? tableOf(next) : null;
        if (table)
        {
            const heads = tableHeads(table);
            target.kids = [...table.querySelectorAll("tbody tr")].map(row => readRow([...row.cells], heads));
            prose.splice(prose.indexOf(next), 1);
            next.remove();
        }

        prose.splice(prose.indexOf(para), 1);
        target.extra = para;
    }
}

function renderShape(kids)
{
    const plate = make("div", "la-shape");
    plate.append(make("div", "la-shape-brace", "{"));
    let group = null;
    for (const kid of kids)
    {
        if (kid.group && kid.group !== group)
        {
            group = kid.group;
            plate.append(make("div", "la-shape-group", `// ${group}`));
        }

        const name = make("button", "la-shape-name", kid.name);
        name.type = "button";
        name.setAttribute("aria-expanded", "false");

        const line = make("div", "la-shape-line");
        line.append(name, make("span", "la-shape-op", kid.req ? ": " : "?: "), make("span", "la-shape-type", kid.type));
        if (kid.def)
            line.append(make("span", "la-shape-op", " = "), make("span", "la-shape-def", kid.def));

        const desc = make("div", "la-shape-desc");
        desc.innerHTML = kid.desc;
        desc.hidden = true;
        name.addEventListener("click", () =>
        {
            desc.hidden = !desc.hidden;
            name.setAttribute("aria-expanded", String(!desc.hidden));
            line.classList.toggle("la-lit", !desc.hidden);
        });
        plate.append(line, desc);
    }

    plate.append(make("div", "la-shape-brace", "}"));
    return plate;
}

function renderParam(param)
{
    const head = make("div", "la-param-head");
    head.append(make("code", "la-param-name", param.name));
    if (param.type)
        head.append(make("span", "la-param-type", param.type));
    if (param.req)
        head.append(make("span", "la-param-req", "required"));
    else if (param.def)
        head.append(make("span", param.defCode ? "la-param-def la-code" : "la-param-def", param.defCode ? `= ${param.def}` : `default ${param.def}`));

    const item = make("div", "la-param");
    item.append(head);
    if (param.desc)
    {
        const desc = make("div", "la-param-desc");
        desc.innerHTML = param.desc;
        item.append(desc);
    }

    if (param.extra)
    {
        param.extra.classList.add("la-param-desc");
        item.append(param.extra);
    }

    if (param.kids?.length > 6)
        item.append(renderShape(param.kids));
    else if (param.kids?.length)
    {
        const kids = make("div", "la-param-kids");
        param.kids.forEach(kid => kids.append(renderParam(kid)));
        item.append(kids);
    }
    return item;
}

function makeBlock(label, nodes, className)
{
    const block = make("div", className ? `la-block ${className}` : "la-block");
    if (label)
        block.append(make("div", "la-block-label", label));
    block.append(...nodes);
    return block;
}

function codeLines(block)
{
    return block.textContent.split("\n").map(line => line.trim()).filter(Boolean);
}

function isSignature(block)
{
    return codeLines(block).every(line => !/[{[(,]$/.test(line));
}

function isPlainCall(block)
{
    return codeLines(block).every(line => /api\.\w+\(/.test(line) && !line.includes("//"));
}

function buildEntryBody(details, lines)
{
    const nodes = [...details.children].filter(node => node.tagName !== "SUMMARY");
    nodes.filter(isBlank).forEach(node => node.remove());
    const kept = nodes.filter(node => node.isConnected);
    const params = kept.filter(node => paramTableOf(node) || isParamsLine(node));
    if (!params.length && !lines.some(line => line.ret))
        return;

    const lead = kept.length && isCodeBlock(kept[0]) && isSignature(kept[0]) ? kept[0] : null;
    const codes = kept.filter(node => isCodeBlock(node) && node !== lead);
    const prose = kept.filter(node => !isCodeBlock(node) && !params.includes(node));
    const firstParam = params.length ? kept.indexOf(params[0]) : kept.length;

    const model = [];
    for (const node of params)
    {
        if (isParamsLine(node))
            readParamsLine(node, model);
        else
            readParamTable(paramTableOf(node), model);
        node.remove();
    }
    attachKeyTables(prose, model);

    const body = make("div", "la-entry");
    if (lead && isPlainCall(lead))
        lead.remove();
    else if (lead)
        body.append(makeBlock(null, [lead], "la-entry-call"));

    const main = make("div", "la-entry-main");

    const before = prose.filter(node => kept.indexOf(node) < firstParam);
    const after = prose.filter(node => kept.indexOf(node) > firstParam);
    if (before.length)
        main.append(makeBlock(null, before, "la-entry-desc"));

    if (model.length)
    {
        const list = make("div", "la-param-list");
        model.forEach(param => list.append(renderParam(param)));
        main.append(makeBlock("Parameters", [list]));
    }

    if (after.length)
        main.append(makeBlock("Details", after));

    body.append(main);
    if (codes.length)
    {
        const examples = makeBlock(codes.length > 1 ? "Examples" : "Example", codes, "la-entry-examples");
        const fitsSide = !main.querySelector(".la-shape") && codes.every(code => code.textContent.split("\n").every(line => line.length <= SIDE_LINE_LIMIT));
        if (fitsSide)
        {
            const side = make("aside", "la-entry-side");
            side.append(examples);
            body.append(side);
            body.classList.add("la-entry-split");
        }
        else
            main.append(examples);
    }
    details.append(body);
}

function buildEntries()
{
    const entries = [...document.querySelectorAll(".md-typeset > details[id]")];
    document.documentElement.classList.toggle("la-api-page", entries.length > 0);
    for (const details of entries)
    {
        const summary = details.querySelector(":scope > summary");
        if (!summary || details.dataset.laEntry)
            continue;

        const lines = parseSummary(summary);
        if (!lines.length)
            continue;

        details.dataset.laEntry = "1";
        const text = [...details.querySelectorAll("pre code")].map(block => block.textContent).join("\n");
        buildSummary(summary, lines, text);
        buildEntryBody(details, lines);
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

function unescapePipes(table)
{
    for (const code of table.querySelectorAll("code"))
    {
        if (code.innerHTML.includes("\\|"))
            code.innerHTML = code.innerHTML.replaceAll("\\|", "|<wbr>");
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
    document.querySelectorAll(".md-typeset table:not([class])").forEach(unescapePipes);
    buildEntries();
    setTimeout(openHashTarget, 0);
});
