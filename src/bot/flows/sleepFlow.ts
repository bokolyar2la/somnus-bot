import { Bot, InlineKeyboard } from 'grammy'
import { createDreamEntry, getOrCreateUser } from '../../db/repo.js'
import { MyContext } from '../helpers/state.js'

export async function openSleepInput(ctx: MyContext) {
	if (!ctx.from?.id) {
		return ctx.reply('Произошла ошибка, не могу определить ваш ID.')
	}
	// очищаем промежуточное состояние
	ctx.session.conversation = { stage: 'awaitingText', type: 'sleep' }
	await ctx.reply('✍️ Пожалуйста, опишите Ваш сон для последующего разбора')
}

export async function handleSleepCommand(ctx: MyContext) {
	await openSleepInput(ctx)
}

export async function handleNapCommand(ctx: MyContext) {
	if (!ctx.from?.id) {
		return ctx.reply('Произошла ошибка, не могу определить ваш ID.')
	}
	ctx.session.conversation = { stage: 'awaitingText', type: 'nap' }
	await ctx.reply(
		'✍️ Пожалуйста, опишите Ваш дневной сон для последующего разбора'
	)
}

export function registerSleepFlow(bot: Bot<MyContext>) {
	bot.command('sleep', handleSleepCommand)
	bot.command('nap', handleNapCommand)
}

export async function handleSleepMessage(ctx: MyContext): Promise<boolean> {
	const conversation = ctx.session.conversation
	const userId = ctx.from?.id.toString()

	if (
		!userId ||
		!conversation ||
		(conversation.type !== 'sleep' && conversation.type !== 'nap')
	) {
		return false // Сообщение не относится к этому flow
	}

	if (conversation.stage === 'awaitingText') {
		const text = ctx.message?.text?.trim()
		if (!text || text.length < 5) {
			await ctx.reply(
				'Похоже, текст пустой. Отправьте, пожалуйста, краткое описание сна (минимум 5 символов).'
			)
			return true
		}

		// Сохраняем запись сна
		const user = await getOrCreateUser(userId)
		const entry = await createDreamEntry(user.id, {
			sleptAt: new Date(),
			text,
			symbolsRaw: undefined, // LLM сам извлечёт
		})

		// ВАЖНО: всегда даём «Разобрать сейчас» — без каких-либо блокировок или просьб заполнить профиль
		const kb = new InlineKeyboard().text(
			'🔮 Разобрать сейчас',
			`interpret:${entry.id}`
		)

		await ctx.reply(
			'✅ Сон сохранён. Я сам отмечу символы при разборе и учту их в отчёте.',
			{
				reply_markup: kb,
			}
		)

		// очищаем состояние диалога
		delete ctx.session.conversation
		return true
	}

	return false
}
