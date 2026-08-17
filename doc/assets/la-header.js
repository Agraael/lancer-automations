document$.subscribe(() =>
{
    const topic = document.querySelector(".md-header__topic:first-child .md-ellipsis");
    if (!topic || topic.querySelector(".la-byline"))
        return;

    const byline = document.createElement("span");
    byline.className = "la-byline";
    byline.append(" by ");

    const link = document.createElement("a");
    link.href = "https://www.patreon.com/cw/LaSossis";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "LaSossis";

    byline.append(link);
    topic.append(byline);
});
