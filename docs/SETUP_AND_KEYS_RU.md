# ABI Conspector — Полная настройка и ключи (RU)

Этот документ закрывает практический вопрос: что включать, где брать ключи, какие режимы выбирать и как диагностировать сбои.

## 1. Быстрый старт (рекомендуемый путь)

1. Установите зависимости:
   - `npm install`
2. Запустите мастер конфигурации:
   - `./run.sh --configure-env`
   - или интерактивно: `./run.sh` -> `Configure .env (wizard)`
3. Подтяните системные зависимости:
   - `./run.sh --bootstrap`
4. Проверьте окружение:
   - `./run.sh --preflight`
5. Запуск:
   - Desktop (Electron): `./run.sh --desktop-real`
   - Web (аккаунты/роли): `./run.sh --web`

## 2. Какие ключи нужны и зачем

## 2.1 Groq API key (для STT primary=groq)

Зачем:
- быстрая транскрибация (особенно на слабых серверах);
- fallback в `whisper.cpp`, если Groq недоступен.

Где взять:
1. Войдите в Groq Console.
2. Откройте раздел API keys.
3. Создайте ключ и вставьте в `.env`:
   - `CONSPECTOR_GROQ_API_KEY=...`

Официальные ссылки:
- [Groq Quickstart](https://console.groq.com/docs/quickstart)
- [Groq Speech-to-Text](https://console.groq.com/docs/speech-to-text)

## 2.2 Notion token (Internal integration secret)

Зачем:
- запись объединённого конспекта обратно в Notion;
- поиск нужной подстраницы по title в рамках root page.

Где взять:
1. Создайте Integration в Notion (тип Internal).
2. Скопируйте `Internal integration secret`.
3. Вставьте в `.env`:
   - `NOTION_TOKEN=...`
4. Дайте интеграции доступ к вашей root-странице (Share/Connections).
5. Укажите root page id:
   - `CONSPECTOR_NOTION_ROOT_PAGE_ID=...`

Официальные ссылки:
- [Create a Notion integration](https://developers.notion.com/docs/create-a-notion-integration)
- [Notion authorization](https://developers.notion.com/docs/authorization)
- [Search endpoint](https://developers.notion.com/reference/post-search)
- [Retrieve page](https://developers.notion.com/reference/retrieve-a-page)

Важно:
- `workspace id` не равен `page id`;
- в проекте используется именно page root (где лежат ваши предметы/подстраницы).

## 2.3 Codex CLI auth (для structuring/merge)

Зачем:
- формирование структурированного markdown;
- merge с базовым конспектом;
- финальная заметка и HTML.

Как подключить:
1. Установите `codex` CLI.
2. Запустите `codex` в терминале и пройдите auth (ChatGPT account или API key).
3. В `.env`:
   - `CONSPECTOR_CODEX_MODE=real`
   - `CONSPECTOR_CODEX_EFFORT=low|medium|high`

Официальная ссылка:
- [OpenAI Codex CLI](https://developers.openai.com/codex/cli)

## 2.4 HuggingFace token (legacy-only, не обязателен для STT v2)

Нужен только если вы запускаете legacy-скрипт `scripts/run_stt_diarization.py` (WhisperX + diarization).

Где взять:
1. Создайте token в Hugging Face.
2. Примите условия нужных моделей pyannote (если используете diarization).
3. Вставьте:
   - `HUGGINGFACE_TOKEN=...`

Официальные ссылки:
- [Hugging Face User Access Tokens](https://huggingface.co/docs/hub/security-tokens)

## 3. Режимы проекта (что выбрать)

## 3.1 Рекомендуемый production-режим

- `CONSPECTOR_STT_MODE=real`
- `CONSPECTOR_STT_PRIMARY=groq`
- `CONSPECTOR_STT_FALLBACK=whispercpp`
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=false`
- `CONSPECTOR_CODEX_MODE=real`
- `CONSPECTOR_NOTION_MODE=real` (если нужен writeback)

Почему:
- быстро на длинных файлах;
- устойчиво при падении одного движка;
- без тихого mock в боевом сценарии.

## 3.2 Локальный автономный режим (без внешнего STT API)

- `CONSPECTOR_STT_PRIMARY=whispercpp`
- `CONSPECTOR_STT_FALLBACK=none`
- `CONSPECTOR_GROQ_API_KEY` можно не задавать.

## 3.3 Диагностический режим

- `CONSPECTOR_STT_MODE=mock`
- `CONSPECTOR_CODEX_MODE=mock`

Использовать только для smoke/debug UI.

## 4. Где лежат результаты и логи

Базовая папка данных:
- macOS: `~/Library/Application Support/abi-conspector/data`
- Linux: `~/.config/abi-conspector/data`

Подпапки:
- `audio/` — управляемые аудиофайлы;
- `transcripts/` — JSON транскрипты и `*.stt.log`;
- `structured/` — структурированный markdown;
- `merged/` — итоговый markdown;
- `html/` — итоговый HTML;
- `backups/` — backup перед Notion writeback.

## 5. Что чаще всего ломается и что делать

1. Прогресс “завис” на STT:
   - проверьте `*.stt.log` в `transcripts/`;
   - проверьте, что `CONSPECTOR_GROQ_API_KEY` валиден;
   - проверьте `whisper.cpp` бинарь и модель.

2. Получается “Mock STT result” в HTML:
   - значит real-STT не прошёл и включился fallback;
   - отключите тихий fallback:
     - `CONSPECTOR_STT_FALLBACK_TO_MOCK=false`
   - затем повторите задачу.

3. Notion writeback не находит страницу:
   - проверьте, что root page действительно расшарена Integration;
   - в GUI укажите точное название подстраницы;
   - используйте suggestions из сообщения ошибки.

4. `AUTH_REQUIRED`/`AUTH_EXPIRED` в web:
   - войдите заново;
   - проверьте `CONSPECTOR_WEB_SESSION_DAYS`.

5. `whisper-cli not found` в preflight:
   - запустите `./run.sh --bootstrap`;
   - проверьте `CONSPECTOR_WHISPERCPP_BIN`.

## 6. Проверки перед реальной работой

1. `./run.sh --preflight`
2. `npm test`
3. `npm run smoke:import`

Если все 3 зелёные, контур обычно готов к рабочей эксплуатации.

## 7. Покрытие тестами в проекте (актуально)

Покрыты:
- DB schema/migration/cleanup;
- импорт и normalize pipeline;
- queue/sequencing;
- resilience fallback;
- Notion markdown/block transforms;
- process runner;
- web auth/roles/endpoints (integration test через реальный `web/server.js`).

Непокрытые зоны (ручная проверка нужна):
- Electron GUI E2E (клики/рендер в окне);
- производительность длинных файлов > 2h на конкретном железе;
- сеть/лимиты внешних API в реальном времени.

## 8. Безопасность ключей

- не коммитьте `.env`;
- если ключ утёк: сразу revoke и создайте новый;
- для серверного режима храните ключи в secret manager/CI secrets;
- минимизируйте scope интеграций (особенно в Notion).
