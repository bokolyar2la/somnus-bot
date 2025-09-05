import { Bot } from 'grammy'
import { getOrCreateUser, updateUser } from '../../db/repo.js'
import { nowInZone } from '../../util/dates.js'
import { isValidHHMM, mapRuWeekdayToIndex } from '../helpers/parse.js'
import type { MyContext } from '../helpers/state.js'
import { mainKb, remindersKb, weeklyKb } from '../keyboards.js'

const weekDays = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб']

export async function openRemindersMenu(ctx: MyContext) {
	const userId = ctx.from?.id.toString()
	if (!userId) {
		await ctx.reply('Произошла ошибка, не могу определить ваш ID.')
		return
	}
	const user = await getOrCreateUser(userId)
	ctx.session.conversation = { stage: 'remindersMenu', type: 'reminders' }

	const timezone = user.timezone || 'Не установлено'
	const remindMorning = user.remindMorning || 'Отключено'
	const remindEvening = user.remindEvening || 'Отключено'
	const remindersStatus = user.remindersEnabled ? 'включены' : 'отключены'
	const reportStatus = user.weeklyEnabled
		? `включён, ${weekDays[user.weeklyDay ?? 0]} ${
				user.weeklyHour ?? 10
		  }:00 (локально)`
		: 'отключён'

	await ctx.reply(
		[
			'🔔 <b>Напоминания</b>',
			`Таймзона: ${timezone}`,
			`Утро: ${remindMorning}`,
			`Вечер: ${remindEvening}`,
			`Статус: ${remindersStatus}`,
			'',
			`🗓 <b>Отчёт по снам</b>: ${reportStatus}`,
		].join('\n'),
		{ parse_mode: 'HTML', reply_markup: remindersKb }
	)
}

export async function handleRemindersCommand(ctx: MyContext) {
	await openRemindersMenu(ctx);
}

export function registerRemindersFlow(bot: Bot<MyContext>) {
	bot.command('reminders', handleRemindersCommand)

	bot.callbackQuery('reminders:menu', async ctx => {
		await ctx.answerCallbackQuery().catch(() => {})
		await openRemindersMenu(ctx)
	})

	bot.hears('Установить утреннее', async ctx => {
		ctx.session.conversation = {
			stage: 'awaitingMorningTime',
			type: 'reminders',
			prop: 'remindMorning',
		}
		await ctx.reply('Введите время в формате HH:MM (24ч), например 08:30')
	})

	bot.hears('Установить вечернее', async ctx => {
		ctx.session.conversation = {
			stage: 'awaitingEveningTime',
			type: 'reminders',
			prop: 'remindEvening',
		}
		await ctx.reply('Введите время в формате HH:MM (24ч), например 22:45')
	})

	bot.hears('Выбрать таймзону', async ctx => {
		ctx.session.conversation = {
			stage: 'awaitingTimezone',
			type: 'reminders',
			prop: 'timezone',
		}
		await ctx.reply('Введите вашу таймзону (IANA), например Europe/Moscow')
	})

	bot.hears('Вкл/Выкл напоминания', async ctx => {
		const userId = ctx.from?.id.toString()
		if (!userId) return
		const user = await getOrCreateUser(userId)
		await updateUser(userId, { remindersEnabled: !user.remindersEnabled })
		await ctx.reply(
			`Напоминания ${!user.remindersEnabled ? 'включены' : 'отключены'}.`,
			{ reply_markup: remindersKb }
		)
		await handleRemindersCommand(ctx)
	})

	// Настройки «Отчёта по снам»
	bot.hears('Настроить отчёт по снам', async ctx => {
		await ctx.reply('Настройки отчёта по снам:', { reply_markup: weeklyKb })
	})

	bot.hears('Вкл/Выкл отчёт', async ctx => {
		const userId = ctx.from?.id.toString()
		if (!userId) return
		const user = await getOrCreateUser(userId)
		await updateUser(userId, { weeklyEnabled: !user.weeklyEnabled })
		await ctx.reply(
			`Отчёт по снам ${!user.weeklyEnabled ? 'включён' : 'отключён'}.`,
			{ reply_markup: weeklyKb }
		)
		await handleRemindersCommand(ctx)
	})

	bot.hears('Выбрать день недели', async ctx => {
		ctx.session.conversation = {
			stage: 'awaitingWeeklyDay',
			type: 'reminders',
			prop: 'weeklyDay',
		}
		await ctx.reply('Введите день недели (вс, пн, вт, ср, чт, пт, сб)')
	})

	bot.hears('Выбрать час', async ctx => {
		ctx.session.conversation = {
			stage: 'awaitingWeeklyHour',
			type: 'reminders',
			prop: 'weeklyHour',
		}
		await ctx.reply('Введите час (0–23), например 10')
	})

	// Навигация
	bot.hears('⬅️ Назад', async ctx => {
		delete ctx.session.conversation
		await ctx.reply('Главное меню:', { reply_markup: mainKb })
	})

	bot.hears('⬅️ Назад к напоминаниям', async ctx => {
		ctx.session.conversation = { stage: 'remindersMenu', type: 'reminders' }
		await handleRemindersCommand(ctx)
	})
}

export async function handleRemindersMessage(ctx: MyContext): Promise<boolean> {
	const conversation = ctx.session.conversation
	const userId = ctx.from?.id.toString()

	if (!userId || !conversation || conversation.type !== 'reminders') {
		return false // Сообщение не относится к этому flow
	}

	const text = ctx.message?.text?.trim()
	if (!text) {
		await ctx.reply('Пожалуйста, введите значение.')
		return true
	}

	if (
		conversation.stage === 'awaitingMorningTime' ||
		conversation.stage === 'awaitingEveningTime'
	) {
		if (!isValidHHMM(text)) {
			await ctx.reply(
				'Неверный формат времени. Введите HH:MM (24ч), например 08:30'
			)
			return true
		}
		await updateUser(userId, { [conversation.prop!]: text })
		delete ctx.session.conversation
		await ctx.reply(
			`Готово! ${
				conversation.stage === 'awaitingMorningTime' ? 'Утреннее' : 'Вечернее'
			} напоминание: ${text} (локально).`,
			{ reply_markup: remindersKb }
		)
		return true
	}

	if (conversation.stage === 'awaitingTimezone') {
		try {
			nowInZone(text) // валидация таймзоны
			await updateUser(userId, { timezone: text })
			delete ctx.session.conversation
			await ctx.reply(`Готово! Таймзона установлена: ${text}.`, {
				reply_markup: remindersKb,
			})
			return true
		} catch {
			await ctx.reply(
				'Неверный формат таймзоны. Введите IANA таймзону, например Europe/Moscow.'
			)
			return true
		}
	}

	if (conversation.stage === 'awaitingWeeklyDay') {
		const dayIndex = mapRuWeekdayToIndex(text)
		if (dayIndex === -1) {
			await ctx.reply(
				'Неверный день недели. Введите один из: вс, пн, вт, ср, чт, пт, сб.'
			)
			return true
		}
		await updateUser(userId, { weeklyDay: dayIndex })
		delete ctx.session.conversation
		await ctx.reply(`Готово! Отчёт по снам будет приходить по ${text}.`, {
			reply_markup: weeklyKb,
		})
		return true
	}

	if (conversation.stage === 'awaitingWeeklyHour') {
		const hour = Number(text)
		if (Number.isNaN(hour) || hour < 0 || hour > 23) {
			await ctx.reply('Неверный час. Введите число от 0 до 23.')
			return true
		}
		await updateUser(userId, { weeklyHour: hour })
		delete ctx.session.conversation
		await ctx.reply(`Готово! Отчёт по снам будет приходить в ${hour}:00.`, {
			reply_markup: weeklyKb,
		})
		return true
	}

	return false // Неизвестное состояние или не обработано
}
