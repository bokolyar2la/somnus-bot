/**
 * Примерные цены. Подставь свои при смене провайдера.
 * Базовая валюта – USD; конвертим в RUB по env RUB_PER_USD.
 */
const USD_PER_INPUT_1K = Number(process.env.USD_PER_INPUT_1K ?? '0.0005') // пример для mini-модели
const USD_PER_OUTPUT_1K = Number(process.env.USD_PER_OUTPUT_1K ?? '0.0015')
const RUB_PER_USD = Number(process.env.RUB_PER_USD ?? '95') // подстрой под реальность

export function estimateCostRub(tokensIn: number, tokensOut: number): number {
  const inUSD = (tokensIn / 1000) * USD_PER_INPUT_1K
  const outUSD = (tokensOut / 1000) * USD_PER_OUTPUT_1K
  const totalUSD = inUSD + outUSD
  return Math.round(totalUSD * RUB_PER_USD * 100) / 100 // 2 знака
}

