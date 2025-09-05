// src/db/optimizations.ts
import { PrismaClient } from '@prisma/client'
import { logger } from '../util/logger.js'
import { config } from '../util/config.js'

export async function optimizeSQLite(prisma: PrismaClient) {
  try {
    logger.info('Starting SQLite optimizations...')
    
    // Включаем WAL режим для лучшей производительности
    await prisma.$executeRaw`PRAGMA journal_mode = WAL;`
    logger.info('WAL mode enabled')
    
    // Настройка синхронизации для баланса производительности/надежности
    await prisma.$executeRaw`PRAGMA synchronous = NORMAL;`
    logger.info('Synchronous mode set to NORMAL')
    
    // Увеличиваем размер кэша (в страницах по 4KB)
    await prisma.$executeRaw`PRAGMA cache_size = -64000;` // ~64MB
    logger.info('Cache size set to 64MB')
    
    // Настройка временных таблиц в памяти
    await prisma.$executeRaw`PRAGMA temp_store = MEMORY;`
    logger.info('Temp store set to MEMORY')
    
    // Оптимизация для многопоточности
    await prisma.$executeRaw`PRAGMA busy_timeout = 30000;` // 30 секунд
    logger.info('Busy timeout set to 30 seconds')
    
    // Включаем foreign keys (если еще не включены)
    await prisma.$executeRaw`PRAGMA foreign_keys = ON;`
    logger.info('Foreign keys enabled')
    
    // Проверяем текущие настройки
    const walMode = await prisma.$queryRaw`PRAGMA journal_mode;`
    const syncMode = await prisma.$queryRaw`PRAGMA synchronous;`
    const cacheSize = await prisma.$queryRaw`PRAGMA cache_size;`
    
    logger.info({
      walMode,
      syncMode, 
      cacheSize
    }, 'SQLite optimizations applied successfully')
    
  } catch (error) {
    logger.error({ error }, 'Failed to apply SQLite optimizations')
    throw error
  }
}

// Функция для периодического VACUUM
export async function performMaintenance(prisma: PrismaClient) {
  try {
    logger.info('Starting database maintenance...')
    
    // Получаем статистику до очистки
    const statsBefore = await getDatabaseStats(prisma)
    
    // Выполняем VACUUM для дефрагментации
    await prisma.$executeRaw`VACUUM;`
    logger.info('VACUUM completed')
    
    // Обновляем статистику оптимизатора
    await prisma.$executeRaw`ANALYZE;`
    logger.info('ANALYZE completed')
    
    // Получаем статистику после очистки
    const statsAfter = await getDatabaseStats(prisma)
    
    logger.info({
      before: statsBefore,
      after: statsAfter,
      spaceSaved: statsBefore.pageSize * (statsBefore.pageCount - statsAfter.pageCount)
    }, 'Database maintenance completed')
    
  } catch (error) {
    logger.error({ error }, 'Database maintenance failed')
    throw error
  }
}

// Получение статистики базы данных
export async function getDatabaseStats(prisma: PrismaClient) {
  try {
    const [pageCount] = await prisma.$queryRaw<[{ page_count: number }]>`PRAGMA page_count;`
    const [pageSize] = await prisma.$queryRaw<[{ page_size: number }]>`PRAGMA page_size;`
    const [freelistCount] = await prisma.$queryRaw<[{ freelist_count: number }]>`PRAGMA freelist_count;`
    const [walCheckpoint] = await prisma.$queryRaw<[{ wal_checkpoint: string }]>`PRAGMA wal_checkpoint;`
    
    return {
      pageCount: pageCount.page_count,
      pageSize: pageSize.page_size,
      freelistCount: freelistCount.freelist_count,
      totalSize: pageCount.page_count * pageSize.page_size,
      freeSpace: freelistCount.freelist_count * pageSize.page_size,
      walCheckpoint: walCheckpoint.wal_checkpoint
    }
  } catch (error) {
    logger.error({ error }, 'Failed to get database stats')
    throw error
  }
}

// Функция для создания резервной копии
export async function createBackup(prisma: PrismaClient, backupPath: string) {
  try {
    logger.info({ backupPath }, 'Creating database backup...')
    
    // Создаем резервную копию с помощью VACUUM INTO
    await prisma.$executeRaw`VACUUM INTO ${backupPath};`
    
    logger.info({ backupPath }, 'Database backup created successfully')
  } catch (error) {
    logger.error({ error, backupPath }, 'Failed to create database backup')
    throw error
  }
}

// Планировщик обслуживания базы данных
export function startMaintenanceScheduler(prisma: PrismaClient) {
  if (!config.features.dbMaintenance) {
    logger.info('Database maintenance scheduler disabled')
    return
  }
  
  // Выполняем ANALYZE каждые 6 часов
  setInterval(async () => {
    try {
      await prisma.$executeRaw`ANALYZE;`
      logger.debug('Scheduled ANALYZE completed')
    } catch (error) {
      logger.error({ error }, 'Scheduled ANALYZE failed')
    }
  }, 6 * 60 * 60 * 1000)
  
  // Выполняем полное обслуживание каждые 24 часа
  setInterval(async () => {
    try {
      await performMaintenance(prisma)
      logger.info('Scheduled maintenance completed')
    } catch (error) {
      logger.error({ error }, 'Scheduled maintenance failed')
    }
  }, 24 * 60 * 60 * 1000)
  
  // Создаем резервную копию каждые 12 часов (если включено)
  if (config.backup?.enabled) {
    setInterval(async () => {
      try {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
        const backupPath = `${config.backup.path}/backup-${timestamp}.db`
        await createBackup(prisma, backupPath)
        logger.info({ backupPath }, 'Scheduled backup completed')
      } catch (error) {
        logger.error({ error }, 'Scheduled backup failed')
      }
    }, 12 * 60 * 60 * 1000)
  }
  
  logger.info('Database maintenance scheduler started')
}
