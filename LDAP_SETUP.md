# Настройка LDAP аутентификации

Этот проект поддерживает аутентификацию через LDAP сервер. Настройка выполняется через переменные окружения.

## Установка зависимостей

Убедитесь, что установлена библиотека `ldapts`:

```bash
npm install ldapts
```

## Настройка переменных окружения

Создайте файл `.env.local` в корне проекта и добавьте следующие переменные:

```env
# Включить/выключить LDAP аутентификацию
LDAP_ENABLED=true

# URL LDAP сервера
LDAP_URL=ldap://ldap.example.com:389
# или для SSL/TLS:
# LDAP_URL=ldaps://ldap.example.com:636

# Базовый DN (Distinguished Name)
LDAP_BASE_DN=dc=example,dc=com

# DN и пароль для привязки к LDAP (опционально, для поиска пользователей)
LDAP_BIND_DN=cn=admin,dc=example,dc=com
LDAP_BIND_PASSWORD=password

# Базовые DN для поиска пользователей (можно указать несколько через запятую)
# Если указано несколько баз, поиск будет выполняться во всех по очереди
LDAP_USER_SEARCH_BASES=ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by
# Или одна база (для обратной совместимости):
# LDAP_USER_SEARCH_BASE=ou=users,dc=example,dc=com

# Фильтр поиска пользователей (используйте {username} как плейсхолдер)
LDAP_USER_SEARCH_FILTER=(uid={username})

# Атрибуты LDAP
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
# Для полного имени можно использовать либо:
# - givenName + sn (имя и фамилия отдельно)
LDAP_FIRSTNAME_ATTRIBUTE=givenName
LDAP_LASTNAME_ATTRIBUTE=sn
# - или одно поле полного имени
# LDAP_FULLNAME_ATTRIBUTE=cn

# Таймаут подключения в миллисекундах (по умолчанию 5000)
LDAP_TIMEOUT=5000
```

## Примеры конфигурации

### БГУИР - Актуальная конфигурация (на основе Python проекта)

```env
LDAP_ENABLED=true
LDAP_URL=ldaps://ldap.bsuir.by

LDAP_BASE_DN=dc=bsuir,dc=by
LDAP_BIND_DN=uid=smdoadmin,ou=staff,dc=bsuir,dc=by
LDAP_BIND_PASSWORD=eW308687!

# Несколько баз поиска через запятую (staff и stud)
LDAP_USER_SEARCH_BASES=ou=staff,dc=bsuir,dc=by;ou=stud,dc=bsuir,dc=by

LDAP_USER_SEARCH_FILTER=(uid={username})
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FIRSTNAME_ATTRIBUTE=givenName
LDAP_LASTNAME_ATTRIBUTE=sn

LDAP_TIMEOUT=10000
```

**Особенности конфигурации БГУИР:**
- Используется `ldaps://` (SSL/TLS) для защищенного соединения
- Поиск выполняется в двух базах: `ou=staff` (преподаватели) и `ou=stud` (студенты)
- Полное имя формируется из `givenName` и `sn` (имя и фамилия)
- Фильтр поиска по атрибуту `uid`
- Обязательно указаны `LDAP_BIND_DN` и `LDAP_BIND_PASSWORD` для поиска пользователей

### OpenLDAP

```env
LDAP_ENABLED=true
LDAP_URL=ldap://ldap.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_USER_SEARCH_BASE=ou=people,dc=example,dc=com
LDAP_USER_SEARCH_FILTER=(uid={username})
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FULLNAME_ATTRIBUTE=cn
```

### Active Directory (общий пример)

```env
LDAP_ENABLED=true
LDAP_URL=ldap://ad.example.com:389
LDAP_BASE_DN=dc=example,dc=com
LDAP_USER_SEARCH_BASE=ou=Users,dc=example,dc=com
LDAP_USER_SEARCH_FILTER=(sAMAccountName={username})
LDAP_USERNAME_ATTRIBUTE=sAMAccountName
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FULLNAME_ATTRIBUTE=cn
```

### FreeIPA

```env
LDAP_ENABLED=true
LDAP_URL=ldaps://ipa.example.com:636
LDAP_BASE_DN=dc=example,dc=com
LDAP_USER_SEARCH_BASE=cn=users,cn=accounts,dc=example,dc=com
LDAP_USER_SEARCH_FILTER=(uid={username})
LDAP_USERNAME_ATTRIBUTE=uid
LDAP_EMAIL_ATTRIBUTE=mail
LDAP_FULLNAME_ATTRIBUTE=cn
```

## Как это работает

1. При входе пользователя система сначала проверяет учетные данные через LDAP (если `LDAP_ENABLED=true`)
2. Если LDAP аутентификация успешна, пользователь получает доступ
3. Если LDAP не настроен или аутентификация не удалась, система проверяет локальную базу пользователей
4. В качестве последнего варианта используются тестовые учетные записи

## Определение ролей пользователей

По умолчанию все пользователи, аутентифицированные через LDAP, получают роль `student`. 

Для настройки ролей на основе групп LDAP или других атрибутов, необходимо модифицировать функцию `mapLDAPUserToUser` в файле `lib/ldap.ts`.

## Безопасность

- Используйте `ldaps://` (LDAP over SSL/TLS) для защищенного соединения
- Храните пароли и конфиденциальные данные в переменных окружения, не коммитьте их в репозиторий
- Регулярно обновляйте библиотеку `ldapts` для получения исправлений безопасности

## Отладка

Все операции LDAP логируются в систему логирования. Проверьте логи в директории `data/logs/` для диагностики проблем.

## Отключение LDAP

Чтобы отключить LDAP аутентификацию, установите:

```env
LDAP_ENABLED=false
```

Или просто удалите/закомментируйте переменные LDAP в `.env.local`.
