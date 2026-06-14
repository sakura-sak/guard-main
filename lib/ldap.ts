/**
 * Модуль для работы с LDAP аутентификацией
 */

import { Client, SearchEntry } from "ldapts"
import { logInfo, logError } from "./logger"
import type { User, UserRole } from "./auth"

export interface LDAPConfig {
  url: string
  baseDN: string
  bindDN?: string
  bindPassword?: string
  userSearchBases: string[] // Поддержка нескольких баз поиска
  userSearchFilter: string
  usernameAttribute: string
  emailAttribute?: string
  firstNameAttribute?: string // givenName
  lastNameAttribute?: string // sn
  middleNameAttribute?: string // отчество (например, middleName)
  fullNameAttribute?: string // для обратной совместимости
  enabled: boolean
  timeout?: number
}

export interface LDAPUser {
  username: string
  email?: string
  fullName?: string
  middleName?: string
  dn: string
}

// Получение конфигурации LDAP из переменных окружения
export function getLDAPConfig(): LDAPConfig | null {
  const enabled = process.env.LDAP_ENABLED === "true"

  if (!enabled) {
    return null
  }

  const url = process.env.LDAP_URL
  const baseDN = process.env.LDAP_BASE_DN
  const userSearchFilter = process.env.LDAP_USER_SEARCH_FILTER || "(uid={username})"
  const usernameAttribute = process.env.LDAP_USERNAME_ATTRIBUTE || "uid"
  const emailAttribute = process.env.LDAP_EMAIL_ATTRIBUTE || "mail"
  const firstNameAttribute = process.env.LDAP_FIRSTNAME_ATTRIBUTE || "givenName"
  const lastNameAttribute = process.env.LDAP_LASTNAME_ATTRIBUTE || "sn"
  const middleNameAttribute = process.env.LDAP_MIDDLENAME_ATTRIBUTE || "middleName"
  const fullNameAttribute = process.env.LDAP_FULLNAME_ATTRIBUTE // опционально
  const timeout = parseInt(process.env.LDAP_TIMEOUT || "10000", 10)

  if (!url || !baseDN) {
    logError("LDAP конфигурация неполная", "LDAP_URL и LDAP_BASE_DN обязательны", undefined, undefined, "ldap")
    return null
  }

  // Поддержка нескольких баз поиска (через точку с запятой, вертикальную черту или перенос строки)
  // НЕ используем запятую, так как она может быть внутри DN (например, dc=bsuir,dc=by)
  let userSearchBases: string[] = []
  if (process.env.LDAP_USER_SEARCH_BASES) {
    // Поддержка формата через точку с запятой, вертикальную черту или перенос строки
    // Разделяем по ; | или \n, но не по запятой
    userSearchBases = process.env.LDAP_USER_SEARCH_BASES.split(/[;\n|]/)
      .map((base) => base.trim())
      .filter((base) => base.length > 0)
  } else if (process.env.LDAP_USER_SEARCH_BASE) {
    // Обратная совместимость с одной базой
    userSearchBases = [process.env.LDAP_USER_SEARCH_BASE]
  } else {
    // По умолчанию используем baseDN
    userSearchBases = [baseDN]
  }

  return {
    url,
    baseDN,
    bindDN: process.env.LDAP_BIND_DN,
    bindPassword: process.env.LDAP_BIND_PASSWORD,
    userSearchBases,
    userSearchFilter,
    usernameAttribute,
    emailAttribute,
    firstNameAttribute,
    lastNameAttribute,
    middleNameAttribute,
    fullNameAttribute,
    enabled: true,
    timeout,
  }
}

// Экранирование специальных символов в LDAP фильтрах
function escapeLDAPFilter(str: string): string {
  return str
    .replace(/\\/g, "\\5c")
    .replace(/\(/g, "\\28")
    .replace(/\)/g, "\\29")
    .replace(/\*/g, "\\2a")
    .replace(/\//g, "\\2f")
    .replace(/\0/g, "\\00")
}

// Аутентификация пользователя через LDAP
export async function authenticateLDAP(
  username: string,
  password: string,
): Promise<{ success: boolean; user?: LDAPUser; error?: string }> {
  const config = getLDAPConfig()

  if (!config) {
    return { success: false, error: "LDAP не настроен" }
  }

  let client: Client | null = null

  try {
    // Создаем клиент LDAP
    client = new Client({
      url: config.url,
      timeout: config.timeout,
      connectTimeout: config.timeout,
    })

    // Подключаемся к серверу
    // Если bindDN не указан, используем анонимную привязку
    if (config.bindDN && config.bindPassword) {
      await client.bind(config.bindDN, config.bindPassword)
    } else {
      // Попытка анонимной привязки (может не работать на всех серверах)
      try {
        await client.bind("", "")
      } catch {
        // Если анонимная привязка не работает, пробуем привязаться напрямую с учетными данными пользователя
        // Это работает для Active Directory
        const userPrincipalName = username.includes("@") 
          ? username 
          : `${username}@${config.baseDN.replace(/dc=/gi, "").replace(/,/g, ".")}`
        
        try {
          await client.bind(userPrincipalName, password)
          // Если привязка успешна, значит пароль верный
          // Теперь нужно получить информацию о пользователе
          const searchFilter = config.userSearchFilter.replace("{username}", escapeLDAPFilter(username))
          const attributes = [
            config.usernameAttribute,
            config.emailAttribute,
            config.firstNameAttribute,
            config.lastNameAttribute,
            config.middleNameAttribute,
            config.fullNameAttribute,
          ].filter(Boolean) as string[]

          // Ищем во всех базах
          for (const searchBase of config.userSearchBases) {
            try {
              const searchResult = await client.search(searchBase, {
                filter: searchFilter,
                scope: "sub",
                attributes,
              })

              if (searchResult && searchResult.searchEntries.length > 0) {
                const userEntry = searchResult.searchEntries[0] as SearchEntry
                const ldapUser: LDAPUser = {
                  username: (userEntry[config.usernameAttribute] as string) || username,
                  dn: userEntry.dn,
                }

                if (config.emailAttribute && userEntry[config.emailAttribute]) {
                  const email = userEntry[config.emailAttribute]
                  ldapUser.email = Array.isArray(email) ? email[0] : email
                }

                // Формируем полное имя из givenName и sn
                const firstName = config.firstNameAttribute && userEntry[config.firstNameAttribute]
                  ? (Array.isArray(userEntry[config.firstNameAttribute]) 
                      ? userEntry[config.firstNameAttribute][0] 
                      : userEntry[config.firstNameAttribute])
                  : null
                
                const lastName = config.lastNameAttribute && userEntry[config.lastNameAttribute]
                  ? (Array.isArray(userEntry[config.lastNameAttribute]) 
                      ? userEntry[config.lastNameAttribute][0] 
                      : userEntry[config.lastNameAttribute])
                  : null
                
                const middleName = config.middleNameAttribute && userEntry[config.middleNameAttribute]
                  ? (Array.isArray(userEntry[config.middleNameAttribute])
                      ? userEntry[config.middleNameAttribute][0]
                      : userEntry[config.middleNameAttribute])
                  : null

                if (firstName || lastName || middleName) {
                  ldapUser.fullName = [lastName, firstName, middleName].filter(Boolean).join(" ").trim()
                  ldapUser.middleName = middleName || undefined
                } else if (config.fullNameAttribute && userEntry[config.fullNameAttribute]) {
                  const fullName = userEntry[config.fullNameAttribute]
                  ldapUser.fullName = Array.isArray(fullName) ? fullName[0] : fullName
                }

                logInfo("LDAP аутентификация успешна (прямая привязка)", username, undefined, "ldap")
                return { success: true, user: ldapUser }
              }
            } catch {
              // Продолжаем поиск в следующей базе
            }
          }
        } catch (directBindError) {
          // Прямая привязка не удалась, продолжаем обычный процесс
        }
      }
    }

    // Ищем пользователя во всех указанных базах (экранируем специальные символы)
    const escapedUsername = escapeLDAPFilter(username)
    const searchFilter = config.userSearchFilter.replace("{username}", escapedUsername)
    
    // Собираем все необходимые атрибуты
    const attributes = [
      config.usernameAttribute,
      config.emailAttribute,
      config.firstNameAttribute,
      config.lastNameAttribute,
      config.middleNameAttribute,
      config.fullNameAttribute,
    ].filter(Boolean) as string[]

    let searchResult = null
    let userEntry: SearchEntry | null = null

    // Ищем пользователя во всех базах поиска
    for (const searchBase of config.userSearchBases) {
      try {
        const result = await client.search(searchBase, {
          filter: searchFilter,
          scope: "sub",
          attributes,
        })

        if (result && result.searchEntries.length > 0) {
          searchResult = result
          userEntry = result.searchEntries[0] as SearchEntry
          logInfo(`LDAP пользователь найден в базе: ${searchBase}`, username, undefined, "ldap")
          break
        }
      } catch (searchError) {
        // Продолжаем поиск в следующей базе
        logError(`Ошибка поиска в базе ${searchBase}`, searchError instanceof Error ? searchError.message : String(searchError), username, undefined, "ldap")
      }
    }

    if (!searchResult || !userEntry) {
      logError("LDAP пользователь не найден", `User not found in any search base: ${username}`, username, undefined, "ldap")
      return { success: false, error: "Пользователь не найден в LDAP" }
    }

    const userDN = userEntry.dn

    // Закрываем текущее соединение
    await client.unbind()

    // Проверяем пароль, пытаясь привязаться с учетными данными пользователя
    client = new Client({
      url: config.url,
      timeout: config.timeout,
      connectTimeout: config.timeout,
    })

    try {
      await client.bind(userDN, password)

      // Если привязка успешна, пароль верный
      const ldapUser: LDAPUser = {
        username: (userEntry[config.usernameAttribute] as string) || username,
        dn: userDN,
      }

      if (config.emailAttribute && userEntry[config.emailAttribute]) {
        const email = userEntry[config.emailAttribute]
        ldapUser.email = Array.isArray(email) ? email[0] : email
      }

      // Формируем полное имя из givenName и sn (как в Python проекте)
      const firstName = config.firstNameAttribute && userEntry[config.firstNameAttribute]
        ? (Array.isArray(userEntry[config.firstNameAttribute]) 
            ? userEntry[config.firstNameAttribute][0] 
            : userEntry[config.firstNameAttribute])
        : null
      
      const lastName = config.lastNameAttribute && userEntry[config.lastNameAttribute]
        ? (Array.isArray(userEntry[config.lastNameAttribute]) 
            ? userEntry[config.lastNameAttribute][0] 
            : userEntry[config.lastNameAttribute])
        : null
      
      const middleName = config.middleNameAttribute && userEntry[config.middleNameAttribute]
        ? (Array.isArray(userEntry[config.middleNameAttribute])
            ? userEntry[config.middleNameAttribute][0]
            : userEntry[config.middleNameAttribute])
        : null

      if (firstName || lastName || middleName) {
        ldapUser.fullName = [lastName, firstName, middleName].filter(Boolean).join(" ").trim()
        ldapUser.middleName = middleName || undefined
      } else if (config.fullNameAttribute && userEntry[config.fullNameAttribute]) {
        // Fallback на полное имя, если задано
        const fullName = userEntry[config.fullNameAttribute]
        ldapUser.fullName = Array.isArray(fullName) ? fullName[0] : fullName
      }

      logInfo("LDAP аутентификация успешна", username, undefined, "ldap")
      return { success: true, user: ldapUser }
    } catch (bindError) {
      logError("LDAP неверный пароль", `Invalid password for ${username}`, username, undefined, "ldap")
      return { success: false, error: "Неверный пароль" }
    } finally {
      await client.unbind()
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError("LDAP ошибка", errorMessage, username, undefined, "ldap")
    return { success: false, error: `Ошибка LDAP: ${errorMessage}` }
  } finally {
    if (client) {
      try {
        await client.unbind()
      } catch {
        // Игнорируем ошибки при закрытии
      }
    }
  }
}

// Получение информации о пользователе из LDAP (без проверки пароля)
export async function getUserInfoLDAP(username: string): Promise<LDAPUser | null> {
  const config = getLDAPConfig()

  if (!config) {
    return null
  }

  let client: Client | null = null

  try {
    client = new Client({
      url: config.url,
      timeout: config.timeout,
      connectTimeout: config.timeout,
    })

    // Подключаемся с учетными данными для поиска (если указаны)
    if (config.bindDN && config.bindPassword) {
      await client.bind(config.bindDN, config.bindPassword)
    } else {
      try {
        await client.bind("", "")
      } catch {
        // Анонимная привязка не работает
        return null
      }
    }

    // Ищем пользователя во всех базах (экранируем специальные символы)
    const escapedUsername = escapeLDAPFilter(username)
    const searchFilter = config.userSearchFilter.replace("{username}", escapedUsername)
    const attributes = [
      config.usernameAttribute,
      config.emailAttribute,
      config.firstNameAttribute,
      config.lastNameAttribute,
      config.middleNameAttribute,
      config.fullNameAttribute,
    ].filter(Boolean) as string[]

    let userEntry: SearchEntry | null = null

    // Ищем во всех базах поиска
    for (const searchBase of config.userSearchBases) {
      try {
        const searchResult = await client.search(searchBase, {
          filter: searchFilter,
          scope: "sub",
          attributes,
        })

        if (searchResult && searchResult.searchEntries.length > 0) {
          userEntry = searchResult.searchEntries[0] as SearchEntry
          break
        }
      } catch {
        // Продолжаем поиск в следующей базе
      }
    }

    if (!userEntry) {
      return null
    }

    const ldapUser: LDAPUser = {
      username: (userEntry[config.usernameAttribute] as string) || username,
      dn: userEntry.dn,
    }

    if (config.emailAttribute && userEntry[config.emailAttribute]) {
      const email = userEntry[config.emailAttribute]
      ldapUser.email = Array.isArray(email) ? email[0] : email
    }

    // Формируем полное имя из givenName и sn
    const firstName = config.firstNameAttribute && userEntry[config.firstNameAttribute]
      ? (Array.isArray(userEntry[config.firstNameAttribute]) 
          ? userEntry[config.firstNameAttribute][0] 
          : userEntry[config.firstNameAttribute])
      : null
    
    const lastName = config.lastNameAttribute && userEntry[config.lastNameAttribute]
      ? (Array.isArray(userEntry[config.lastNameAttribute]) 
          ? userEntry[config.lastNameAttribute][0] 
          : userEntry[config.lastNameAttribute])
      : null
    
    const middleName = config.middleNameAttribute && userEntry[config.middleNameAttribute]
      ? (Array.isArray(userEntry[config.middleNameAttribute])
          ? userEntry[config.middleNameAttribute][0]
          : userEntry[config.middleNameAttribute])
      : null

    if (firstName || lastName || middleName) {
      ldapUser.fullName = [lastName, firstName, middleName].filter(Boolean).join(" ").trim()
      ldapUser.middleName = middleName || undefined
    } else if (config.fullNameAttribute && userEntry[config.fullNameAttribute]) {
      const fullName = userEntry[config.fullNameAttribute]
      ldapUser.fullName = Array.isArray(fullName) ? fullName[0] : fullName
    }

    return ldapUser
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    logError("LDAP ошибка при получении информации", errorMessage, username, undefined, "ldap")
    return null
  } finally {
    if (client) {
      try {
        await client.unbind()
      } catch {
        // Игнорируем ошибки при закрытии
      }
    }
  }
}

// Преобразование LDAP пользователя в User с определением роли
export function mapLDAPUserToUser(ldapUser: LDAPUser, defaultRole: UserRole = "student"): User {
  // Определение роли на основе логина:
  // - Если логин содержит только цифры - это студент
  // - Если логин содержит буквы - это преподаватель
  let role: UserRole = defaultRole
  
  if (ldapUser.username) {
    // Проверяем, содержит ли логин только цифры
    const isOnlyDigits = /^\d+$/.test(ldapUser.username)
    if (isOnlyDigits) {
      role = "student"
    } else {
      // Если есть буквы - это преподаватель
      role = "teacher"
    }
  }
  
  return {
    username: ldapUser.username,
    role: role,
    email: ldapUser.email,
    fullName: ldapUser.fullName,
    middleName: ldapUser.middleName,
    institution: "БГУИР",
  }
}
