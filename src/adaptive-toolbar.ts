// Adaptive toolbar.
//
// As the editor narrows, formatting groups (`.dxe-grp[data-collapse="Label"]`)
// fold gracefully so the toolbar stays ONE fixed-height row at any embed width:
//   1. inline     — full row of controls (wide)
//   2. pill       — group becomes a labeled dropdown button "Paragraf ▾"
//   3. compact    — pills drop their labels (icon-only) at narrow widths
//   4. ⋯ overflow — pills that still don't fit merge into one "⋯" menu with
//                    labeled sections (guarantees fit at tiny widths)
// Controls are *moved* (never duplicated) so listeners + state-sync keep working.

import { t } from './i18n';

interface Item {
  group: HTMLElement;
  trigger: HTMLButtonElement; // per-group pill
  dropdown: HTMLElement; // pill's dropdown
  section: HTMLElement; // its labeled section inside the ⋯ menu
  controls: HTMLElement; // control host inside the section
  state: 'inline' | 'pill' | 'more';
}

// Order groups fold away (first = folds first). Values are data-collapse keys.
const COLLAPSE_ORDER = ['view', 'insert', 'paragraph', 'style', 'format'];

// Representative icon per group key (label sits beside it; hidden in compact mode).
const PILL_ICONS: Record<string, string> = {
  style: 'ic-fontcolor',
  format: 'ic-bold',
  paragraph: 'ic-align-left',
  insert: 'ic-table',
  view: 'ic-zoom-in',
};

export function installAdaptiveToolbar(toolbar: HTMLElement, root: HTMLElement): void {
  const groups = Array.from(toolbar.querySelectorAll<HTMLElement>('.dxe-grp[data-collapse]'));
  if (groups.length === 0) return;

  const pill = (label: string, icon: string) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dxe-pill';
    b.hidden = true;
    b.title = label;
    b.innerHTML =
      `<svg class="ic"><use href="#${icon}"></use></svg>` +
      `<span class="dxe-pill-label">${label}</span>` +
      `<svg class="ic dxe-caret"><use href="#ic-chev-down"></use></svg>`;
    return b;
  };

  const items: Item[] = groups.map((group) => {
    const key = group.dataset.collapse ?? '';
    const label = t(`group.${key}`);
    const trigger = pill(label, PILL_ICONS[key] ?? 'ic-bold');
    group.after(trigger);

    const dropdown = document.createElement('div');
    dropdown.className = 'dxe-dd';
    dropdown.hidden = true;
    root.appendChild(dropdown);

    const section = document.createElement('div');
    section.className = 'dxe-dd-sec';
    const title = document.createElement('div');
    title.className = 'dxe-dd-title';
    title.textContent = label;
    const controls = document.createElement('div');
    controls.className = 'dxe-dd-controls';
    section.append(title, controls);

    const item: Item = { group, trigger, dropdown, section, controls, state: 'inline' };
    trigger.addEventListener('click', (e) => {
      e.stopPropagation();
      openDropdown(dropdown, trigger);
    });
    return item;
  });

  // The overflow menu (three-dots), pinned after the last pill.
  const moreTrigger = pill(t('group.more'), 'ic-more');
  items[items.length - 1].trigger.after(moreTrigger);
  const moreDropdown = document.createElement('div');
  moreDropdown.className = 'dxe-dd dxe-dd-more';
  moreDropdown.hidden = true;
  root.appendChild(moreDropdown);
  moreTrigger.addEventListener('click', (e) => {
    e.stopPropagation();
    openDropdown(moreDropdown, moreTrigger);
  });

  const order: Item[] = COLLAPSE_ORDER.map((l) => items.find((it) => it.group.dataset.collapse === l))
    .filter((it): it is Item => !!it)
    .concat(items.filter((it) => !COLLAPSE_ORDER.includes(it.group.dataset.collapse ?? '')));

  const moveChildren = (from: HTMLElement, to: HTMLElement) => {
    while (from.firstChild) to.appendChild(from.firstChild);
  };

  function toInline(it: Item): void {
    if (it.state === 'pill') moveChildren(it.dropdown, it.group);
    else if (it.state === 'more') {
      moveChildren(it.controls, it.group);
      it.section.remove();
    }
    it.group.hidden = false;
    it.trigger.hidden = true;
    it.dropdown.hidden = true;
    it.state = 'inline';
  }
  function toPill(it: Item): void {
    if (it.state === 'pill') return;
    if (it.state === 'more') {
      moveChildren(it.controls, it.group);
      it.section.remove();
    }
    moveChildren(it.group, it.dropdown);
    it.group.hidden = true;
    it.trigger.hidden = false;
    it.state = 'pill';
  }
  function toMore(it: Item): void {
    if (it.state === 'more') return;
    if (it.state === 'inline') {
      moveChildren(it.group, it.dropdown);
      it.group.hidden = true;
    }
    moveChildren(it.dropdown, it.controls);
    moreDropdown.appendChild(it.section);
    it.trigger.hidden = true;
    it.dropdown.hidden = true;
    it.state = 'more';
  }

  function closeMenus(): void {
    for (const it of items) it.dropdown.hidden = true;
    moreDropdown.hidden = true;
  }
  function openDropdown(dd: HTMLElement, trig: HTMLElement): void {
    const willOpen = dd.hidden;
    closeMenus();
    if (!willOpen) return;
    dd.hidden = false;
    const r = trig.getBoundingClientRect();
    dd.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - dd.offsetWidth - 8))}px`;
    dd.style.top = `${r.bottom + 4}px`;
  }

  const fits = (): boolean => toolbar.scrollWidth <= toolbar.clientWidth + 1;

  let scheduled = false;
  function reflow(): void {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      closeMenus();
      moreTrigger.hidden = true;
      toolbar.classList.remove('dxe-compact');
      for (const it of items) toInline(it);
      if (fits()) return;

      // Tier 2: fold groups into labeled pills (least-essential first).
      for (const it of order) {
        toPill(it);
        if (fits()) return;
      }
      // Tier 3: drop pill labels (icon-only).
      toolbar.classList.add('dxe-compact');
      if (fits()) return;
      // Tier 4: merge still-overflowing pills into the "⋯" menu.
      moreTrigger.hidden = false;
      for (const it of order) {
        toMore(it);
        if (fits()) return;
      }
    });
  }

  // Close open menu on outside press / Escape.
  document.addEventListener('mousedown', (e) => {
    const t = e.target as Node;
    for (const it of items) {
      if (!it.dropdown.hidden && !it.dropdown.contains(t) && !it.trigger.contains(t)) {
        it.dropdown.hidden = true;
      }
    }
    if (!moreDropdown.hidden && !moreDropdown.contains(t) && !moreTrigger.contains(t)) {
      moreDropdown.hidden = true;
    }
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMenus();
  });

  new ResizeObserver(reflow).observe(toolbar);
  // Also re-run on window resize — the engine dispatches one after the document
  // is ready (afterDocReady), giving us a correct measurement once layout has
  // settled (the very first measurement can be premature and over-collapse).
  window.addEventListener('resize', reflow);
  reflow();
  document.fonts?.ready?.then(() => reflow());
  setTimeout(reflow, 400);
}
