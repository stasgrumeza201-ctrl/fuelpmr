# Топливо ПМР

Цены на бензин и дизель в Приднестровье с официального сайта сети АЗС «Шериф» ([sheriff.md](https://sheriff.md/activities/nefteprodukty/ceny_po_regionam/)).

- `scripts/scrape.mjs` — забирает розничные цены по 9 городам, список АЗС и цены по топливным картам; пишет `data/latest.json` и, при изменении цен, точку в `data/history.json`.
- `.github/workflows/scrape.yml` — запускает сборщик каждые 30 минут и коммитит данные, только если что-то поменялось.
- `scripts/backfill-telegram.mjs` — разовое восстановление истории (с 18.03.2026) из Telegram-канала «Топливо ПМР» (t.me/fuelpmr): история строится назад от официальных цен sheriff.md.
- Страницы: `index.html` (3D-главная), `history.html`, `stations.html`, `trip.html`; общие `assets/app.css`, `assets/app.js`, `assets/icons.svg` (иконки Solar). Данные перепроверяются каждые 10 минут, пока страница открыта.

Ручной запуск сборщика: `node scripts/scrape.mjs` или вкладка Actions → «Run workflow».

Независимый проект, не связан с сетью «Шериф».
