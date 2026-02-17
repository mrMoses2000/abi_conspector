# ABI Conspector — Причинно-следственная логика работы (подробно)

Этот документ объясняет систему как цепочку причин и последствий:
какое действие пользователя вызывает какие внутренние шаги, какие данные меняются,
какие условия ведут к успеху или к ошибке.

## 1. Главная идея системы

Вход:
- аудио из микрофона или импортированный аудио/видео файл.

Выход:
- `transcript.json` (распознанная речь),
- `structured.md` (структурированный конспект),
- `merged.md` (объединённый итог),
- `html` (визуализация),
- опционально обновление страницы в Notion.

Причина -> Следствие:
- чем качественнее и стабильнее STT, тем качественнее структурирование и merge;
- чем точнее целевая страница в Notion, тем корректнее writeback.

## 2. Основные подсистемы

1. UI (Desktop/Web):
- запускает действия пользователя;
- показывает состояние очереди и ошибки.

2. IPC / Main process:
- принимает команды UI;
- создаёт записи и задачи в БД;
- запускает pipeline.

3. DB (SQLite):
- хранит `recordings`, `merge_jobs`, статус этапов, ошибки, warnings.

4. Pipeline workers:
- `normalize_audio`
- `stt_diarization`
- `llm_structure` (codex или gemini, в зависимости от `CONSPECTOR_LLM_PROVIDER`)
- `merge` (codex или gemini)
- `render_html`
- `notion_writeback`

5. External dependencies:
- `ffmpeg`/`ffprobe`
- Groq API
- whisper.cpp (`whisper-cli`)
- Codex CLI **или** Gemini CLI (зависит от `CONSPECTOR_LLM_PROVIDER`)
- Notion API

## 3. Поток №1: импорт файла (детально)

### Шаг 1. Пользователь выбирает файл

Причина:
- нажата кнопка `Добавить аудио файл`.

Следствие:
- создаётся запись `recording` с `source_type=imported_file`;
- вычисляется/сохраняется мета (имя, путь, длительность и т.д.);
- в очередь добавляется `merge_job`.

### Шаг 2. normalize_audio

Причина:
- pipeline стартовал задачу.

Следствие:
- `ffmpeg` делает единый внутренний формат (`flac`, mono, sample rate);
- в БД фиксируется `normalized_audio_path`.

Если шаг падает:
- job -> `failed`,
- в `error_code/error_message` сохраняется причина,
- дальнейшие этапы не выполняются.

### Шаг 3. stt_diarization

Причина:
- есть нормализованный аудиофайл.

Следствие:
- если `primary=groq`, сначала идёт Groq;
- если файл большой, включается chunking;
- если Groq неуспешен, и fallback включен, запускается `whispercpp`.

Что важно:
- `whisper.cpp` в коде запускается через `whisper-cli`;
- поэтому preflight проверяет именно `whisper-cli`.

Если оба движка неуспешны:
- при `CONSPECTOR_STT_FALLBACK_TO_MOCK=false` -> job падает;
- при `true` -> создаётся mock transcript (качество низкое, но pipeline продолжится).

### Шаг 4. llm_structure (codex или gemini)

Причина:
- получен `transcript.json`.

Следствие:
- `llmProvider.js` определяет, какой воркер использовать:
  - `CONSPECTOR_LLM_PROVIDER=codex` → `codexWorker.js` → `codex exec`
  - `CONSPECTOR_LLM_PROVIDER=gemini` → `geminiWorker.js` → `gemini --prompt -`
- воркер формирует `structured.md` по правилам skills (`conspector-structure`).

Если этап падает:
- при включённом fallback может быть mock structured output;
- иначе job отмечается как failed.

### Шаг 5. merge

Причина:
- есть `structured.md`.

Следствие:
- merge с базовым note (если задан путь и режим);
- результат: `merged.md`.

### Шаг 6. render_html

Причина:
- есть `merged.md`.

Следствие:
- строится финальный HTML-файл;
- UI кнопка `Открыть HTML` становится полезной только после `done`.

### Шаг 7. notion_writeback (опционально)

Причина:
- `CONSPECTOR_NOTION_MODE=real` и вызван writeback.

Следствие:
1. определяется target page:
   - по введённому title внутри `CONSPECTOR_NOTION_ROOT_PAGE_ID`;
2. считывается старое содержимое страницы;
3. создаётся backup блоков;
4. выполняется merge старого + нового markdown;
5. старые блоки удаляются;
6. новые блоки записываются.

Если target не найден:
- controlled error с `suggestions`.

## 4. Поток №2: запись с микрофона

Отличие только во входе:
- вместо локального файла идёт процесс записи;
- после `Стоп` формируется managed audio;
- дальше pipeline идентичен импорту.

Причина -> Следствие:
- микрофон не записывает -> pipeline не стартует;
- запись завершена корректно -> создаётся `recording` и идёт обычная обработка.

## 5. Очередь и параллелизм

Текущая модель:
- очередь последовательная (консервативная стабильность).

Причина:
- тяжёлые STT/LLM этапы могут конфликтовать за ресурсы.

Следствие:
- меньше race condition и OOM;
- но больше суммарное время при множестве задач.

## 6. Почему “прогресс завис на 30/45%”

Причинно-следственная связь:
1. UI прогресс показывает этап + coarse процент.
2. Если движок не отдаёт granular progress (или лог тихий), процент может долго стоять.
3. Реальная работа при этом продолжается (например, длинный chunk в STT).

Как проверять:
- смотреть `*.stt.log`;
- смотреть предупреждения job (`warning`);
- смотреть финальный статус в БД/UI.

## 7. Почему иногда получается “технический” HTML

Причина:
- STT дал mock transcript (fallback), а не реальный текст лекции.

Следствие:
- структура и HTML формально создаются,
- но содержание бедное/техническое (`Mock STT result`).

Исправление:
- включить real STT ключи/бинарь;
- отключить mock fallback в production:
  - `CONSPECTOR_STT_FALLBACK_TO_MOCK=false`.

## 8. Почему может не работать Notion writeback

1. `CONSPECTOR_NOTION_MODE=off`:
- причина: writeback выключен;
- следствие: Notion этап скипается.

2. Нет `NOTION_TOKEN`:
- причина: API не авторизуется;
- следствие: controlled skip/error.

3. Root page не расшарена integration:
- причина: интеграция не видит вложенные страницы;
- следствие: page not found, suggestions ограничены.

4. Неверный title:
- причина: mismatch в названии;
- следствие: `NOTION_PAGE_NOT_FOUND_IN_ROOT`.

## 9. Web auth/roles: причинно-следственная модель

1. Регистрация:
- причина: `POST /api/auth/register`;
- следствие: создаётся user + session token.

2. Авторизация:
- причина: token в `Authorization: Bearer ...`;
- следствие: пользователь проходит `requireAuth`.

3. Админ-доступ:
- причина: email в `CONSPECTOR_ADMIN_EMAILS`;
- следствие: `role=admin`, доступ к `/api/admin/*`.

4. Истёкшая сессия:
- причина: `expires_at <= now`;
- следствие: `AUTH_EXPIRED`, нужна повторная авторизация.

## 10. Принципы надёжности в проекте

1. Controlled errors:
- предсказуемые ошибки возвращаются как structured payload;
- UI может показать понятный текст и suggestions.

2. Soft-fail политики:
- позволяют не ронять весь pipeline на второстепенном этапе;
- но в production лучше отключать mock fallback для STT.

3. Backup перед destructive write:
- перед writeback в Notion сохраняются старые блоки;
- можно восстановить состояние вручную.

4. Preflight:
- ранняя проверка бинарей/ключей;
- уменьшает “поздние” падения уже на длинной задаче.

## 11. Граница качества и скорости

Причина:
- длинные файлы + CPU-only + внешний API latency.

Следствие:
- STT может занимать десятки минут;
- при неверном fallback может занять дольше и ухудшить качество.

Практический баланс:
- primary Groq + fallback whisper.cpp;
- queue sequential;
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=false` для боевого режима.

## 12. Что считать успешным end-to-end

Успех = все условия:
1. Job дошёл до `done`.
2. `transcript.json` не mock.
3. Есть `merged.md` и `html`.
4. (Если включён Notion) writeback выполнен в нужную подстраницу.
5. В логах нет критичных ошибок по STT/Codex/Notion.
