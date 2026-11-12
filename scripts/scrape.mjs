// Забирает цены с официального сайта сети АЗС «Шериф» и обновляет data/latest.json и data/history.json.
// Запуск: node scripts/scrape.mjs  (GitHub Actions — каждые 30 минут). Без зависимостей, Node 20+.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const BASE = 'https://sheriff.md';
const RETAIL_URL = `${BASE}/activities/nefteprodukty/ceny_po_regionam/`;
const CARDS_URL = `${BASE}/activities/nefteprodukty/toplivo/`;
export const FUELS = [
  { id: 'f-98', name: 'Бензин 98' },
  { id: 'f-95p', name: 'Бензин 95 Премиум' },
  { id: 'f-95', name: 'Бензин 95' },
  { id: 'f-dte', name: 'Евро ДТ' },
  { id: 'f-dt', name: 'Дизель ДТ' },
];
const ITEM = /class="item (f-[\w]+)"[^>]*>\s*<span class="first">(\d+)<\/span>[\s\S]*?<span class="last">(\d+)<\/span>/g;
const decode = s => s.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

// цены из одного блока p-inner: { 'f-98': 30.9, ... }
function prices(block) {
  const out = {};
  for (const [, id, a, b] of block.matchAll(ITEM)) out[id] = Number(`${a}.${b.padEnd(2, '0')}`);
  return out;
}
// все блоки p-inner ru|en по порядку
function inners(html) {
  const starts = [...html.matchAll(/<div class="p-inner (ru|en)"[^>]*>/g)]; // у блока en есть доп. атрибуты
  return starts.map((m, i) => {
    const end = starts[i + 1] ? starts[i + 1].index : html.length;
    return { cur: m[1], prices: prices(html.slice(m.index, end)) };
  });
}
const complete = p => FUELS.every(f => typeof p?.[f.id] === 'number' && p[f.id] > 0);

export function parseRetail(html) {
  const names = [...html.matchAll(/data-rel="(city-\d+)">([^<]+)<\/a>/g)].map(([, rel, name]) => ({ rel, name: decode(name) }));
  const cities = names.map(({ rel, name }, i) => {
    const start = html.indexOf(`${rel}-view`);
    if (start < 0) return null;
    const next = names[i + 1] ? html.indexOf(`${names[i + 1].rel}-view`, start) : -1;
    const block = html.slice(start, next > 0 ? next : undefined);
    const inn = inners(block);
    const rub = inn.find(x => x.cur === 'ru')?.prices, usd = inn.find(x => x.cur === 'en')?.prices;
    const stations = [...block.matchAll(/<a href="(\/kak_nas_nayti\/azs\/[^"]*)">([^<]+)<\/a>/g)].map(([, href, text]) => {
      const t = decode(text), m = t.match(/^(АЗК?С?-\s?\d+[\d-]*),?\s*(.*)$/u);
      return { code: m ? m[1] : '', address: m ? m[2] : t, url: BASE + href };
    });
    return complete(rub) ? { name, rub, usd: complete(usd) ? usd : null, stations } : null;
  }).filter(Boolean);
  if (!cities.length) throw new Error('retail: не найдено ни одного города с ценами — разметка sheriff.md изменилась?');
  return cities;
}

export function parseCards(html) {
  const labels = [...html.matchAll(/(до|от)\s*1000\s*литров/g)].map(m => m[0]);
  const inn = inners(html), tiers = [];
  for (let i = 0; i + 1 < inn.length; i += 2) {
    if (inn[i].cur === 'ru' && complete(inn[i].prices)) {
      tiers.push({ label: labels[tiers.length] || `тариф ${tiers.length + 1}`, rub: inn[i].prices, usd: complete(inn[i + 1].prices) ? inn[i + 1].prices : null });
    }
  }
  return tiers;
}

const same = (a, b) => FUELS.every(f => a?.[f.id] === b?.[f.id]);

// точка в историю добавляется только при изменении цен (берём первый город — Тирасполь)
export function nextHistory(history, rub, now) {
  const last = history[history.length - 1];
  if (last && same(last.rub, rub)) return history;
  return [...history, { t: now, rub, source: 'sheriff.md' }];
}

async function get(url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'pmr-fuel-tracker/1.0 (checks every 30 minutes)' } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}
async function readJson(url, fallback) {
  try { return JSON.parse(await readFile(url, 'utf8')); } catch { return fallback; }
}

async function main() {
  const root = new URL('../data/', import.meta.url);
  const [retailHtml, cardsHtml] = await Promise.all([get(RETAIL_URL), get(CARDS_URL)]);
  const cities = parseRetail(retailHtml);
  let cards = [];
  try { cards = parseCards(cardsHtml); } catch (e) { console.warn('cards:', e.message); }
  const now = new Date().toISOString();
  const prev = await readJson(new URL('latest.json', root), null);
  const history = nextHistory(await readJson(new URL('history.json', root), []), cities[0].rub, now);
  const changed = !prev || !same(prev.cities?.[0]?.rub, cities[0].rub);
  // файлы перезаписываем только если что-то поменялось: так робот не коммитит каждые 30 минут
  if (prev && JSON.stringify([prev.cities, prev.cards]) === JSON.stringify([cities, cards])) { console.log('ok: без изменений'); return; }
  const latest = { changedAt: changed ? now : prev.changedAt, source: RETAIL_URL, fuels: FUELS, cities, cards };
  await writeFile(new URL('latest.json', root), JSON.stringify(latest, null, 2) + '\n');
  await writeFile(new URL('history.json', root), JSON.stringify(history, null, 2) + '\n');
  console.log(`ok: ${cities.length} городов, ${cards.length} тарифа карт, история ${history.length} точек${changed ? ', цены изменились' : ''}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
