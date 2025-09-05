// src/core/promptVersioning.ts
import crypto from 'crypto'
import { logger } from '../util/logger.js'

interface PromptVersion {
  id: string
  version: string
  checksum: string
  content: string
  createdAt: Date
  metadata?: Record<string, any>
}

const promptVersions: PromptVersion[] = []
const promptRegistry = new Map<string, PromptVersion>()

export function registerPrompt(
  id: string, 
  content: string, 
  metadata?: Record<string, any>
): PromptVersion {
  const checksum = crypto.createHash('sha256').update(content).digest('hex').slice(0, 8)
  const version = `v${promptVersions.length + 1}-${checksum}`
  
  const promptVersion: PromptVersion = {
    id,
    version,
    checksum,
    content,
    createdAt: new Date(),
    metadata
  }
  
  promptVersions.push(promptVersion)
  promptRegistry.set(id, promptVersion)
  
  logger.info({
    promptId: id,
    version,
    checksum,
    contentLength: content.length,
    metadata
  }, 'Prompt registered')
  
  return promptVersion
}

// Получение текущей версии промпта
export function getPrompt(id: string): PromptVersion | undefined {
  return promptRegistry.get(id)
}

// Получение всех версий промпта
export function getPromptHistory(id: string): PromptVersion[] {
  return promptVersions.filter(p => p.id === id)
}

// Логирование использования промпта
export function logPromptUsage(
  promptVersion: PromptVersion, 
  correlationId: string,
  operation: string,
  additionalContext?: Record<string, any>
) {
  logger.info({
    correlationId,
    operation,
    promptId: promptVersion.id,
    promptVersion: promptVersion.version,
    promptChecksum: promptVersion.checksum,
    ...additionalContext
  }, 'Prompt used')
}

// Валидация промпта (проверка на изменения)
export function validatePromptIntegrity(id: string, expectedChecksum: string): boolean {
  const current = promptRegistry.get(id)
  if (!current) {
    logger.warn({ promptId: id }, 'Prompt not found in registry')
    return false
  }
  
  if (current.checksum !== expectedChecksum) {
    logger.warn({
      promptId: id,
      expectedChecksum,
      actualChecksum: current.checksum
    }, 'Prompt checksum mismatch detected')
    return false
  }
  
  return true
}

// Экспорт всех промптов для бэкапа
export function exportPrompts(): PromptVersion[] {
  return [...promptVersions]
}

// Статистика использования промптов
export function getPromptStats(): Record<string, any> {
  const stats: Record<string, any> = {}
  
  for (const [id, current] of promptRegistry.entries()) {
    const history = getPromptHistory(id)
    stats[id] = {
      currentVersion: current.version,
      currentChecksum: current.checksum,
      totalVersions: history.length,
      firstCreated: history[0]?.createdAt,
      lastUpdated: current.createdAt,
      contentLength: current.content.length
    }
  }
  
  return stats
}
