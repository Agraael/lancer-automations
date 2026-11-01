let _styleInjected = false;

function injectStyles()
{
    if (_styleInjected)
        return;
    _styleInjected = true;
    const style = document.createElement('style');
    style.id = 'la-measure-toolbar-styles';
    style.textContent = `
        .la-mt-hide-cursor, .la-mt-hide-cursor * { cursor: none !important; }
        .la-mt-distance-cursor { position: fixed; pointer-events: none; z-index: 100000; transform: translate(-50%, -50%); color: #ffffff; font-size: 22px; line-height: 1; display: none; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.9)); }
        .la-mt-distance-cursor.kind-ruler { font-size: 16px; }
        .la-mt-distance-cursor .la-mt-cursor-laser { width: 30px; height: 30px; display: block; }
        #la-measure-toolbar { --la-mt-cut: 10px; position: fixed; left: 50%; bottom: 10px; z-index: 70; isolation: isolate; display: flex; align-items: center; gap: 8px; padding: 7px 16px; background: transparent; font-family: var(--font-primary, "Signika", sans-serif); color: var(--la-ink, #e8e8e8); font-size: 13px; opacity: 0; transform-origin: 0 100%; transform: translateY(24px) scale(var(--la-mt-scale, 1)); transition: opacity 200ms ease-out, transform 240ms cubic-bezier(0.22, 1, 0.36, 1); }
        #la-measure-toolbar::before { content: ""; position: absolute; inset: 0; z-index: -2; background: var(--primary-color, #ff6400); clip-path: polygon(0 0, calc(100% - var(--la-mt-cut)) 0, 100% var(--la-mt-cut), 100% 100%, var(--la-mt-cut) 100%, 0 calc(100% - var(--la-mt-cut))); filter: drop-shadow(0 4px 14px rgba(0,0,0,0.55)); }
        #la-measure-toolbar::after { content: ""; position: absolute; inset: 2px; z-index: -1; background: var(--la-plate, #e4dccd); clip-path: polygon(0 0, calc(100% - var(--la-mt-cut)) 0, 100% var(--la-mt-cut), 100% 100%, var(--la-mt-cut) 100%, 0 calc(100% - var(--la-mt-cut))); }
        #la-measure-toolbar.la-show { opacity: 1; transform: translateY(0) scale(var(--la-mt-scale, 1)); }
        #la-measure-toolbar.la-hide { opacity: 0; transform: translateY(24px) scale(var(--la-mt-scale, 1)); }
        #la-measure-toolbar.la-mt-suppressed { opacity: 0.45; pointer-events: none; filter: grayscale(0.75); }
        #la-measure-toolbar .la-mt-badge { display: flex; align-items: center; justify-content: center; background: var(--primary-color, #ff6400); color: var(--light-text, #fff); padding: 5px 9px; line-height: 1; }
        #la-measure-toolbar .la-mt-badge-icon { width: 18px; height: 18px; display: block; border: none; object-fit: contain; }
        #la-measure-toolbar button.la-mt-help { width: 21px; height: 21px; min-height: 0; margin: 0; padding: 0; display: flex; align-items: center; justify-content: center; border: 1px solid var(--primary-color, #ff6400); border-radius: 50%; background: transparent; box-shadow: none; font-weight: 700; font-size: 13px; line-height: 1; color: var(--la-accent); cursor: pointer; }
        #la-measure-toolbar button.la-mt-help.open { background: var(--primary-color, #ff6400); color: var(--light-text, #fff); }
        #la-measure-toolbar button.lancer-action-btn { cursor: pointer; line-height: 1; padding: 6px 11px; margin: 0; min-height: 0; flex: 0 0 auto; }
        #la-measure-toolbar button.lancer-action-btn:disabled { opacity: 0.4; cursor: default; }
        #la-measure-toolbar button.la-mt-active { --la-line: var(--primary-color, #ff6400); --la-fill: var(--primary-color, #ff6400); color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-group { display: flex; align-items: center; gap: 4px; }
        #la-measure-toolbar .la-mt-sep { width: 1px; height: 22px; background: color-mix(in srgb, var(--primary-color, #ff6400), transparent 55%); }
        #la-measure-toolbar .la-mt-toggles { display: flex; align-items: center; gap: 10px; font-size: 11px; }
        #la-measure-toolbar .la-mt-toggles label { display: flex; align-items: center; gap: 4px; cursor: pointer; white-space: nowrap; text-transform: uppercase; letter-spacing: 0.04em; }
        #la-measure-toolbar .la-mt-toggles input[type=checkbox] { -webkit-appearance: auto; appearance: auto; accent-color: var(--primary-color, #ff6400); width: 14px; height: 14px; min-width: 0; min-height: 0; margin: 0; padding: 0; background: initial; border: initial; box-shadow: none; cursor: pointer; }
        #la-measure-toolbar .la-mt-toggles input[type=checkbox]::before, #la-measure-toolbar .la-mt-toggles input[type=checkbox]::after { content: none; display: none; }
        @keyframes la-mt-appear { from { opacity: 0; transform: translateY(5px); } to { opacity: 1; transform: translateY(0); } }
        #la-measure-toolbar .la-mt-appear { animation: la-mt-appear 160ms ease-out; }
        #la-measure-toolbar input, #la-measure-toolbar select { -webkit-appearance: auto; appearance: auto; background: var(--la-raise, var(--la-plate, #e4dccd)); color: var(--la-ink, #e8e8e8); border: 1px solid var(--la-edge, #3a3a3a); border-radius: 0; padding: 2px 5px; font-family: var(--la-mono, ui-monospace, "Cascadia Mono", Consolas, monospace); font-size: 12px; }
        #la-measure-toolbar select option { background: var(--la-plate, #e4dccd); color: var(--la-ink, #111); }
        #la-measure-toolbar input:focus, #la-measure-toolbar select:focus { border-color: var(--primary-color, #ff6400); outline: none; }
        #la-measure-toolbar input[type=number] { width: 46px; }
        #la-measure-toolbar .la-mt-ref { display: flex; align-items: center; gap: 6px; max-width: 160px; }
        #la-measure-toolbar .la-mt-ref img { width: 23px; height: 23px; object-fit: contain; border: 1px solid var(--la-edge, rgba(128,128,128,0.5)); background: #000; }
        #la-measure-toolbar .la-mt-ref span { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 14px; }
        #la-measure-toolbar .la-mt-ref-badge { font-weight: 700; font-size: 14px; color: var(--light-text, #fff); background: var(--primary-color, #ff6400); padding: 1px 5px; }
        #la-measure-toolbar .la-mt-ref-multi { gap: 0; }
        #la-measure-toolbar .la-mt-ref-multi img { position: relative; box-shadow: 0 0 0 2px var(--la-plate, #e7e7e7); }
        #la-measure-toolbar .la-mt-ref-multi img + img { margin-left: -12px; }
        #la-measure-toolbar .la-mt-ref-multi img:nth-child(1) { z-index: 3; }
        #la-measure-toolbar .la-mt-ref-multi img:nth-child(2) { z-index: 2; }
        #la-measure-toolbar .la-mt-ref-multi img:nth-child(3) { z-index: 1; }
        #la-measure-toolbar .la-mt-ref-multi .la-mt-ref-text { margin-left: 6px; }
        #la-measure-toolbar .la-mt-ref-text { display: flex; flex-direction: column; justify-content: center; min-width: 0; line-height: 1.05; }
        #la-measure-toolbar .la-mt-ref-tag { font: 600 8.5px/1.1 var(--la-mono, ui-monospace, monospace); text-transform: uppercase; letter-spacing: 0.08em; color: var(--la-ink-dim, #777); }
        #la-measure-toolbar .la-mt-ref-tag-hover { color: var(--la-accent); }
        #la-measure-toolbar .la-mt-ref-text .la-mt-name { font-size: 13px; }
        #la-measure-toolbar .la-mt-ref-text .la-mt-ref-badge { align-self: flex-start; padding: 0 4px; font-size: 11px; }
        #la-measure-toolbar .la-mt-name { display: inline-block; width: 96px; max-width: 96px; overflow: hidden; white-space: nowrap; }
        #la-measure-toolbar .la-mt-name-inner { display: inline-block; white-space: nowrap; will-change: transform; }
        #la-measure-toolbar .la-mt-helpcard { display: none; position: absolute; bottom: calc(100% + 10px); left: 0; z-index: 72; width: max-content; max-width: 380px; padding: 10px 14px 11px; font-size: 11.5px; color: var(--la-ink, #111); }
        #la-measure-toolbar .la-mt-helpcard.open { display: block; }
        #la-measure-toolbar .la-mt-helpcard h5 { margin: 7px 0 3px; font: 600 10px var(--la-mono, ui-monospace, monospace); letter-spacing: 0.08em; text-transform: uppercase; color: var(--la-accent); border: none; }
        #la-measure-toolbar .la-mt-helpcard h5:first-child { margin-top: 0; }
        #la-measure-toolbar .la-mt-help-row { display: grid; grid-template-columns: 104px 1fr; gap: 8px; line-height: 1.55; }
        #la-measure-toolbar .la-mt-help-row kbd { justify-self: start; padding: 0 4px; font: 600 10px/16px var(--la-mono, ui-monospace, monospace); color: var(--la-ink, #111); background: var(--la-raise, #ddd); border: 1px solid var(--la-edge, #bbb); border-radius: 2px; box-shadow: none; white-space: nowrap; }
        #la-measure-toolbar .la-mt-help-row b { font-weight: 600; white-space: nowrap; }
        #la-measure-toolbar .la-mt-help-foot { display: flex; justify-content: space-between; gap: 16px; margin-top: 8px; padding-top: 6px; border-top: 1px solid var(--la-edge, #bbb); color: var(--la-ink-dim, #666); }
        #la-measure-toolbar .la-mt-help-foot a { color: var(--la-accent); font-weight: 600; cursor: pointer; }
        #la-measure-toolbar .la-mt-icon-btn { padding: 6px 8px; display: inline-flex; align-items: center; justify-content: center; }
        #la-measure-toolbar .la-mt-icon-btn i, #la-measure-toolbar .la-mt-dd-trigger i { font-size: 15px; line-height: 1; }
        #la-measure-toolbar .la-mt-icon-btn i, #la-measure-toolbar .la-mt-dd-trigger i:not(.la-mt-dd-caret), #la-measure-toolbar .la-mt-dd-item i { color: var(--la-accent); }
        #la-measure-toolbar .la-mt-svg-icon { display: inline-block; width: 15px; height: 15px; background-color: var(--la-accent); -webkit-mask: center / contain no-repeat; mask: center / contain no-repeat; }
        #la-measure-toolbar .la-mt-dd-item .la-mt-svg-icon { width: 16px; }
        #la-measure-toolbar button.la-mt-active .la-mt-svg-icon { background-color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-dd { position: relative; display: inline-flex; }
        #la-measure-toolbar .la-mt-dd-trigger { display: inline-flex; align-items: center; gap: 6px; }
        #la-measure-toolbar .la-mt-dd-trigger span { font-family: var(--la-mono, ui-monospace, monospace); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; white-space: nowrap; }
        #la-measure-toolbar .la-mt-dd-caret { font-size: 10px !important; opacity: 0.7; margin-left: 1px; }
        #la-measure-toolbar .la-mt-placeholder .la-mt-dd-label { opacity: 0.55; }
        #la-measure-toolbar .la-mt-dd-val { padding: 1px 5px; font: 700 12px var(--la-mono, ui-monospace, monospace); font-variant-numeric: tabular-nums; background: color-mix(in srgb, var(--light-text, #fff) 24%, transparent); }
        #la-measure-toolbar .la-mt-dd-trigger .la-mt-dd-pins { font-size: 10px; font-weight: 700; letter-spacing: 0; }
        #la-measure-toolbar button.la-mt-active i, #la-measure-toolbar button.la-mt-active svg { color: var(--light-text, #fff) !important; fill: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-hidden { display: none !important; }
        #la-measure-toolbar .la-mt-dd-panel, #la-measure-toolbar .la-mt-helpcard, #la-measure-toolbar .la-mt-pop { --pcut: 8px; isolation: isolate; background: transparent; border: none; box-shadow: none; }
        #la-measure-toolbar .la-mt-dd-panel::before, #la-measure-toolbar .la-mt-helpcard::before, #la-measure-toolbar .la-mt-pop::before { content: ""; position: absolute; inset: 0; z-index: -2; background: var(--primary-color, #ff6400); clip-path: polygon(0 0, calc(100% - var(--pcut)) 0, 100% var(--pcut), 100% 100%, var(--pcut) 100%, 0 calc(100% - var(--pcut))); filter: drop-shadow(0 5px 16px rgba(0,0,0,0.5)); }
        #la-measure-toolbar .la-mt-dd-panel::after, #la-measure-toolbar .la-mt-helpcard::after, #la-measure-toolbar .la-mt-pop::after { content: ""; position: absolute; inset: 2px; z-index: -1; background: var(--la-plate, rgba(15,15,17,0.98)); clip-path: polygon(0 0, calc(100% - var(--pcut)) 0, 100% var(--pcut), 100% 100%, var(--pcut) 100%, 0 calc(100% - var(--pcut))); }
        #la-measure-toolbar .la-mt-dd-panel { display: none; flex-direction: column; position: absolute; bottom: calc(100% + 7px); left: 0; z-index: 72; min-width: 148px; padding: 4px; }
        #la-measure-toolbar .la-mt-dd-panel.open { display: flex; }
        #la-measure-toolbar .la-mt-dd-item { display: flex; align-items: center; gap: 9px; padding: 6px 11px; background: transparent; border: none; border-radius: 0; color: var(--la-ink, #e8e8e8); font-family: var(--la-mono, ui-monospace, monospace); font-size: 13px; text-transform: uppercase; letter-spacing: 0.04em; cursor: pointer; text-align: left; white-space: nowrap; }
        #la-measure-toolbar .la-mt-dd-item i { width: 16px; text-align: center; font-size: 14px; }
        #la-measure-toolbar .la-mt-dd-item:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color, #ff6400), transparent 80%); }
        #la-measure-toolbar .la-mt-dd-item.active { background: var(--primary-color, #ff6400); color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active:hover:not(:disabled) { background: color-mix(in srgb, var(--primary-color, #ff6400), #000 18%); }
        #la-measure-toolbar .la-mt-dd-item.active i { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-svg-icon { background-color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item.active .la-hud-fav-mark { color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-dd-entry { display: flex; align-items: stretch; }
        #la-measure-toolbar .la-mt-dd-entry .la-mt-dd-item:not(.la-mt-dd-col) { flex: 1 1 auto; }
        #la-measure-toolbar .la-mt-dd-entry.active { background: var(--primary-color, #ff6400); }
        #la-measure-toolbar .la-mt-dd-entry.active .la-mt-dd-item.active { background: transparent; }
        #la-measure-toolbar .la-mt-dd-num { margin-left: auto; padding-left: 12px; color: var(--la-accent); font-variant-numeric: tabular-nums; }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-dd-num { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-col { flex: 0 0 auto; width: 30px; padding: 6px 0; justify-content: center; gap: 0; opacity: 0.45; }
        #la-measure-toolbar .la-mt-dd-col i { width: 13px; font-size: 12px; }
        #la-measure-toolbar .la-mt-dd-col:hover:not(:disabled), #la-measure-toolbar .la-mt-dd-col-on { opacity: 1; }
        #la-measure-toolbar .la-mt-dd-entry.active .la-mt-dd-col i { color: var(--light-text, #fff) !important; }
        #la-measure-toolbar .la-mt-dd-foot { padding: 4px 11px 2px; font: 10px var(--la-mono, ui-monospace, monospace); text-transform: uppercase; letter-spacing: 0.04em; color: var(--la-ink-dim, #666); }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-weap-r { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-dd-item:disabled { opacity: 0.4; cursor: default; }
        #la-measure-toolbar .la-mt-weap-row { justify-content: flex-start; gap: 9px; }
        #la-measure-toolbar .la-mt-weap-n { flex: 1 1 auto; }
        #la-measure-toolbar .la-mt-weap-r { color: var(--la-accent); font-variant-numeric: tabular-nums; }
        #la-measure-toolbar .la-mt-anchor { position: relative; }
        #la-measure-toolbar .la-mt-pop-row { display: flex; align-items: center; gap: 5px; }
        #la-measure-toolbar .la-mt-pop-label { font-family: var(--la-mono, ui-monospace, monospace); font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--la-ink-dim, #666); }
        #la-measure-toolbar .la-mt-pop-input { width: 40px; text-align: center; font-variant-numeric: tabular-nums; }
        #la-measure-toolbar .la-mt-pop-empty { font-size: 12px; opacity: 0.7; font-style: italic; }
        #la-measure-toolbar .la-mt-pop { position: absolute; bottom: calc(100% + 10px); z-index: 72; display: flex; flex-direction: column; gap: 6px; width: max-content; padding: 6px 12px; }
        #la-measure-toolbar .la-mt-pop-end { right: 0; }
        #la-measure-toolbar .la-mt-pop-start { left: 0; }
        #la-measure-toolbar .la-mt-pop .la-mt-icon-btn { padding: 3px 7px; }
        #la-measure-toolbar .la-mt-weap-pop { padding: 4px; }
        #la-measure-toolbar .la-mt-weap-pop .la-mt-pop-empty { padding: 4px 8px; }
        #la-measure-toolbar .la-mt-weap-scroll { position: relative; display: flex; flex-direction: column; }
        #la-measure-toolbar .la-mt-weap-scroll .la-mt-dd-item { box-sizing: border-box; flex: 0 0 30px; height: 30px; min-height: 0; }
        #la-measure-toolbar .la-mt-weap-many { max-height: 150px; overflow-x: hidden; overflow-y: scroll; scrollbar-width: thin; }
        #la-measure-toolbar .la-mt-weap-pin { width: 14px; text-align: center; opacity: 0; }
        #la-measure-toolbar .la-mt-weap-pin.on { opacity: 1; }
        #la-measure-toolbar .la-mt-weap-pin i { width: auto !important; font-size: 10px !important; color: var(--la-accent); }
        #la-measure-toolbar .la-mt-dd-item.active .la-mt-weap-pin i { color: var(--light-text, #fff); }
        #la-measure-toolbar .la-mt-weap-dead { opacity: 0.5; text-decoration: line-through; }
    `;
    document.head.appendChild(style);
}

export { injectStyles };
