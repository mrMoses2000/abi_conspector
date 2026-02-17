# Codex CLI на сервере без GUI (SSH) — инструкция (RU)

Этот гайд для сценария: вы подключены к Ubuntu/Linux серверу по SSH и хотите запускать `codex` без графического интерфейса.

## 1. Проверка установки

```bash
codex --version
```

Ожидаемо: версия CLI, например `codex-cli 0.101.0`.

## 2. Варианты авторизации без GUI

## Вариант A (рекомендуется для headless): API key

1. На машине, где есть браузер, получите `OPENAI_API_KEY`.
2. На сервере временно задайте переменную:

```bash
export OPENAI_API_KEY="ваш_ключ"
```

3. Выполните login через stdin:

```bash
printenv OPENAI_API_KEY | codex login --with-api-key
```

4. Проверьте статус:

```bash
codex login status
```

## Вариант B: device auth

Если доступен device flow:
- запустите `codex login --device-auth`,
- получите URL/код,
- откройте URL на своей локальной машине в браузере,
- завершите авторизацию.

Если device flow неудобен/не отрабатывает в вашей среде, используйте Вариант A.

## 3. Рекомендуемая подготовка окружения на сервере

```bash
cd /path/to/abi_conspector
./run.sh --configure-env
./run.sh --bootstrap
./run.sh --preflight-strict
```

Критично:
- `CONSPECTOR_CODEX_MODE=real`
- `CONSPECTOR_CODEX_WORKDIR=/path/to/abi_conspector`
- `CONSPECTOR_CODEX_EFFORT=low|medium|high`

## 4. Проверка, что Codex реально доступен из проекта

```bash
codex login status
npm run preflight
```

В preflight должен быть PASS по строке `codex: ...`.

## 5. Автозапуск на SSH-сервере (без GUI)

Desktop режим Electron на headless сервере обычно не нужен.
Используйте web/server режим:

```bash
./run.sh --web
```

Или запуск через systemd/supervisor (рекомендуется для продакшна).

## 6. Безопасность ключей

- Не храните API ключи в истории shell.
- Не коммитьте `.env`.
- Для постоянной работы используйте secret manager или protected env vars.
- Если ключ утёк: revoke и создайте новый.
