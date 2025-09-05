// src/core/scheduler.ts
import type { Bot, Context } from 'grammy'
import { DateTime } from 'luxon'
import cron from 'node-cron'

import { getAllUsers, markReminderSent, ensureMonthlyReset } from '../db/repo.js'
import { isNowAt, nowInZone } from '../util/dates.js'
import { logger } from '../util/logger.js'

// Принимаем любой Bot с кастомным контекстом (совместимо с Bot<MyContext>)
export function startScheduler<C extends Context>(bot: Bot<C>): void {
	// Каждую минуту
	cron.schedule('* * * * *', async () => {
		try {
			const users = await getAllUsers()

			for (const u of users) {
				await ensureMonthlyReset(u.id)
				const zone = u.timezone || 'UTC'
				const nowZ = nowInZone(zone) // локальное время пользователя

				// === Утреннее напоминание ===
				const morningHHMM = u.remindMorning ?? u.wakeTime ?? null;
				if (u.remindersEnabled && morningHHMM) {
					const alreadyToday = u.lastMorningSent
						? nowZ.hasSame(
								DateTime.fromJSDate(u.lastMorningSent).setZone(zone),
								'day'
						  )
						: false

					if (!alreadyToday && isNowAt(zone, morningHHMM)) {
						await bot.api.sendMessage(
							Number(u.tgId),
							'☀️ Доброе утро! Запишите сон, пока он свежий: /sleep'
						)
						await markReminderSent(u.id, 'morning', new Date())
					}
				}

				// === Вечернее напоминание ===
				const eveningHHMM = u.remindEvening ?? u.sleepTime ?? null;
				if (u.remindersEnabled && eveningHHMM) {
					const alreadyToday = u.lastEveningSent
						? nowZ.hasSame(
								DateTime.fromJSDate(u.lastEveningSent).setZone(zone),
								'day'
						  )
						: false

					if (!alreadyToday && isNowAt(zone, eveningHHMM)) {
						await bot.api.sendMessage(
							Number(u.tgId),
							'🌙 Время готовиться ко сну. Перед сном сформулируйте намерение: «Хочу запомнить свой сон». Утром — /sleep.'
						)
						await markReminderSent(u.id, 'evening', new Date())
					}
				}

				// === Недельный отчёт ===
				if (u.weeklyEnabled) {
					// В нашей БД: 0 = воскресенье, 1 = понедельник, ... 6 = суббота
					// В Luxon: weekday = 1..7 (Mon..Sun)
					const targetLuxonWeekday =
						(u.weeklyDay ?? 0) === 0 ? 7 : (u.weeklyDay as number) // 0→7, остальное без изменений
					const hour = u.weeklyHour ?? 10

					const alreadyThisWeek = u.lastWeeklySent
						? nowZ.hasSame(
								DateTime.fromJSDate(u.lastWeeklySent).setZone(zone),
								'week'
						  )
						: false

					if (
						!alreadyThisWeek &&
						nowZ.weekday === targetLuxonWeekday &&
						nowZ.hour === hour &&
						nowZ.minute === 0
					) {
						// Пока заглушка — позже подставим ИИ-сводку
						await bot.api.sendMessage(
							Number(u.tgId),
							'🧭 Недельный обзор: скоро здесь будут повторяющиеся символы и мягкие практики. (Контент подключим позже.)'
						)
						await markReminderSent(u.id, 'weekly', new Date())
					}
				}
			}
		} catch (e) {
			logger.error({ e }, 'scheduler tick failed')
		}
	})
}

