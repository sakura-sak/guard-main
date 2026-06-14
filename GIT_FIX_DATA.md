# Исправление проблемы с git pull и файлами данных

## Проблема

При попытке `git pull` возникает ошибка:
```
error: Your local changes to the following files would be overwritten by merge:
        data/_index.json
        data/coursework/documents.json
        data/users.json
```

Это происходит потому, что эти файлы содержат пользовательские данные и не должны быть в git репозитории.

## Решение на сервере

### Вариант 1: Сохранить локальные изменения и обновить (рекомендуется)

```bash
# 1. Сохранить текущие изменения в stash
git stash push -m "Сохранение локальных данных перед pull"

# 2. Обновить код из репозитория
git pull origin main

# 3. Вернуть локальные данные (если нужно)
git stash pop
```

### Вариант 2: Удалить файлы из отслеживания git (если данные не важны)

```bash
# 1. Удалить файлы из индекса git (но оставить на диске)
git rm --cached data/_index.json
git rm --cached data/coursework/documents.json
git rm --cached data/users.json

# 2. Закоммитить удаление из git
git commit -m "Удаление файлов данных из git"

# 3. Обновить код
git pull origin main
```

### Вариант 3: Принудительно обновить (если локальные данные не важны)

⚠️ **Внимание:** Это удалит локальные изменения в этих файлах!

```bash
# 1. Сбросить изменения в этих файлах
git checkout -- data/_index.json
git checkout -- data/coursework/documents.json
git checkout -- data/users.json

# 2. Обновить код
git pull origin main
```

## После исправления

После того как файлы будут удалены из git, они больше не будут вызывать конфликты при `git pull`.

Файлы данных будут создаваться автоматически при работе приложения и не будут попадать в git благодаря обновленному `.gitignore`.

## Проверка

После исправления проверьте, что файлы игнорируются:

```bash
git status
```

Файлы `data/*.json` не должны отображаться в списке измененных файлов.
