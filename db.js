// Compartido entre la página y el service worker (sin módulos para poder usar importScripts).
(function (g) {
  const DB_NAME = 'guardados';
  const STORE = 'items';

  // Sitios conocidos: clave, nombre, color y dominios.
  const SOURCES = [
    { key: 'tiktok', name: 'TikTok', color: '#ff2d6f', domains: ['tiktok.com'] },
    { key: 'linkedin', name: 'LinkedIn', color: '#3b8ff0', domains: ['linkedin.com', 'lnkd.in'] },
    { key: 'instagram', name: 'Instagram', color: '#e1306c', domains: ['instagram.com', 'instagr.am'] },
    { key: 'youtube', name: 'YouTube', color: '#ff3d3d', domains: ['youtube.com', 'youtu.be'] },
    { key: 'x', name: 'X / Twitter', color: '#a9b1c3', domains: ['x.com', 'twitter.com', 't.co'] },
    { key: 'threads', name: 'Threads', color: '#c9c9c9', domains: ['threads.net', 'threads.com'] },
    { key: 'facebook', name: 'Facebook', color: '#4c7cf3', domains: ['facebook.com', 'fb.watch', 'fb.com'] },
    { key: 'reddit', name: 'Reddit', color: '#ff5700', domains: ['reddit.com', 'redd.it'] },
    { key: 'pinterest', name: 'Pinterest', color: '#e60023', domains: ['pinterest.com', 'pinterest.es', 'pin.it'] },
    { key: 'claude', name: 'Claude', color: '#d97757', domains: ['claude.ai', 'anthropic.com'] },
    { key: 'github', name: 'GitHub', color: '#9aa4b2', domains: ['github.com', 'github.io'] },
    { key: 'spotify', name: 'Spotify', color: '#1ed760', domains: ['spotify.com', 'spotify.link'] },
    { key: 'maps', name: 'Mapas', color: '#34a853', domains: ['maps.google.com', 'maps.app.goo.gl', 'goo.gl/maps'] },
    { key: 'amazon', name: 'Amazon', color: '#ff9900', domains: ['amazon.es', 'amazon.com', 'amzn.to', 'amzn.eu'] },
    { key: 'ropa', name: 'Tiendas de ropa', color: '#c084fc', domains: ['zara.com', 'hm.com', 'mango.com', 'pullandbear.com', 'bershka.com', 'stradivarius.com', 'massimodutti.com', 'shein.com', 'asos.com', 'zalando.es', 'nike.com', 'adidas.es', 'vinted.es', 'uniqlo.com', 'cos.com', 'elcorteingles.es'] },
    { key: 'whatsapp', name: 'WhatsApp', color: '#25d366', domains: ['wa.me', 'whatsapp.com'] },
    { key: 'medium', name: 'Medium', color: '#e6e6e6', domains: ['medium.com'] }
  ];
  const IMAGE_SOURCE = { key: 'captura', name: 'Capturas', color: '#e0b46e' };
  const NOTE_SOURCE = { key: 'nota', name: 'Notas', color: '#6ec7dd' };

  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\.|^m\.|^mobile\./, ''); } catch { return ''; }
  }

  function detectSource(url) {
    const host = hostOf(url);
    if (!host) return null;
    let path = '';
    try { path = new URL(url).pathname; } catch {}
    for (const s of SOURCES) {
      for (const d of s.domains) {
        if (d.includes('/')) { if ((host + path).startsWith(d)) return s.key; continue; }
        if (host === d || host.endsWith('.' + d)) return s.key;
      }
    }
    if (host.startsWith('google.') && path.startsWith('/maps')) return 'maps';
    return 'web:' + host;
  }

  function sourceInfo(key) {
    if (!key) return { key: 'web', name: 'Web', color: '#8b93a7' };
    if (key === 'captura') return IMAGE_SOURCE;
    if (key === 'nota') return NOTE_SOURCE;
    const s = SOURCES.find(x => x.key === key);
    if (s) return s;
    const host = key.replace(/^web:/, '');
    return { key, name: host, color: '#8b93a7' };
  }

  // Las apps suelen meter el link dentro del texto ("Mira este vídeo https://vm.tiktok.com/…").
  function extractUrl(...parts) {
    for (const p of parts) {
      if (!p) continue;
      const m = String(p).match(/https?:\/\/[^\s<>"']+/i);
      if (m) return m[0].replace(/[).,;!?]+$/, '');
    }
    for (const p of parts) {
      if (!p) continue;
      const m = String(p).match(/\b(?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}\/[^\s]*/i);
      if (m) return 'https://' + m[0];
    }
    return '';
  }

  function cleanText(text, url) {
    if (!text) return '';
    let t = String(text);
    if (url) t = t.split(url).join('');
    return t.replace(/https?:\/\/\S+/g, '').replace(/\s+/g, ' ').trim();
  }

  function open() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const st = db.createObjectStore(STORE, { keyPath: 'id' });
          st.createIndex('createdAt', 'createdAt');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const st = t.objectStore(STORE);
      let out;
      Promise.resolve(fn(st)).then(v => { out = v; });
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error); };
    });
  }

  const reqP = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  function newId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  // Crea los registros a partir de lo que llega por "Compartir" (o del formulario).
  function buildItems({ title = '', text = '', url = '', files = [], tags = [] }) {
    const items = [];
    const now = Date.now();
    const link = extractUrl(url, text, title);
    files.forEach((f, i) => {
      if (!f || !f.size) return;
      items.push({
        id: newId(), type: f.type.startsWith('video/') ? 'video' : 'image',
        blob: f, mime: f.type, fileName: f.name || '',
        title: cleanText(title, link),
        text: cleanText(text, link), url: link,
        source: 'captura', tags: [...tags], note: '', seen: false,
        createdAt: now + i
      });
    });
    if (!items.length && link) {
      items.push({
        id: newId(), type: 'link', url: link,
        title: cleanText(title, link), text: cleanText(text, link),
        source: detectSource(link), tags: [...tags], note: '', seen: false, createdAt: now
      });
    } else if (!items.length && (title || text)) {
      items.push({
        id: newId(), type: 'note', url: '', title: title || '', text: text || '',
        source: 'nota', tags: [...tags], note: '', seen: false, createdAt: now
      });
    }
    return items;
  }

  const DB = {
    SOURCES, sourceInfo, detectSource, extractUrl, hostOf, buildItems,
    all: () => tx('readonly', st => reqP(st.getAll())),
    put: item => tx('readwrite', st => reqP(st.put(item))),
    putMany: items => tx('readwrite', st => Promise.all(items.map(i => reqP(st.put(i))))),
    remove: id => tx('readwrite', st => reqP(st.delete(id))),
    clear: () => tx('readwrite', st => reqP(st.clear()))
  };

  g.GuardadosDB = DB;
})(typeof self !== 'undefined' ? self : window);
