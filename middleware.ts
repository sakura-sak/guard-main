// Middleware disabled: frontend auth is handled by the static HTML pages.
// API routes are protected individually via require-session-api / require-admin-api helpers.
export function middleware() {}

export const config = {
  matcher: [],
}
