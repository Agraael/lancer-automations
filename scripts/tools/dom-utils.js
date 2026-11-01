export function htmlToElement(html)
{
    const template = document.createElement('template');
    template.innerHTML = String(html).trim();
    return /** @type {HTMLElement} */ (template.content.firstElementChild);
}

/**
 * CodeMirror keeps its own height, so a resizable dialog has to push a new one on every resize.
 * @param {number} [buttonReservedH] default 40 matches the forced CSS height on .dialog-buttons
 * @returns {ResizeObserver|null} observer to disconnect in the dialog's close handler
 */
export function attachEditorResizeObserver(editor, windowEl, buttonReservedH = 40)
{
    if (!windowEl)
        return null;
    const updateSize = () =>
    {
        const headerH = /** @type {HTMLElement|null} */ (windowEl.querySelector('.window-header'))?.offsetHeight ?? 34;
        editor.setSize(null, windowEl.offsetHeight - headerH - buttonReservedH);
        editor.refresh();
    };
    setTimeout(updateSize, 50);
    const observer = new ResizeObserver(updateSize);
    observer.observe(windowEl);
    return observer;
}
