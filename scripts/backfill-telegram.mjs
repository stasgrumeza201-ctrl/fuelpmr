// Разовое восстановление истории цен «Шерифа» из публичного Telegram-канала «Топливо ПМР» (t.me/fuelpmr).
// В постах есть только изменившиеся виды топлива и шаг, поэтому история восстанавливается назад
// от текущих официальных цен (data/latest.json): цена до поста = цена после поста − шаг.
// Запуск: node scripts/backfill-telegram.mjs [дата-с, по умолчанию 2025-01-01]
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const CHANNEL = 'fuelpmr';
// канал менял названия дизеля: раньше «Евродизель» / «Дизель», позже «Евро DT» / «DT»
const NAMES = { 'Бензин 98': 'f-98', 'Бензин 95 Премиум': 'f-95p', 'Бензин 95': 'f-95', 'Евро DT': 'f-dte', 'DT': 'f-dt', 'Евродизель': 'f-dte', 'Дизель': 'f-dt' };
const strip = s => s.replace(/<br\s*\/?>/g, '\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&');

// пост → { id, t, changes: { 'f-95': { price, delta } } } или null, если это не пост об изменении цен SHERIFF в ПМР
export function parsePost(id, t, html) {
  const text = strip(html);
  if (!/Изменение цен:\s*SHERIFF/i.test(text) || !/Приднестровье/i.test(text)) return null;
  const changes = {};
  for (const m of text.matchAll(/^\s*\S*\s*(Бензин 98|Бензин 95 Премиум|Бензин 95|Евро DT|DT|Евродизель|Дизель):\s*([\d.]+)\s*р\.\s*\(([+-][\d.]+)\)/gmu)) {
    changes[NAMES[m[1]]] = { price: Number(m[2]), delta: Number(m[3]) };
  }
  return Object.keys(changes).length ? { id, t, changes } : null;
}

export function parsePage(html) {
  const out = [];
  for (const b of html.split('<div class="tgme_widget_message_wrap').slice(1)) {
    const id = Number((b.match(/data-post="[^/]+\/(\d+)"/) || [])[1]);
    const t = (b.match(/<time datetime="([^"]+)"/) || [])[1];
    const body = (b.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/) || [])[1];
    if (id && t && body) out.push({ id, t, html: body });
  }
  return out;
}

// посты по возрастанию времени + текущие цены → полная история
export function rebuild(posts, current) {
  const points = [];
  let after = { ...current };
  for (const p of [...posts].reverse()) {
    points.push({ t: new Date(p.t).toISOString(), rub: { ...after }, source: 't.me/fuelpmr' });
    const before = { ...after };
    for (const [id, { price, delta }] of Object.entries(p.changes)) before[id] = Math.round((price - delta) * 100) / 100;
    after = before;
  }
  return points.reverse();
}

async function main() {
  const since = new Date(process.argv[2] || '2025-01-01');
  const root = new URL('../data/', import.meta.url);
  const latest = JSON.parse(await readFile(new URL('latest.json', root), 'utf8'));
  const posts = [];
  let before = '';
  for (let page = 0; page < 200; page++) {
    const res = await fetch(`https://t.me/s/${CHANNEL}${before ? `?before=${before}` : ''}`, { headers: { 'User-Agent': 'pmr-fuel-tracker/1.0 (one-time history backfill)' } });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const msgs = parsePage(await res.text());
    if (!msgs.length) break;
    for (const m of msgs) { const p = parsePost(m.id, m.t, m.html); if (p) posts.push(p); }
    const oldest = msgs.reduce((a, b) => (a.id < b.id ? a : b));
    if (new Date(oldest.t) < since || oldest.id <= 1) break;
    before = oldest.id;
    await new Promise(r => setTimeout(r, 1200)); // вежливая пауза
  }
  const uniq = [...new Map(posts.map(p => [p.id, p])).values()].filter(p => new Date(p.t) >= since).sort((a, b) => a.id - b.id);
  const history = rebuild(uniq, latest.cities[0].rub);
  // проверка: последний пост канала должен совпадать с текущими ценами sheriff.md
  const last = uniq[uniq.length - 1];
  const mismatch = last && Object.entries(last.changes).filter(([id, { price }]) => latest.cities[0].rub[id] !== price);
  if (mismatch?.length) console.warn('ВНИМАНИЕ: последний пост канала не совпадает с sheriff.md:', mismatch);
  await writeFile(new URL('history.json', root), JSON.stringify(history, null, 2) + '\n');
  console.log(`ok: ${uniq.length} изменений с ${uniq[0]?.t} по ${last?.t}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main().catch(e => { console.error(e); process.exit(1); });
