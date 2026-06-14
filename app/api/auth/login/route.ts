import { type NextRequest, NextResponse } from "next/server"
import { getUserByUsername, updateLastLogin, registerUser } from "@/lib/user-storage"
import { logInfo, logError } from "@/lib/logger"
import { authenticateLDAP, mapLDAPUserToUser, getLDAPConfig } from "@/lib/ldap"
import type { UserRole } from "@/lib/auth"
import { GUARD_SESSION_COOKIE, signGuardSessionCookie } from "@/lib/guard-session.node"

function jsonWithSessionCookie(
  body: object,
  session: { username: string; role: string; additionalRoles?: UserRole[] },
): NextResponse {
  const res = NextResponse.json(body)
  const token = signGuardSessionCookie(
    session.username,
    session.role as UserRole,
    session.additionalRoles,
  )
  res.cookies.set(GUARD_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7,
  })
  return res
}

// POST - Авторизация пользователя
export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const { username, password } = body

    const normalizedUsername = typeof username === "string" ? username.trim() : ""
    const normalizedPassword = typeof password === "string" ? password.trim() : ""

    if (!normalizedUsername || !normalizedPassword) {
      return NextResponse.json({ success: false, error: "Логин и пароль обязательны" }, { status: 400 })
    }

    // 1. Сначала проверяем LDAP (если включен)
    const ldapConfig = getLDAPConfig()
    if (ldapConfig && ldapConfig.enabled) {
      try {
        const ldapResult = await authenticateLDAP(normalizedUsername, normalizedPassword)
        
        if (ldapResult.success && ldapResult.user) {
          // LDAP аутентификация успешна
          // Роль определяется автоматически на основе логина (только цифры = студент, есть буквы = преподаватель)
          const ldapUser = mapLDAPUserToUser(ldapResult.user)
          
          // Проверяем, есть ли пользователь в локальной базе (для получения роли)
          const storedUser = await getUserByUsername(normalizedUsername)
          if (storedUser) {
            // Если пользователь есть в локальной базе, используем его роль
            ldapUser.role = storedUser.role
            await updateLastLogin(normalizedUsername)
          } else {
            // Если пользователя нет в локальной базе, создаем запись с ролью по умолчанию
            // Можно настроить определение роли на основе групп LDAP
            // Для LDAP пользователей используем специальный маркер пароля, который не будет использоваться для локальной аутентификации
            const registerResult = await registerUser(
              normalizedUsername,
              "LDAP_AUTH_ONLY_USER_MARKER", // Специальный маркер для LDAP пользователей (достаточно длинный для валидации)
              ldapUser.role,
              ldapUser.email,
              ldapUser.fullName,
              ldapUser.institution
            )
            if (registerResult.success) {
              logInfo("LDAP пользователь зарегистрирован в локальной базе", normalizedUsername, ldapUser.role, "login")
            }
          }

          logInfo("LDAP пользователь авторизован", normalizedUsername, ldapUser.role, "login")

          return jsonWithSessionCookie(
            {
              success: true,
              user: {
                username: ldapUser.username,
                role: ldapUser.role,
                additionalRoles: [],
                email: ldapUser.email,
                fullName: ldapUser.fullName,
                middleName: ldapUser.middleName,
                institution: ldapUser.institution,
                faculty: ldapUser.faculty,
                group: ldapUser.group,
              },
            },
            {
              username: ldapUser.username,
              role: ldapUser.role,
              additionalRoles: [],
            },
          )
        }
        // Если LDAP не вернул успех, продолжаем проверку локальной базы
      } catch (ldapError) {
        // Ошибка LDAP - логируем, но продолжаем проверку локальной базы
        logError("LDAP ошибка при авторизации", ldapError instanceof Error ? ldapError.message : String(ldapError), normalizedUsername, undefined, "login")
      }
    }

    // 2. Проверяем локальную базу пользователей
    const storedUser = await getUserByUsername(normalizedUsername)
    if (storedUser && storedUser.password === normalizedPassword) {
      await updateLastLogin(normalizedUsername)
      logInfo("Пользователь авторизован", normalizedUsername, storedUser.role, "login")

      return jsonWithSessionCookie(
        {
          success: true,
          user: {
            username: storedUser.username,
            role: storedUser.role,
            additionalRoles: storedUser.additionalRoles ?? [],
            email: storedUser.email,
            fullName: storedUser.fullName,
            middleName: undefined,
            institution: storedUser.institution,
            faculty: storedUser.faculty,
            group: storedUser.group,
          },
        },
        {
          username: storedUser.username,
          role: storedUser.role,
          additionalRoles: storedUser.additionalRoles ?? [],
        },
      )
    }

    // 3. Fallback на тестовых пользователей
    const testUsers: Record<string, { username: string; password: string; role: string; email?: string; fullName?: string }> = {
      student: { username: "student", password: "student", role: "student", fullName: "Студент Тестовый" },
      teacher: { username: "teacher", password: "teacher", role: "teacher", fullName: "Преподаватель Тестовый" },
      admin: { username: "admin", password: "admin", role: "admin", fullName: "Администратор Тестовый" },
      superadmin: { username: "superadmin", password: "superadmin", role: "superadmin", fullName: "Главный Администратор" },
    }

    const testUser = testUsers[normalizedUsername]
    if (testUser && testUser.password === normalizedPassword) {
      logInfo("Тестовый пользователь авторизован", normalizedUsername, testUser.role, "login")
      return jsonWithSessionCookie(
        {
          success: true,
          user: {
            username: testUser.username,
            role: testUser.role as UserRole,
            additionalRoles: [],
            email: testUser.email,
            fullName: testUser.fullName,
            middleName: undefined,
          },
        },
        {
          username: testUser.username,
          role: testUser.role,
          additionalRoles: [],
        },
      )
    }

    logError("Неудачная попытка входа", `Invalid credentials for ${username}`, username, undefined, "login")
    return NextResponse.json({ success: false, error: "Неверный логин или пароль" }, { status: 401 })
  } catch (error) {
    logError("Ошибка при авторизации", error instanceof Error ? error : String(error), undefined, undefined, "login")
    return NextResponse.json({ success: false, error: "Ошибка при авторизации" }, { status: 500 })
  }
}
