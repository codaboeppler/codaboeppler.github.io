/* Comentarios sobre los flujos, al estilo de los comentarios de un prototipo de Figma (no es parte del producto).
   Una pestaña "Comentarios" en el borde izquierdo activa el modo comentar: se hace clic en cualquier parte de la
   pantalla para dejar un pin con un comentario; los demás lo ven, responden y lo resuelven. Tecla C para entrar o salir.
   - Los comentarios se guardan en un servicio propio (Cloudflare Worker + D1, carpeta ../comentarios-api).
   - Cada pin se ancla a un elemento de la página y a su posición relativa dentro de él, para que siga en su lugar
     en otros anchos de pantalla. Si el elemento no se ve (otra pestaña de la ficha, fila cerrada, tabla desplazada,
     ya no existe), el pin no se dibuja: queda en la Lista, que lo abre.
   - No hay cuentas: cada quien escribe su nombre una vez (se recuerda en su navegador) y solo puede borrar lo suyo.
   Es autónomo (marcado y estilos propios), igual que demo.js. */
(() => {
  const API = 'https://ataskate-comentarios.danielboeppler.workers.dev';
  const base = new URL('.', document.currentScript.src);   // …/pos/
  // los comentarios hechos en local no se mezclan con los del sitio publicado
  const ESPACIO = location.hostname === 'codaboeppler.github.io' ? 'prod' : 'dev';
  const ruta = location.pathname.replace(/index\.html$/, '').replace(/\/?$/, '/');
  const rel = ruta.startsWith(base.pathname) ? ruta.slice(base.pathname.length) : null;
  const enMora = new URLSearchParams(location.search).get('estado') === 'mora';
  // otras páginas (el sitio de marketing) dicen su página en el script: <script src="/comentarios.js" data-pagina="web-inicio">
  const PAGINA = document.currentScript.dataset.pagina
    || { '': 'v1', 'v2/': 'v2', 'v2-prendario/': enMora ? 'prendario-mora' : 'prendario', 'v2-marketplace/': 'marketplace' }[rel];
  if (!PAGINA) return;
  // si el script trae data-autor (p. ej. el sitio de marketing, donde solo comenta una persona), no se pide nombre
  const AUTOR_FIJO = (document.currentScript.dataset.autor || '').trim().slice(0, 40);

  // ---------- quién soy (solo en este navegador) ----------
  const LS = 'ataskate-comentarios';
  const leerYo = () => { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } };
  const tokenValido = (t) => typeof t === 'string' && t.length >= 16 && t.length <= 100;
  let yo = leerYo();
  if (!tokenValido(yo.token)) yo.token = [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (!Array.isArray(yo.ids)) yo.ids = [];
  const borrados = new Set();
  // otra pestaña del navegador puede haber guardado comentarios propios: al guardar se unen las dos listas en vez de pisarse
  const guardarYo = () => {
    const g = leerYo();
    yo.ids = [...new Set([...(Array.isArray(g.ids) ? g.ids : []), ...yo.ids])].filter((id) => !borrados.has(id));
    try { localStorage.setItem(LS, JSON.stringify(yo)); } catch (e) { /* sin almacenamiento: se pide el nombre cada vez */ }
  };
  guardarYo();
  yo.token = tokenValido(leerYo().token) ? leerYo().token : yo.token;   // si dos pestañas nacieron a la vez, se quedan con el mismo token
  addEventListener('storage', (e) => {
    if (e.key !== LS) return;
    const g = leerYo();
    if (Array.isArray(g.ids)) yo.ids = [...new Set([...yo.ids, ...g.ids])].filter((id) => !borrados.has(id));
    if (typeof g.nombre === 'string' && g.nombre) yo.nombre = g.nombre;
  });

  // ---------- estado ----------
  let comentarios = [];       // tal como llegan del servicio: raíces (pines) y respuestas
  let firma = '';             // para no repintar cuando el sondeo no trae cambios
  let cambio = 0;             // sube con cada acción propia: una respuesta vieja del sondeo no pisa lo recién hecho
  let modo = false;           // modo comentar activo
  let verResueltos = false;
  let abierto = null;         // id del hilo abierto
  let borrador = null;        // { ancla } mientras se escribe un comentario nuevo
  let listaAbierta = false;
  let sondeo = 0;

  const porId = (id) => comentarios.find((c) => c.id === id) || null;
  const raices = () => comentarios.filter((c) => !c.hilo && c.ancla);
  const respuestas = (id) => comentarios.filter((c) => c.hilo === id);
  const abiertos = () => raices().filter((c) => !c.resuelto);

  // ---------- utilidades ----------
  const h = (tag, props, ...hijos) => {
    const e = document.createElement(tag);
    if (props) Object.keys(props).forEach((k) => {
      const v = props[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;                       // solo para los íconos constantes de este archivo
      else if (k.slice(0, 2) === 'on') e.addEventListener(k.slice(2), v);
      else e.setAttribute(k, v === true ? '' : v);
    });
    hijos.flat().forEach((c) => { if (c !== null && c !== undefined && c !== false) e.append(c); });
    return e;
  };
  // íconos del design system (Close y EstadosSuccess), en currentColor
  const ICO_X = '<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none"><path d="M6.4 19L5 17.6L10.6 12L5 6.4L6.4 5L12 10.6L17.6 5L19 6.4L13.4 12L19 17.6L17.6 19L12 13.4L6.4 19Z" fill="currentColor"/></svg>';
  const ICO_OK = '<svg aria-hidden="true" width="20" height="20" viewBox="96 156 24 24" fill="none"><path d="M108 178C106.617 178 105.317 177.737 104.1 177.212C102.883 176.687 101.825 175.975 100.925 175.075C100.025 174.175 99.3127 173.117 98.788 171.9C98.2627 170.683 98 169.383 98 168C98 166.617 98.2627 165.317 98.788 164.1C99.3127 162.883 100.025 161.825 100.925 160.925C101.825 160.025 102.883 159.312 104.1 158.787C105.317 158.262 106.617 158 108 158C109.383 158 110.683 158.262 111.9 158.787C113.117 159.312 114.175 160.025 115.075 160.925C115.975 161.825 116.687 162.883 117.212 164.1C117.737 165.317 118 166.617 118 168C118 169.383 117.737 170.683 117.212 171.9C116.687 173.117 115.975 174.175 115.075 175.075C114.175 175.975 113.117 176.687 111.9 177.212C110.683 177.737 109.383 178 108 178ZM106.6 172.6L113.65 165.55L112.25 164.15L106.6 169.8L103.75 166.95L102.35 168.35L106.6 172.6Z" fill="currentColor"/></svg>';
  const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
  const hace = (ms) => {
    const s = Math.max(0, (Date.now() - ms) / 1000);
    if (s < 60) return 'ahora';
    if (s < 3600) return 'hace ' + Math.floor(s / 60) + ' min';
    if (s < 86400) return 'hace ' + Math.floor(s / 3600) + ' h';
    const d = new Date(ms);
    return d.getDate() + ' ' + MESES[d.getMonth()] + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  };
  const hora = (c) => h('span', { class: 'cm-msg__hora', 'data-creado': String(c.creado), text: hace(c.creado) });
  const refrescarHoras = () => document.querySelectorAll('.cm-msg__hora[data-creado]').forEach((e) => {
    const t = hace(Number(e.getAttribute('data-creado')));
    if (e.textContent !== t) e.textContent = t;
  });
  // iniciales solo con letras o números (un paréntesis o un emoji no cuentan)
  const iniciales = (nombre) => (String(nombre).match(/[\p{L}\p{N}]+/gu) || []).slice(0, 2).map((p) => [...p][0]).join('').toUpperCase() || '?';
  // color del avatar por autor, con los tonos claros del design system
  const TONOS = ['#ff98ef', '#d1ffd1', '#d0f6ff', '#e5e5ff', '#ffebba', '#ebf9ff'];
  const tono = (nombre) => TONOS[[...String(nombre)].reduce((t, ch) => (t * 31 + ch.charCodeAt(0)) >>> 0, 7) % TONOS.length];
  const avatar = (nombre) => { const a = h('span', { class: 'cm-avatar', 'aria-hidden': 'true', text: iniciales(nombre) }); a.style.background = tono(nombre); return a; };
  const sinMovimiento = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  const api = async (camino, metodo, cuerpo) => {
    let r;
    try {
      r = await fetch(API + camino, { method: metodo || 'GET', headers: cuerpo ? { 'Content-Type': 'application/json' } : undefined, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    } catch (e) { throw new Error('No hay conexión con el servicio de comentarios.'); }
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || 'No se pudo completar la acción.');
    return d;
  };

  // ---------- anclas: elemento + posición relativa ----------
  const propio = (el) => !!(el && el.closest && el.closest('.cm-capa, .cm-pins, .cm-barra, .cm-lista, .demo-rail, .demo-menu'));
  const cabecera = document.querySelector('.pos-header, .topbar');   // el encabezado fijo de la ficha
  const bajoCabecera = () => (cabecera ? Math.max(0, cabecera.getBoundingClientRect().bottom) : 0);
  const selectorDe = (el) => {
    const partes = [];
    let n = el;
    while (n && n.nodeType === 1 && n !== document.body && n !== document.documentElement) {
      if (n.id && document.querySelectorAll('#' + CSS.escape(n.id)).length === 1) { partes.unshift('#' + CSS.escape(n.id)); break; }
      const p = n.parentElement;
      if (!p) break;
      partes.unshift(n.tagName.toLowerCase() + ':nth-child(' + ([...p.children].indexOf(n) + 1) + ')');
      n = p;
    }
    if (!partes.length) return 'body';
    return (partes[0][0] === '#' ? '' : 'body > ') + partes.join(' > ');
  };
  const anclaEn = (x, y) => {
    let el = document.elementsFromPoint(x, y).find((e) => !propio(e)) || document.body;
    const svg = el.closest && el.closest('svg');
    if (svg) el = svg.parentElement || svg;                         // los trazos de un ícono no son un buen ancla
    if (el === document.documentElement) el = document.body;
    const r = el.getBoundingClientRect();
    const frac = (v, total) => (total > 0 ? Math.min(1, Math.max(0, v / total)) : 0);
    return {
      s: selectorDe(el).slice(0, 600),
      rx: frac(x - r.left, r.width), ry: frac(y - r.top, r.height), oy: Math.min(30000, Math.max(0, y - r.top)),
      dx: frac(x + scrollX, document.documentElement.clientWidth), dy: Math.min(30000, Math.max(0, y + scrollY)),
      vw: innerWidth,
    };
  };
  const elementoDe = (a) => { try { return a && a.s ? document.querySelector(a.s) : null; } catch (e) { return null; } };
  // cuando el elemento no existe (todavía): su ancestro más cercano que sí existe. Sirve para el contenido que se pinta al abrirse
  // (las filas del popup de V1): si ese ancestro está oculto, el pin está "en otra parte de la ficha", no perdido
  const ancestroVivo = (a) => {
    const partes = String((a && a.s) || '').split(' > ');
    while (partes.length > 1) {
      partes.pop();
      try { const n = document.querySelector(partes.join(' > ')); if (n) return n; } catch (e) { /* selector inválido: se sigue subiendo */ }
    }
    return null;
  };
  // contenedores que recortan a un elemento (overflow distinto de visible); se recuerdan por elemento y se olvidan al cambiar el ancho
  let recortes = new WeakMap();
  const recortadores = (el) => {
    let lista = recortes.get(el);
    if (!lista) {
      lista = [];
      for (let n = el.parentElement; n && n !== document.body && n !== document.documentElement; n = n.parentElement) {
        const cs = getComputedStyle(n);
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') lista.push(n);
      }
      recortes.set(el, lista);
    }
    return lista;
  };
  /* Dónde va el pin, en coordenadas del documento. Devuelve { p, motivo }:
     p = { x, y } si se puede dibujar; si no, p = null y motivo dice por qué:
     'oculto' (otra pestaña de la ficha, fila cerrada, popup cerrado), 'recortado' (fuera del área visible de un contenedor
     con scroll, p. ej. una tabla ancha en teléfono), 'huerfano' (su elemento ya no existe) o 'tapado' (pasa bajo el encabezado fijo). */
  const mirar = (a) => {
    const el = elementoDe(a);
    if (!el) return { p: null, motivo: (() => { const anc = ancestroVivo(a); return anc && !anc.getClientRects().length ? 'oculto' : 'huerfano'; })() };
    if (!el.getClientRects().length) return { p: null, motivo: 'oculto' };
    if (el.closest('[inert]')) return { p: null, motivo: 'oculto' };   // fondo inerte bajo un popup abierto (V1): su pin no se dibuja encima del popup
    const r = el.getBoundingClientRect();
    // en un contenedor alto (la página, una sección) la altura cambia con el contenido: ahí el pin guarda su distancia al borde superior
    const dy = r.height > 400 && typeof a.oy === 'number' ? Math.min(a.oy, r.height) : a.ry * r.height;
    const vx = r.left + a.rx * r.width, vy = r.top + dy;            // en la ventana
    if (recortadores(el).some((n) => { const c = n.getBoundingClientRect(); return vx < c.left - 1 || vx > c.right + 1 || vy < c.top - 1 || vy > c.bottom + 1; })) return { p: null, motivo: 'recortado' };
    // el pin mide 32: no se sale del ancho de la página (ensancharía el documento, sobre todo en teléfono)
    const p = { x: Math.max(0, Math.min(vx + scrollX, document.documentElement.clientWidth - 34)), y: vy + scrollY };
    // 'tapado' solo si el encabezado está de verdad encima en ese punto (un popup de la ficha lo cubre y ahí el pin sí se ve)
    if (cabecera && !cabecera.contains(el) && vy < bajoCabecera()) {
      const encima = document.elementsFromPoint(vx, vy).find((e) => !propio(e));
      if (!encima || cabecera.contains(encima)) return { p: null, motivo: 'tapado', bajo: p };
    }
    return { p, motivo: null };
  };
  const NOTA = { oculto: 'En otra parte de la ficha', recortado: 'En otra parte de la ficha', huerfano: 'Su elemento ya no está en la ficha' };
  // abre las pestañas o filas que esconden el elemento (cada contenedor oculto con un control aria-controls) y lo acerca dentro de su contenedor con scroll
  const abrirHasta = (el) => {
    const cadena = [];
    for (let n = el; n && n !== document.body; n = n.parentElement) cadena.unshift(n);
    cadena.forEach((n) => {
      if (!n.id || n.getClientRects().length) return;
      const ctl = document.querySelector('[aria-controls="' + CSS.escape(n.id) + '"]');
      if (ctl && ctl.getAttribute('aria-selected') !== 'true' && ctl.getAttribute('aria-expanded') !== 'true') ctl.click();
    });
  };
  const revelar = (a) => {
    let el = elementoDe(a);
    if (!el) {
      // el elemento se pinta al abrir su contenedor (popup): se abre ese contenedor y se vuelve a buscar
      const anc = ancestroVivo(a);
      if (!anc) return;
      abrirHasta(anc);
      el = elementoDe(a);
      if (!el) return;
    }
    abrirHasta(el);
    if (mirar(a).motivo === 'recortado') el.scrollIntoView({ block: 'nearest', inline: 'center' });
  };

  // ---------- estilos ----------
  const css = document.createElement('style');
  css.textContent = `
.cm-tab {
  box-sizing: border-box; width: 18px; margin: 0; padding: 8px 3px; border: 0; border-radius: 8px 0 0 8px;
  writing-mode: vertical-rl; transform: rotate(180deg);
  background: #e5e5ff; color: #0d166b; cursor: pointer; opacity: .8;
  font: 600 11px/12px 'Nunito', sans-serif; letter-spacing: .4px; white-space: nowrap;
  transition: opacity .15s, background .15s;
}
.cm-tab:hover, .cm-tab:focus-visible, .cm-tab[aria-pressed='true'] { opacity: 1; }
.cm-tab[aria-pressed='true'] { background: #0d166b; color: #fff; }
.cm-tab:focus-visible { outline: 2px solid #5a5aff; outline-offset: 2px; }
/* con un popup de la ficha abierto (V1: overlay en z-index 1400) el riel sube sobre su fondo, para poder comentar el popup */
:where(body:has(.ds-modal-overlay:not([hidden]))) .demo-rail { z-index: 1401; }
:where(body:has(.ds-modal-overlay:not([hidden]))) .demo-menu { z-index: 1402; }
.cm-activo .demo-rail { z-index: 2003; }
.cm-activo .demo-menu { z-index: 2004; }
.cm-capa { position: fixed; inset: 0; z-index: 2000; background: transparent;
  /* puntero de comentario: globo morado con + (la punta abajo a la izquierda marca dónde cae el pin); borde morado = modo comentar */
  cursor: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='36' height='36' viewBox='0 0 36 36'%3E%3Cpath d='M3 33V17C3 9.3 9.3 3 17 3s14 6.3 14 14-6.3 14-14 14H3Z' fill='%235A5AFF' stroke='%23fff' stroke-width='2.5' stroke-linejoin='round'/%3E%3Cpath d='M17 11v12M11 17h12' stroke='%23fff' stroke-width='2.6' stroke-linecap='round'/%3E%3C/svg%3E") 3 33, crosshair; box-shadow: inset 0 0 0 3px rgba(90, 90, 255, .55); }
.cm-pins { position: absolute; left: 0; top: 0; width: 0; height: 0; z-index: 2001; font-family: 'Nunito', sans-serif; }
.cm-pin {
  position: absolute; box-sizing: border-box; width: 32px; height: 32px; margin: 0; padding: 3px; border: 0;
  border-radius: 50% 50% 50% 0; background: #fff; cursor: pointer; transform: translate(0, -100%);
  box-shadow: 0 2px 8px 0 rgba(0, 0, 0, .28); transition: transform .12s;
}
.cm-pin:hover { transform: translate(0, -100%) scale(1.08); transform-origin: 0 100%; }
.cm-pin:focus-visible { outline: 2px solid #5a5aff; outline-offset: 2px; }
.cm-pin[aria-expanded='true'] { background: #5a5aff; }
.cm-pin--resuelto { opacity: .6; }
.cm-pin--nuevo { background: #5a5aff; cursor: default; }
.cm-pin--nuevo .cm-avatar { background: #fff !important; color: #5a5aff; font-size: 16px; }
.cm-avatar {
  flex: none; display: inline-flex; align-items: center; justify-content: center; box-sizing: border-box;
  width: 26px; height: 26px; border-radius: 50%; color: #0d166b; font: 700 11px/1 'Nunito', sans-serif; letter-spacing: .2px;
}
.cm-hilo {
  position: absolute; z-index: 1; box-sizing: border-box; width: 320px; max-height: min(480px, calc(100vh - var(--cm-barra-h, 52px) - 56px));
  display: flex; flex-direction: column; border-radius: 16px; background: #fff; box-shadow: 0 10px 60px 0 rgba(0, 0, 0, .25);
  color: #2a2c2f; font: 400 14px/1.4 'Nunito', sans-serif; text-align: left; cursor: default; overflow: hidden;
}
.cm-hilo__top { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-bottom: 1px solid #e8e9ea; }
.cm-hilo__titulo { flex: 1 1 0; min-width: 0; margin: 0; font-size: 14px; line-height: 1.2; font-weight: 600; color: #1d1e20; }
.cm-aviso { flex: none; margin: 0; padding: 8px 16px; background: #f0f0ff; font-size: 12px; line-height: 1.3; color: #0d166b; }
.cm-ico { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 8px; border: 0; border-radius: 100px; background: #fff; color: #5a5aff; cursor: pointer; transition: background .15s; }
.cm-ico:hover { background: #f0f0ff; }
.cm-ico:focus-visible, .cm-btn:focus-visible, .cm-link:focus-visible { outline: 2px solid #5a5aff; outline-offset: 2px; }
.cm-ico[aria-pressed='true'] { color: #309c60; }
.cm-hilo__msgs { flex: 1 1 auto; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; padding: 12px 16px; scrollbar-width: thin; }
.cm-hilo__msgs:empty { display: none; }
.cm-msg { display: flex; gap: 8px; }
.cm-msg__cuerpo { flex: 1 1 0; min-width: 0; }
.cm-msg__cab { display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 8px; }
.cm-msg__autor { font-size: 14px; line-height: 1.2; font-weight: 700; color: #1d1e20; overflow-wrap: anywhere; }
.cm-msg__hora { font-size: 12px; line-height: 1.2; color: #54575c; }
.cm-msg__texto { margin: 2px 0 0; font-size: 14px; line-height: 1.4; color: #2a2c2f; white-space: pre-wrap; overflow-wrap: anywhere; }
.cm-link { margin: 0; padding: 0; border: 0; background: none; color: #5a5aff; cursor: pointer; font: 700 12px/1.2 'Nunito', sans-serif; }
.cm-link:hover { color: #0d166b; }
.cm-form { flex: none; display: flex; flex-direction: column; gap: 8px; margin: 0; padding: 12px 16px 16px; border-top: 1px solid #e8e9ea; }
.cm-hilo > .cm-form:first-child { border-top: 0; }
.cm-campo {
  box-sizing: border-box; width: 100%; margin: 0; padding: 8px 12px; border: 1px solid #d4d6d8; border-radius: 8px; background: #fff;
  color: #2a2c2f; font: 400 14px/1.4 'Nunito', sans-serif; transition: border-color .15s;
}
.cm-campo::placeholder { color: #71767d; opacity: 1; }
.cm-campo:hover { border-color: #5a5aff; }
.cm-campo:focus { outline: 0; border-color: #0d166b; }
textarea.cm-campo { min-height: 64px; max-height: 160px; resize: vertical; }
.cm-form__pie { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.cm-form__quien { min-width: 0; font-size: 12px; line-height: 1.2; color: #54575c; overflow-wrap: anywhere; }
.cm-form__quien b { font-weight: 700; color: #2a2c2f; }
.cm-form__acciones { flex: none; display: flex; align-items: center; gap: 8px; }
.cm-btn {
  box-sizing: border-box; height: 36px; margin: 0; padding: 7px 16px; border: 1px solid transparent; border-radius: 100px; cursor: pointer;
  background: #5a5aff; color: #fff; font: 700 14px/20px 'Nunito', sans-serif; white-space: nowrap; transition: background .15s;
}
.cm-btn:hover { background: #0d166b; }
.cm-btn[disabled] { pointer-events: none; opacity: .6; }
.cm-btn--ter { background: #fff; color: #5a5aff; }
.cm-btn--ter:hover { background: #f0f0ff; }
.cm-error { margin: 0; font-size: 12px; line-height: 1.3; color: #a82424; }
.cm-error:empty { display: none; }
.cm-barra {
  position: fixed; left: 50%; bottom: 16px; z-index: 2003; transform: translateX(-50%); box-sizing: border-box; max-width: calc(100vw - 24px);
  display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-radius: 100px; background: #fff;
  box-shadow: 0 10px 60px 0 rgba(0, 0, 0, .25); color: #2a2c2f; font: 400 14px/1.2 'Nunito', sans-serif; white-space: nowrap;
}
.cm-barra__txt { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.cm-barra__txt b { font-weight: 700; color: #0d166b; }
.cm-lista {
  position: fixed; right: 16px; top: calc(var(--pos-header-h, 56px) + 8px); z-index: 2003; box-sizing: border-box; width: 320px;
  max-height: calc(100vh - var(--pos-header-h, 56px) - var(--cm-barra-h, 52px) - 48px); display: flex; flex-direction: column; border-radius: 16px; background: #fff;
  box-shadow: 0 10px 60px 0 rgba(0, 0, 0, .25); color: #2a2c2f; font: 400 14px/1.4 'Nunito', sans-serif; text-align: left; overflow: hidden;
}
.cm-lista__top { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 16px; border-bottom: 1px solid #e8e9ea; }
.cm-lista__filtro { flex: none; display: flex; align-items: center; gap: 8px; padding: 8px 16px; font-size: 12px; line-height: 1.2; color: #54575c; cursor: pointer; }
.cm-lista__filtro input { width: 16px; height: 16px; margin: 0; accent-color: #5a5aff; }
.cm-lista__items { flex: 1 1 auto; min-height: 0; overflow-y: auto; margin: 0; padding: 0 0 8px; list-style: none; scrollbar-width: thin; }
.cm-item { display: flex; gap: 8px; box-sizing: border-box; width: 100%; margin: 0; padding: 8px 16px; border: 0; background: none; cursor: pointer; text-align: left; font: inherit; color: inherit; transition: background .15s; }
.cm-item:hover, .cm-item:focus-visible { background: #f0f0ff; }
.cm-item:focus-visible { outline: 2px solid #5a5aff; outline-offset: -2px; }
.cm-item__txt { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.cm-item__snip { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; overflow-wrap: anywhere; color: #2a2c2f; }
.cm-item__meta { font-size: 12px; line-height: 1.2; color: #54575c; }
.cm-item__meta:empty { display: none; }
.cm-vacio { margin: 0; padding: 8px 16px 16px; font-size: 14px; line-height: 1.4; color: #54575c; }
[hidden].cm-capa, [hidden].cm-pins, [hidden].cm-barra, [hidden].cm-lista, [hidden].cm-campo { display: none; }
@media (max-width: 720px) {
  .cm-tab { width: 14px; padding: 8px 1px; font-size: 10px; }
  .cm-barra { left: 12px; right: 12px; bottom: 12px; transform: none; max-width: none; }
  .cm-barra__txt { flex: 1 1 0; }
}
@media (max-width: 600px) {
  /* en teléfono el hilo y la lista suben desde abajo, a todo lo ancho, justo encima de la barra */
  .cm-hilo, .cm-lista { position: fixed; left: 8px !important; right: 8px; top: auto !important; bottom: calc(var(--cm-barra-h, 52px) + 20px); width: auto; max-height: min(60vh, calc(100vh - var(--cm-barra-h, 52px) - 36px)); }
}
@media (max-width: 480px) { .cm-barra__pista { display: none; } }
@media (max-height: 480px) {
  /* pantalla baja (teléfono acostado, zoom alto): la tarjeta entera se desplaza para que Responder no quede fuera */
  .cm-hilo { overflow-y: auto; max-height: calc(100vh - var(--cm-barra-h, 52px) - 36px); }
  .cm-hilo__msgs { flex: none; overflow: visible; }
}
@media (prefers-reduced-motion: reduce) { .cm-tab, .cm-pin, .cm-ico, .cm-btn, .cm-item, .cm-campo { transition: none; } .cm-pin:hover { transform: translate(0, -100%); } }
@media print { .cm-tab, .cm-capa, .cm-pins, .cm-barra, .cm-lista { display: none !important; } }
`;
  document.head.appendChild(css);

  // ---------- piezas fijas ----------
  // la pestaña vive en el mismo riel que "Clic aquí para ver flujos" (lo crea demo.js; si no está, se crea aquí)
  let riel = document.querySelector('.demo-rail');
  if (!riel) {
    riel = h('div', { class: 'demo-rail' });
    riel.style.cssText = 'position:fixed;left:0;top:calc(var(--pos-header-h,56px) + 8px);z-index:29;display:flex;flex-direction:column;align-items:flex-start;gap:8px';
    document.body.append(riel);
  }
  // el clic en la pestaña no roba el foco ni llega a los "clic fuera" de la página: el panel o menú abierto se queda, para poder comentarlo
  const tab = h('button', { type: 'button', class: 'cm-tab', id: 'cmTab', 'aria-pressed': 'false', title: 'Comentar (tecla C)',
    onmousedown: (e) => e.preventDefault(),
    onclick: (e) => {
      e.stopPropagation();
      const menuFlujos = document.getElementById('demoMenu'), tabFlujos = document.getElementById('demoTab');
      if (menuFlujos && !menuFlujos.hidden && tabFlujos) tabFlujos.click();   // el menú de flujos sí se cierra (ya no le llega el clic fuera)
      activar(!modo);
    } });
  riel.append(tab);

  // los clics en la interfaz de comentarios no llegan a los "clic fuera" de la página (no cierran el menú o panel que se comenta)
  const noBurbujea = (e) => e.stopPropagation();
  const capa = h('div', { class: 'cm-capa', hidden: true, 'aria-hidden': 'true' });
  const pins = h('div', { class: 'cm-pins', hidden: true });
  const btnLista = h('button', { type: 'button', class: 'cm-btn cm-btn--ter', 'aria-expanded': 'false', 'aria-controls': 'cmLista', onclick: () => verLista(!listaAbierta) });
  const btnSalir = h('button', { type: 'button', class: 'cm-btn', text: 'Salir', onclick: () => activar(false) });
  const barra = h('div', { class: 'cm-barra', hidden: true, role: 'region', 'aria-label': 'Modo comentar', onclick: noBurbujea },
    h('span', { class: 'cm-barra__txt' }, h('b', { text: 'Modo comentar' }), h('span', { class: 'cm-barra__pista', text: ' · haz clic para dejar un comentario' })),
    btnLista, btnSalir);
  const listaItems = h('ul', { class: 'cm-lista__items' });
  const chkResueltos = h('input', { type: 'checkbox', onchange: (e) => {
    const c = abierto && porId(abierto);
    // al ocultar los resueltos se cierra el hilo resuelto que esté abierto; si se cancela el descarte, la casilla vuelve a como estaba
    if (!e.target.checked && c && c.resuelto && cerrarHilo() === false) { e.target.checked = true; return; }
    verResueltos = e.target.checked;
    pintar();
  } });
  const btnCerrarLista = h('button', { type: 'button', class: 'cm-ico', 'aria-label': 'Cerrar la lista', html: ICO_X, onclick: () => verLista(false, true) });
  const lista = h('div', { class: 'cm-lista', id: 'cmLista', hidden: true, role: 'region', 'aria-label': 'Lista de comentarios', onclick: noBurbujea },
    h('div', { class: 'cm-lista__top' }, h('h2', { class: 'cm-hilo__titulo', text: 'Comentarios' }), btnCerrarLista),
    h('label', { class: 'cm-lista__filtro' }, chkResueltos, 'Ver también los resueltos'),
    listaItems);
  document.body.append(capa, pins, lista, barra);
  // la hoja del hilo y la lista se apoyan sobre la barra: su alto real se publica como variable
  new ResizeObserver(() => { if (!barra.hidden) document.documentElement.style.setProperty('--cm-barra-h', barra.offsetHeight + 'px'); }).observe(barra);

  // ---------- pintar ----------
  const pintarTab = () => {
    const n = abiertos().length;
    tab.textContent = 'Comentarios' + (n ? ' · ' + n : '');
    tab.setAttribute('aria-label', (modo ? 'Salir del modo comentar' : 'Comentar este flujo') + (n ? ' (' + n + (n === 1 ? ' comentario abierto)' : ' comentarios abiertos)') : ''));
  };
  let tarjeta = null;   // tarjeta del hilo abierto o del comentario nuevo
  let msgs = null, errorTxt = null, avisoTxt = null;
  // la tarjeta va junto a su pin sin salirse de la ventana ni quedar bajo el encabezado, la barra o la lista;
  // si su pin no se puede dibujar, se centra arriba
  // lista (320 + 16) y tarjeta (320 + 8 + 8) no caben lado a lado por debajo de 672 px: ahí no se muestran a la vez
  const sinSitio = () => document.documentElement.clientWidth < 672;
  const colocarTarjeta = (p) => {
    if (!tarjeta) return;
    if (innerWidth <= 600) { tarjeta.style.maxHeight = ''; return; }   // en teléfono es una hoja fija (CSS)
    const ancho = 320, doc = document.documentElement;
    const izq = scrollX + 8;
    const der = scrollX + (listaAbierta ? lista.getBoundingClientRect().left : doc.clientWidth) - 8;
    const altoBarra = barra.offsetHeight || 52;
    // el alto se limita al hueco real entre el encabezado y la barra: así Responder nunca queda bajo la barra
    const alFinal = msgs && msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 8;
    tarjeta.style.maxHeight = Math.max(160, Math.min(480, innerHeight - bajoCabecera() - 8 - altoBarra - 28)) + 'px';
    if (alFinal) msgs.scrollTop = msgs.scrollHeight;                 // al encoger, el hilo sigue mostrando lo último
    const alto = tarjeta.offsetHeight || 200;
    const arriba = scrollY + bajoCabecera() + 8;
    const abajo = scrollY + innerHeight - altoBarra - 28 - alto;
    let x, y;
    if (p) {
      x = p.x + 40;
      if (x + ancho > der) x = p.x - ancho - 8;
      y = p.y - 36;
    } else {
      x = izq + (der - izq - ancho) / 2;
      y = arriba + 16;
    }
    x = Math.max(izq, Math.min(x, der - ancho));
    // si no cabe a ningún lado del pin, va debajo (o encima) en vez de taparlo; el pin ocupa p.x..p.x+32 y p.y-32..p.y
    if (p && x < p.x + 32 && x + ancho > p.x) { y = p.y + 8; if (y > abajo) y = p.y - 40 - alto; }
    y = Math.max(arriba, Math.min(y, abajo));
    tarjeta.style.left = x + 'px';
    tarjeta.style.top = y + 'px';
  };
  // los pines se actualizan en su sitio (no se recrean): así no pierden el foco al desplazar la página
  const pinDe = new Map();   // id del hilo → botón
  const pinNuevo = h('span', { class: 'cm-pin cm-pin--nuevo', 'aria-hidden': 'true' }, h('span', { class: 'cm-avatar', text: '+' }));
  const pintarPins = () => {
    const vistos = new Set();
    if (modo) raices().filter((c) => verResueltos || !c.resuelto).forEach((c) => {
      const p = mirar(c.ancla).p;
      if (!p) return;
      vistos.add(c.id);
      let b = pinDe.get(c.id);
      if (!b) {
        const id = c.id;
        b = h('button', { type: 'button', class: 'cm-pin', 'data-id': id, onclick: (e) => { e.stopPropagation(); if (abierto === id) cerrarHilo(true); else if (descartarOk()) abrirHilo(id); } }, avatar(c.autor));
        pinDe.set(id, b);
        pins.prepend(b);
      }
      const n = respuestas(c.id).length;
      b.classList.toggle('cm-pin--resuelto', c.resuelto);
      b.style.left = p.x + 'px';
      b.style.top = p.y + 'px';
      b.setAttribute('aria-expanded', String(abierto === c.id));
      b.setAttribute('aria-label', 'Comentario de ' + c.autor + (n ? ' con ' + n + (n === 1 ? ' respuesta' : ' respuestas') : '') + (c.resuelto ? ', resuelto' : '') + ': ' + c.texto.slice(0, 80));
    });
    pinDe.forEach((b, id) => { if (!vistos.has(id)) { b.remove(); pinDe.delete(id); } });
    const mb = modo && borrador ? mirar(borrador.ancla) : null;
    if (mb && mb.p) { pinNuevo.style.left = mb.p.x + 'px'; pinNuevo.style.top = mb.p.y + 'px'; if (!pinNuevo.isConnected) pins.prepend(pinNuevo); }
    else pinNuevo.remove();
    if (tarjeta) {
      const m = abierto ? (porId(abierto) ? mirar(porId(abierto).ancla) : null) : mb;
      colocarTarjeta(m ? (m.p || m.bajo || null) : null);
      if (avisoTxt) { const nota = m && !m.p ? NOTA[m.motivo] : ''; avisoTxt.hidden = !nota; avisoTxt.textContent = nota ? nota + ': no se puede mostrar el pin.' : ''; }
    }
  };
  const pintarLista = () => {
    const visibles = raices().filter((c) => verResueltos || !c.resuelto).sort((a, b) => b.creado - a.creado);
    btnLista.textContent = 'Lista' + (visibles.length ? ' (' + visibles.length + ')' : '');
    if (!listaAbierta) return;
    // quien recorre la lista con teclado conserva su lugar cuando llegan comentarios nuevos
    const conFoco = listaItems.contains(document.activeElement) ? document.activeElement.getAttribute('data-id') : null;
    listaItems.replaceChildren(...visibles.map((c) => {
      const n = respuestas(c.id).length;
      const motivo = mirar(c.ancla).motivo;
      return h('li', null, h('button', { type: 'button', class: 'cm-item', 'data-id': c.id, onclick: () => { if (descartarOk()) irA(c.id); } },
        avatar(c.autor),
        h('span', { class: 'cm-item__txt' },
          h('span', { class: 'cm-msg__cab' }, h('span', { class: 'cm-msg__autor', text: c.autor }), hora(c)),
          h('span', { class: 'cm-item__snip', text: c.texto }),
          h('span', { class: 'cm-item__meta', text: [n ? n + (n === 1 ? ' respuesta' : ' respuestas') : '', c.resuelto ? 'Resuelto' : '', NOTA[motivo] || ''].filter(Boolean).join(' · ') }))));
    }));
    if (!visibles.length) listaItems.replaceChildren(h('li', null, h('p', { class: 'cm-vacio', text: raices().length ? 'No hay comentarios abiertos en este flujo.' : 'Aún no hay comentarios en este flujo. Haz clic en cualquier parte de la pantalla para dejar el primero.' })));
    if (conFoco) { const b = listaItems.querySelector('.cm-item[data-id="' + conFoco + '"]'); if (b) b.focus({ preventScroll: true }); }
  };
  // primero el contenido (la tarjeta toma su alto real) y al final los pines, que colocan la tarjeta
  const pintar = () => { pintarTab(); pintarLista(); if (abierto) pintarMensajes(); pintarPins(); };

  // ---------- hilo y redacción ----------
  const textoPendiente = () => { const t = tarjeta && tarjeta.querySelector('textarea'); return !!(t && t.value.trim()); };
  // antes de cerrar algo donde hay texto a medio escribir se pregunta
  const descartarOk = () => !textoPendiente() || window.confirm('¿Descartar lo que estás escribiendo?');
  const formulario = (placeholder, etiqueta, alEnviar, alCancelar) => {
    const nombre = h('input', { class: 'cm-campo', type: 'text', maxlength: '40', placeholder: 'Tu nombre', 'aria-label': 'Tu nombre', autocomplete: 'name', value: AUTOR_FIJO || yo.nombre || '', hidden: !!(AUTOR_FIJO || yo.nombre) });
    const texto = h('textarea', { class: 'cm-campo', maxlength: '2000', rows: '2', placeholder, 'aria-label': placeholder });
    const quien = h('span', { class: 'cm-form__quien' });
    const pintarQuien = () => quien.replaceChildren(...(AUTOR_FIJO ? [] : yo.nombre && nombre.hidden
      ? ['Comentas como ', h('b', { text: yo.nombre }), ' · ', h('button', { type: 'button', class: 'cm-link', text: 'Cambiar', onclick: () => { nombre.hidden = false; pintarQuien(); nombre.focus(); nombre.select(); } })]
      : []));
    pintarQuien();
    errorTxt = h('p', { class: 'cm-error', role: 'alert' });
    const error = errorTxt;
    const enviar = h('button', { type: 'submit', class: 'cm-btn', text: etiqueta });
    let enviando = false;   // Cmd/Ctrl + Enter repetido no publica dos veces
    const f = h('form', { class: 'cm-form', novalidate: true, onsubmit: async (e) => {
      e.preventDefault();
      if (enviando || enviar.disabled) return;
      const n = AUTOR_FIJO || nombre.value.trim(), t = texto.value.trim();
      if (!n) { error.textContent = 'Escribe tu nombre para comentar.'; nombre.hidden = false; nombre.focus(); return; }
      if (!t) { error.textContent = 'Escribe un comentario.'; texto.focus(); return; }
      error.textContent = '';
      if (!AUTOR_FIJO) { yo.nombre = n.slice(0, 40); guardarYo(); }
      enviando = true; enviar.disabled = true;
      // el campo no se vacía hasta que el envío termina bien: si falla o se cierra la tarjeta mientras viaja, el texto no se pierde sin aviso
      try { await alEnviar(AUTOR_FIJO || yo.nombre, t); if (texto.value.trim() === t) texto.value = ''; nombre.hidden = true; pintarQuien(); }
      catch (err) { error.textContent = err.message; }
      enviando = false; enviar.disabled = false;
    } }, nombre, texto, error,
      h('div', { class: 'cm-form__pie' }, quien,
        h('span', { class: 'cm-form__acciones' }, alCancelar ? h('button', { type: 'button', class: 'cm-btn cm-btn--ter', text: 'Cancelar', onclick: alCancelar }) : null, enviar)));
    // Cmd/Ctrl + Enter envía, como en Figma
    texto.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && !e.repeat) { e.preventDefault(); f.requestSubmit(); } });
    f.cmTexto = texto; f.cmNombre = nombre; f.cmEnviar = enviar;
    return f;
  };
  let colchon = 0;   // espacio extra al final del documento mientras hay una hoja abierta en teléfono
  const ponerColchon = (px) => { colchon = px; document.documentElement.style.paddingBottom = px ? px + 'px' : ''; };
  const quitarTarjeta = () => { if (tarjeta) { tarjeta.remove(); tarjeta = null; msgs = null; avisoTxt = null; errorTxt = null; } };
  // cierra el hilo o el borrador; con "forzar" no pregunta por el texto a medio escribir
  const cerrarHilo = (devolverFoco, forzar) => {
    if (!forzar && !descartarOk()) return false;
    const id = abierto;
    abierto = null; borrador = null;
    quitarTarjeta();
    ponerColchon(0);
    pintarPins();
    if (devolverFoco) { const p = id && pinDe.get(id); (p || btnLista).focus({ preventScroll: true }); }
    return true;
  };
  const pintarMensajes = () => {
    if (!msgs || !abierto) return;
    const raiz = porId(abierto);
    if (!raiz) {
      // alguien borró el hilo: si hay una respuesta a medio escribir no se pierde sin aviso
      if (textoPendiente()) { if (errorTxt) errorTxt.textContent = 'Este comentario fue borrado por su autor; ya no se puede responder.'; const f = tarjeta.querySelector('form'); if (f && f.cmEnviar) f.cmEnviar.disabled = true; return; }
      cerrarHilo(false, true);
      return;
    }
    const abajo = msgs.scrollTop + msgs.clientHeight >= msgs.scrollHeight - 8;
    msgs.replaceChildren(...[raiz].concat(respuestas(raiz.id)).map((c) => h('div', { class: 'cm-msg' }, avatar(c.autor),
      h('div', { class: 'cm-msg__cuerpo' },
        h('div', { class: 'cm-msg__cab' }, h('span', { class: 'cm-msg__autor', text: c.autor }), hora(c),
          yo.ids.includes(c.id) ? h('button', { type: 'button', class: 'cm-link', text: 'Borrar', 'aria-label': 'Borrar mi comentario', onclick: () => borrar(c.id) }) : null),
        h('p', { class: 'cm-msg__texto', text: c.texto })))));
    if (abajo) msgs.scrollTop = msgs.scrollHeight;
    const r = tarjeta.querySelector('.cm-resolver');
    if (r) { r.setAttribute('aria-pressed', String(raiz.resuelto)); r.setAttribute('aria-label', raiz.resuelto ? 'Reabrir el hilo' : 'Marcar como resuelto'); r.title = raiz.resuelto ? 'Reabrir' : 'Resolver'; }
  };
  // en teléfono la hoja inferior no debe tapar el pin que se abre o se crea: la página sube lo necesario
  const despejarPin = (ancla) => {
    if (innerWidth > 600 || !tarjeta) return;
    const m = mirar(ancla);
    const p = m.p || m.bajo;
    if (!p) return;
    const techo = tarjeta.getBoundingClientRect().top - 16;         // el pin (32 de alto, su punta abajo) debe quedar por encima
    const vy = p.y - scrollY;
    const piso = bajoCabecera() + 40;
    if (vy > techo) {
      // si el ancla está al final de la página, el documento no puede subir más: se le da el espacio que falta
      const falta = Math.ceil(vy - techo - (document.documentElement.scrollHeight - innerHeight - scrollY));
      if (falta > 0) ponerColchon(colchon + falta);
      window.scrollBy({ top: vy - techo, behavior: sinMovimiento() ? 'auto' : 'smooth' });
    }
    else if (vy < piso) window.scrollBy({ top: vy - piso, behavior: sinMovimiento() ? 'auto' : 'smooth' });
  };
  const abrirHilo = (id) => {
    const raiz = porId(id);
    if (!raiz) return;
    if (listaAbierta && sinSitio()) verLista(false);
    quitarTarjeta();
    abierto = id; borrador = null;
    msgs = h('div', { class: 'cm-hilo__msgs' });
    avisoTxt = h('p', { class: 'cm-aviso', hidden: true });
    const form = formulario('Responder…', 'Responder', async (autor, texto) => {
      const d = await api('/comentarios', 'POST', { espacio: ESPACIO, pagina: PAGINA, hilo: id, autor, texto, token: yo.token });
      cambio += 1;
      if (!porId(d.comentario.id)) comentarios.push(d.comentario);   // un sondeo cruzado pudo traerlo antes
      yo.ids.push(d.comentario.id); guardarYo();
      firma = '';
      pintar();
      if (msgs) msgs.scrollTop = msgs.scrollHeight;
      const r = porId(id);
      if (r) despejarPin(r.ancla);                                   // la hoja creció: su pin sigue a la vista
    });
    tarjeta = h('div', { class: 'cm-hilo', role: 'dialog', 'aria-label': 'Comentario de ' + raiz.autor, onclick: noBurbujea },
      h('div', { class: 'cm-hilo__top' }, h('h2', { class: 'cm-hilo__titulo', text: 'Comentario' }),
        h('button', { type: 'button', class: 'cm-ico cm-resolver', html: ICO_OK, onclick: () => resolver(id) }),
        h('button', { type: 'button', class: 'cm-ico', 'aria-label': 'Cerrar', html: ICO_X, onclick: () => cerrarHilo(true) })),
      avisoTxt, msgs, form);
    pins.append(tarjeta);
    pintar();
    if (matchMedia('(max-height: 480px)').matches) tarjeta.scrollTop = tarjeta.scrollHeight;
    despejarPin(raiz.ancla);
    form.cmTexto.focus({ preventScroll: true });
  };
  const nuevoEn = (x, y) => {
    if (listaAbierta && sinSitio()) verLista(false);                 // sin sitio para los dos, la tarjeta no queda bajo la lista
    quitarTarjeta();
    abierto = null;
    const ancla = anclaEn(x, y);
    borrador = { ancla };
    const form = formulario('Escribe un comentario…', 'Comentar', async (autor, texto) => {
      const d = await api('/comentarios', 'POST', { espacio: ESPACIO, pagina: PAGINA, autor, texto, token: yo.token, ancla });
      cambio += 1;
      if (!porId(d.comentario.id)) comentarios.push(d.comentario);   // un sondeo cruzado pudo traerlo antes
      yo.ids.push(d.comentario.id); guardarYo();
      firma = '';
      abrirHilo(d.comentario.id);
    }, () => cerrarHilo(true));
    tarjeta = h('div', { class: 'cm-hilo', role: 'dialog', 'aria-label': 'Comentario nuevo', onclick: noBurbujea }, form);
    pins.append(tarjeta);
    pintarPins();
    despejarPin(ancla);
    (AUTOR_FIJO || yo.nombre ? form.cmTexto : form.cmNombre).focus({ preventScroll: true });
  };
  // resolver y borrar trabajan con el comentario vigente (el sondeo reemplaza los objetos), no con el de cuando se abrió la tarjeta
  const resolver = async (id) => {
    const raiz = porId(id);
    if (!raiz) return;
    const valor = !raiz.resuelto;
    if (valor && !verResueltos && !descartarOk()) return;            // al resolver la tarjeta se cierra
    try {
      await api('/comentarios/' + id, 'PATCH', { resuelto: valor });
      cambio += 1; firma = '';
      const actual = porId(id);
      if (actual) actual.resuelto = valor;
      if (valor && !verResueltos && abierto === id) cerrarHilo(true, true);
      pintar();
    } catch (err) { if (errorTxt) errorTxt.textContent = err.message; }
  };
  const borrar = async (id) => {
    const c = porId(id);
    if (!c) return;
    if (!window.confirm(c.hilo ? '¿Borrar tu respuesta?' : '¿Borrar tu comentario y sus respuestas?')) return;
    try {
      await api('/comentarios/' + id, 'DELETE', { token: yo.token });
      cambio += 1; firma = '';
      comentarios = comentarios.filter((x) => x.id !== id && x.hilo !== id);
      borrados.add(id); guardarYo();
      if (!c.hilo && abierto === id) cerrarHilo(true, true);
      pintar();
    } catch (err) { if (errorTxt) errorTxt.textContent = err.message; }
  };
  // desde la lista: muestra la pestaña donde está el pin, lo lleva a la vista y abre su hilo
  const irA = (id) => {
    const c = porId(id);
    if (!c) return;
    revelar(c.ancla);
    const m = mirar(c.ancla);
    const p = m.p || m.bajo;
    if (p) window.scrollTo({ top: Math.max(0, p.y - innerHeight / 3), behavior: sinMovimiento() ? 'auto' : 'smooth' });
    if (sinSitio()) verLista(false);
    abrirHilo(id);
  };

  // ---------- modo comentar ----------
  const verLista = (ver, devolverFoco) => {
    if (ver && sinSitio() && !cerrarHilo()) return;                  // sin sitio para los dos, la lista y el hilo no conviven
    listaAbierta = ver;
    lista.hidden = !ver;
    btnLista.setAttribute('aria-expanded', String(ver));
    if (ver) { pintarLista(); (listaItems.querySelector('.cm-item') || btnCerrarLista).focus({ preventScroll: true }); }
    else if (devolverFoco) btnLista.focus({ preventScroll: true });
    pintarPins();   // la tarjeta abierta se recoloca: no debe quedar bajo la lista
  };
  const cargar = async () => {
    const v = cambio;
    let d;
    try { d = await api('/comentarios?espacio=' + ESPACIO + '&pagina=' + PAGINA); }
    catch (err) { return; }                                          // sin conexión: se queda con lo último que se cargó
    if (v !== cambio) { cargar(); return; }                          // hubo una acción propia mientras viajaba: esta respuesta es vieja
    const f = JSON.stringify(d.comentarios);
    if (f === firma) { refrescarHoras(); return; }                   // nada nuevo: no se repinta (no se pierde foco ni selección), solo se pone al día la hora
    firma = f;
    comentarios = d.comentarios;
    pintar();
  };
  // los pines siguen a sus elementos: al cambiar el tamaño, al desplazar (elementos fijos) y cuando la página muestra u oculta algo
  let cuadro = 0;
  const recolocar = () => { if (!modo || cuadro) return; cuadro = requestAnimationFrame(() => { cuadro = 0; pintarPins(); }); };
  const vigia = new MutationObserver((cambios) => { if (cambios.some((c) => !propio(c.target))) recolocar(); });
  const activar = (si) => {
    if (!si && !descartarOk()) return;
    modo = si;
    document.documentElement.classList.toggle('cm-activo', si);
    tab.setAttribute('aria-pressed', String(si));
    capa.hidden = pins.hidden = barra.hidden = !si;
    clearInterval(sondeo);
    vigia.disconnect();
    if (si) {
      document.documentElement.style.setProperty('--cm-barra-h', barra.offsetHeight + 'px');
      vigia.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['hidden', 'class', 'style', 'open', 'inert', 'aria-expanded', 'aria-selected'] });
      cargar();
      // mientras se comenta se traen los comentarios de los demás cada 20 s
      sondeo = setInterval(() => { if (!document.hidden) cargar(); }, 20000);
    } else {
      cerrarHilo(false, true);
      verLista(false);
      // si el foco estaba en la página (un panel o menú abierto) se queda ahí, para no cerrarlo por focusout
      const fa = document.activeElement;
      if (!fa || fa === document.body || propio(fa)) tab.focus({ preventScroll: true });
    }
    pintar();
  };
  capa.addEventListener('click', (e) => {
    e.stopPropagation();   // el clic que deja el pin no debe cerrar el menú o panel de la página sobre el que se comenta
    const menuFlujos = document.getElementById('demoMenu'), tabFlujos = document.getElementById('demoTab');
    if (menuFlujos && !menuFlujos.hidden && tabFlujos) { tabFlujos.click(); return; }
    // con texto a medio escribir, un clic fuera no lo descarta: vuelve al campo
    if (textoPendiente()) { tarjeta.querySelector('textarea').focus(); return; }
    if (tarjeta && abierto) { cerrarHilo(false, true); return; }
    nuevoEn(e.clientX, e.clientY);
  });
  // en fase de captura: un Esc cierra una sola cosa (la de comentarios) y no además el popup o el menú de la página
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modo) {
      const menuFlujos = document.getElementById('demoMenu');
      if (menuFlujos && !menuFlujos.hidden) return;                  // el menú de flujos se cierra primero (demo.js)
      e.stopImmediatePropagation();
      if (tarjeta) cerrarHilo(true); else if (listaAbierta) verLista(false, true); else activar(false);
      return;
    }
    const t = e.target;
    const escribiendo = t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName || '') || t.isContentEditable);
    if ((e.key === 'c' || e.key === 'C') && !e.repeat && !escribiendo && !e.metaKey && !e.ctrlKey && !e.altKey) activar(!modo);
  }, true);
  addEventListener('resize', () => { recortes = new WeakMap(); if (listaAbierta && tarjeta && sinSitio()) verLista(false); recolocar(); });
  addEventListener('scroll', recolocar, { passive: true, capture: true });   // también el scroll de contenedores (tablas)
  new ResizeObserver(recolocar).observe(document.body);
  document.addEventListener('visibilitychange', () => { if (modo && !document.hidden) cargar(); });
  // salir de la ficha (menú de flujos, recargar, cerrar) con texto a medio escribir: se pregunta, como en los demás descartes
  let saliendo = false;
  document.addEventListener('click', (e) => {
    const a = e.target.closest && e.target.closest('#demoMenu a');
    if (!a) return;
    if (descartarOk()) saliendo = true; else e.preventDefault();
  }, true);
  addEventListener('beforeunload', (e) => { if (!saliendo && textoPendiente()) { e.preventDefault(); e.returnValue = ''; } });

  pintar();
  cargar();   // al entrar a la ficha: para mostrar cuántos comentarios abiertos tiene
})();
