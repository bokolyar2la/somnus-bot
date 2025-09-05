// src/bot/helpers/state.ts
import type { Context, SessionFlavor } from 'grammy'
import type { User } from "@prisma/client"; // Добавлен импорт User

export type ConversationSession = {
	type: 'sleep' | 'nap' | 'reminders' | 'profile' | 'followup' | 'profile_tz_manual'
	// опциональные поля для разных флоу
	stage?: string | 'awaitingTimezone' | 'awaiting_tz'
	prop?: string
	tmpText?: string
	entryId?: string // для followup
}

export interface SessionState {
	conversation?: ConversationSession
	exportPeriod?: '7' | '30' | '90' | 'all'
	followupsUsed?: number

	// ⇩ новое поле для вкладки "Дневник" в аналитике
	analyticsJournalPage?: number

	// Добавлены поля, которые вызывали ошибки
	onboarding?: {
		pendingEntryId?: string;
		active?: boolean;
		lastProfileNudgeAt?: string; // ISO date string
		firstInterpretDone?: boolean;
	}
	sleepWizard?: {
		step: 'wake' | 'bed';
	}
	cachedUser?: {
		data: User;
		lastFetchedAt: number;
		tgId: string;
	}; // Для кэширования пользователя
	correlationId?: string; // Для логирования
}

export function initSession(): SessionState {
	return {
		conversation: undefined,
		exportPeriod: undefined,
		followupsUsed: 0,

		// ⇩ дефолтная страница журнала
		analyticsJournalPage: 0,
		onboarding: undefined,
		sleepWizard: undefined,
		cachedUser: undefined,
		correlationId: undefined,
	}
}

export type MyContext = Context & SessionFlavor<SessionState>
