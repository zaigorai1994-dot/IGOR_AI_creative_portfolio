IGOR.AI — Dynamic Worker + R2 (захищене завантаження)

ЦЕЙ ZIP — НЕ Pages Functions. Це повноцінний Cloudflare Worker із статичними файлами, API та R2 binding.

ЩО Є ВСЕРЕДИНІ
- public/ — твій сайт, sitemap, robots та локальні зображення
- src/index.js — Worker: API + R2 + віддача сайту
- wrangler.json — конфігурація Worker

R2
Binding name: PORTFOLIO_IMAGES
Bucket name: PORTFOLIO_IMAGES
Використовується існуюче відро, нове створювати НЕ потрібно.

ADMIN_KEY
Ключ НЕ записаний у ZIP і НЕ лежить у index.html. Після створення Worker додай Secret з назвою ADMIN_KEY у Settings → Variables and Secrets.

ЗАХИСТ
- POST /api/upload без правильного X-Admin-Key повертає 401.
- Файл: тільки JPG/PNG/WebP/GIF, максимум 10 МБ.
- Фото пишуться безпосередньо у R2 через binding.
- /api/works читає список робіт з R2.
- /files/... віддає фото з R2.
- Інші запити обслуговує public/ через ASSETS.

ВАЖЛИВО
Цей ZIP призначений для Worker, а не для старого статичного Pages deployment. Не видаляй старий Worker, доки нова версія не перевірена.
