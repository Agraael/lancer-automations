function tagCallTokens(code)
{
    let depth = 0;
    for (const el of code.children)
    {
        if (!el.classList)
            continue;

        if (el.classList.contains("p"))
        {
            for (const ch of el.textContent)
            {
                if (ch === "(") depth++;
                else if (ch === ")") depth--;
            }
            continue;
        }

        if (!el.classList.contains("nx"))
            continue;

        const next = el.nextElementSibling;
        if (next && next.classList.contains("p") && next.textContent.trimStart().startsWith("("))
            el.classList.add("la-fn");
        else if (depth > 0)
            el.classList.add("la-arg");
    }
}

document$.subscribe(() =>
{
    document.querySelectorAll(".highlight code, code.highlight").forEach(tagCallTokens);
});
