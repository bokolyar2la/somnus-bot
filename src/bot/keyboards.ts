import { Bot, Context, InlineKeyboard, Keyboard } from 'grammy'
import { config } from '../util/config.js'
import { logger } from '../util/logger.js'

export const mainKb = new Keyboard()
	.text('🛌 Записать сон')
	.text('📊 Аналитика')
	.row()
	.text('🔔 Напоминания')
	.text('📋 Отчёт по снам')
	.row()
	.text('👤 Профиль')
	.text('📤 Экспорт')
	.row()
	.text('💳 Подписка')
	.resized()

export const remindersKb = new Keyboard()
	.text('Установить утреннее')
	.text('Установить вечернее')
	.row()
	.text('Выбрать таймзону')
	.text('Вкл/Выкл напоминания')
	.row()
	.text('Настроить отчёт по снам')
	.row()
	.text('⬅️ Назад')
	.row()

// 🔹 НОВОЕ: клавиатура для настроек отчёта по снам (бывш. weekly)
export const weeklyKb = new Keyboard()
	.text('Вкл/Выкл отчёт')
	.row()
	.text('Выбрать день недели')
	.text('Выбрать час')
	.row()
	.text('⬅️ Назад к напоминаниям')
	.resized()

// Обновляем команды в боте (без /nap)
export async function registerCommands<C extends Context>(bot: Bot<C>) {
	await bot.api.setMyCommands([
		{ command: 'start', description: 'Начать работу' },
		{ command: 'sleep', description: 'Записать ночной сон' },
		{ command: 'reminders', description: 'Напоминания и время' },
		{ command: 'profile', description: 'Профиль и настройки' },
		{ command: 'report', description: 'Отчёт по снам' },
		{ command: 'export', description: 'Экспорт дневника' },
		{ command: 'help', description: 'Справка по командам' },
		{ command: 'menu', description: 'Главное меню' },
		{ command: 'pay', description: 'Планы и подписка' },
	])
}
