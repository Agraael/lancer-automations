import { localize } from "../tools/string-utils.js";
import { installLancerHints } from "../setup/codemirror-hints.js";
import { ReactionManager } from "./reaction-manager.js";

export class StartupScriptEditor extends FormApplication
{
    constructor(object, options)
    {
        super(object, options);
        this._codeEditor = null;
    }

    static get defaultOptions()
    {
        return mergeObject(super.defaultOptions, {
            title: localize('LA.dialogTitle.startupScript'),
            id: "startup-script-editor",
            template: `modules/lancer-automations/templates/startup-script-editor.html`,
            width: 700,
            height: 580,
            resizable: true,
            classes: ["lancer-reaction-editor", "lancer-dialog-base", "lancer-no-title"]
        });
    }

    get title()
    {
        const script = this.object?.script;
        if (!script)
            return "New Startup Script";
        return script.builtin ? `View: ${script.name}` : `Edit: ${script.name}`;
    }

    async getData()
    {
        const script = this.object?.script;
        return {
            id: script?.id ?? foundry.utils.randomID(),
            name: script?.name ?? "",
            description: script?.description ?? "",
            enabled: script?.enabled !== false,
            code: script?.code ?? "",
            builtin: !!script?.builtin,
            workshopId: script?.workshopId ?? "",
            workshopPreview: this.object?.workshopPreview === true
        };
    }

    activateListeners(html)
    {
        super.activateListeners(html);

        const isBuiltin = !!this.object?.script?.builtin;
        const host = html.find('.sse-codemirror-host')[0];
        const textarea = html.find('textarea[name="code"]')[0];
        if (host && typeof CodeMirror !== 'undefined')
        {
            const initialValue = textarea?.value ?? "";
            this._codeEditor = CodeMirror(host, {
                value: initialValue,
                mode: 'javascript',
                theme: 'monokai',
                lineNumbers: true,
                matchBrackets: true,
                styleActiveLine: true,
                indentUnit: 4,
                lineWrapping: false,
                scrollbarStyle: 'native',
                readOnly: isBuiltin
            });
            if (!isBuiltin)
            {
                this._codeEditor.on('change', (cm) =>
                {
                    if (textarea)
                        textarea.value = cm.getValue();
                });
                installLancerHints(this._codeEditor, 'startup');
            }
            const fit = () =>
            {
                if (!this._codeEditor || !host?.isConnected)
                    return;
                const height = host.clientHeight;
                if (height <= 0)
                    return;
                this._codeEditor.setSize('100%', height);
                const cmEl = host.querySelector('.CodeMirror');
                if (cmEl)
                    cmEl.style.setProperty('height', height + 'px', 'important');
                this._codeEditor.refresh();
            };
            requestAnimationFrame(() => requestAnimationFrame(fit));
            const resizeObserver = new ResizeObserver(fit);
            resizeObserver.observe(host);
            this._codeEditorRO = resizeObserver;
        }
    }

    async close(options)
    {
        try
        {
            this._codeEditorRO?.disconnect?.();
        }
        catch
        { /* ignore */ }
        return super.close(options);
    }

    async _updateObject(event, formData)
    {
        if (this.object?.script?.builtin)
            return;

        const id = formData.id ?? foundry.utils.randomID();
        const name = (formData.name ?? "").trim();
        if (!name)
        {
            ui.notifications.warn(localize('LA.notify.scriptNameIsRequired'));
            throw new Error('Script name is required.');
        }

        const entry = {
            id,
            name,
            description: (formData.description ?? "").trim(),
            enabled: !!formData.enabled,
            code: formData.code ?? ""
        };
        if (formData.workshopId)
            entry.workshopId = formData.workshopId;

        const scripts = ReactionManager.getStartupScripts();
        const isNew = !this.object?.script && !entry.workshopId;
        if (isNew)
            scripts.push(entry);
        else
        {
            const idx = scripts.findIndex(script => script.id === id || (entry.workshopId && script.workshopId === entry.workshopId));
            if (idx >= 0)
                scripts[idx] = entry;
            else
                scripts.push(entry);
        }

        await ReactionManager.saveStartupScripts(scripts);
        if (this.object?.manager)
        {
            this.object.manager._needsReload = true;
            this.object.manager.render();
        }
    }
}
