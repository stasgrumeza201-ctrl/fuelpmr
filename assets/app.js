// Общее для всех страниц: загрузка данных, форматирование, шапка, меню, статус обновления.
const ICONS = 'assets/icons.svg';
export const FUEL_META = {
  'f-98': { code: '98', color: '#5B47B8' },
  'f-95p': { code: '95+', color: '#C07A1E' },
  'f-95': { code: '95', color: '#1F7A45' },
  'f-dte': { code: 'ЕДТ', color: '#1D5C99' },
  'f-dt': { code: 'ДТ', color: '#55554E' },
};
export const icon = (id, cls = 'icon') => `<svg class="${cls}" aria-hidden="true"><use href="${ICONS}#${id}"/></svg>`;
export const rub = n => n.toLocaleString('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const fmtDate = (iso, opts = { day: 'numeric', month: 'long' }) => new Date(iso).toLocaleDateString('ru-RU', opts);
export const fmtDateTime = iso => new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
export const param = k => new URLSearchParams(location.search).get(k);

const PAGES = [
  ['./', 'Главная', 'home-2-linear'],
  ['history.html', 'История', 'history-linear'],
  ['stations.html', 'АЗС', 'map-point-linear'],
  ['trip.html', 'Поездка', 'calculator-linear'],
];

// шапка, нижнее меню на телефоне и подвал — одинаковые на всех страницах
export function chrome() {
  // главная может открываться как «/», «/index.html» или как корень артефакта — всё это «./»
  const last = location.pathname.split('/').pop();
  const here = !last || last === 'index.html' || !last.endsWith('.html') ? './' : last;
  const links = PAGES.map(([href, label, ic]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ''}>${icon(ic)}${label}</a>`).join('');
  document.body.insertAdjacentHTML('afterbegin', `<header class="site-header gutter"><div class="wrap bar">
    <a class="logo" href="./">${icon('gas-station-linear')}Топливо ПМР</a>
    <nav class="nav" aria-label="Разделы">${links}</nav>
    <span class="status num" id="status" role="status"><i></i><span>Загружаем цены…</span></span></div></header>`);
  document.body.insertAdjacentHTML('beforeend', `<nav class="tabbar" aria-label="Разделы">${links}</nav>
    <footer class="site-footer gutter"><div class="wrap"><p>Независимый трекер цен, не связан с сетью «Шериф». Текущие цены берутся с официального сайта
    <a href="https://sheriff.md/activities/nefteprodukty/ceny_po_regionam/" target="_blank" rel="noopener">sheriff.md</a> каждые 30 минут,
    история до 12 ноября 2026 года — из Telegram-канала <a href="https://t.me/fuelpmr" target="_blank" rel="noopener">«Топливо ПМР»</a>.
    Перед заправкой сверяйте цену на АЗС. Сайт не использует cookie и не собирает данные посетителей.</p></div></footer>`);
}

// данные: загружаются при открытии и перепроверяются каждые 10 минут, пока страница открыта
export function watchData(onData) {
  let last = '';
  const status = () => document.getElementById('status');
  async function load() {
    try {
      const [l, h] = await Promise.all([fetch('data/latest.json', { cache: 'no-cache' }), fetch('data/history.json', { cache: 'no-cache' })]);
      if (!l.ok) throw new Error('latest ' + l.status);
      const latest = await l.json(), history = h.ok ? await h.json() : [];
      status().classList.remove('err');
      status().lastElementChild.textContent = 'Цены от ' + fmtDateTime(latest.changedAt);
      const key = latest.changedAt + history.length;
      if (key !== last) { last = key; onData(makeApi(latest, history)); }
    } catch {
      status().classList.add('err');
      status().lastElementChild.textContent = last ? 'Нет связи, показаны прошлые цены' : 'Не удалось загрузить цены';
    }
  }
  load();
  setInterval(load, 10 * 60 * 1000);
}

function makeApi(latest, history) {
  const price = (id, city = 0) => latest.cities[city].rub[id];
  return {
    latest, history,
    fuels: latest.fuels,
    fuel: id => latest.fuels.find(f => f.id === id),
    price,
    usd: (id, city = 0) => latest.cities[city].usd?.[id],
    // последнее изменение: { d: шаг, t: когда } — по истории
    lastChange(id) {
      for (let i = history.length - 1; i > 0; i--) {
        if (history[i].rub[id] !== history[i - 1].rub[id]) return { d: +(history[i].rub[id] - history[i - 1].rub[id]).toFixed(2), t: history[i].t };
      }
      return null;
    },
    // изменение за N дней: текущая цена минус цена, действовавшая N дней назад
    changeOver(id, days) {
      const edge = Date.now() - days * 864e5;
      let then = history[0]?.rub[id];
      for (const p of history) { if (new Date(p.t).getTime() <= edge) then = p.rub[id]; else break; }
      return then == null ? null : +(price(id) - then).toFixed(2);
    },
  };
}

export const deltaPill = (d, suffix = '') => d == null ? '' : d === 0
  ? `<span class="pill">без изменений${suffix}</span>`
  : `<span class="pill ${d < 0 ? 'down' : 'up'}">${icon(d < 0 ? 'arrow-down-linear' : 'arrow-up-linear')}${rub(Math.abs(d))} ₽${suffix}</span>`;
