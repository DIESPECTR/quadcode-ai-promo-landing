---
SECTION_ID: plans.promo-landing-mvp
TYPE: plan
STATUS: completed
PRIORITY: high
---

# Промолендинг с защищённой выдачей кодов

GOAL: Реализовать демонстрируемый MVP: лендинг, Google OAuth, выдача уникального кода с лимитами, email-доставка и тесты.

## Шаги
- [x] Подготовить структуру и адаптивный дизайн страницы.
- [x] Довести до готовности Google OAuth, хранение кодов, защиту запросов, почту и настройки.
- [x] Написать тесты на повторную и параллельную выдачу, ошибки, Gmail и Turnstile (10 прошли).
- [x] Запустить тесты и проверить страницу в браузере (desktop и mobile 390px; горизонтального скролла нет).
- [skipped: нет доступов к внешним сервисам] Проверить реальный поток Google → Turnstile → SMTP → активация в Quadcode на продакшене.

## Ограничения
- Реальное погашение кодов в Quadcode невозможно без документации интеграции или импортируемого пула кодов.
- Публикация требует OAuth credentials, SMTP и Turnstile credentials.

## Критерии готовности
- [x] Страница адаптивна; у интерактивных элементов есть клавиатурный фокус.
- [x] Код проверяет Gmail и email_verified; тест OAuth-callback с моками проходит.
- [x] Повторные/одновременные запросы не создают лишних кодов (тесты проходят).
- [x] Логика SMTP-отправки и безопасного повтора покрыта тестами с моками.
- [x] Автоматические проверки проходят (10 тестов).
- [skipped: нет ключей и действующих кодов] Реальная проверка внешних сервисов и погашения в Quadcode.

## Ребрендинг под Quadcode AI (новое требование)
- [x] Изучить текущий quadcode.ai: позиционирование IDE, фирменные цвета, шрифты, визуал и гайды.
- [x] Проверить обновлённое оформление и копирайт Quadcode AI без выдуманных обещаний.
- [x] Проверить бренд-ассеты и реальные ссылки на продукт и библиотеку гайдов.
- [x] Проверить адаптивность и функциональные тесты после изменений: 320/390/768/1440px без переполнения; CTA и FAQ работают; бренд-ассеты загружаются; 10 тестов прошли.

## English-only conversion update
- [x] Rewrite page content in English with clearer IDE value proposition, honest promo conditions and guide selection.
- [x] Translate all dynamic UI, API errors and delivery email; keep flow and anti-fraud unchanged.
- [x] Add responsive guide cards linking to verified official guides and tighten CTA hierarchy.
- [x] Test English-only rendered states, links, responsive widths and automated suite: 12 tests passed in prior run; browser 320/390/768/1440px without overflow; CTA, FAQ and external-link safety checked.
