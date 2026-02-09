# HarvestPredictor — AI Agent Specification (Nuxt 4 / Vue 3 / Prisma / PostgreSQL)

## 1. Project Overview

**HarvestPredictor** — AI-платформа для агроаналитики, которая объединяет данные с дронов (NDVI/EVI, мультиспектр) и данные с датчиков почвы (влажность, N/P и т.д.), чтобы прогнозировать урожайность, оценивать здоровье посевов и выдавать рекомендации по посеву, удобрениям и обработке полей.

---

## 2. Project Idea

Основная идея — превратить “сырые” данные с полей в понятные решения:

- анализировать дрон-снимки и рассчитывать NDVI/EVI;
- агрегировать показания датчиков почвы и историю участка;
- строить прогноз урожайности (MLR/регрессия + расширение до более сложных моделей);
- обнаруживать риски (стресс, нехватка влаги, дефицит питания, возможные болезни);
- выдавать рекомендации по участкам: что сеять, сколько удобрений вносить, где нужна обработка.

---

## 3. Project Goals

### Primary Goals
- Точный прогноз урожайности и “ранние сигналы” проблем по зонам поля.
- Снижение затрат (удобрения/вода/обработка) за счет зонального подхода.
- Понятные рекомендации и отчеты для фермера (по участкам/полям/периодам).

### MVP Goals
- Быстрая загрузка датасета (CSV/Excel) -- no priority.
- Дашборд с полями, датчиками, снимками и прогнозом.
- Базовые рекомендации: N/P, полив, приоритетные зоны.
- Экспорт отчета (PDF/CSV) и уведомления -- no priority.

---

## 4. AI Agent Concept -- no priority // mne nujno sperva nujno sdelat UI a potom AI

### Role // AI budet posle prizentatsi, kogda mi budem poluchat invetitsuyu
AI-агент = **“Цифровой агроном-аналитик”**.

### Core Responsibilities
1. **Ingest & Normalize**
   - принимает данные: сенсоры, дрон-индексы, историю урожая/посевов;
   - валидирует, нормализует, версионирует наборы данных.

2. **Vegetation & Time-Series Analysis**
   - рассчитывает NDVI/EVI (если нужно — на бэке) либо принимает готовые значения;
   - анализирует динамику по времени и выделяет проблемные зоны.

3. **Yield Prediction**
   - прогнозирует урожайность и уверенность прогноза (confidence/interval);
   - поддерживает разные культуры и сезоны.

4. **Recommendation Engine**
   - рекомендации по удобрениям (N/P), поливу, обработке;
   - рекомендации по культуре под участок (при наличии достаточных данных).

5. **Explainability**
   - объясняет “почему” (факторы прогноза: NDVI, влажность, N/P, тренды);
   - показывает ключевые признаки и вклад.

6. **Automation**
   - отправляет уведомления о критических изменениях (падение NDVI, риск стресса);
   - планирует задачи на повторный облет/сбор данных.

---

## 5. Technology Stack (Your Required Stack)

### Frontend / Meta-framework
- **Nuxt v4**
- **Vue v3**

### UI / MVP ускорение
- **Nuxt UI v4**
- **Tailwind CSS v4**

### Backend
- **Nuxt Server Routes** (Nitro)
  - REST endpoints (или server actions) для данных, прогнозов и рекомендаций.

### Database / ORM
- **PostgreSQL**
- **Prisma**

### Optional Integrations (MVP+)
- Хранилище файлов (S3-compatible или локально): изображения/тайлы/индексы -- no priority // prilojeniye v MVP sostoyaniye ne xranit izobrajeniya.
- Очередь задач (если нужно): обработка изображений, переобучение модели. -- no priority // prilojeniye v MVP sostoyaniye ne xranit izobrajeniya.
- Telegram bot / email notifications (по требованиям). -- no priority // prilojeniye v MVP sostoyaniye ne xranit izobrajeniya.

### Nuxt Modules
- nuxtjs/i18n
- nuxt-auth-utils

---

## 6. Suggested System Modules (Nuxt-oriented)

### Web App
- Dashboard:
  - поля, культуры, сезоны;
  - карта зон (MVP: таблица + простая визуализация).
- Data Upload:
  - CSV/Excel → парсер → сохранение в Postgres -- no priority.
- Analytics:
  - NDVI/EVI тренды;
  - прогноз урожайности;
  - рекомендации.

### API (Nuxt Server Routes)
- `POST /api/datasets/upload` — загрузка файлов
- `GET /api/fields` — список полей
- `GET /api/fields/:id/metrics` — метрики по полю
- `POST /api/predict/yield` — прогноз урожайности
- `GET /api/recommendations/:fieldId` — рекомендации
- `POST /api/alerts/run` — пересчет триггеров/уведомлений

---

## 7. Data Model (Prisma-level, conceptual)

- User
- Farm
- Field
- Season (year, crop, notes)
- SensorDevice
- SensorReading (timestamp, moisture, N, P, etc.)
- DroneFlight
- VegetationIndexPoint (timestamp, ndvi, evi, zoneId/geoRef)
- YieldRecord (seasonId, yieldValue)
- Prediction (seasonId, predictedYield, confidence, modelVersion)
- Recommendation (fieldId/seasonId, type, payload, createdAt)
- Alert (rule, status, triggeredAt)

---

## 8. MVP Scope (Fast Launch)

### MVP Must-Have
- Auth (минимальный) // nuxt module nuxt-auth-utils
- CRUD: Farm/Field/Season
- Загрузка CSV (сенсоры + индексы) и сохранение в Postgres -- no priority
- Прогноз (MLR) как сервисный модуль на серверной стороне Nuxt -- no priority // sperva UI dlya togo shtobi pokazat na prezintatsiye proyekta, eto budet posle investitsii 
- Дашборд (Nuxt UI + Tailwind) с:
  - таблицами данных,
  - графиком тренда NDVI,
  - прогнозом урожайности,
  - списком рекомендаций.

### MVP Nice-to-Have
- Уведомления при падении NDVI/аномалиях
- Экспорт отчета
- Разделение ролей (admin/farmer)

---

## 9. Success Metrics

- Accuracy прогноза урожайности (MAE/RMSE)
- Скорость получения инсайта (время от загрузки данных до результата)
- Снижение “лишних” внесений удобрений
- Увеличение урожайности/стабильности результатов по сезону
- Adoption: активные пользователи/поля/сезоны

---

## 10. One-paragraph Agent Brief

HarvestPredictor — это AI-система для сельского хозяйства, которая анализирует NDVI/EVI и показатели датчиков почвы, прогнозирует урожайность и генерирует рекомендации по удобрениям, поливу и обработке. MVP реализуется на Nuxt v4 (Vue v3) с Nuxt Server Routes, хранением данных в PostgreSQL через Prisma, и интерфейсом на Nuxt UI v4 + Tailwind v4 для быстрого запуска продукта.
