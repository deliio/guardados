const DB = window.GuardadosDB;
const $ = s => document.querySelector(s);
const DEFAULT_TAGS = ['Ver luego', 'Ropa', 'Claude', 'Trabajo', 'Ideas', 'Recetas', 'Viajes'];

const state = { items: [], source: 'all', tag: null, q: '' };
let objectUrls = [];

const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function fmtDate(ts) {
  const d = new Date(ts), now = new Date();
  const days = Math.floor((now - d) / 864e5);
  if (d.toDateString() === now.toDateString()) return 'Hoy ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' });
  if (days < 1 || (days === 1)) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return d.toLocaleDateString('es', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

function allTags() {
  const set = new Set(DEFAULT_TAGS);
  state.items.forEach(i => (i.tags || []).forEach(t => set.add(t)));
  return [...set];
}

function blobUrl(blob) {
  const u = URL.createObjectURL(blob);
  objectUrls.push(u);
  return u;
}

async function load() {
  state.items = (await DB.all()).sort((a, b) => b.createdAt - a.createdAt);
  render();
}

function filtered() {
  const q = state.q.trim().toLowerCase();
  return state.items.filter(i => {
    if (state.source === 'unseen' && i.seen) return false;
    if (state.source !== 'all' && state.source !== 'unseen' && i.source !== state.source) return false;
    if (state.tag && !(i.tags || []).includes(state.tag)) return false;
    if (q) {
      const hay = [i.title, i.text, i.note, i.url, DB.sourceInfo(i.source).name, ...(i.tags || [])].join(' ').toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function renderChips() {
  const counts = {};
  state.items.forEach(i => { counts[i.source] = (counts[i.source] || 0) + 1; });
  const unseen = state.items.filter(i => !i.seen).length;
  const sources = Object.keys(counts).sort((a, b) => counts[b] - counts[a]);
  const chip = (key, label, n, color) =>
    `<button class="chip" data-source="${esc(key)}" aria-pressed="${state.source === key}" style="--c:${color || 'var(--muted)'}">
      ${color ? '<span class="dot"></span>' : ''}${esc(label)} <span class="n">${n}</span></button>`;
  $('#sourceChips').innerHTML = state.items.length ? [
    chip('all', 'Todo', state.items.length),
    unseen && unseen !== state.items.length ? chip('unseen', 'Sin ver', unseen) : '',
    ...sources.map(k => { const s = DB.sourceInfo(k); return chip(k, s.name, counts[k], s.color); })
  ].join('') : '';

  const tagCounts = {};
  state.items.forEach(i => (i.tags || []).forEach(t => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  const tags = Object.keys(tagCounts).sort((a, b) => tagCounts[b] - tagCounts[a]);
  $('#tagChips').innerHTML = tags.map(t =>
    `<button class="chip" data-tag="${esc(t)}" aria-pressed="${state.tag === t}">#${esc(t)} <span class="n">${tagCounts[t]}</span></button>`
  ).join('');
}

function cardHtml(i) {
  const s = DB.sourceInfo(i.source);
  let thumb;
  if (i.type === 'image' && i.blob) thumb = `<img src="${blobUrl(i.blob)}" alt="" loading="lazy">`;
  else if (i.type === 'video' && i.blob) thumb = `<video src="${blobUrl(i.blob)}#t=0.1" muted preload="metadata"></video>`;
  else thumb = esc((s.name || '?').charAt(0).toUpperCase());
  const title = i.title || i.text || i.note || (i.url ? DB.hostOf(i.url) + new URL(i.url).pathname : '') || (i.type === 'image' ? 'Captura' : 'Sin título');
  const tags = (i.tags || []).map(t => `<span class="mini-tag">#${esc(t)}</span>`).join('');
  return `<button class="card${i.seen ? ' seen' : ''}" data-id="${i.id}" style="--c:${s.color}">
    <div class="thumb">${thumb}</div>
    <div class="body">
      <span class="src">${esc(s.name)}${i.seen ? ' · visto' : ''}</span>
      <span class="title">${esc(title)}</span>
      <span class="meta"><span>${fmtDate(i.createdAt)}</span>${tags}</span>
    </div>
  </button>`;
}

function render() {
  objectUrls.forEach(u => URL.revokeObjectURL(u));
  objectUrls = [];
  if (state.source !== 'all' && state.source !== 'unseen' && !state.items.some(i => i.source === state.source)) state.source = 'all';
  if (state.tag && !state.items.some(i => (i.tags || []).includes(state.tag))) state.tag = null;
  renderChips();
  const list = filtered();
  $('#list').innerHTML = list.map(cardHtml).join('');
  $('#empty').hidden = state.items.length > 0;
  $('#count').textContent = state.items.length
    ? (list.length === state.items.length ? `${list.length} guardados` : `${list.length} de ${state.items.length}`)
    : '';
}

// ---------- Selector de etiquetas reutilizable ----------
function tagPicker(container, selected, onChange) {
  const sel = new Set(selected);
  const draw = () => {
    const tags = [...new Set([...allTags(), ...sel])];
    container.innerHTML = tags.map(t =>
      `<button type="button" class="chip" data-t="${esc(t)}" aria-pressed="${sel.has(t)}">#${esc(t)}</button>`
    ).join('') + `<input type="text" placeholder="+ nueva etiqueta" enterkeyhint="done">`;
    const input = container.querySelector('input');
    input.addEventListener('keydown', e => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = input.value.trim().replace(/^#/, '');
      if (v) { sel.add(v); onChange && onChange([...sel]); draw(); container.querySelector('input').focus(); }
    });
    input.addEventListener('blur', () => {
      const v = input.value.trim().replace(/^#/, '');
      if (v) { sel.add(v); onChange && onChange([...sel]); draw(); }
    });
  };
  container.onclick = e => {
    const b = e.target.closest('[data-t]');
    if (!b) return;
    const t = b.dataset.t;
    sel.has(t) ? sel.delete(t) : sel.add(t);
    b.setAttribute('aria-pressed', sel.has(t));
    onChange && onChange([...sel]);
  };
  draw();
  return () => [...sel];
}

// ---------- Toast ----------
let toastTimer;
function toast(html, ms = 3000) {
  const t = $('#toast');
  t.innerHTML = html;
  t.hidden = false;
  clearTimeout(toastTimer);
  if (ms) toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  return t;
}

function savedToast(items) {
  if (!items.length) return;
  const names = [...new Set(items.map(i => DB.sourceInfo(i.source).name))].join(', ');
  const t = toast(`<div>✓ Guardado en <b>${esc(names)}</b>. ¿Etiqueta?</div><div class="tag-picker"></div>`, 8000);
  tagPicker(t.querySelector('.tag-picker'), items[0].tags || [], async tags => {
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 4000);
    for (const it of items) { it.tags = tags; await DB.put(it); }
    render();
  });
}

// ---------- Añadir ----------
let getAddTags;
function openAdd() {
  $('#addForm').reset();
  getAddTags = tagPicker($('#addTags'), state.tag ? [state.tag] : []);
  $('#addDlg').showModal();
}

$('#addBtn').onclick = openAdd;
$('#pasteBtn').onclick = async () => {
  try {
    const txt = await navigator.clipboard.readText();
    if (txt) $('#addText').value = txt;
    else toast('El portapapeles está vacío');
  } catch { toast('No se pudo leer el portapapeles; pégalo a mano'); }
};
$('#addForm').addEventListener('submit', async e => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  const text = $('#addText').value.trim();
  const files = [...$('#addFiles').files];
  if (!text && !files.length) { e.preventDefault(); toast('Pega un link o elige una captura'); return; }
  const items = DB.buildItems({ text, files, tags: getAddTags() });
  await DB.putMany(items);
  await load();
  toast(`✓ ${items.length === 1 ? 'Guardado' : items.length + ' guardados'} en ${esc(DB.sourceInfo(items[0].source).name)}`);
});

// ---------- Detalle ----------
let current = null;
function openItem(id) {
  const i = state.items.find(x => x.id === id);
  if (!i) return;
  current = { ...i, tags: [...(i.tags || [])] };
  const s = DB.sourceInfo(i.source);
  const options = [
    ...DB.SOURCES.map(x => [x.key, x.name]),
    ['captura', 'Capturas'], ['nota', 'Notas'],
    ...(i.url ? [['web:' + DB.hostOf(i.url), DB.hostOf(i.url)]] : [])
  ];
  if (!options.some(o => o[0] === i.source)) options.push([i.source, s.name]);
  let media = '';
  if (i.blob && i.type === 'image') media = `<div class="detail-media"><img src="${blobUrl(i.blob)}" alt=""></div>`;
  if (i.blob && i.type === 'video') media = `<div class="detail-media"><video src="${blobUrl(i.blob)}" controls playsinline></video></div>`;

  $('#itemBody').innerHTML = `
    ${media}
    <div class="detail-src" style="--c:${s.color}">
      <span>Sitio:</span>
      <select id="dSource">${options.map(([k, n]) => `<option value="${esc(k)}" ${k === i.source ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select>
    </div>
    ${i.title ? `<h2 class="detail-title">${esc(i.title)}</h2>` : ''}
    ${i.text ? `<p class="detail-text">${esc(i.text)}</p>` : ''}
    ${i.url ? `<a class="detail-url" href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.url)}</a>` : ''}
    <div class="detail-date">Guardado: ${new Date(i.createdAt).toLocaleString('es')}</div>
    <label class="field"><span>Nota</span><textarea id="dNote" rows="2" placeholder="¿Por qué lo guardaste?">${esc(i.note)}</textarea></label>
    <div class="field"><span>Etiquetas</span><div class="tag-picker" id="dTags"></div></div>
    <div class="actions">
      <button class="btn danger" id="dDelete">Borrar</button>
      ${navigator.share ? '<button class="btn ghost" id="dShare">Compartir</button>' : ''}
      <button class="btn" id="dSeen">${i.seen ? 'Marcar sin ver' : '✓ Visto'}</button>
      ${i.url ? `<a class="btn primary" id="dOpen" href="${esc(i.url)}" target="_blank" rel="noopener">Abrir</a>` : ''}
      <button class="btn ${i.url ? '' : 'primary'}" id="dClose">Cerrar</button>
    </div>`;

  tagPicker($('#dTags'), current.tags, tags => { current.tags = tags; });
  $('#dClose').onclick = () => $('#itemDlg').close();
  $('#dSeen').onclick = () => { current.seen = !current.seen; $('#itemDlg').close(); };
  if ($('#dOpen')) $('#dOpen').onclick = () => { current.seen = true; };
  $('#dDelete').onclick = async () => {
    if (!confirm('¿Borrar este guardado?')) return;
    await DB.remove(i.id);
    current = null;
    $('#itemDlg').close();
    await load();
  };
  if ($('#dShare')) $('#dShare').onclick = async () => {
    try {
      if (i.blob) await navigator.share({ files: [new File([i.blob], i.fileName || 'captura.png', { type: i.mime })] });
      else await navigator.share({ url: i.url || undefined, text: i.text || i.title || undefined });
    } catch {}
  };
  $('#itemDlg').showModal();
}

$('#itemDlg').addEventListener('close', async () => {
  if (!current) return;
  current.note = $('#dNote').value.trim();
  current.source = $('#dSource').value;
  const orig = state.items.find(x => x.id === current.id);
  await DB.put(current);
  current = null;
  if (orig) await load();
});

// ---------- Menú, ayuda, copia de seguridad ----------
$('#menuBtn').onclick = () => $('#menuDlg').showModal();
document.addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  if (open) {
    document.querySelectorAll('dialog[open]').forEach(d => d.close());
    $('#' + open.dataset.open + 'Dlg').showModal();
  }
  const close = e.target.closest('[data-close]');
  if (close) close.closest('dialog').close();
});
// Cerrar al tocar fuera
document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));

const toDataUrl = blob => new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(blob); });

$('#exportBtn').onclick = async () => {
  const items = await DB.all();
  const out = [];
  for (const i of items) {
    const { blob, ...rest } = i;
    out.push(blob ? { ...rest, blobData: await toDataUrl(blob) } : rest);
  }
  const file = new Blob([JSON.stringify({ app: 'guardados', version: 1, items: out })], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = `guardados-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
};

$('#importFile').onchange = async e => {
  const f = e.target.files[0];
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    const items = [];
    for (const i of data.items || []) {
      const { blobData, ...rest } = i;
      if (blobData) rest.blob = await (await fetch(blobData)).blob();
      items.push(rest);
    }
    await DB.putMany(items);
    await load();
    $('#menuDlg').close();
    toast(`✓ ${items.length} elementos restaurados`);
  } catch { toast('Ese archivo no es una copia válida'); }
  e.target.value = '';
};

$('#clearSeenBtn').onclick = async () => {
  const seen = state.items.filter(i => i.seen);
  if (!seen.length) { toast('No hay nada marcado como visto'); return; }
  if (!confirm(`¿Borrar ${seen.length} guardados ya vistos?`)) return;
  for (const i of seen) await DB.remove(i.id);
  $('#menuDlg').close();
  await load();
};

// ---------- Filtros ----------
$('#sourceChips').onclick = e => {
  const b = e.target.closest('[data-source]');
  if (!b) return;
  state.source = b.dataset.source;
  render();
};
$('#tagChips').onclick = e => {
  const b = e.target.closest('[data-tag]');
  if (!b) return;
  state.tag = state.tag === b.dataset.tag ? null : b.dataset.tag;
  render();
};
$('#search').oninput = e => { state.q = e.target.value; render(); };
$('#list').onclick = e => {
  const c = e.target.closest('.card');
  if (c) openItem(c.dataset.id);
};

// ---------- Arranque ----------
const base = location.origin + location.pathname;
$('#shortcutUrl').textContent = base + '?text=';

async function handleIncoming() {
  const p = new URLSearchParams(location.search);
  let saved = [];
  if (p.has('saved')) {
    const n = +p.get('saved') || 0;
    await load();
    saved = state.items.slice(0, n);
    if (!n) toast('No se encontró nada que guardar en lo compartido');
  } else if (p.has('error')) {
    toast('No se pudo guardar lo compartido');
  } else if (location.search || location.hash) {
    // Para atajos de iPhone o marcadores: ?text=… / ?url=… (o cualquier link que venga en la dirección)
    let raw = '';
    try { raw = decodeURIComponent(location.search.slice(1) + ' ' + location.hash.slice(1)); } catch { raw = location.search + ' ' + location.hash; }
    saved = DB.buildItems({
      url: p.get('url') || '', title: p.get('title') || '',
      text: [p.get('text'), DB.extractUrl(raw)].filter(Boolean).join(' ')
    });
    await DB.putMany(saved);
    if (!saved.length) toast('El atajo abrió la web pero no llegó ningún link. Revisa el paso “Codificar URL” del atajo.', 9000);
  }
  if (location.search || location.hash) history.replaceState(null, '', location.pathname);
  await load();
  if (saved.length) savedToast(saved.map(s => state.items.find(i => i.id === s.id)).filter(Boolean));
}

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js');
handleIncoming();
