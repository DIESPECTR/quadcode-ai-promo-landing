// UI.js — the game's UI (HUD): DOM elements over the 3D canvas, laid out by UILayout.js.
//
// RULE: every UI element is a UI_LAYOUT record (js/UILayout.js), placed and styled in the
// editor's UI tab. Game code does not create, position or style HUD DOM itself — it takes an
// element by id and feeds it data:
//     UI.get('score').setText('10');  UI.get('hp').setValue(0.7);
//     UI.get('start').onClick(() => …);  UI.get('hint').show(false);
// Many elements of one kind (inventory slots): a template record in UILayout.js +
//     UI.add(Object.assign({}, UI.def('slot'), { id: 'slot2', x: 140 }));
//
// Record: { id, kind, anchor, x, y, w, h, … } (the full field list — UI.DEFAULTS).
//   kind   — 'text' | 'panel' | 'bar' | 'button'.
//   anchor — one of 9 screen points ('top-left' … 'bottom-right'): x and y go from it to THE
//            SAME point of the element — inward from a screen edge, signed from the center.
//            A 'bottom-right' element at x 20, y 20 keeps its bottom right corner 20 px from
//            the screen corner at any screen size.
//   w, h   — size in px; a text sizes itself by its content.
//   parent — id of the element this one sits in ('' or none — the screen): anchor, x and y then
//            count from the PARENT's box, the parent clips it, and hiding the parent hides it too.
//   stretch — 'h' | 'v' | 'both' (sized kinds): the element fills its container on that axis,
//            x (y) is the inset from BOTH edges, w (h) is ignored. A full-screen dim:
//            { kind: 'panel', stretch: 'both', x: 0, y: 0 }.
//   Colors — '#rrggbb' strings, '' — none. Records go in drawing order: later — on top.
// SCALE: layout numbers are px of a screen UI_REF_HEIGHT tall — the whole UI scales with the
//   real height (a 1440 px screen draws a 720 px layout twice as big). UI_REF_HEIGHT = 0 — CSS px.

/** @satisfies {Record<string, any>} */
const UI = {
    ANCHORS: ['top-left', 'top-center', 'top-right', 'middle-left', 'middle-center', 'middle-right',
        'bottom-left', 'bottom-center', 'bottom-right'],
    KINDS: ['text', 'panel', 'bar', 'button'],
    FONT: 'system-ui, "Segoe UI", Roboto, sans-serif',

    // Fields of a record by kind and their defaults — a new element in the editor starts from them.
    DEFAULTS: {
        text: { parent: '', anchor: 'top-left', x: 20, y: 20, text: 'Text', fontSize: 24, color: '#ffffff', shadow: '#000000', alpha: 1, visible: 1 },
        panel: { parent: '', anchor: 'top-left', x: 20, y: 20, w: 240, h: 80, stretch: '', fill: '#10202c', border: '', radius: 10, alpha: 0.7, visible: 1 },
        bar: { parent: '', anchor: 'top-left', x: 20, y: 20, w: 240, h: 18, stretch: '', value: 0.6, color: '#5ad05a', fill: '#10202c', border: '#ffffff', radius: 9, alpha: 1, visible: 1 },
        button: { parent: '', anchor: 'bottom-center', x: 0, y: 40, w: 180, h: 48, stretch: '', text: 'Button', fontSize: 20, color: '#ffffff', fill: '#2a6fb0', border: '', radius: 10, alpha: 1, visible: 1 },
    },

    /** @type {HTMLElement | null} */
    root: null,
    /** @type {HTMLCanvasElement | null} */
    canvas: null,
    /** @type {UIRecord[]} */
    layout: [],
    /** @type {Map<string, UIElement>} */
    elements: new Map(),
    dialogId: '',
    _dialogBackdrop: '',
    _dialogReturn: '',
    _dialogKey: null,
    editing: false,          // the editor's UI tab: every element catches the pointer, buttons do not fire
    /** @type {ResizeObserver | null} */
    _observer: null,

    // canvas — the 3D canvas the UI lies over; layout — records (UI_LAYOUT by default).
    init(canvas, layout) {
        this.dispose();
        this.canvas = canvas;
        const root = this.root = document.createElement('div');
        root.className = 'arc-ui';
        Object.assign(root.style, { position: 'absolute', overflow: 'hidden', pointerEvents: 'none', transformOrigin: '0 0',
            fontFamily: this.FONT, userSelect: 'none', webkitUserSelect: 'none' });
        (canvas.parentElement || document.body).appendChild(root);
        if (typeof ResizeObserver !== 'undefined') {
            this._observer = new ResizeObserver(() => this.resize());
            this._observer.observe(canvas);
        }
        this.applyLayout(layout || (typeof UI_LAYOUT !== 'undefined' ? UI_LAYOUT : []));
        return this;
    },

    dispose() {
        this.closeDialog(false);
        if (this._dialogKey) document.removeEventListener('keydown', this._dialogKey, true);
        this._dialogKey = null;
        if (this._observer) this._observer.disconnect();
        if (this.root) this.root.remove();
        this._observer = null;
        this.root = null;
        this.canvas = null;
        this.elements.clear();
    },

    get(id) {
        return this.elements.get(id) || null;
    },

    // Modal mechanics are reusable renderer behavior, never DOM built by Game.
    openDialog(id, backdrop, returnId) {
        const panel = this.get(id), dim = this.get(backdrop), menu = this.get('menu');
        if (!panel || !dim || this.editing) return false;
        this.closeDialog(false);
        this.dialogId = id; this._dialogBackdrop = backdrop; this._dialogReturn = returnId;
        if (menu) menu.el.inert = true;
        dim.show(true); panel.show(true);
        dim.el.style.pointerEvents = 'auto';
        dim.el.style.zIndex = '100';
        panel.el.setAttribute('role', 'dialog'); panel.el.setAttribute('aria-modal', 'true');
        const title = this.get(id + '-title');
        if (title) { title.el.id = 'arc-' + title.def.id; panel.el.setAttribute('aria-labelledby', title.el.id); }
        panel.fitViewport();
        if (!this._dialogKey) {
            this._dialogKey = (e) => {
                const current = this.get(this.dialogId); if (!current) return;
                const buttons = [...current.el.querySelectorAll('[role="button"]')];
                e.stopImmediatePropagation();
                if (e.key === 'Escape') { e.preventDefault(); this.closeDialog(); }
                else if (e.key === 'Tab') {
                    e.preventDefault();
                    const n = buttons.length, i = buttons.indexOf(document.activeElement);
                    if (n) buttons[(i + (e.shiftKey ? -1 : 1) + n) % n].focus();
                } else if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    const active = document.activeElement;
                    if (active instanceof HTMLElement && current.el.contains(active) && active.getAttribute('role') === 'button') active.click();
                }
            };
            document.addEventListener('keydown', this._dialogKey, true);
        }
        const first = panel.el.querySelector('[role="button"]'); if (first instanceof HTMLElement) first.focus();
        return true;
    },

    closeDialog(restore = true) {
        const panel = this.get(this.dialogId), dim = this.get(this._dialogBackdrop), menu = this.get('menu');
        if (panel) panel.show(false);
        if (dim) dim.show(false);
        if (menu) menu.el.inert = false;
        const target = this.get(this._dialogReturn);
        this.dialogId = ''; this._dialogBackdrop = ''; this._dialogReturn = '';
        if (restore && target) target.el.focus();
    },

    // Responsive stacking derived from existing panel records; source/editor records stay unchanged.
    fitColumns(panelId, columnIds, headerIds) {
        if (this.editing || !this.canvas) return;
        const panel = this.get(panelId), base = this.def(panelId);
        const columns = columnIds.map(id => this.get(id)).filter(Boolean);
        if (!panel || !base || columns.length < 2) return;
        const narrow = this.canvas.clientWidth < base.w + 16;
        const padding = this.def(columnIds[0]).x;
        const gap = this.def(columnIds[1]).x - padding - this.def(columnIds[0]).w;
        const key = narrow ? 'stack' : 'wide';
        if (panel._columnMode === key) return;
        panel._columnMode = key;
        let y = this.def(columnIds[0]).y;
        const headers = headerIds.map(id => this.get(id)).filter(Boolean);
        if (narrow && headers.length) y += headers[0].def.h + gap;
        for (const column of columns) {
            const original = this.def(column.def.id);
            column.def = Object.assign({}, original, narrow ? { x: padding, y } : {});
            column.apply(); y += original.h + gap;
        }
        headers.forEach((header, i) => {
            const original = this.def(header.def.id);
            header.def = Object.assign({}, original, narrow ? { x: padding + i * (original.w + gap / 2), y: this.def(columnIds[0]).y - original.h } : {});
            header.apply();
        });
        panel.def = Object.assign({}, base, narrow ? { w: Math.max(...columns.map(c => c.def.w)) + padding * 2, h: y - gap + padding } : {});
        panel.apply();
    },

    // The record of an element — a template for UI.add.
    def(id) {
        return this.layout.find(d => d.id === id) || null;
    },

    // Rebuild every element from the records (the editor — after an edit). What the game has
    // set — text, value, visibility, click handler — survives by id.
    applyLayout(layout) {
        if (layout) this.layout = layout;
        if (!this.root) return;
        const old = this.elements;
        this.elements = new Map();
        this.root.textContent = '';
        // All elements first, then the nesting: a child may stand before its parent in the file.
        for (const def of this.layout) this.elements.set(def.id, new UIElement(def, old.get(def.id)));
        for (const def of this.layout) this._attach(this.elements.get(def.id));
        for (const def of this.layout) this.elements.get(def.id).apply();
        this.resize();
    },

    // A runtime element from a record that is not in UILayout.js (a copy of a template).
    add(def) {
        if (!this.root || !def || !def.id) return null;
        this.remove(def.id);
        const e = new UIElement(def, null);
        this.elements.set(def.id, e);
        this._attach(e);
        e.apply();
        return e;
    },

    // Removes the element together with everything nested in it.
    remove(id) {
        const e = this.elements.get(id);
        if (!e) return;
        const inside = [...this.elements.values()].filter(c => this.isInside(c.def, id));
        for (const c of inside) this.elements.delete(c.def.id);
        e.el.remove();
        this.elements.delete(id);
    },

    // The element def sits in (def.parent), null — the screen. A missing parent or a cycle in
    // the chain also gives null: a bad record lands on the screen instead of breaking the tree.
    parentOf(def) {
        const seen = new Set([def.id]);
        for (let id = def.parent; id; ) {
            const e = this.elements.get(id);
            if (!e || seen.has(id)) return null;
            seen.add(id);
            id = e.def.parent;
        }
        return def.parent ? this.elements.get(def.parent) : null;
    },

    // Is def nested in the element id — directly or through its ancestors?
    isInside(def, id) {
        for (let e = this.parentOf(def); e; e = this.parentOf(e.def)) if (e.def.id === id) return true;
        return false;
    },

    _attach(e) {
        const parent = this.parentOf(e.def);
        (parent ? parent.el : this.root).appendChild(e.el);
    },

    // UI px per CSS px: screen height / UI_REF_HEIGHT.
    scale() {
        const ref = typeof UI_REF_HEIGHT !== 'undefined' ? UI_REF_HEIGHT : 720;
        const h = this.canvas ? this.canvas.clientHeight : 0;
        return ref > 0 && h > 0 ? h / ref : 1;
    },

    // The root covers the canvas; its inner size is the screen in layout px.
    resize() {
        const c = this.canvas, r = this.root;
        if (!c || !r) return;
        const s = this.scale();
        r.style.left = c.offsetLeft + 'px';
        r.style.top = c.offsetTop + 'px';
        r.style.width = (c.clientWidth / s) + 'px';
        r.style.height = (c.clientHeight / s) + 'px';
        r.style.transform = 'scale(' + s + ')';
    },

    // Screen size in layout px.
    size() {
        const s = this.scale(), c = this.canvas;
        return { w: c ? c.clientWidth / s : 0, h: c ? c.clientHeight / s : 0 };
    },

    // --- Anchor math (no DOM — tests/ui.test.mjs) -------------------------------------

    // 'bottom-right' -> { v: 'bottom', h: 'right' }; garbage -> top-left.
    parseAnchor(anchor) {
        const a = this.ANCHORS.includes(anchor) ? anchor : 'top-left', p = a.split('-');
        return { v: p[0], h: p[1] };
    },

    // def.stretch -> the stretched axes; a text has no size of its own to stretch.
    stretchOf(def) {
        const s = def.kind === 'text' ? '' : def.stretch;
        return { h: s === 'h' || s === 'both', v: s === 'v' || s === 'both' };
    },

    // Record -> the top left corner of an element of size w × h in a container W × H (the screen
    // or the parent's inside). On a stretched axis x (y) is the inset, whatever the anchor.
    resolve(def, w, h, W, H) {
        const a = this.parseAnchor(def.anchor), st = this.stretchOf(def), x = Number(def.x) || 0, y = Number(def.y) || 0;
        return {
            left: st.h ? x : a.h === 'right' ? W - x - w : a.h === 'center' ? W / 2 + x - w / 2 : x,
            top: st.v ? y : a.v === 'bottom' ? H - y - h : a.v === 'middle' ? H / 2 + y - h / 2 : y,
        };
    },

    // The inverse: where the element stands -> x, y of the record for the given anchor. The editor
    // changes the anchor through it, so the element stays where it was.
    toStored(anchor, left, top, w, h, W, H) {
        const a = this.parseAnchor(anchor);
        return {
            x: a.h === 'right' ? W - left - w : a.h === 'center' ? left + w / 2 - W / 2 : left,
            y: a.v === 'bottom' ? H - top - h : a.v === 'middle' ? top + h / 2 - H / 2 : top,
        };
    },
};

// One UI element: a record (def) + its DOM + what the game has set at run time.
class UIElement {
    /** @param {UIRecord} def @param {UIElement | null} prev — the same id before a rebuild */
    constructor(def, prev) {
        this.def = def;
        this.el = document.createElement('div');
        this.el.dataset.ui = def.id;
        /** @type {HTMLElement | null} */
        this.inner = null;       // bar: the filled part; text and button: the label
        this._text = prev ? prev._text : null;
        this._value = prev ? prev._value : null;
        this._shown = prev ? prev._shown : null;
        this._click = prev ? prev._click : null;
        this._imageSrc = prev ? prev._imageSrc : '';
        this._imageAlt = prev ? prev._imageAlt : '';
        this._selected = prev ? prev._selected : false;
        /** @type {HTMLDivElement | null} */
        this._viewport = null;
        this.el.addEventListener('keydown', e => {
            if (this.def.kind === 'button' && !UI.editing && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); this.el.click(); }
        });
        this.el.addEventListener('focus', () => { this.el.style.outline = '3px solid #4fd2ff'; this.el.style.outlineOffset = '-4px'; });
        this.el.addEventListener('blur', () => { this.el.style.outline = ''; });
        this.el.addEventListener('pointerenter', () => { if (this.def.kind === 'button') this.el.style.filter = 'brightness(1.18)'; });
        this.el.addEventListener('pointerleave', () => { this.el.style.filter = ''; });
        this.el.addEventListener('click', (e) => {
            if (UI.editing || this.def.kind !== 'button' || !this._click || !this.visible || this.el.closest('[inert]')) return;
            for (let p = UI.parentOf(this.def); p; p = UI.parentOf(p.def)) if (!p.visible) return;
            if (UI.dialogId && !UI.isInside(this.def, UI.dialogId)) return;
            e.stopPropagation();
            this._click(this);
        });
    }

    // Keep menu controls readable on short screens; scroll the shell instead of shrinking vertically.
    fitViewport() {
        const root = UI.root, scale = UI.scale();
        if (!root || !UI.canvas || UI.editing) return;
        const width = UI.canvas.clientWidth, height = UI.canvas.clientHeight;
        const cssScale = Math.min(1, (width - 16) / this.def.w);
        for (const button of this.el.querySelectorAll('[role="button"]')) {
            if (button instanceof HTMLElement) button.style.minHeight = (44 / cssScale) + 'px';
        }
        const scroll = this.visible && this.def.h * cssScale > height - 16;
        if (!scroll) {
            if (this._viewport) { const parent = UI.parentOf(this.def); (parent ? parent.el : root).appendChild(this.el); this._viewport.remove(); this._viewport = null; this.apply(); }
            Object.assign(this.el.style, { transformOrigin: '50% 50%', transform: 'translate(-50%, -50%) scale(' + (cssScale / scale) + ')' });
            return;
        }
        if (!this._viewport) {
            this._viewport = document.createElement('div');
            this._viewport.style.cssText = 'position:absolute;inset:0;overflow-y:auto;overflow-x:hidden;pointer-events:auto;overscroll-behavior:contain;';
            const parent = UI.parentOf(this.def); (parent ? parent.el : root).appendChild(this._viewport); this._viewport.appendChild(this.el);
        }
        Object.assign(this.el.style, { top: (8 / scale) + 'px', transformOrigin: '50% 0',
            transform: 'translate(-50%, 0) scale(' + (cssScale / scale) + ')' });
    }

    setSelected(on) { this._selected = !!on; this.apply(); return this; }

    setImage(src, alt) {
        this._imageSrc = src; this._imageAlt = alt || '';
        let img = this.el.querySelector('img');
        if (!img) {
            img = document.createElement('img');
            img.style.cssText = 'display:block;width:100%;height:100%;object-fit:contain;';
            img.addEventListener('error', () => { img.style.display = 'none'; this.el.setAttribute('aria-label', this._imageAlt + ' — preview unavailable'); });
            this.el.prepend(img);
        }
        img.alt = this._imageAlt;
        if (img.getAttribute('src') !== src) { img.style.display = 'block'; img.src = src; }
        return this;
    }

    setText(text) { this._text = String(text); this.apply(); return this; }

    // Bar fill 0..1.
    setValue(v) { this._value = Math.max(0, Math.min(1, Number(v) || 0)); this.apply(); return this; }

    show(on) { this._shown = on !== false; this.apply(); return this; }

    onClick(fn) { this._click = fn || null; return this; }

    get visible() {
        return this._shown != null ? this._shown : this.def.visible !== 0;
    }

    // Record + run-time state -> DOM. Cheap: called on every edit and every setText.
    apply() {
        const d = this.def, s = this.el.style, a = UI.parseAnchor(d.anchor);
        const x = Number(d.x) || 0, y = Number(d.y) || 0, px = (v) => (Number(v) || 0) + 'px';
        const sized = d.kind !== 'text', st = UI.stretchOf(d);
        s.cssText = '';
        s.position = 'absolute';
        s.boxSizing = 'border-box';
        // The container is the parent's box (an absolute element positions its children) or the
        // root. A stretched axis pins both edges with the same inset; w (h) is not used there.
        s.left = st.h || a.h === 'left' ? px(x) : a.h === 'center' ? 'calc(50% + ' + px(x) + ')' : '';
        s.right = st.h || a.h === 'right' ? px(x) : '';
        s.top = st.v || a.v === 'top' ? px(y) : a.v === 'middle' ? 'calc(50% + ' + px(y) + ')' : '';
        s.bottom = st.v || a.v === 'bottom' ? px(y) : '';
        s.transform = 'translate(' + (!st.h && a.h === 'center' ? '-50%' : '0') + ', ' + (!st.v && a.v === 'middle' ? '-50%' : '0') + ')';
        if (sized && !st.h) s.width = px(d.w);
        if (sized && !st.v) s.height = px(d.h);
        s.opacity = String(d.alpha == null ? 1 : Math.max(0, Math.min(1, Number(d.alpha))));
        s.display = this.visible || UI.editing ? 'block' : 'none';
        if (UI.editing && !this.visible) s.opacity = String(Number(s.opacity) * 0.35);
        s.pointerEvents = UI.editing || d.kind === 'button' ? 'auto' : 'none';
        s.cursor = UI.editing ? 'move' : d.kind === 'button' ? 'pointer' : '';
        if (d.kind === 'button') {
            s.transition = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'none' : 'filter 150ms, background-color 150ms';
            this.el.setAttribute('role', 'button'); this.el.tabIndex = UI.editing ? -1 : 0;
            this.el.setAttribute('aria-pressed', String(this._selected));
            if (document.activeElement === this.el) { s.outline = '3px solid #4fd2ff'; s.outlineOffset = '-4px'; }
        }

        if (sized) {
            s.background = d.fill || 'transparent';
            s.border = this._selected ? '2px solid #ffcf64' : d.border ? '2px solid ' + d.border : 'none';
            if (this._selected) s.background = '#37433a';
            s.borderRadius = px(d.radius);
            s.overflow = 'hidden';
        }
        if (this._imageSrc) this.setImage(this._imageSrc, this._imageAlt);
        const label = d.kind === 'text' || d.kind === 'button';
        if (label || d.kind === 'bar') {
            if (!this.inner) {
                this.inner = document.createElement('div');
                this.el.appendChild(this.inner);
            }
        } else if (this.inner) {
            this.inner.remove();
            this.inner = null;
        }
        if (label) {
            const t = this.inner.style;
            t.cssText = '';
            this.inner.textContent = this._text != null ? this._text : String(d.text == null ? '' : d.text);
            t.whiteSpace = 'pre';
            t.fontSize = px(d.fontSize || 20);
            t.fontWeight = '600';
            t.lineHeight = '1.2';
            t.color = d.color || '#ffffff';
            t.textAlign = a.h === 'center' ? 'center' : a.h;
            if (d.shadow) t.textShadow = '0 1px 2px ' + d.shadow + ', 0 0 3px ' + d.shadow;
            if (d.kind === 'button') {
                Object.assign(t, { display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%', height: '100%' });
                const children = [...UI.elements.values()].filter(e => e.def.parent === d.id && e.def.kind === 'panel');
                if (children.length) {
                    const bottom = Math.max(...children.map(e => e.def.y + e.def.h));
                    Object.assign(t, { position: 'absolute', bottom: '0', height: px(d.h - bottom) });
                }
            }
        } else if (d.kind === 'bar') {
            const v = this._value != null ? this._value : Math.max(0, Math.min(1, Number(d.value) || 0));
            this.inner.textContent = '';
            this.inner.style.cssText = 'height: 100%; width: ' + (v * 100) + '%; background: ' + (d.color || '#5ad05a') + ';';
        }
    }
}
