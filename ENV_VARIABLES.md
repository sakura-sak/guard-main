# Переменные окружения (.env.local)

Этот документ описывает все переменные окружения, используемые в проекте.

## 📋 Создание файла .env.local

Создайте файл `.env.local` в корне проекта на основе примера:

```bash
# Linux/macOS
cp .env.local.example .env.local

# Windows PowerShell
Copy-Item .env.local.example .env.local
```

⚠️ **Важно:** Файл `.env.local` уже добавлен в `.gitignore` и не будет попадать в git.

## 🔐 Переменные окружения

### LDAP Аутентификация

Эти переменные необходимы для работы LDAP аутентификации:

| Переменная | Описание | Обязательная | Значение по умолчанию |
|------------|----------|--------------|----------------------|
| `LDAP_ENABLED` | Включить/выключить LDAP | Да | `false` |
| `LDAP_URL` | URL LDAP сервера | Да (если LDAP включен) | - |
| `LDAP_BASE_DN` | Базовый DN | Да (если LDAP включен) | - |
| `LDAP_BIND_DN` | DN для привязки к LDAP | Нет | - |
| `LDAP_BIND_PASSWORD` | Пароль для привязки | Нет | - |
| `LDAP_USER_SEARCH_BASES` | Базы поиска пользователей | Нет | Используется `LDAP_BASE_DN` |
| `LDAP_USER_SEARCH_FILTER` | Фильтр поиска | Нет | `(uid={username})` |
| `LDAP_USERNAME_ATTRIBUTE` | Атрибут имени пользователя | Нет | `uid` |
| `LDAP_EMAIL_ATTRIBUTE` | Атрибут email | Нет | `mail` |
| `LDAP_FIRSTNAME_ATTRIBUTE` | Атрибут имени | Нет | `givenName` |
| `LDAP_LASTNAME_ATTRIBUTE` | Атрибут фамилии | Нет | `sn` |
| `LDAP_MIDDLENAME_ATTRIBUTE` | Атрибут отчества | Нет | `middleName` |
| `LDAP_TIMEOUT` | Таймаут подключения (мс) | Нет | `10000` |

**Пример для БГУИР:**
```env
LDAP_ENABLED=true
LDAP_URL=ldaps://ldap.bsuir.by
LDAP_BASE_DN=dc=bsuir,dc=by
LDAP_BIND_DN=uid=smdoadmin,ou=staff,dc=bsuir,dc=by
LDAP_BIND_PASSWORD=your_password_here
LDAP_USER_SEARCH_BASES=ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by
LDAP_USER_SEARCH_FILTER=(uid={username})
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FIRSTNAME_ATTRIBUTE=givenName
LDAP_LASTNAME_ATTRIBUTE=sn
LDAP_MIDDLENAME_ATTRIBUTE=middleName
LDAP_TIMEOUT=10000
```

⚠️ **Важно:** Для `LDAP_USER_SEARCH_BASES` используйте точку с запятой (`;`) для разделения нескольких DN, так как запятые используются внутри DN (например, `dc=bsuir,dc=by`).

### Безопасность и доступ к отчетам

| Переменная | Описание | Обязательная | Значение по умолчанию |
|------------|----------|--------------|----------------------|
| `REPORT_ACCESS_SECRET` | Секретный ключ для подписи QR-ссылок | Нет | `dev-secret-change-in-production` |

⚠️ **Важно:** В production измените `REPORT_ACCESS_SECRET` на случайную строку минимум 16 символов!

**Пример:**
```env
REPORT_ACCESS_SECRET=your-random-secret-key-min-16-chars-long
```

### Публичный URL приложения

| Переменная | Описание | Обязательная | Значение по умолчанию |
|------------|----------|--------------|----------------------|
| `NEXT_PUBLIC_APP_URL` | Публичный URL приложения для QR-кодов | **Да (для production)** | Автоматически определяется из запроса |

⚠️ **Важно для production:** Обязательно укажите `NEXT_PUBLIC_APP_URL` в `.env.local` на сервере, чтобы QR-коды в отчетах работали корректно!

**Пример:**
```env
# Для production сервера
NEXT_PUBLIC_APP_URL=http://guard-main.by:3000
# или для HTTPS:
NEXT_PUBLIC_APP_URL=https://guard-main.by
```

**Как это работает:**
- Если `NEXT_PUBLIC_APP_URL` задан, он используется для генерации QR-кодов
- Если не задан, система пытается определить URL из заголовков запроса
- Если заголовки содержат localhost, используется fallback на переменную окружения
- Без правильной настройки QR-коды могут указывать на localhost и не работать на сервере

### Системные переменные

Эти переменные обычно устанавливаются автоматически через Docker или систему:

| Переменная | Описание | Устанавливается |
|------------|----------|----------------|
| `NODE_ENV` | Окружение (production/development) | Docker Compose |
| `PORT` | Порт приложения | Docker Compose (3000) |
| `NEXT_TELEMETRY_DISABLED` | Отключение телеметрии Next.js | Docker Compose (1) |

### База данных PostgreSQL (Prisma)

| Переменная | Описание | Обязательная | Значение по умолчанию |
|------------|----------|--------------|----------------------|
| `DATABASE_URL` | Строка подключения к PostgreSQL для Prisma | **Да** | - |

**Пример:**
```env
DATABASE_URL=postgresql://bsuir:bsuir@localhost:5432/bsuir?schema=public
```

⚠️ **Важно:** перед запуском приложения выполните инициализацию схемы:

```bash
npx prisma generate
npx prisma db push
```

## 📝 Минимальная конфигурация

Для работы приложения с LDAP достаточно указать:

```env
LDAP_ENABLED=true
LDAP_URL=ldaps://ldap.bsuir.by
LDAP_BASE_DN=dc=bsuir,dc=by
LDAP_BIND_DN=uid=smdoadmin,ou=staff,dc=bsuir,dc=by
LDAP_BIND_PASSWORD=your_password
LDAP_USER_SEARCH_BASES=ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by
```

## 🔒 Безопасность

1. **Никогда не коммитьте `.env.local` в git** - файл уже в `.gitignore`
2. **Измените `REPORT_ACCESS_SECRET`** на случайную строку в production
3. **Храните пароли LDAP в безопасности** - используйте переменные окружения или секреты Docker
4. **Используйте HTTPS** в production для защиты данных

## 🐳 Docker

При использовании Docker, переменные из `.env.local` автоматически загружаются через `env_file` в `docker-compose.yml`.

Вы также можете переопределить переменные через `docker-compose.override.yml` (не коммитится в git).

## 📚 Дополнительная документация

- **LDAP настройка:** `LDAP_SETUP.md`
- **Docker деплой:** `DOCKER_DEPLOY.md`
- **Инструкции по развертыванию:** `DEPLOY_INSTRUCTIONS.md`
