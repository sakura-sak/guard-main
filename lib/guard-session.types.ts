import type { UserRole } from "./auth"

/** Полезная нагрузка подписанной сессии (JSON → base64url + HMAC). */
export type GuardSessionPayload = {
  sub: string
  exp: number
  role: UserRole | string
  ar?: UserRole[]
  /** Last activity timestamp (ms). Missing on cookies issued before idle timeout. */
  act?: number
}
