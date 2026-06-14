/**
 * Русские названия типов работ для отображения в UI.
 * Используется в клиентских компонентах (без Node.js). Динамические типы из document-types
 * подставляются через API или передаются явно там, где нужны.
 */

export const CATEGORY_LABELS: Record<string, string> = {
  diploma: "Дипломная работа",
  coursework: "Курсовая работа / Проект",
  lab: "Лабораторная работа",
  practice: "Практическое задание",
  uncategorized: "Не указано",
}

export function categoryLabel(cat?: string): string {
  if (!cat) return "Не указано"
  return CATEGORY_LABELS[cat] ?? cat
}
