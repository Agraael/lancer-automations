const ICONS = {
    "patreon": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 512 512\" fill=\"currentColor\"><path d=\"M489.7 153.8c-.1-65.4-51-119-110.7-138.3C304.8-8.5 207-5 136.1 28.4 50.3 68.9 23.3 157.7 22.3 246.2 21.5 319 28.7 510.6 136.9 512c80.3 1 92.3-102.5 129.5-152.3 26.4-35.5 60.5-45.5 102.4-55.9 72-17.8 121.1-74.7 121-150z\"/></svg>",
    "discord": "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 640 512\" fill=\"currentColor\"><path d=\"M524.531 69.836a1.5 1.5 0 0 0-.764-.7A485 485 0 0 0 404.081 32.03a1.82 1.82 0 0 0-1.923.91 338 338 0 0 0-14.9 30.6 447.9 447.9 0 0 0-134.426 0 310 310 0 0 0-15.135-30.6 1.89 1.89 0 0 0-1.924-.91 483.7 483.7 0 0 0-119.688 37.107 1.7 1.7 0 0 0-.788.676C39.068 183.651 18.186 294.69 28.43 404.354a2.02 2.02 0 0 0 .765 1.375 487.7 487.7 0 0 0 146.825 74.189 1.9 1.9 0 0 0 2.063-.676A348 348 0 0 0 208.12 430.4a1.86 1.86 0 0 0-1.019-2.588 321 321 0 0 1-45.868-21.853 1.885 1.885 0 0 1-.185-3.126 251 251 0 0 0 9.109-7.137 1.82 1.82 0 0 1 1.9-.256c96.229 43.917 200.41 43.917 295.5 0a1.81 1.81 0 0 1 1.924.233 235 235 0 0 0 9.132 7.16 1.884 1.884 0 0 1-.162 3.126 301.4 301.4 0 0 1-45.89 21.83 1.875 1.875 0 0 0-1 2.611 391 391 0 0 0 30.014 48.815 1.86 1.86 0 0 0 2.063.7A486 486 0 0 0 610.7 405.729a1.88 1.88 0 0 0 .765-1.352c12.264-126.783-20.532-236.912-86.934-334.541M222.491 337.58c-28.972 0-52.844-26.587-52.844-59.239s23.409-59.241 52.844-59.241c29.665 0 53.306 26.82 52.843 59.239 0 32.654-23.41 59.241-52.843 59.241m195.38 0c-28.971 0-52.843-26.587-52.843-59.239s23.409-59.241 52.843-59.241c29.667 0 53.307 26.82 52.844 59.239 0 32.654-23.177 59.241-52.844 59.241\"/></svg>"
};

const HEADER_LINKS = [
    { href: "https://www.patreon.com/c/LaSossis", icon: "patreon", label: "Support my work" },
    { href: "https://discord.com/channels/426286410496999425/1436087781666455642", icon: "discord", label: "Discord" },
];

function addByline(topic)
{
    if (topic.querySelector(".la-byline"))
        return;

    const byline = document.createElement("span");
    byline.className = "la-byline";
    byline.append(" by ");

    const link = document.createElement("a");
    link.href = "https://www.patreon.com/c/LaSossis";
    link.target = "_blank";
    link.rel = "noopener";
    link.textContent = "LaSossis";

    byline.append(link);
    topic.append(byline);
}

function addHeaderLinks()
{
    const source = document.querySelector(".md-header__source");
    const host = source?.parentElement ?? document.querySelector(".md-header__inner");
    if (!host || host.querySelector(".la-header-links"))
        return;

    const nav = document.createElement("nav");
    nav.className = "la-header-links";
    nav.setAttribute("aria-label", "Author links");

    for (const entry of HEADER_LINKS)
    {
        const link = document.createElement("a");
        link.href = entry.href;
        link.target = "_blank";
        link.rel = "noopener";
        link.title = entry.label;

        const icon = document.createElement("span");
        icon.className = "la-header-icon";
        icon.innerHTML = ICONS[entry.icon];
        link.append(icon);

        const text = document.createElement("span");
        text.textContent = entry.label;
        link.append(text);

        nav.append(link);
    }

    if (source)
        source.before(nav);
    else
        host.append(nav);
}

document$.subscribe(() =>
{
    const topic = document.querySelector(".md-header__topic:first-child .md-ellipsis");
    if (topic)
        addByline(topic);
    addHeaderLinks();
});
