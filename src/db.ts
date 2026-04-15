export type HabitPhase = 'morning' | 'afterWork' | 'beforeBed'
export type ReportingType = 'button' | 'text' | 'emotion' | 'mood'
export type FrequencyPeriod = 'day' | 'week'

export interface DesiredFrequency {
  count: number
  per: FrequencyPeriod
}

export interface SrhiReport {
  id: string
  createdAt: string
  scores: [number, number, number, number]
}

export interface Habit {
  id: string
  name: string
  description: string
  desiredFrequency: DesiredFrequency
  difficultyK: number
  streakBreaks: number
  phase: HabitPhase
  reportingType: ReportingType
  srhiReports: SrhiReport[]
  createdAt: string
  archived: boolean
}

export interface HabitLog {
  id: string
  habitId: string
  dayKey: string
  completedAt: string
  reportValue: string
}

export interface PersistedState {
  habits: Habit[]
  logs: HabitLog[]
}

const DB_NAME = 'habit-feed-db'
const DB_VERSION = 1
const STORE_NAME = 'kv'
const APP_STATE_KEY = 'habit-feed-state'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => resolve(request.result)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME)
      }
    }
  })
}

function asNumber(value: unknown, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function normalizeFrequency(value: unknown): DesiredFrequency {
  if (value && typeof value === 'object') {
    const candidate = value as Partial<DesiredFrequency>
    const count = clamp(Math.round(asNumber(candidate.count, 1)), 1, 14)
    const per = candidate.per === 'week' ? 'week' : 'day'
    return { count, per }
  }

  if (typeof value === 'string') {
    const lower = value.toLowerCase()
    if (lower.includes('week')) {
      const parsed = asNumber(lower.match(/\d+/)?.[0], 3)
      return { count: clamp(Math.round(parsed), 1, 14), per: 'week' }
    }
    return { count: 1, per: 'day' }
  }

  return { count: 1, per: 'day' }
}

function normalizeDifficultyK(value: unknown, legacyDifficulty?: unknown): number {
  const direct = asNumber(value, NaN)
  if (Number.isFinite(direct)) {
    return clamp(direct, 0.01, 0.12)
  }

  if (legacyDifficulty === 'difficult') {
    return 0.02
  }
  return 0.05
}

function normalizeSrhiReports(value: unknown, legacyScores?: unknown): SrhiReport[] {
  if (Array.isArray(value)) {
    return value
      .map((entry) => {
        if (!entry || typeof entry !== 'object') {
          return null
        }
        const candidate = entry as Partial<SrhiReport>
        if (!Array.isArray(candidate.scores) || candidate.scores.length !== 4) {
          return null
        }

        const scores = candidate.scores.map((score) =>
          clamp(Math.round(asNumber(score, 4)), 1, 7),
        ) as [number, number, number, number]

        return {
          id: typeof candidate.id === 'string' ? candidate.id : crypto.randomUUID(),
          createdAt:
            typeof candidate.createdAt === 'string'
              ? candidate.createdAt
              : new Date().toISOString(),
          scores,
        }
      })
      .filter((report): report is SrhiReport => report !== null)
  }

  if (Array.isArray(legacyScores) && legacyScores.length === 4) {
    const scores = legacyScores.map((score) =>
      clamp(Math.round(asNumber(score, 4)), 1, 7),
    ) as [number, number, number, number]
    return [
      {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        scores,
      },
    ]
  }

  return []
}

function normalizeHabit(value: unknown): Habit | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const habit = value as Record<string, unknown>
  if (typeof habit.id !== 'string' || typeof habit.name !== 'string') {
    return null
  }

  return {
    id: habit.id,
    name: habit.name,
    description: typeof habit.description === 'string' ? habit.description : '',
    desiredFrequency: normalizeFrequency(habit.desiredFrequency),
    difficultyK: normalizeDifficultyK(habit.difficultyK, habit.difficulty),
    streakBreaks: clamp(Math.round(asNumber(habit.streakBreaks, 0)), 0, 9999),
    phase:
      habit.phase === 'morning' || habit.phase === 'afterWork' || habit.phase === 'beforeBed'
        ? habit.phase
        : 'morning',
    reportingType:
      habit.reportingType === 'button' ||
      habit.reportingType === 'text' ||
      habit.reportingType === 'emotion' ||
      habit.reportingType === 'mood'
        ? habit.reportingType
        : 'button',
    srhiReports: normalizeSrhiReports(habit.srhiReports, habit.srhiScores),
    createdAt: typeof habit.createdAt === 'string' ? habit.createdAt : new Date().toISOString(),
    archived: Boolean(habit.archived),
  }
}

function normalizeLog(value: unknown): HabitLog | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  const log = value as Record<string, unknown>
  if (
    typeof log.id !== 'string' ||
    typeof log.habitId !== 'string' ||
    typeof log.dayKey !== 'string'
  ) {
    return null
  }

  return {
    id: log.id,
    habitId: log.habitId,
    dayKey: log.dayKey,
    completedAt: typeof log.completedAt === 'string' ? log.completedAt : new Date().toISOString(),
    reportValue: typeof log.reportValue === 'string' ? log.reportValue : '',
  }
}

function normalizePersistedState(value: unknown): PersistedState {
  if (!value || typeof value !== 'object') {
    return { habits: [], logs: [] }
  }

  const candidate = value as Partial<PersistedState>
  return {
    habits: Array.isArray(candidate.habits)
      ? candidate.habits
          .map((habit) => normalizeHabit(habit))
          .filter((habit): habit is Habit => habit !== null)
      : [],
    logs: Array.isArray(candidate.logs)
      ? candidate.logs.map((log) => normalizeLog(log)).filter((log): log is HabitLog => log !== null)
      : [],
  }
}

export async function loadPersistedState(): Promise<PersistedState> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readonly')
    const store = tx.objectStore(STORE_NAME)
    const request = store.get(APP_STATE_KEY)

    request.onerror = () => reject(request.error)
    request.onsuccess = () => {
      const value = request.result as unknown
      if (!value) {
        resolve({ habits: [], logs: [] })
        return
      }

      resolve(normalizePersistedState(value))
    }
  })
}

export async function savePersistedState(state: PersistedState): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, 'readwrite')
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
    tx.objectStore(STORE_NAME).put(state, APP_STATE_KEY)
  })
}

export interface ExportData extends PersistedState {
  version: number
  exportedAt: string
}

export function toExportData(state: PersistedState): ExportData {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    habits: state.habits,
    logs: state.logs,
  }
}

export function fromImportedData(data: unknown): PersistedState | null {
  const normalized = normalizePersistedState(data)
  if (!normalized.habits.length && !normalized.logs.length) {
    return null
  }
  return normalized
}