"use client"

import type React from "react"

import { useState, useRef, useCallback } from "react"
import { Upload, X, Loader2, AlertCircle, CheckCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { parseFile, validateFile, type ParsedFile } from "@/lib/file-parser"

interface FileUploadProps {
  onFileProcessed: (result: ParsedFile, file: File) => void
  onError: (error: string) => void
  disabled?: boolean
  className?: string
}

export function FileUpload({ onFileProcessed, onError, disabled, className }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [currentFile, setCurrentFile] = useState<{ name: string; status: "processing" | "done" | "error" } | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const processFile = useCallback(
    async (file: File) => {
      const validation = validateFile(file)
      if (!validation.valid) {
        onError(validation.error || "Ошибка валидации файла")
        return
      }

      setIsProcessing(true)
      setCurrentFile({ name: file.name, status: "processing" })

      try {
        const result = await parseFile(file)

        if (result.wordCount < 10) {
          throw new Error("Файл содержит слишком мало текста (минимум 10 слов)")
        }

        setCurrentFile({ name: file.name, status: "done" })
        onFileProcessed(result, file)
      } catch (err) {
        setCurrentFile({ name: file.name, status: "error" })
        onError(err instanceof Error ? err.message : "Ошибка при обработке файла")
      } finally {
        setIsProcessing(false)
      }
    },
    [onFileProcessed, onError],
  )

  const handleDragOver = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      if (!disabled && !isProcessing) {
        setIsDragging(true)
      }
    },
    [disabled, isProcessing],
  )

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)

      if (disabled || isProcessing) return

      const file = e.dataTransfer.files[0]
      if (file) {
        processFile(file)
      }
    },
    [disabled, isProcessing, processFile],
  )

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0]
      if (file) {
        processFile(file)
      }
      // Reset input
      if (fileInputRef.current) {
        fileInputRef.current.value = ""
      }
    },
    [processFile],
  )

  const clearFile = useCallback(() => {
    setCurrentFile(null)
  }, [])

  return (
    <Card className={className}>
      <CardContent className="p-6">
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx"
          onChange={handleFileSelect}
          className="hidden"
          disabled={disabled || isProcessing}
        />

        {!currentFile ? (
          <div
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => !disabled && !isProcessing && fileInputRef.current?.click()}
            className={`
              border-2 border-dashed rounded-lg p-8 text-center cursor-pointer
              transition-all duration-200
              ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-muted/50"
              }
              ${disabled || isProcessing ? "opacity-50 cursor-not-allowed" : ""}
            `}
          >
            <Upload className="h-12 w-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg font-medium mb-2">Перетащите файл или нажмите, чтобы загрузить</p>
            <p className="text-sm text-muted-foreground">Поддерживаемые форматы: DOCX, PDF | Макс. 20 МБ.</p>
          </div>
        ) : (
          <div className="flex items-center gap-4 p-4 bg-muted/50 rounded-lg overflow-hidden">
            <div className="flex-shrink-0">
              {currentFile.status === "processing" && <Loader2 className="h-8 w-8 text-primary animate-spin" />}
              {currentFile.status === "done" && <CheckCircle className="h-8 w-8 text-green-600" />}
              {currentFile.status === "error" && <AlertCircle className="h-8 w-8 text-destructive" />}
            </div>
            <div className="flex-1 min-w-0 overflow-hidden">
              <p className="font-medium truncate" title={currentFile.name}>
                {currentFile.name}
              </p>
              <p className="text-sm text-muted-foreground">
                {currentFile.status === "processing" && "Извлечение текста..."}
                {currentFile.status === "done" && "Файл обработан"}
                {currentFile.status === "error" && "Ошибка обработки"}
              </p>
            </div>
            {currentFile.status !== "processing" && (
              <Button
                variant="ghost"
                size="icon"
                onClick={(e) => {
                  e.stopPropagation()
                  clearFile()
                }}
                className="flex-shrink-0"
              >
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
