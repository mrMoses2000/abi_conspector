# ABI Conspector — Полная инструкция запуска (RU)

Этот файл предназначен как единый runbook: от установки до первого успешного цикла
`аудио -> транскрипция -> структурирование -> merge -> HTML -> Notion`.

## 1. Что уже должно быть на машине

Минимум:
- Node.js `24+`
- `npm`
- интернет для внешних API (Groq, Notion, Codex)

Дополнительно (ставится через bootstrap):
- `ffmpeg`
- `ffprobe`
- `whisper.cpp` + `whisper-cli` + модель `ggml-*.bin`

## 2. Установка проекта

```bash
cd /Users/mosesvasilenko/abi_conspector
npm install
chmod +x run.sh
```

Примечание для Ubuntu:
- если `node/npm` не установлены или версия Node < 24, `run.sh` сам обнаружит это и предложит авто-установку `Node.js 24.x` через `apt` (с `sudo`).

## 3. Настройка `.env` без ручного редактирования

Запустите мастер:

```bash
./run.sh --configure-env
```

Если в `.env` уже остались шаблонные пути (например `/Users/you/abi_conspector/...`), используйте:

```bash
./run.sh --fix-env-paths
```

Проверка корректности переменных и подсказки по каждой ошибке:

```bash
./run.sh --env-doctor
```

Автоматически применить безопасные исправления:

```bash
./run.sh --env-doctor-write
```

Рекомендуемые значения:
- `CONSPECTOR_STT_MODE=real`
- `CONSPECTOR_STT_PRIMARY=groq`
- `CONSPECTOR_STT_FALLBACK=whispercpp`
- `CONSPECTOR_STT_FALLBACK_TO_MOCK=false`
- `CONSPECTOR_CODEX_MODE=real`
- `CONSPECTOR_CODEX_EFFORT=medium` (или `low/high`)
- `CONSPECTOR_NOTION_MODE=real` (если нужен writeback)

## 4. Вы правильно получаете Groq key?

Да. Если вы создаёте ключ на странице `console.groq.com/keys` через `Create API Key`, это правильный путь.

Проверочный чек-лист:
1. Ключ создан именно в вашем проекте/воркспейсе Groq.
2. Вы скопировали **полный** secret key (не маску вида `gsk_...wr72`).
3. Ключ вставлен в:
   - `CONSPECTOR_GROQ_API_KEY=...`
4. После этого `./run.sh --preflight` не ругается на отсутствие Groq key.

Быстрый тест ключа (одна команда):

```bash
cd /Users/mosesvasilenko/abi_conspector
source .env
curl https://api.groq.com/openai/v1/models \
  -H "Authorization: Bearer $CONSPECTOR_GROQ_API_KEY"
```

Если приходит JSON со списком моделей или корректный ответ API, ключ рабочий.

Если получили `401`:
- ключ неверный/просрочен;
- или в `.env` попала маска вместо полного значения.

## 5. Подключение Notion writeback

## 5.1 Что делает writeback

При кнопке `Комбинировать с Notion`:
1. берётся ваш `merged.md`;
2. по введённому title ищется нужная подстраница внутри `CONSPECTOR_NOTION_ROOT_PAGE_ID`;
3. считывается текущий контент этой страницы;
4. выполняется merge старого + нового текста;
5. в ту же страницу записывается результат;
6. создаётся backup и лог.

## 5.2 Как настроить

1. Создайте Internal Integration в Notion.
2. Возьмите `Internal integration secret`.
3. В `.env`:
   - `NOTION_TOKEN=...`
   - `CONSPECTOR_NOTION_MODE=real`
   - `CONSPECTOR_NOTION_ROOT_PAGE_ID=<ID страницы АБИ>`
4. Откройте root-страницу в Notion и дайте доступ интеграции (`Share`/`Connections`).

Важно:
- `CONSPECTOR_NOTION_ROOT_PAGE_ID` — это **page id**, не `workspace id`.
- Название подстраницы вводится вручную в GUI (это ожидаемое поведение).

## 6. Установка системных зависимостей

```bash
./run.sh --bootstrap
```

На Linux при желании web stack:

```bash
./run.sh --bootstrap-web
```

## 7. Проверка готовности

```bash
./run.sh --env-doctor
./run.sh --preflight-strict
npm test
npm run smoke:import
```

Если всё зелёное — проект готов к работе.

## 8. Запуск в нужном режиме

Desktop (Electron):

```bash
./run.sh --desktop-real
```

Web (аккаунты/роли):

```bash
./run.sh --web
```

Интерактивное меню:

```bash
./run.sh
```

Для headless SSH-сервера по Codex CLI отдельно:
- `/Users/mosesvasilenko/abi_conspector/docs/CODEX_CLI_SSH_SERVER_RU.md`

## 9. Где искать результат

Папка данных:
- macOS: `~/Library/Application Support/abi-conspector/data`
- Linux: `~/.config/abi-conspector/data`

Артефакты:
- HTML: `.../data/html/<recordingId>.html`
- merged md: `.../data/merged/<recordingId>.md`
- transcript json: `.../data/transcripts/<recordingId>.json`
- STT лог: `.../data/transcripts/<recordingId>.json.stt.log`
- Notion лог/backup: `.../data/backups/`

## 10. Частые проблемы и быстрые решения

1. Долго висит STT:
- проверьте `*.stt.log`;
- проверьте Groq key;
- проверьте, что fallback `whispercpp` реально установлен.

2. В HTML видно `Mock STT result`:
- был fallback в mock;
- выставьте `CONSPECTOR_STT_FALLBACK_TO_MOCK=false`;
- повторите задачу.

3. Notion page not found:
- проверьте, что root page расшарена integration;
- проверьте точность title;
- используйте suggestions из ошибки.

4. `prompt() is not supported`:
- в актуальной версии уже убрано;
- обновитесь на последнюю ветку/коммит.

## 11. Безопасность ключей

- никогда не коммитьте `.env`;
- при утечке сразу revoke/create нового ключа;
- храните прод-ключи в secret manager;
- минимизируйте доступы Notion integration только до нужных страниц.
