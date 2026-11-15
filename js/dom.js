// Small DOM helpers shared by the UI and importer.

export const $ = (s, r = document) => r.querySelector(s);
export const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v; else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v === true) e.setAttribute(k, ''); else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(k));
  return e;
};

let toastTimer;
export function toast(msg, ms = 2600, onClick = null) {
  const t = $('#toast');
  t.textContent = msg; t.hidden = false;
  t.onclick = onClick; t.style.cursor = onClick ? 'pointer' : '';
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), ms);
}


export function openModal(title, body, footer) {
  const m = $('#modal'), c = $('#modalcard');
  c.innerHTML = '';
  const close = () => (m.hidden = true);
  c.append(el('div', { class: 'modal-h' }, title, el('button', { class: 'x', onclick: close }, '×')), el('div', { class: 'modal-b' }, body));
  if (footer) c.append(el('div', { class: 'modal-f' }, footer));
  m.hidden = false;
  m.onclick = (e) => { if (e.target === m) close(); };
  return close;
}

export { $ as qs };
