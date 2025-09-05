// src/bot/flows/subscriptionFlow.ts
import type { Bot } from 'grammy'
import { InlineKeyboard } from 'grammy'
import type { MyContext } from '../helpers/state.js'
import { mainKb } from '../keyboards.js'

/** Продающий текст (HTML) */
function subscribeText(): string {
	return [
		'🔑 <b>Что даёт подписка AI‑Сонник?</b>',
		'',
		'🔮 <b>Безлимитные разборы снов</b> — глубже и точнее, чем обычные сонники.',
		'💬 <b>Уточняющие вопросы</b> после каждого сна — коротко и по делу.',
		'🧘 <b>Духовные практики</b> — дыхание, медитации и вечерние ритуалы под ваш символический сюжет.',
		'📊 <b>Полный недельный обзор</b> — повторяющиеся символы, эмоции и скрытые тенденции.',
		'📂 <b>Экспорт дневника</b> — PDF, TXT или Markdown для вашей личной “книги снов”.',
		'',
		'⚡️ Подписка открывает путь к глубинному пониманию себя и превращает сны в личный навигатор.',
		'',
		'💫 <b>Тарифы:</b>',
		'▫ 1 неделя — 99 ₽ <i></i>',
		'🌟 1 месяц — 299 ₽ <i>(рекомендуем)</i>',
		'▫ 1 год — 2490 ₽ <i>(выгода ~30%)</i>',
	].join('\n')
}

/** Единая клавиатура: все тарифы → pay:open, плюс «Назад» */
function subscribeKb(): InlineKeyboard {
	return new InlineKeyboard()
		.text('1 неделя — 99 ₽', 'pay:open')
		.row()
		.text('🌟 1 месяц — 299 ₽', 'pay:open')
		.row()
		.text('1 год — 2490 ₽', 'pay:open')
		.row()
		.text('⬅️ Назад', 'pay:back')
}

/** Показ экрана подписки */
export async function sendSubscribeMessage(ctx: MyContext): Promise<void> {
	await ctx.reply(subscribeText(), {
		parse_mode: 'HTML',
		reply_markup: subscribeKb(),
	})
}

/** Регистрация обработчиков для pay:open / pay:back */
export function registerSubscriptionFlow(bot: Bot<MyContext>): void {
	// Открыть экран подписки из любых мест
	bot.callbackQuery('pay:open', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await sendSubscribeMessage(ctx)
	})

	// Назад в главное меню
	bot.callbackQuery('pay:back', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await ctx.reply('Главное меню:', { reply_markup: mainKb })
	})

	// Команда /pay на всякий случай
	bot.command('pay', sendSubscribeMessage)
}
