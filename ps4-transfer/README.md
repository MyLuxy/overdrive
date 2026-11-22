# Передача файлов Overdrive в НОВЫЙ репозиторий (hand-off для ИИ-агента)

Цель: скопировать **снимок файлов** ветки `main` этого репозитория
(`Stintik-123/Overdrive`) в **новый пустой** репозиторий Overdrive-PS4,
который владелец создаст сам. URL нового репозитория даёт владелец в
задании; если URL неизвестен — остановись и спроси, не угадывай.

Контекст: предыдущая передача случайно перетащила git-историю Overdrive,
из-за чего в новом репозитории появились чужие Contributors. Владелец
создал репозиторий заново. Твоя задача — перенести только файлы. История
не нужна и нежелательна в принципе.

## Жёсткие правила (нарушать нельзя)

1. **Никакой git-истории.** Запрещены: `git fetch` из Overdrive в целевой
   репозиторий, `git reset --hard FETCH_HEAD`, push существующих коммитов,
   `clone` одного репозитория с последующим переименованием remote.
   Переносится только снимок файлов через `git archive`.
2. **Ровно один корневой коммит** в целевом репозитории.
3. Автор и коммиттер — владелец: `Stintik-123 <stintikvpn@proton.me>`,
   а не идентичность агента.
4. Эту папку (`ps4-transfer/`) в целевой репозиторий **не переносить**.
5. Содержимое файлов не редактировать и не «улучшать». Не трогать
   `README.md` / `README.ru.md` — они уже в финальном виде.
6. Если что-то не совпадает с ожиданиями (репозиторий не пуст, push
   отклонён) — остановись и сообщи владельцу, не выдумывай обходные пути
   и не используй force-push.

## Шаги

```sh
# 1. Актуализировать исходник
git -C /path/to/Overdrive fetch origin
git -C /path/to/Overdrive status        # зафиксируй коммит origin/main

# 2. Экспортировать снимок main в целевой репозиторий
mkdir -p /path/to/Overdrive-PS4
git -C /path/to/Overdrive archive --format=tar origin/main \
    | tar -x -C /path/to/Overdrive-PS4
rm -rf /path/to/Overdrive-PS4/ps4-transfer

# 3. Один коммит от имени владельца
cd /path/to/Overdrive-PS4
git init -b main
git add -A
git -c commit.gpgsign=false commit \
    --author="Stintik-123 <stintikvpn@proton.me>" \
    -m "Overdrive for PlayStation 4"

# 4. Привязать новый репозиторий и отправить
git remote add origin <URL нового репозитория>
git push -u origin main
```

Если целевой клон уже существует и пуст — пропусти `git init` и работай в нём.

## Проверка (обязательно, до и после)

- `git -C /path/to/Overdrive-PS4 rev-list --count HEAD` → ровно `1`.
- `git -C ... log --format='%an <%ae>'` → только владелец.
- `git -C ... status --short` → пусто (всё закоммичено).
- Список верхнего уровня: `app/`, `ps5-react/`, `packaging/`, `tools/`,
  `covers/`, `docs/`, `.github/`, `README.md`, `README.ru.md`,
  `LICENSE`, `package.json`, `AGENTS.md`, `update-feed.json`,
  `.gitignore` — и **нет** `ps4-transfer/`.
- `ls ps5-react/native/ps4/` содержит ровно: `CMakeLists.txt`, `README.md`,
  `browser_capture.cpp`, `host_platform.cpp`, `package_installer.cpp`,
  `rar_worker_process.cpp`, `toolchain-openorbis.cmake`.
- `grep '"build:ps4"' package.json` находит скрипт; `docs/PS4.md` существует.

## Уборка (только после успешного push)

1. В этом репозитории (Stintik-123/Overdrive):
   ```sh
   git -C /path/to/Overdrive rm -r ps4-transfer
   git -C /path/to/Overdrive commit -m "transfer: remove hand-off note (applied)"
   git -C /path/to/Overdrive push origin main
   ```
2. Больше ничего в Overdrive не менять.

## Что дальше (для владельца, не для агента)

Порт нигде не компилировался: нужен Open Orbis toolchain
(`OO_PS4_TOOLCHAIN`) и `npm run build:ps4`. План и чек-лист проверки на
консоли — в `docs/PS4.md`, он переносится вместе с остальными файлами.
