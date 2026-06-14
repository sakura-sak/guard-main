# Исправление ошибки 'ContainerConfig' при запуске Docker

## Проблема

Ошибка `KeyError: 'ContainerConfig'` возникает при попытке запустить контейнеры через docker-compose. Это обычно связано с поврежденным образом или старым контейнером.

## Решение на сервере

### Вариант 1: Полная очистка и пересборка (рекомендуется)

```bash
# 1. Остановить и удалить все контейнеры
docker-compose down

# 2. Удалить старые контейнеры принудительно (если нужно)
docker rm -f plagiarismguard-app plagiarismguard-nginx 2>/dev/null || true

# 3. Удалить старые образы
docker rmi plagiarismguard-app 2>/dev/null || true

# 4. Очистить неиспользуемые ресурсы
docker system prune -f

# 5. Пересобрать образы с нуля
docker-compose build --no-cache

# 6. Запустить контейнеры
docker-compose up -d
```

### Вариант 2: Использовать docker compose (v2) вместо docker-compose

Если на сервере установлен Docker Compose v2:

```bash
# Использовать команду docker compose вместо docker-compose
docker compose down
docker compose build --no-cache
docker compose up -d
```

### Вариант 3: Обновить скрипт deploy.sh

Если проблема повторяется, можно обновить скрипт для автоматической очистки:

```bash
# В deploy.sh добавить перед сборкой:
docker-compose down --remove-orphans
docker system prune -f
```

## Проверка после исправления

```bash
# Проверить статус контейнеров
docker-compose ps

# Проверить логи
docker-compose logs -f app
```

## Если проблема сохраняется

1. Проверьте версию docker-compose:
   ```bash
   docker-compose --version
   ```

2. Обновите docker-compose до последней версии или используйте `docker compose` (v2)

3. Проверьте доступное место на диске:
   ```bash
   df -h
   ```

4. Очистите все неиспользуемые образы и контейнеры:
   ```bash
   docker system prune -a --volumes
   ```
