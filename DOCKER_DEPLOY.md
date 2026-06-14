# Развертывание с помощью Docker

Это руководство описывает процесс развертывания проекта PlagiarismGuard на сервере с использованием Docker и Docker Compose.

## Требования

- Docker (версия 20.10 или выше)
- Docker Compose (версия 2.0 или выше)
- Минимум 2GB RAM
- Минимум 10GB свободного места на диске

## Быстрый старт

### 1. Клонирование репозитория

```bash
git clone <repository-url>
cd guard-main
```

### 2. Настройка переменных окружения

Создайте файл `.env.local` в корне проекта:

```bash
cp env.bsuir.local.example .env.local
```

Отредактируйте `.env.local` и укажите правильные значения для LDAP (если используется):

```env
LDAP_ENABLED=true
LDAP_URL=ldaps://ldap.bsuir.by
LDAP_BASE_DN=dc=bsuir,dc=by
LDAP_BIND_DN=uid=smdoadmin,ou=staff,dc=bsuir,dc=by
LDAP_BIND_PASSWORD=your_password
LDAP_USER_SEARCH_BASES=ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by
LDAP_USER_SEARCH_FILTER=(uid={username})
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FIRSTNAME_ATTRIBUTE=givenName
LDAP_LASTNAME_ATTRIBUTE=sn
LDAP_TIMEOUT=10000
```

### 3. Сборка и запуск

#### Автоматический способ (рекомендуется)

```bash
# Сделайте скрипт исполняемым
chmod +x deploy.sh

# Запустите скрипт развертывания
./deploy.sh
```

#### Ручной способ

```bash
# Сборка образов
docker-compose build

# Запуск контейнеров
docker-compose up -d

# Просмотр логов
docker-compose logs -f
```

Приложение будет доступно по адресу:
- **Через Nginx:** `http://guard-main.by:3000` (на сервере)
- **Локально:** `http://localhost:3000` (для тестирования)

**Важно:** 
- На сервере настройте DNS запись для домена `guard-main.by`, указывающую на IP сервера
- Если приложение не загружается, проверьте логи: `docker-compose logs -f`

## Управление контейнерами

### Остановка

```bash
docker-compose down
```

### Перезапуск

```bash
docker-compose restart
```

### Обновление после изменений в коде

```bash
# Остановить контейнеры
docker-compose down

# Пересобрать образы
docker-compose build --no-cache

# Запустить заново
docker-compose up -d
```

### Просмотр логов

```bash
# Все логи
docker-compose logs -f

# Только логи приложения
docker-compose logs -f app

# Только логи nginx
docker-compose logs -f nginx
```

## Структура данных

Данные приложения хранятся в директории `./data` на хосте:

```
data/
├── documents.json    # База метаданных документов
├── users.json        # База пользователей
├── uploads/          # Загруженные файлы
├── reports/          # Сгенерированные отчеты
└── logs/             # Логи приложения
```

Эта директория монтируется как volume, поэтому данные сохраняются при перезапуске контейнеров.

## Настройка Nginx

Файл `nginx.conf` содержит конфигурацию веб-сервера. По умолчанию настроен для работы на порту 3000.

### Настройка HTTPS

1. Получите SSL сертификаты (например, через Let's Encrypt)
2. Поместите сертификаты в директорию `./ssl`:
   - `./ssl/cert.pem` - сертификат
   - `./ssl/key.pem` - приватный ключ
3. Раскомментируйте строки в `docker-compose.yml`:
   ```yaml
   volumes:
     - ./ssl:/etc/nginx/ssl:ro
   ```
4. Обновите `nginx.conf` для поддержки HTTPS (порт 443)

## Переменные окружения

### Основные переменные

- `NODE_ENV` - окружение (production/development)
- `PORT` - порт приложения (по умолчанию 3000)
- `NEXT_TELEMETRY_DISABLED` - отключение телеметрии Next.js

### LDAP переменные

См. файл `env.bsuir.local.example` или документацию `LDAP_SETUP.md` для полного списка переменных LDAP.

## Мониторинг и отладка

### Проверка статуса контейнеров

```bash
docker-compose ps
```

### Вход в контейнер приложения

```bash
docker-compose exec app sh
```

### Проверка использования ресурсов

```bash
docker stats
```

### Очистка неиспользуемых ресурсов

```bash
# Удалить остановленные контейнеры
docker-compose down

# Удалить неиспользуемые образы
docker image prune -a

# Полная очистка (осторожно!)
docker system prune -a
```

## Резервное копирование

Рекомендуется регулярно создавать резервные копии директории `data`:

```bash
# Создание резервной копии
tar -czf backup-$(date +%Y%m%d).tar.gz data/

# Восстановление из резервной копии
tar -xzf backup-YYYYMMDD.tar.gz
```

## Обновление приложения

1. Остановите контейнеры:
   ```bash
   docker-compose down
   ```

2. Обновите код:
   ```bash
   git pull
   ```

3. Пересоберите и запустите:
   ```bash
   docker-compose build --no-cache
   docker-compose up -d
   ```

## Решение проблем

### Проблема: Контейнер не запускается

1. Проверьте логи:
   ```bash
   docker-compose logs app
   ```

2. Убедитесь, что порт 3000 не занят другим приложением:
   ```bash
   sudo netstat -tulpn | grep :3000
   ```

### Проблема: LDAP не работает

1. Проверьте переменные окружения:
   ```bash
   docker-compose exec app env | grep LDAP
   ```

2. Проверьте логи приложения:
   ```bash
   docker-compose logs app | grep -i ldap
   ```

3. Убедитесь, что сервер LDAP доступен из контейнера:
   ```bash
   docker-compose exec app ping ldap.bsuir.by
   ```

### Проблема: Недостаточно места на диске

```bash
# Проверьте использование диска
df -h

# Очистите неиспользуемые образы и контейнеры
docker system prune -a
```

## Production рекомендации

1. **Безопасность:**
   - Используйте HTTPS
   - Храните секреты в переменных окружения или Docker secrets
   - Регулярно обновляйте образы Docker

2. **Производительность:**
   - Настройте лимиты ресурсов в `docker-compose.yml`:
     ```yaml
     deploy:
       resources:
         limits:
           cpus: '2'
           memory: 2G
     ```

3. **Мониторинг:**
   - Настройте логирование в централизованную систему
   - Используйте мониторинг контейнеров (например, Prometheus)

4. **Резервное копирование:**
   - Автоматизируйте резервное копирование директории `data`
   - Храните резервные копии в безопасном месте

## Поддержка

При возникновении проблем проверьте:
- Логи контейнеров: `docker-compose logs`
- Документацию LDAP: `LDAP_SETUP.md`
- Файлы конфигурации: `docker-compose.yml`, `nginx.conf`
