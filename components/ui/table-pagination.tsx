"use client"

import { Button } from "@/components/ui/button"

interface TablePaginationProps {
  totalItems: number
  pageSize: number
  currentPage: number
  onPrevious: () => void
  onNext: () => void
  className?: string
}

export function TablePagination({
  totalItems,
  pageSize,
  currentPage,
  onPrevious,
  onNext,
  className,
}: TablePaginationProps) {
  if (totalItems <= 0) return null

  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(Math.max(1, currentPage), totalPages)
  const from = (safePage - 1) * pageSize + 1
  const to = Math.min(safePage * pageSize, totalItems)

  return (
    <div className={`mt-4 flex items-center justify-between gap-3 ${className ?? ""}`}>
      <p className="text-sm text-muted-foreground">
        Показано {from}-{to} из {totalItems}
      </p>
      <div className="flex items-center gap-2">
        <Button variant="outline" size="sm" disabled={safePage <= 1} onClick={onPrevious}>
          Назад
        </Button>
        <span className="text-sm text-muted-foreground">
          Страница {safePage} из {totalPages}
        </span>
        <Button variant="outline" size="sm" disabled={safePage >= totalPages} onClick={onNext}>
          Вперёд
        </Button>
      </div>
    </div>
  )
}
