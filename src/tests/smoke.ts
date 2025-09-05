// src/tests/smoke.ts
import { config } from '../util/config.js'
import { logger } from '../util/logger.js'
import { PrismaClient } from '@prisma/client'

async function smokeTest() {
  logger.info('Starting smoke tests...')
  
  try {
    // Test 1: Config validation
    logger.info('✓ Config loaded successfully')
    console.log('Bot token length:', config.BOT_TOKEN.length)
    console.log('Admin IDs count:', config.ADMIN_IDS.size)
    
    // Test 2: Database connection
    const prisma = new PrismaClient()
    await prisma.$connect()
    logger.info('✓ Database connection successful')
    
    // Test 3: Basic query
    const userCount = await prisma.user.count()
    logger.info(`✓ Database query successful (${userCount} users)`)
    
    await prisma.$disconnect()
    
    // Test 4: Error classes
    const { LLMValidationError } = await import('../types/errors.js')
    const testError = new LLMValidationError('Test error')
    if (testError.name === 'LLMValidationError') {
      logger.info('✓ Error classes working')
    }
    
    // Test 5: Metrics (if enabled)
    if (config.features.metrics) {
      const { trackLLMCall } = await import('../util/metrics.js')
      const testPromise = Promise.resolve({ test: 'data' })
      await trackLLMCall('test', 'gpt-3.5-turbo', testPromise)
      logger.info('✓ Metrics tracking working')
    }
    
    logger.info('🎉 All smoke tests passed!')
    process.exit(0)
    
  } catch (error) {
    logger.error({ error }, '❌ Smoke test failed')
    process.exit(1)
  }
}

smokeTest()
