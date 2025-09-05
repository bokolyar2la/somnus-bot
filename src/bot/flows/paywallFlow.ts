import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../helpers/state.js'
import { getOrCreateUser, setPlan } from '../../db/repo.js'
import { safePlan } from '../../core/pricing.js'

export function registerPaywallFlow(bot: Bot<MyContext>) {
  // Админ: /admin_plan <@username|tgId> <plan>
  bot.command('admin_plan', async (ctx) => {
    const parts = ctx.message?.text?.trim().split(/\s+/) ?? []
    if (parts.length < 3) return ctx.reply('usage: /admin_plan <tgId> <free|paid>')
    const targetTgId = parts[1]
    const plan = safePlan(parts[2])
    await setPlan(targetTgId, plan, 6) // например на 6 мес
    return ctx.reply('ok')
  })
}

