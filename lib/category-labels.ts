/**
 * Русские названия типов работ для отображения в UI.
 * Используется в клиентских компонентах (без Node.js). Динамические типы из document-types
 * подставляются через API или передаются явно там, где нужны.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  diploma: "Дипломная работа / проект",
  coursework: "Курсовая работа / проект",
  lab: "Лабораторная работа",
  practice: "Практическая работа",
  article: "Статьи",
  uncategorized: "Не указано",
}

export function categoryLabel(cat?: string): string {
  if (!cat) return "Не указано"
  return CATEGORY_LABELS[cat] ?? cat
}
