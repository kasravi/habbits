import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type CSSProperties } from 'react'
import * as d3 from 'd3'
import {
  type Habit,
  type HabitLog,
  type HabitPhase,
  type ReportingType,
  type SrhiReport,
  fromImportedData,
  loadPersistedState,
  savePersistedState,
  toExportData,
} from './db'
import {
  type DriveBackupSettings,
  defaultDriveBackupSettings,
  loadDriveBackupSettings,
  restoreBackupFromDrive,
  saveDriveBackupSettings,
  uploadBackupToDrive,
} from './driveBackup'
import { analyzeFaceSentiment } from './faceSentiment'
import emotionsData from '../emotions.json'

type TimedPhase = Exclude<HabitPhase, 'anytime'>

const TIMED_PHASE_ORDER: TimedPhase[] = ['morning', 'afterWork', 'beforeBed']
const PHASE_OPTIONS: HabitPhase[] = [...TIMED_PHASE_ORDER, 'anytime']
const PHASE_LABELS: Record<HabitPhase, string> = {
  morning: 'Morning',
  afterWork: 'After work',
  beforeBed: 'Before bed',
  anytime: 'Anytime',
}
const PHASE_LABELS_FA: Record<HabitPhase, string> = {
  morning: 'صبح',
  afterWork: 'بعد از کار',
  beforeBed: 'قبل خواب',
  anytime: 'هر زمان',
}

const REPORTING_LABELS: Record<ReportingType, string> = {
  button: 'Simple button',
  text: 'Journal + sentiment',
  emotion: 'Emotion wheel',
  mood: 'Mood emoji',
  photo: 'Photo journal',
  selfie: 'Selfie + face tone',
}
const REPORTING_LABELS_FA: Record<ReportingType, string> = {
  button: 'دکمه ساده',
  text: 'ژورنال + احساس',
  emotion: 'چرخه احساسات',
  mood: 'ایموجی حال',
  photo: 'ژورنال تصویری',
  selfie: 'سلفی + حال چهره',
}

const FACE_TONE_LABELS = {
  joyful: 'Joyful',
  calm: 'Calm',
  flat: 'Flat',
  stressed: 'Stressed',
} as const

const FACE_TONE_LABELS_FA: Record<keyof typeof FACE_TONE_LABELS, string> = {
  joyful: 'شاد',
  calm: 'آرام',
  flat: 'خنثی',
  stressed: 'پرفشار',
}

const FACE_TONE_EMOJIS: Record<keyof typeof FACE_TONE_LABELS, string> = {
  joyful: '😄',
  calm: '🙂',
  flat: '😐',
  stressed: '😣',
}

const ENCOURAGEMENTS = [
  'Beautiful consistency. You showed up for yourself.',
  'You did enough for today. Gentle progress counts.',
  'Tiny action, big identity vote. Proud of you.',
  'You kept the promise to yourself. That matters.',
  'Steady and kind. Your system is working.',
]

const ENCOURAGEMENTS_FA = [
  'خیلی خوب پیش می‌ری. امروز هم به خودت وفادار موندی.',
  'همین قدم کوچک عالیه. پیوستگی مهم‌تر از کماله.',
  'آفرین. یک رأی دیگه به هویت جدیدت دادی.',
  'قولی که به خودت دادی رو نگه داشتی. ارزشمنده.',
  'آرام و پیوسته؛ مسیر درست همینه.',
]

const CARD_COMPASSION = [
  'Soft reminder: effort beats perfection.',
  'You are building trust with yourself.',
  'No pressure, just one caring rep.',
  'Small wins can still be life-changing.',
]

const CARD_COMPASSION_FA = [
  'یادآوری مهربان: تلاش از بی‌نقص بودن مهم‌تره.',
  'تو داری به خودت اعتماد می‌سازی.',
  'فشار لازم نیست؛ فقط یک قدم مهربانانه.',
  'بردهای کوچک هم می‌تونن زندگی‌ساز باشن.',
]

const HAZE_UI_STORAGE_KEY = 'habit-feed-haze-ui-v1'

const SRHI_TRIGGER_STRENGTH = 35
const MOOD_EMOJIS = ['😖', '🙁', '😕', '😐', '🙂', '😄', '🤩']

interface EmotionGroupRaw {
  Core?: string
  Aspects?: Record<string, string>
}

interface EmotionGroup {
  key: string
  labelEn: string
  labelFa: string
  color: string
  secondary: Array<{ en: string; fa: string }>
}

const EMOTION_COLORS: Record<string, string> = {
  Fear: '#8b5cf6',
  Anger: '#ef4444',
  Sadness: '#3b82f6',
  Enjoyment: '#f59e0b',
  Love: '#ec4899',
  Disgust: '#22c55e',
  Surprise: '#06b6d4',
  Shame: '#64748b',
}

const EMOTION_GROUPS: EmotionGroup[] = Object.entries(
  emotionsData as Record<string, EmotionGroupRaw>,
)
  .filter(([, value]) => value && typeof value === 'object' && Boolean(value.Aspects))
  .map(([key, value]) => ({
    key,
    labelEn: key,
    labelFa: value.Core ?? key,
    color: EMOTION_COLORS[key] ?? '#94a3b8',
    secondary: Object.entries(value.Aspects ?? {}).map(([en, fa]) => ({ en, fa })),
  }))

type PrimaryEmotionKey = string

function getPhaseLabel(phase: HabitPhase, language: 'en' | 'fa'): string {
  return language === 'fa' ? PHASE_LABELS_FA[phase] : PHASE_LABELS[phase]
}

function getReportingLabel(type: ReportingType, language: 'en' | 'fa'): string {
  return language === 'fa' ? REPORTING_LABELS_FA[type] : REPORTING_LABELS[type]
}

function getRiskTitle(title: string, language: 'en' | 'fa'): string {
  if (language === 'en') {
    return title
  }
  if (title === 'Fragile') return 'شکننده'
  if (title === 'Forming') return 'در حال شکل‌گیری'
  if (title === 'Automatic') return 'خودکار'
  return title
}

function getRiskHint(title: string, language: 'en' | 'fa'): string {
  if (language === 'en') {
    if (title === 'Fragile') return 'Protect this one. Skipping is costly right now.'
    if (title === 'Forming') return 'Still friction-heavy. Keep reps easy and visible.'
    return 'Strong autopilot. One off day is usually recoverable.'
  }
  if (title === 'Fragile') return 'از این یکی محافظت کن؛ رد کردنش فعلاً پرهزینه است.'
  if (title === 'Forming') return 'هنوز اصطکاک بالاست؛ قدم‌ها را ساده و واضح نگه دار.'
  return 'خودکار شده؛ یک روز لغزش معمولاً قابل جبران است.'
}

function getDifficultyQualifier(k: number, language: 'en' | 'fa'): string {
  if (k >= 0.08) {
    return language === 'fa' ? 'خیلی آسان' : 'Very easy'
  }
  if (k >= 0.06) {
    return language === 'fa' ? 'آسان' : 'Easy'
  }
  if (k >= 0.045) {
    return language === 'fa' ? 'متوسط' : 'Moderate'
  }
  if (k >= 0.03) {
    return language === 'fa' ? 'سخت' : 'Difficult'
  }
  return language === 'fa' ? 'خیلی سخت' : 'Super difficult'
}

function getDecayQualifier(decayFactor: number, language: 'en' | 'fa'): string {
  if (decayFactor <= 0.62) {
    return language === 'fa' ? 'حساس به شکست' : 'Break-sensitive'
  }
  if (decayFactor <= 0.74) {
    return language === 'fa' ? 'حساس' : 'Sensitive'
  }
  if (decayFactor <= 0.86) {
    return language === 'fa' ? 'متعادل' : 'Balanced'
  }
  if (decayFactor <= 0.93) {
    return language === 'fa' ? 'بخشنده' : 'Forgiving'
  }
  return language === 'fa' ? 'خیلی بخشنده' : 'Very forgiving'
}

interface HabitDraft {
  name: string
  description: string
  desiredCount: number
  desiredPer: 'day' | 'week'
  difficultyK: number
  decayFactor: number
  phase: HabitPhase
  reportingType: ReportingType
}

interface ParsedReport {
  type: 'button' | 'mood' | 'emotion' | 'text' | 'photo' | 'selfie' | 'unknown'
  mood?: number
  emotionPrimary?: string
  emotionSecondary?: string
  text?: string
  sentiment?: number
  imageDataUrl?: string
  caption?: string
  faceLabel?: keyof typeof FACE_TONE_LABELS
  faceScore?: number
  faceAnalysisStatus?: 'pending' | 'ready' | 'unavailable'
  faceAnalysisMessage?: string
  faceAnalysisDelegate?: 'GPU' | 'CPU'
}

interface CameraCaptureSession {
  habitId: string
  targetDayKey: string
  mode: 'photo' | 'selfie'
}

interface MediaGalleryEntry {
  logId: string
  dayKey: string
  completedAt: string
  report: ParsedReport & {
    type: 'photo' | 'selfie'
    imageDataUrl: string
  }
}

interface HazeUiState {
  confirmedStartDayKey: string | null
  lastConfirmedStartDayKey: string | null
  dismissedStartDayKey: string | null
  dismissedUntilDayKey: string | null
  exitPromptSnoozedUntilDayKey: string | null
}

interface DayCompletionStat {
  dayKey: string
  ratio: number
  baseline: number | null
  trailing3Average: number
  dropFromBaseline: number | null
  isLow: boolean
}

interface HazePeriod {
  startDayKey: string
  endDayKey: string
  baseline: number
  averageRatio: number
  lowDayCount: number
  severity: 'light' | 'heavy'
  recovered: boolean
  recoveryDayKey: string | null
}

interface HazeChartRange {
  startIndex: number
  endIndex: number
  tone: 'detected' | 'confirmed' | 'recovered'
}

interface HazeRecoverySignal {
  recovered: boolean
  baseline: number | null
  threshold: number | null
  recentAverage: number | null
}

function defaultDraft(): HabitDraft {
  return {
    name: '',
    description: '',
    desiredCount: 1,
    desiredPer: 'day',
    difficultyK: 0.05,
    decayFactor: 0.82,
    phase: 'morning',
    reportingType: 'button',
  }
}

function formatDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getEffectiveDayKey(now = new Date()): string {
  const shifted = new Date(now)
  shifted.setHours(shifted.getHours() - 2)
  return formatDayKey(shifted)
}

function defaultHazeUiState(): HazeUiState {
  return {
    confirmedStartDayKey: null,
    lastConfirmedStartDayKey: null,
    dismissedStartDayKey: null,
    dismissedUntilDayKey: null,
    exitPromptSnoozedUntilDayKey: null,
  }
}

function loadHazeUiState(): HazeUiState {
  if (typeof window === 'undefined') {
    return defaultHazeUiState()
  }

  try {
    const raw = window.localStorage.getItem(HAZE_UI_STORAGE_KEY)
    if (!raw) {
      return defaultHazeUiState()
    }

    const parsed = JSON.parse(raw) as Partial<HazeUiState>
    return {
      confirmedStartDayKey:
        typeof parsed.confirmedStartDayKey === 'string' ? parsed.confirmedStartDayKey : null,
      lastConfirmedStartDayKey:
        typeof parsed.lastConfirmedStartDayKey === 'string' ? parsed.lastConfirmedStartDayKey : null,
      dismissedStartDayKey:
        typeof parsed.dismissedStartDayKey === 'string' ? parsed.dismissedStartDayKey : null,
      dismissedUntilDayKey:
        typeof parsed.dismissedUntilDayKey === 'string' ? parsed.dismissedUntilDayKey : null,
      exitPromptSnoozedUntilDayKey:
        typeof parsed.exitPromptSnoozedUntilDayKey === 'string'
          ? parsed.exitPromptSnoozedUntilDayKey
          : null,
    }
  } catch {
    return defaultHazeUiState()
  }
}

function dayKeyToDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function average(values: number[]): number {
  if (!values.length) {
    return 0
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const date = dayKeyToDate(dayKey)
  date.setDate(date.getDate() + deltaDays)
  return formatDayKey(date)
}

function getCurrentPhase(now = new Date()): TimedPhase {
  const hour = now.getHours()
  const minute = now.getMinutes()

  if (hour < 2) {
    return 'beforeBed'
  }

  if (hour < 16 || (hour === 16 && minute < 30)) {
    return 'morning'
  }

  if (hour < 22) {
    return 'afterWork'
  }

  return 'beforeBed'
}

function getPhaseSortIndex(phase: HabitPhase): number {
  if (phase === 'anytime') {
    return 99
  }
  return TIMED_PHASE_ORDER.indexOf(phase)
}

function isAnytimeUrgent(habit: Habit, todayKey: string, currentPhase: TimedPhase): boolean {
  if (habit.phase !== 'anytime') {
    return false
  }

  if (habit.desiredFrequency.per === 'day') {
    return currentPhase === 'beforeBed'
  }

  return getWeekDayOffset(todayKey) >= 5
}

function getWeekStart(dayKey: string): string {
  const date = dayKeyToDate(dayKey)
  const day = date.getDay()
  const normalized = day === 0 ? 6 : day - 1
  date.setDate(date.getDate() - normalized)
  return formatDayKey(date)
}

function countHabitCompletionsForDay(habitId: string, dayKey: string, logs: HabitLog[]): number {
  return logs.filter((log) => log.habitId === habitId && log.dayKey === dayKey).length
}

function countHabitCompletionsForWeek(habitId: string, weekStart: string, logs: HabitLog[]): number {
  const weekStartDate = dayKeyToDate(weekStart)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)

  return logs.filter((log) => {
    if (log.habitId !== habitId) {
      return false
    }
    const date = dayKeyToDate(log.dayKey)
    return date >= weekStartDate && date <= weekEndDate
  }).length
}

function getPeriodProgress(
  habit: Habit,
  logs: HabitLog[],
  todayKey: string,
): {
  done: number
  target: number
  remaining: number
  completed: boolean
  label: string
} {
  const target = Math.max(1, habit.desiredFrequency.count)

  if (habit.desiredFrequency.per === 'day') {
    const done = countHabitCompletionsForDay(habit.id, todayKey, logs)
    return {
      done,
      target,
      remaining: Math.max(0, target - done),
      completed: done >= target,
      label: `${done}/${target} today`,
    }
  }

  const weekStart = getWeekStart(todayKey)
  const done = countHabitCompletionsForWeek(habit.id, weekStart, logs)
  return {
    done,
    target,
    remaining: Math.max(0, target - done),
    completed: done >= target,
    label: `${done}/${target} this week`,
  }
}

function getWeekDayOffset(dayKey: string): number {
  const weekStart = getWeekStart(dayKey)
  const startDate = dayKeyToDate(weekStart)
  const currentDate = dayKeyToDate(dayKey)
  const diffMs = currentDate.getTime() - startDate.getTime()
  return Math.max(0, Math.min(6, Math.floor(diffMs / (1000 * 60 * 60 * 24))))
}

function getHabitPeriodBounds(dayKey: string, phase: HabitPhase): { start: Date; end: Date } {
  const baseDate = dayKeyToDate(dayKey)
  const start = new Date(baseDate)
  const end = new Date(baseDate)

  if (phase === 'morning') {
    start.setHours(2, 0, 0, 0)
    end.setHours(16, 30, 0, 0)
    return { start, end }
  }

  if (phase === 'afterWork') {
    start.setHours(16, 30, 0, 0)
    end.setHours(22, 0, 0, 0)
    return { start, end }
  }

  if (phase === 'beforeBed') {
    start.setHours(22, 0, 0, 0)
    end.setDate(end.getDate() + 1)
    end.setHours(2, 0, 0, 0)
    return { start, end }
  }

  start.setHours(2, 0, 0, 0)
  end.setDate(end.getDate() + 1)
  end.setHours(2, 0, 0, 0)
  return { start, end }
}

function getNextDailyRevealTime(
  habit: Habit,
  logs: HabitLog[],
  dayKey: string,
): Date | null {
  const target = Math.max(1, habit.desiredFrequency.count)
  if (habit.desiredFrequency.per !== 'day' || target <= 1) {
    return null
  }

  const { start, end } = getHabitPeriodBounds(dayKey, habit.phase)
  const periodMs = Math.max(1, end.getTime() - start.getTime())
  const intervalMs = periodMs / target

  const completionTimes = logs
    .filter((log) => log.habitId === habit.id && log.dayKey === dayKey)
    .map((log) => new Date(log.completedAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())

  if (!completionTimes.length) {
    return start
  }

  const lastCompletion = completionTimes[completionTimes.length - 1]
  const clampedCompletionTime = Math.min(
    Math.max(lastCompletion.getTime(), start.getTime()),
    end.getTime(),
  )
  const elapsedMs = Math.max(0, clampedCompletionTime - start.getTime())
  const nextBoundaryIndex = Math.floor(elapsedMs / intervalMs) + 1
  const nextBoundaryTime = start.getTime() + nextBoundaryIndex * intervalMs

  return new Date(Math.min(nextBoundaryTime, end.getTime()))
}

function shouldShowHabitBySchedule(
  habit: Habit,
  logs: HabitLog[],
  todayKey: string,
  now = new Date(),
): boolean {
  const progress = getPeriodProgress(habit, logs, todayKey)
  if (progress.completed) {
    return false
  }

  if (habit.desiredFrequency.per === 'day') {
    const currentDayKey = getEffectiveDayKey(now)
    if (todayKey !== currentDayKey) {
      return true
    }

    const nextRevealTime = getNextDailyRevealTime(habit, logs, todayKey)
    if (nextRevealTime && now < nextRevealTime) {
      return habit.phase === 'anytime' && isAnytimeUrgent(habit, todayKey, getCurrentPhase(now))
    }

    return true
  }

  const target = Math.max(1, habit.desiredFrequency.count)
  const doneThisWeek = progress.done
  const nextDueDayOffset = Math.min(6, Math.floor((doneThisWeek * 7) / target))
  const currentDayOffset = getWeekDayOffset(todayKey)

  return currentDayOffset >= nextDueDayOffset
}

function getConsecutiveSuccessUnits(
  habit: Habit,
  logs: HabitLog[],
  todayKey: string,
  options?: { optimisticCurrentDayKey?: string; hazeCompassionByDay?: Record<string, number> },
): number {
  const target = Math.max(1, habit.desiredFrequency.count)
  const habitLogs = logs.filter((log) => log.habitId === habit.id)

  if (!habitLogs.length) {
    return 0
  }

  const momentumDecay = clamp(habit.decayFactor, 0.5, 0.98)
  const partialDecay = clamp((momentumDecay + 1) / 2, 0.75, 0.995)
  let units = 0

  if (habit.desiredFrequency.per === 'day') {
    const firstDay = habitLogs
      .map((log) => log.dayKey)
      .sort((a, b) => a.localeCompare(b))[0]
    let cursor = firstDay
    const endExclusive = todayKey

    while (cursor < endExclusive) {
      const done = countHabitCompletionsForDay(habit.id, cursor, logs)
      let ratio = clamp(done / target, 0, 1)

      if (options?.optimisticCurrentDayKey && cursor === options.optimisticCurrentDayKey) {
        ratio = 1
      }

      if (ratio >= 1) {
        units += 1
      } else if (ratio > 0) {
        const compassion = clamp(options?.hazeCompassionByDay?.[cursor] ?? 0, 0, 1)
        const adjustedPartialDecay = partialDecay + (1 - partialDecay) * compassion * 0.45
        units = units * adjustedPartialDecay + ratio
      } else {
        const compassion = clamp(options?.hazeCompassionByDay?.[cursor] ?? 0, 0, 1)
        const adjustedDecay = momentumDecay + (1 - momentumDecay) * compassion * 0.7
        units *= adjustedDecay
      }

      cursor = shiftDayKey(cursor, 1)
    }

    return units
  }

  const firstWeek = getWeekStart(
    habitLogs
      .map((log) => log.dayKey)
      .sort((a, b) => a.localeCompare(b))[0],
  )
  const endExclusive = getWeekStart(todayKey)
  let cursor = firstWeek

  while (cursor < endExclusive) {
    const done = countHabitCompletionsForWeek(habit.id, cursor, logs)
    const ratio = clamp(done / target, 0, 1)
    const weekCompassion = Math.max(
      0,
      ...Array.from({ length: 7 }, (_, index) => options?.hazeCompassionByDay?.[shiftDayKey(cursor, index)] ?? 0),
    )

    if (ratio >= 1) {
      units += 1
    } else if (ratio > 0) {
      const adjustedPartialDecay = partialDecay + (1 - partialDecay) * weekCompassion * 0.45
      units = units * adjustedPartialDecay + ratio
    } else {
      const adjustedDecay = momentumDecay + (1 - momentumDecay) * weekCompassion * 0.7
      units *= adjustedDecay
    }

    cursor = shiftDayKey(cursor, 7)
  }

  return units
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getAdaptiveK(habit: Habit): number {
  return clamp(habit.difficultyK - habit.streakBreaks * 0.0015, 0.01, 0.12)
}

function getStrength(k: number, streakUnits: number): number {
  return 100 * (1 - Math.exp(-k * streakUnits))
}

function getRiskTier(strength: number): {
  title: string
  icon: string
  className: string
  hint: string
} {
  if (strength <= 20) {
    return {
      title: 'Fragile',
      icon: '🌱',
      className: 'tier-fragile',
      hint: 'Protect this one. Skipping is costly right now.',
    }
  }
  if (strength <= 70) {
    return {
      title: 'Forming',
      icon: '🛠️',
      className: 'tier-forming',
      hint: 'Still friction-heavy. Keep reps easy and visible.',
    }
  }
  return {
    title: 'Automatic',
    icon: '✨',
    className: 'tier-automatic',
    hint: 'Strong autopilot. One off day is usually recoverable.',
  }
}

function getTierColor(title: string): string {
  if (title === 'Fragile') return '#ef4444'
  if (title === 'Forming') return '#f59e0b'
  return '#22c55e'
}

function getStageProgress(strength: number): {
  current: 'Fragile' | 'Forming' | 'Automatic'
  next: 'Forming' | 'Automatic' | null
  progressPct: number
} {
  if (strength <= 20) {
    return {
      current: 'Fragile',
      next: 'Forming',
      progressPct: clamp((strength / 20) * 100, 0, 100),
    }
  }

  if (strength <= 70) {
    return {
      current: 'Forming',
      next: 'Automatic',
      progressPct: clamp(((strength - 20) / 50) * 100, 0, 100),
    }
  }

  return {
    current: 'Automatic',
    next: null,
    progressPct: clamp(((strength - 70) / 30) * 100, 0, 100),
  }
}

function getProgressBarSegments(strength: number): string[] {
  const filled = Math.round(strength / 12.5)
  return Array.from({ length: 8 }, (_, i) => (i < filled ? '🟩' : '⬜️'))
}

function srhiAverage(scores: [number, number, number, number]): number {
  return scores.reduce((sum, n) => sum + n, 0) / 4
}

function pickCompassion(seed: string, list: string[]): string {
  const sum = seed.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0)
  return list[sum % list.length]
}

const POSITIVE_WORDS = new Set([
  'good',
  'great',
  'happy',
  'calm',
  'progress',
  'proud',
  'better',
  'joy',
  'thankful',
  'grateful',
  'peaceful',
  'win',
  'wins',
  'love',
  'clear',
])

const NEGATIVE_WORDS = new Set([
  'bad',
  'sad',
  'angry',
  'stress',
  'stressed',
  'tired',
  'fear',
  'anxious',
  'hard',
  'pain',
  'upset',
  'worry',
  'worried',
  'hate',
  'foggy',
])

const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'that',
  'with',
  'have',
  'this',
  'from',
  'just',
  'been',
  'about',
  'your',
  'what',
  'when',
  'they',
  'them',
  'into',
  'also',
  'then',
  'were',
])

function analyzeSentiment(text: string): number {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)

  if (!words.length) {
    return 0
  }

  let score = 0
  for (const word of words) {
    if (POSITIVE_WORDS.has(word)) {
      score += 1
    }
    if (NEGATIVE_WORDS.has(word)) {
      score -= 1
    }
  }

  return clamp(score / Math.max(3, words.length / 2), -1, 1)
}

function sentimentEmoji(score: number): string {
  if (score > 0.5) {
    return '😄'
  }
  if (score > 0.1) {
    return '🙂'
  }
  if (score < -0.5) {
    return '😟'
  }
  if (score < -0.1) {
    return '🙁'
  }
  return '😐'
}

function getFaceToneLabel(
  label: keyof typeof FACE_TONE_LABELS | undefined,
  language: 'en' | 'fa',
): string {
  if (!label) {
    return language === 'fa' ? 'نامشخص' : 'Unknown'
  }

  return language === 'fa' ? FACE_TONE_LABELS_FA[label] : FACE_TONE_LABELS[label]
}

function getFaceToneEmoji(label: keyof typeof FACE_TONE_LABELS | undefined): string {
  if (!label) {
    return '🙂'
  }
  return FACE_TONE_EMOJIS[label]
}

function getFaceAnalysisStatusEmoji(
  report: Pick<ParsedReport, 'faceAnalysisStatus' | 'faceLabel'>,
): string {
  if (report.faceLabel) {
    return getFaceToneEmoji(report.faceLabel)
  }

  if (report.faceAnalysisStatus === 'pending') {
    return '⏳'
  }

  if (report.faceAnalysisStatus === 'unavailable') {
    return '❔'
  }

  return '🙂'
}

function getFaceAnalysisStatusLabel(
  report: Pick<ParsedReport, 'faceAnalysisStatus' | 'faceLabel'>,
  language: 'en' | 'fa',
): string {
  if (report.faceLabel) {
    return getFaceToneLabel(report.faceLabel, language)
  }

  if (report.faceAnalysisStatus === 'pending') {
    return language === 'fa' ? 'در حال تحلیل' : 'Analyzing'
  }

  if (report.faceAnalysisStatus === 'unavailable') {
    return language === 'fa' ? 'ناموجود' : 'Unavailable'
  }

  return language === 'fa' ? 'نامشخص' : 'Unknown'
}

function getFaceAnalysisDetail(
  report: Pick<
    ParsedReport,
    'faceAnalysisStatus' | 'faceAnalysisMessage' | 'faceAnalysisDelegate'
  >,
  language: 'en' | 'fa',
): string {
  if (report.faceAnalysisStatus === 'pending') {
    return language === 'fa'
      ? 'تحلیل در پس‌زمینه در حال انجام است.'
      : 'Analysis is still running in the background.'
  }

  const delegateText = report.faceAnalysisDelegate
    ? language === 'fa'
      ? `اجرا با ${report.faceAnalysisDelegate}`
      : `via ${report.faceAnalysisDelegate}`
    : ''

  if (report.faceAnalysisMessage) {
    return delegateText ? `${report.faceAnalysisMessage} · ${delegateText}` : report.faceAnalysisMessage
  }

  if (report.faceAnalysisStatus === 'unavailable') {
    return language === 'fa'
      ? 'برای این سلفی نتیجه قابل‌استفاده‌ای به‌دست نیامد.'
      : 'No usable result was produced for this selfie.'
  }

  return ''
}

function formatRelativeDateTime(value: string | null, language: 'en' | 'fa'): string {
  if (!value) {
    return language === 'fa' ? 'هنوز انجام نشده' : 'Not yet'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return language === 'fa' ? 'نامشخص' : 'Unknown'
  }

  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function formatDayKeyForDisplay(dayKey: string, language: 'en' | 'fa'): string {
  const date = dayKeyToDate(dayKey)
  return new Intl.DateTimeFormat(language === 'fa' ? 'fa-IR' : 'en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(date)
}

function isMediaGalleryReport(
  report: ParsedReport,
): report is ParsedReport & { type: 'photo' | 'selfie'; imageDataUrl: string } {
  return (
    (report.type === 'photo' || report.type === 'selfie') &&
    typeof report.imageDataUrl === 'string' &&
    report.imageDataUrl.length > 0
  )
}

function openImageCapture(captureMode: 'environment' | 'user'): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'image/*'
    input.setAttribute('capture', captureMode)

    input.addEventListener(
      'change',
      () => {
        resolve(input.files?.[0] ?? null)
      },
      { once: true },
    )

    input.addEventListener(
      'cancel',
      () => {
        resolve(null)
      },
      { once: true },
    )

    input.click()
  })
}

function loadImageFromUrl(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not read the selected image.'))
    image.src = url
  })
}

async function fileToCompressedImageDataUrl(file: File): Promise<string> {
  const objectUrl = URL.createObjectURL(file)

  try {
    const image = await loadImageFromUrl(objectUrl)
    const maxDimension = 960
    const scale = Math.min(1, maxDimension / Math.max(image.width, image.height))
    const width = Math.max(1, Math.round(image.width * scale))
    const height = Math.max(1, Math.round(image.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d')

    if (!context) {
      throw new Error('Could not open the image editor.')
    }

    context.drawImage(image, 0, 0, width, height)
    return canvas.toDataURL('image/jpeg', 0.82)
  } finally {
    URL.revokeObjectURL(objectUrl)
  }
}

function parseReport(reportValue: string): ParsedReport {
  try {
    const parsed = JSON.parse(reportValue) as ParsedReport
    if (!parsed || typeof parsed !== 'object') {
      return { type: 'unknown' }
    }
    return parsed
  } catch {
    if (reportValue.trim()) {
      return {
        type: 'text',
        text: reportValue,
        sentiment: analyzeSentiment(reportValue),
      }
    }
    return { type: 'unknown' }
  }
}

function formatFrequencyLabel(habit: Habit): string {
  return habit.desiredFrequency.per === 'day'
    ? `${habit.desiredFrequency.count} / day`
    : `${habit.desiredFrequency.count} / week`
}

function getRecentDayKeys(todayKey: string, days: number): string[] {
  return Array.from({ length: days }, (_, index) => shiftDayKey(todayKey, -(days - 1 - index)))
}

function getDayKeysBetween(startDayKey: string, endDayKey: string): string[] {
  const keys: string[] = []
  let cursor = startDayKey
  while (cursor <= endDayKey) {
    keys.push(cursor)
    cursor = shiftDayKey(cursor, 1)
  }
  return keys
}

function shortDayLabel(dayKey: string): string {
  const date = dayKeyToDate(dayKey)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

interface ChartPoint {
  label: string
  value: number
  dayKey?: string
}

interface StrengthLineChartProps {
  data: ChartPoint[]
  color: string
  fill: string
  optimisticLastPoint?: boolean
  optimisticColor?: string
  hazeRanges?: HazeChartRange[]
  showUnderFogDetails?: boolean
}

interface MiniBarDatum {
  label: string
  value: number
  color?: string
}

function StrengthLineChart({
  data,
  color,
  fill,
  optimisticLastPoint = false,
  optimisticColor = '#60a5fa',
  hazeRanges = [],
  showUnderFogDetails = false,
}: StrengthLineChartProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [chartWidth, setChartWidth] = useState(620)

  useEffect(() => {
    const wrapElement = wrapRef.current
    if (!wrapElement) {
      return
    }

    const updateWidth = () => {
      const nextWidth = Math.max(320, Math.round(wrapElement.clientWidth))
      setChartWidth(nextWidth)
    }

    updateWidth()
    const observer = new ResizeObserver(updateWidth)
    observer.observe(wrapElement)

    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const svgElement = svgRef.current
    if (!svgElement) {
      return
    }

    const width = chartWidth
    const height = 170
    const margin = { top: 8, right: 10, bottom: 32, left: 28 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(svgElement)
    svg.selectAll('*').remove()

    const defs = svg.append('defs')

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scaleLinear()
      .domain([0, Math.max(0, data.length - 1)])
      .range([0, innerWidth])

    const y = d3
      .scaleLinear()
      .domain([0, 100])
      .range([innerHeight, 0])

    root
      .selectAll('line.grid')
      .data([0, 25, 50, 75, 100])
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d: number) => y(d))
      .attr('y2', (d: number) => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)

    const rangeStartX = (index: number) => {
      if (data.length <= 1) {
        return 0
      }
      return index <= 0 ? 0 : x(index - 0.5)
    }

    const rangeEndX = (index: number) => {
      if (data.length <= 1) {
        return innerWidth
      }
      return index >= data.length - 1 ? innerWidth : x(index + 0.5)
    }

    const sortedRanges = [...hazeRanges].sort((a, b) => a.startIndex - b.startIndex)
    const visibleSegments: Array<{ startX: number; endX: number }> = []
    let cursorX = 0
    for (const range of sortedRanges) {
      const startX = rangeStartX(range.startIndex)
      const endX = rangeEndX(range.endIndex)
      if (startX > cursorX) {
        visibleSegments.push({ startX: cursorX, endX: startX })
      }
      cursorX = Math.max(cursorX, endX)
    }
    if (cursorX < innerWidth) {
      visibleSegments.push({ startX: cursorX, endX: innerWidth })
    }

    const area = d3
      .area<ChartPoint>()
      .x((_: ChartPoint, index: number) => x(index))
      .y0(y(0))
      .y1((d: ChartPoint) => y(d.value))
      .curve(d3.curveMonotoneX)

    const line = d3
      .line<ChartPoint>()
      .x((_: ChartPoint, index: number) => x(index))
      .y((d: ChartPoint) => y(d.value))
      .curve(d3.curveMonotoneX)

    const areaPath = data.length > 0 ? area(data) : null
    const linePath = data.length > 0 ? line(data) : null

    const appendSeries = (
      selection: d3.Selection<SVGGElement, unknown, null, undefined>,
      options?: { hideLastPoint?: boolean },
    ) => {
      if (areaPath) {
        selection
          .append('path')
          .attr('fill', fill)
          .attr('d', areaPath)
      }

      if (linePath) {
        selection
          .append('path')
          .attr('fill', 'none')
          .attr('stroke', color)
          .attr('stroke-width', 2)
          .attr('d', linePath)
      }

      if (!options?.hideLastPoint) {
        selection
          .append('circle')
          .attr('cx', x(data.length - 1))
          .attr('cy', y(data[data.length - 1].value))
          .attr('r', 3.5)
          .attr('fill', optimisticLastPoint ? optimisticColor : color)

        if (optimisticLastPoint && data.length > 1) {
          selection
            .append('line')
            .attr('x1', x(data.length - 2))
            .attr('y1', y(data[data.length - 2].value))
            .attr('x2', x(data.length - 1))
            .attr('y2', y(data[data.length - 1].value))
            .attr('stroke', optimisticColor)
            .attr('stroke-width', 2.6)
            .attr('stroke-linecap', 'round')
        }
      }
    }

    if (data.length > 0) {
      const lastPointInsideFog = sortedRanges.some(
        (range) => data.length - 1 >= range.startIndex && data.length - 1 <= range.endIndex,
      )

      if (showUnderFogDetails || !sortedRanges.length) {
        appendSeries(root)
      } else {
        visibleSegments.forEach((segment, segmentIndex) => {
          const clipId = `visible-clip-${segmentIndex}-${Math.random().toString(36).slice(2, 9)}`
          defs
            .append('clipPath')
            .attr('id', clipId)
            .append('rect')
            .attr('x', segment.startX)
            .attr('y', -8)
            .attr('width', Math.max(0, segment.endX - segment.startX))
            .attr('height', innerHeight + 16)

          appendSeries(
            root.append('g').attr('clip-path', `url(#${clipId})`),
            { hideLastPoint: lastPointInsideFog },
          )
        })

        if (!visibleSegments.length && !lastPointInsideFog) {
          appendSeries(root)
        }
      }

      sortedRanges.forEach((range) => {
        const x0 = rangeStartX(range.startIndex)
        const x1 = rangeEndX(range.endIndex)
        const width = Math.max(10, x1 - x0)
        const gradientId = `fog-gradient-${Math.random().toString(36).slice(2, 9)}`
        const hazeRgb = '231, 254, 134'

        const fogTopOpacity =
          range.tone === 'confirmed' ? 0.62 : range.tone === 'recovered' ? 0.42 : 0.5
        const fogBottomOpacity =
          range.tone === 'confirmed' ? 0.28 : range.tone === 'recovered' ? 0.18 : 0.22

        const fogGradient = defs
          .append('linearGradient')
          .attr('id', gradientId)
          .attr('x1', '0%')
          .attr('y1', '0%')
          .attr('x2', '0%')
          .attr('y2', '100%')

        fogGradient
          .append('stop')
          .attr('offset', '0%')
          .attr('stop-color', `rgba(${hazeRgb}, ${fogTopOpacity})`)

        fogGradient
          .append('stop')
          .attr('offset', '100%')
          .attr('stop-color', `rgba(${hazeRgb}, ${fogBottomOpacity})`)

        root
          .append('rect')
          .attr('x', x0)
          .attr('y', 0)
          .attr('width', width)
          .attr('height', innerHeight)
          .attr('rx', 10)
          .attr('fill', `url(#${gradientId})`)
          .attr('stroke', 'rgba(231, 254, 134, 0.52)')
          .attr('stroke-width', 1)

        if (showUnderFogDetails) {
          root
            .append('rect')
            .attr('x', x0)
            .attr('y', 0)
            .attr('width', width)
            .attr('height', innerHeight)
            .attr('rx', 10)
            .attr('fill', 'rgba(231, 254, 134, 0.16)')
        }

        const cloudGroup = root.append('g').attr('opacity', range.tone === 'confirmed' ? 0.9 : 0.75)
        const cloudCenterX = x0 + width / 2
        cloudGroup
          .append('ellipse')
          .attr('cx', cloudCenterX)
          .attr('cy', 18)
          .attr('rx', Math.min(28, width * 0.18))
          .attr('ry', 9)
          .attr('fill', 'rgba(231,254,134,0.88)')
        cloudGroup
          .append('ellipse')
          .attr('cx', cloudCenterX - Math.min(18, width * 0.12))
          .attr('cy', 20)
          .attr('rx', Math.min(16, width * 0.12))
          .attr('ry', 7)
          .attr('fill', 'rgba(239,255,180,0.82)')
        cloudGroup
          .append('ellipse')
          .attr('cx', cloudCenterX + Math.min(18, width * 0.12))
          .attr('cy', 20)
          .attr('rx', Math.min(15, width * 0.11))
          .attr('ry', 6.5)
          .attr('fill', 'rgba(247,255,212,0.8)')

        root
          .append('text')
          .attr('x', x0 + width / 2)
          .attr('y', 21)
          .attr('text-anchor', 'middle')
          .attr('fill', '#64748b')
          .attr('font-size', 11)
          .text('☁︎')
      })
    }

    const tickStep = Math.max(1, Math.floor(data.length / 6))
    const tickIndexes = new Set<number>([0, Math.max(0, data.length - 1)])
    for (let index = 0; index < data.length; index += tickStep) {
      tickIndexes.add(index)
    }

    const ticks = [...tickIndexes].sort((a, b) => a - b)

    root
      .selectAll('text.x-tick')
      .data(ticks)
      .enter()
      .append('text')
      .attr('x', (index: number) => x(index))
      .attr('y', innerHeight + 16)
      .attr('text-anchor', 'middle')
      .attr('fill', '#6b7280')
      .attr('font-size', 10)
      .text((index: number) => data[index]?.label ?? '')
  }, [data, color, fill, chartWidth, hazeRanges, optimisticLastPoint, optimisticColor, showUnderFogDetails])

  return (
    <div ref={wrapRef} className="line-chart-wrap">
      <svg
        ref={svgRef}
        className="line-chart"
        viewBox={`0 0 ${chartWidth} 170`}
        role="img"
        aria-label="Strength trend chart"
      />
    </div>
  )
}

function D3VerticalBars({ data, fallbackColor = '#60a5fa' }: { data: MiniBarDatum[]; fallbackColor?: string }) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svgElement = svgRef.current
    if (!svgElement) {
      return
    }

    const width = 620
    const height = 190
    const margin = { top: 10, right: 10, bottom: 44, left: 26 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const svg = d3.select(svgElement)
    svg.selectAll('*').remove()

    const root = svg
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const maxValue = Math.max(1, ...data.map((entry) => entry.value))
    const x = d3
      .scaleBand<string>()
      .domain(data.map((entry) => entry.label))
      .range([0, innerWidth])
      .padding(0.22)
    const y = d3
      .scaleLinear()
      .domain([0, maxValue])
      .range([innerHeight, 0])

    root
      .selectAll('line.grid')
      .data([0, maxValue])
      .enter()
      .append('line')
      .attr('x1', 0)
      .attr('x2', innerWidth)
      .attr('y1', (d: number) => y(d))
      .attr('y2', (d: number) => y(d))
      .attr('stroke', '#e5e7eb')
      .attr('stroke-width', 1)

    data.forEach((entry) => {
      const xPos = x(entry.label) ?? 0
      const barWidth = x.bandwidth()
      const barHeight = innerHeight - y(entry.value)

      root
        .append('rect')
        .attr('x', xPos)
        .attr('y', y(entry.value))
        .attr('width', barWidth)
        .attr('height', barHeight)
        .attr('rx', 4)
        .attr('fill', entry.color ?? fallbackColor)

      root
        .append('text')
        .attr('x', xPos + barWidth / 2)
        .attr('y', y(entry.value) - 4)
        .attr('text-anchor', 'middle')
        .attr('fill', '#6b7280')
        .attr('font-size', 10)
        .text(entry.value)

      root
        .append('text')
        .attr('x', xPos + barWidth / 2)
        .attr('y', innerHeight + 14)
        .attr('text-anchor', 'middle')
        .attr('fill', '#4b5563')
        .attr('font-size', 10)
        .text(entry.label)
    })

    svg.attr('viewBox', `0 0 ${width} ${height}`)
  }, [data, fallbackColor])

  return <svg ref={svgRef} className="line-chart" role="img" aria-label="Vertical bar chart" />
}

function getDailyHabitCompletionRatio(habit: Habit, logs: HabitLog[], dayKey: string): number {
  const target = Math.max(1, habit.desiredFrequency.count)

  if (habit.desiredFrequency.per === 'day') {
    const done = countHabitCompletionsForDay(habit.id, dayKey, logs)
    return clamp(done / target, 0, 1)
  }

  const weekStart = getWeekStart(dayKey)
  const done = countHabitCompletionsForWeek(habit.id, weekStart, logs)
  const expectedByToday = Math.max(1, Math.ceil(((getWeekDayOffset(dayKey) + 1) * target) / 7))
  return clamp(done / expectedByToday, 0, 1)
}

function buildDayCompletionStats(
  habits: Habit[],
  logs: HabitLog[],
  startDayKey: string,
  endDayKey: string,
): DayCompletionStat[] {
  const dayKeys = getDayKeysBetween(startDayKey, endDayKey)
  const ratios = dayKeys.map((dayKey) => {
    if (!habits.length) {
      return 0
    }

    const habitRatios = habits.map((habit) => getDailyHabitCompletionRatio(habit, logs, dayKey))
    return average(habitRatios)
  })

  return dayKeys.map((dayKey, index) => {
    const windowStart = Math.max(0, index - 10)
    const baselineWindow = ratios.slice(windowStart, index)
    const baseline = baselineWindow.length >= 6 ? average(baselineWindow) : null
    const trailing3 = average(ratios.slice(Math.max(0, index - 2), index + 1))
    const dropFromBaseline = baseline === null ? null : baseline - ratios[index]
    const isLow =
      baseline !== null &&
      baseline >= 0.42 &&
      ((ratios[index] <= 0.58 && (dropFromBaseline ?? 0) >= 0.14) ||
        (trailing3 <= 0.62 && baseline - trailing3 >= 0.12))

    return {
      dayKey,
      ratio: ratios[index],
      baseline,
      trailing3Average: trailing3,
      dropFromBaseline,
      isLow,
    }
  })
}

function detectHazePeriods(stats: DayCompletionStat[]): HazePeriod[] {
  const periods: HazePeriod[] = []
  let index = 0

  while (index < stats.length) {
    const stat = stats[index]
    const baseline = stat.baseline

    const startsHaze =
      baseline !== null &&
      baseline >= 0.45 &&
      stat.trailing3Average <= Math.max(0.6, baseline - 0.1) &&
      stat.ratio <= Math.max(0.72, baseline - 0.06)

    if (!startsHaze) {
      index += 1
      continue
    }

    const anchorBaseline = baseline
    const startIndex = index
    let lastHazeIndex = index
    let lowDayCount = 0
    let recoveryStreak = 0
    let hasMeaningfulDip = false
    let troughRatio = stat.ratio
    let troughTrailing3 = stat.trailing3Average
    let recoveryStartIndex = -1

    for (let cursor = index; cursor < stats.length; cursor += 1) {
      const entry = stats[cursor]
      troughRatio = Math.min(troughRatio, entry.ratio)
      troughTrailing3 = Math.min(troughTrailing3, entry.trailing3Average)

      const trough = Math.min(troughRatio, troughTrailing3)
      const recoveryThreshold = Math.max(0.45, trough + (anchorBaseline - trough) * 0.55)
      const stillMeaningfullyLow =
        entry.trailing3Average <= Math.max(recoveryThreshold - 0.04, trough + 0.06) ||
        entry.ratio <= Math.max(recoveryThreshold - 0.08, trough + 0.1)

      if (stillMeaningfullyLow) {
        lowDayCount += 1
        recoveryStreak = 0
        recoveryStartIndex = -1
        lastHazeIndex = cursor
        if (
          entry.trailing3Average <= anchorBaseline - 0.12 ||
          entry.ratio <= anchorBaseline - 0.15
        ) {
          hasMeaningfulDip = true
        }
        continue
      }

      const recoveryEnough =
        entry.trailing3Average >= recoveryThreshold &&
        entry.ratio >= Math.max(0.4, recoveryThreshold - 0.05)

      if (lowDayCount >= 2 && recoveryEnough) {
        if (recoveryStreak === 0) {
          recoveryStartIndex = cursor
        }
        recoveryStreak += 1
        if (recoveryStreak >= 4) {
          break
        }
      } else {
        recoveryStreak = 0
        recoveryStartIndex = -1
        lastHazeIndex = cursor
      }
    }

    const slice = stats.slice(startIndex, lastHazeIndex + 1)
    const averageRatio = average(slice.map((entry) => entry.ratio))
    const minTrailing3 = Math.min(...slice.map((entry) => entry.trailing3Average))
    const recovered = recoveryStreak >= 4 && recoveryStartIndex !== -1
    const recoveryDayKey = recovered ? stats[recoveryStartIndex]?.dayKey ?? null : null

    if (
      slice.length >= 3 &&
      lowDayCount >= 2 &&
      hasMeaningfulDip &&
      averageRatio <= anchorBaseline - 0.1 &&
      minTrailing3 <= anchorBaseline - 0.09
    ) {
      periods.push({
        startDayKey: slice[0].dayKey,
        endDayKey: slice[slice.length - 1].dayKey,
        baseline: anchorBaseline,
        averageRatio,
        lowDayCount,
        severity: anchorBaseline - averageRatio >= 0.24 ? 'heavy' : 'light',
        recovered,
        recoveryDayKey,
      })
      index = recovered && recoveryStartIndex !== -1 ? recoveryStartIndex + recoveryStreak : lastHazeIndex + 1
      continue
    }

    index = startIndex + 1
  }

  return periods
}

function getHazeRecoverySignal(
  stats: DayCompletionStat[],
  confirmedStartDayKey: string | null,
): HazeRecoverySignal {
  if (!confirmedStartDayKey) {
    return {
      recovered: false,
      baseline: null,
      threshold: null,
      recentAverage: null,
    }
  }

  const startIndex = stats.findIndex((entry) => entry.dayKey === confirmedStartDayKey)
  if (startIndex === -1) {
    return {
      recovered: false,
      baseline: null,
      threshold: null,
      recentAverage: null,
    }
  }

  const baselineWindow = stats.slice(Math.max(0, startIndex - 10), startIndex).map((entry) => entry.ratio)
  const baseline = baselineWindow.length >= 4 ? average(baselineWindow) : null
  const recentWindow = stats.slice(Math.max(startIndex, stats.length - 3))
  if (recentWindow.length < 3 || baseline === null) {
    return {
      recovered: false,
      baseline,
      threshold: baseline === null ? null : Math.max(0.62, baseline - 0.05),
      recentAverage: recentWindow.length ? average(recentWindow.map((entry) => entry.ratio)) : null,
    }
  }

  const threshold = Math.max(0.62, baseline - 0.05)
  const recentAverage = average(recentWindow.map((entry) => entry.ratio))
  const recovered =
    recentAverage >= threshold - 0.03 &&
    recentWindow.filter((entry) => entry.ratio >= threshold).length >= 2

  return {
    recovered,
    baseline,
    threshold,
    recentAverage,
  }
}

function buildHazeCompassionByDay(
  periods: HazePeriod[],
  confirmedStartDayKey: string | null,
  todayKey: string,
): Record<string, number> {
  const compassionByDay: Record<string, number> = {}

  if (!confirmedStartDayKey) {
    return compassionByDay
  }

  for (const period of periods) {
    if (period.startDayKey !== confirmedStartDayKey) {
      continue
    }

    const periodCompassion = period.recovered ? 0.78 : period.severity === 'heavy' ? 0.54 : 0.4
    for (const dayKey of getDayKeysBetween(period.startDayKey, period.endDayKey)) {
      compassionByDay[dayKey] = Math.max(compassionByDay[dayKey] ?? 0, periodCompassion)
    }
  }

  if (confirmedStartDayKey) {
    for (const dayKey of getDayKeysBetween(confirmedStartDayKey, todayKey)) {
      compassionByDay[dayKey] = Math.max(compassionByDay[dayKey] ?? 0, 0.62)
    }
  }

  return compassionByDay
}

function mapHazeRangesToChart(
  data: ChartPoint[],
  periods: HazePeriod[],
  confirmedStartDayKey: string | null,
): HazeChartRange[] {
  if (!confirmedStartDayKey) {
    return []
  }

  const dayIndex = new Map<string, number>()
  data.forEach((entry, index) => {
    if (entry.dayKey) {
      dayIndex.set(entry.dayKey, index)
    }
  })

  return periods
    .filter((period) => period.startDayKey === confirmedStartDayKey)
    .map((period) => {
      const startIndex = dayIndex.get(period.startDayKey)
      const endIndex = dayIndex.get(period.endDayKey)
      if (typeof startIndex !== 'number' || typeof endIndex !== 'number') {
        return null
      }

      return {
        startIndex,
        endIndex,
        tone:
          !period.recovered && confirmedStartDayKey === period.startDayKey
            ? 'confirmed'
            : period.recovered
              ? 'recovered'
              : 'detected',
      } as HazeChartRange
    })
    .filter((entry): entry is HazeChartRange => Boolean(entry))
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function App() {
  const configuredDriveClientId = import.meta.env.VITE_GOOGLE_DRIVE_CLIENT_ID?.trim() ?? ''
  const [language, setLanguage] = useState<'en' | 'fa'>(() => {
    if (typeof window === 'undefined') {
      return 'en'
    }
    const saved = window.localStorage.getItem('habit-feed-language')
    return saved === 'fa' ? 'fa' : 'en'
  })
  const [habits, setHabits] = useState<Habit[]>([])
  const [logs, setLogs] = useState<HabitLog[]>([])
  const [isLoaded, setIsLoaded] = useState(false)
  const [canAutoSave, setCanAutoSave] = useState(false)
  const [captureBusyHabitId, setCaptureBusyHabitId] = useState<string | null>(null)
  const [cameraSession, setCameraSession] = useState<CameraCaptureSession | null>(null)
  const [cameraStreamError, setCameraStreamError] = useState('')
  const [cameraPreviewReady, setCameraPreviewReady] = useState(false)
  const [driveBackupSettings, setDriveBackupSettings] = useState<DriveBackupSettings>(() => {
    const saved = loadDriveBackupSettings()
    return configuredDriveClientId
      ? {
          ...saved,
          clientId: configuredDriveClientId,
        }
      : saved
  })
  const [driveBackupStatus, setDriveBackupStatus] = useState('')
  const [isDriveSyncing, setIsDriveSyncing] = useState(false)
  const [rewardMessage, setRewardMessage] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)
  const [isImportExportOpen, setIsImportExportOpen] = useState(false)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [expandedInsightHabitId, setExpandedInsightHabitId] = useState<string | null>(null)
  const [insightRange, setInsightRange] = useState<'30d' | 'full'>('30d')
  const [showUnderFogDetails, setShowUnderFogDetails] = useState(false)
  const [showPreviousDayHabits, setShowPreviousDayHabits] = useState(false)
  const [showAnytimeHabits, setShowAnytimeHabits] = useState(false)
  const [showSecondaryAnalytics, setShowSecondaryAnalytics] = useState<Record<string, boolean>>({})
  const [selectedMediaLogIds, setSelectedMediaLogIds] = useState<Record<string, string>>({})
  const [galleryHabitId, setGalleryHabitId] = useState<string | null>(null)
  const [hazeUiState, setHazeUiState] = useState<HazeUiState>(() => loadHazeUiState())
  const [draft, setDraft] = useState<HabitDraft>(defaultDraft())
  const [cardInputs, setCardInputs] = useState<Record<string, string>>({})
  const [emotionPrimary, setEmotionPrimary] = useState<Record<string, PrimaryEmotionKey | null>>({})
  const [srhiHabitId, setSrhiHabitId] = useState<string | null>(null)
  const [srhiDraft, setSrhiDraft] = useState<[number, number, number, number]>([4, 4, 4, 4])
  const [clockNow, setClockNow] = useState<Date>(() => new Date())
  const addButtonTimer = useRef<number | null>(null)
  const ignoreAddClick = useRef(false)
  const cardLongPressTimer = useRef<number | null>(null)
  const importInputRef = useRef<HTMLInputElement | null>(null)
  const lastDriveBackupPayloadRef = useRef('')
  const cameraVideoRef = useRef<HTMLVideoElement | null>(null)
  const cameraStreamRef = useRef<MediaStream | null>(null)

  const todayKey = useMemo(() => getEffectiveDayKey(clockNow), [clockNow])
  const yesterdayKey = useMemo(() => shiftDayKey(todayKey, -1), [todayKey])
  const currentPhase = useMemo(() => getCurrentPhase(clockNow), [clockNow])
  const exportPayload = useMemo(() => JSON.stringify(toExportData({ habits, logs }), null, 2), [habits, logs])
  const effectiveDriveClientId = configuredDriveClientId || driveBackupSettings.clientId.trim()
  const tx = useCallback((en: string, fa: string): string => (language === 'fa' ? fa : en), [language])

  useEffect(() => {
    window.localStorage.setItem('habit-feed-language', language)
    document.documentElement.lang = language
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'
  }, [language])

  useEffect(() => {
    if (typeof window === 'undefined') {
      return
    }

    window.localStorage.setItem(HAZE_UI_STORAGE_KEY, JSON.stringify(hazeUiState))
  }, [hazeUiState])

  useEffect(() => {
    saveDriveBackupSettings(driveBackupSettings)
  }, [driveBackupSettings])

  useEffect(() => {
    if (!configuredDriveClientId) {
      return
    }

    setDriveBackupSettings((prev) =>
      prev.clientId === configuredDriveClientId
        ? prev
        : {
            ...prev,
            clientId: configuredDriveClientId,
          },
    )
  }, [configuredDriveClientId])

  useEffect(() => {
    function onBeforeInstallPrompt(event: Event) {
      const installEvent = event as BeforeInstallPromptEvent
      installEvent.preventDefault()
      setDeferredInstallPrompt(installEvent)
    }

    function onAppInstalled() {
      setIsInstalled(true)
      setDeferredInstallPrompt(null)
      setRewardMessage(tx('App installed successfully.', 'برنامه با موفقیت نصب شد.'))
    }

    window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt)
    window.addEventListener('appinstalled', onAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt)
      window.removeEventListener('appinstalled', onAppInstalled)
    }
  }, [language])

  async function installPwa(): Promise<void> {
    if (!deferredInstallPrompt) {
      return
    }

    await deferredInstallPrompt.prompt()
    const choiceResult = await deferredInstallPrompt.userChoice
    if (choiceResult.outcome === 'accepted') {
      setRewardMessage(tx('Thanks for installing ✨', 'مرسی از نصب برنامه ✨'))
      setIsInstalled(true)
    }
    setDeferredInstallPrompt(null)
  }

  useEffect(() => {
    let mounted = true
    loadPersistedState()
      .then((state) => {
        if (!mounted) {
          return
        }
        setHabits(state.habits)
        setLogs(state.logs)
        setCanAutoSave(true)
        setIsLoaded(true)
      })
      .catch(() => {
        if (!mounted) {
          return
        }
        setCanAutoSave(false)
        setIsLoaded(true)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!isLoaded || !canAutoSave) {
      return
    }
    void savePersistedState({ habits, logs })
  }, [habits, logs, isLoaded, canAutoSave])

  useEffect(() => {
    if (!isLoaded || !driveBackupSettings.enabled || !effectiveDriveClientId) {
      return
    }

    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      return
    }

    if (exportPayload === lastDriveBackupPayloadRef.current) {
      return
    }

    const timer = window.setTimeout(() => {
      void syncDriveBackup('auto')
    }, 12000)

    return () => window.clearTimeout(timer)
  }, [
    effectiveDriveClientId,
    driveBackupSettings.enabled,
    exportPayload,
    isLoaded,
  ])

  useEffect(() => {
    if (!isLoaded || !driveBackupSettings.enabled || !effectiveDriveClientId) {
      return
    }

    const intervalMs = Math.max(5, driveBackupSettings.intervalMinutes) * 60 * 1000
    const timer = window.setInterval(() => {
      if (typeof navigator !== 'undefined' && !navigator.onLine) {
        return
      }

      if (exportPayload === lastDriveBackupPayloadRef.current) {
        return
      }

      void syncDriveBackup('auto')
    }, intervalMs)

    return () => window.clearInterval(timer)
  }, [
    effectiveDriveClientId,
    driveBackupSettings.enabled,
    driveBackupSettings.intervalMinutes,
    exportPayload,
    isLoaded,
  ])

  useEffect(() => {
    const timer = window.setInterval(() => {
      setClockNow(new Date())
    }, 30000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!rewardMessage) {
      return
    }
    const timer = window.setTimeout(() => setRewardMessage(''), 2600)
    return () => window.clearTimeout(timer)
  }, [rewardMessage])

  useEffect(() => {
    async function startCameraPreview(): Promise<void> {
      if (!cameraSession) {
        return
      }

      if (!navigator.mediaDevices?.getUserMedia) {
        setCameraStreamError(
          tx(
            'Live camera preview is not available here. You can still upload a picture instead.',
            'پیش‌نمایش زنده دوربین اینجا در دسترس نیست. هنوز می‌توانی عکس را بارگذاری کنی.',
          ),
        )
        setCameraPreviewReady(false)
        return
      }

      setCameraStreamError('')
      setCameraPreviewReady(false)

      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: cameraSession.mode === 'selfie' ? 'user' : 'environment',
            width: { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        })

        cameraStreamRef.current = stream
        const video = cameraVideoRef.current
        if (video) {
          video.srcObject = stream
          await video.play()
        }
        setCameraPreviewReady(true)
      } catch (error) {
        const fallbackMessage =
          error instanceof Error && error.message
            ? error.message
            : tx('Could not open the camera.', 'باز کردن دوربین انجام نشد.')

        setCameraStreamError(
          tx(
            `Could not open the camera. ${fallbackMessage}`,
            `باز کردن دوربین انجام نشد. ${fallbackMessage}`,
          ),
        )
        setCameraPreviewReady(false)
      }
    }

    void startCameraPreview()

    return () => {
      const stream = cameraStreamRef.current
      if (stream) {
        for (const track of stream.getTracks()) {
          track.stop()
        }
      }
      cameraStreamRef.current = null
      const video = cameraVideoRef.current
      if (video) {
        video.srcObject = null
      }
      setCameraPreviewReady(false)
    }
  }, [cameraSession, tx])

  const completedToday = useMemo(() => {
    const completedSet = new Set(
      logs.filter((log) => log.dayKey === todayKey).map((log) => log.habitId),
    )
    return completedSet.size
  }, [logs, todayKey])

  const visibleHabits = useMemo(() => {
    const currentPhaseIndex = TIMED_PHASE_ORDER.indexOf(currentPhase)

    return habits
      .filter((habit) => !habit.archived && habit.phase !== 'anytime' && getPhaseSortIndex(habit.phase) <= currentPhaseIndex)
      .filter((habit) => shouldShowHabitBySchedule(habit, logs, todayKey, clockNow))
      .sort((a, b) => {
        const phaseDiff = getPhaseSortIndex(b.phase) - getPhaseSortIndex(a.phase)
        if (phaseDiff !== 0) {
          return phaseDiff
        }
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [habits, logs, currentPhase, todayKey, clockNow])

  const anytimeHabits = useMemo(() => {
    return habits
      .filter((habit) => !habit.archived && habit.phase === 'anytime')
      .filter((habit) => shouldShowHabitBySchedule(habit, logs, todayKey, clockNow))
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }, [habits, logs, todayKey, clockNow])

  const hasUrgentAnytimeHabits = useMemo(
    () => anytimeHabits.some((habit) => isAnytimeUrgent(habit, todayKey, currentPhase)),
    [anytimeHabits, todayKey, currentPhase],
  )

  useEffect(() => {
    if (hasUrgentAnytimeHabits) {
      setShowAnytimeHabits(true)
    }
  }, [hasUrgentAnytimeHabits])

  const previousDayHabits = useMemo(() => {
    return habits
      .filter((habit) => !habit.archived)
      .filter((habit) => shouldShowHabitBySchedule(habit, logs, yesterdayKey, clockNow))
      .sort((a, b) => {
        const phaseDiff = getPhaseSortIndex(b.phase) - getPhaseSortIndex(a.phase)
        if (phaseDiff !== 0) {
          return phaseDiff
        }
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [habits, logs, yesterdayKey, clockNow])

  const managedHabit = useMemo(
    () => habits.find((habit) => habit.id === editingHabitId) ?? null,
    [habits, editingHabitId],
  )

  const activeHabits = useMemo(() => habits.filter((habit) => !habit.archived), [habits])
  const activeHabitIds = useMemo(() => new Set(activeHabits.map((habit) => habit.id)), [activeHabits])

  const fullRangeStartDay = useMemo(() => {
    const createdDayKeys = activeHabits.map((habit) => formatDayKey(new Date(habit.createdAt)))
    const logDayKeys = logs
      .filter((log) => activeHabitIds.has(log.habitId))
      .map((log) => log.dayKey)

    const allKeys = [...createdDayKeys, ...logDayKeys]
    if (!allKeys.length) {
      return todayKey
    }

    const earliest = allKeys.sort((a, b) => a.localeCompare(b))[0]
    return earliest <= todayKey ? earliest : todayKey
  }, [activeHabits, logs, activeHabitIds, todayKey])

  useEffect(() => {
    if (!activeHabits.length) {
      setExpandedInsightHabitId(null)
      return
    }

    const stillExists = activeHabits.some((habit) => habit.id === expandedInsightHabitId)
    if (!expandedInsightHabitId || !stillExists) {
      setExpandedInsightHabitId(activeHabits[0].id)
    }
  }, [activeHabits, expandedInsightHabitId])

  const hazeDayStats = useMemo(() => {
    if (!activeHabits.length) {
      return []
    }

    return buildDayCompletionStats(activeHabits, logs, fullRangeStartDay, todayKey)
  }, [activeHabits, logs, fullRangeStartDay, todayKey])

  const detectedHazePeriods = useMemo(() => detectHazePeriods(hazeDayStats), [hazeDayStats])

  const currentDetectedHaze = useMemo(() => {
    const latest = detectedHazePeriods[detectedHazePeriods.length - 1]
    if (!latest) {
      return null
    }

    return shiftDayKey(latest.endDayKey, 1) >= todayKey ? latest : null
  }, [detectedHazePeriods, todayKey])

  const isCurrentDetectedHazeConfirmed = useMemo(() => {
    if (!currentDetectedHaze || !hazeUiState.confirmedStartDayKey) {
      return false
    }

    return hazeUiState.confirmedStartDayKey === currentDetectedHaze.startDayKey
  }, [currentDetectedHaze, hazeUiState.confirmedStartDayKey])

  const activeConfirmedHazeStartDayKey = useMemo(() => {
    if (!isCurrentDetectedHazeConfirmed) {
      return null
    }

    return hazeUiState.confirmedStartDayKey
  }, [hazeUiState.confirmedStartDayKey, isCurrentDetectedHazeConfirmed])

  const visualizedConfirmedHazeStartDayKey = useMemo(() => {
    const candidates = [hazeUiState.confirmedStartDayKey, hazeUiState.lastConfirmedStartDayKey].filter(
      (value): value is string => Boolean(value),
    )

    for (const candidate of candidates) {
      if (detectedHazePeriods.some((period) => period.startDayKey === candidate)) {
        return candidate
      }
    }

    return null
  }, [detectedHazePeriods, hazeUiState.confirmedStartDayKey, hazeUiState.lastConfirmedStartDayKey])

  const hazeRecoverySignal = useMemo(
    () => getHazeRecoverySignal(hazeDayStats, activeConfirmedHazeStartDayKey),
    [hazeDayStats, activeConfirmedHazeStartDayKey],
  )

  const hazeCompassionByDay = useMemo(
    () => buildHazeCompassionByDay(detectedHazePeriods, visualizedConfirmedHazeStartDayKey, todayKey),
    [detectedHazePeriods, visualizedConfirmedHazeStartDayKey, todayKey],
  )

  const isDetectedHazeDismissed = useMemo(() => {
    if (!currentDetectedHaze) {
      return false
    }

    return Boolean(
      hazeUiState.dismissedStartDayKey === currentDetectedHaze.startDayKey &&
        hazeUiState.dismissedUntilDayKey &&
        todayKey <= hazeUiState.dismissedUntilDayKey,
    )
  }, [currentDetectedHaze, hazeUiState.dismissedStartDayKey, hazeUiState.dismissedUntilDayKey, todayKey])

  const showHazeEntryPrompt = Boolean(
    currentDetectedHaze && !isCurrentDetectedHazeConfirmed && !isDetectedHazeDismissed,
  )

  const showHazeExitPrompt = Boolean(
    hazeUiState.confirmedStartDayKey &&
      hazeRecoverySignal.recovered &&
      (!hazeUiState.exitPromptSnoozedUntilDayKey || todayKey > hazeUiState.exitPromptSnoozedUntilDayKey),
  )

  const activeHazeStat = hazeDayStats[hazeDayStats.length - 1] ?? null

  const strengthDaySeries = useMemo<ChartPoint[]>(() => {
    const dayKeys =
      insightRange === '30d'
        ? getRecentDayKeys(todayKey, 30)
        : getDayKeysBetween(fullRangeStartDay, todayKey)

    return dayKeys.map((dayKey) => {
      if (!activeHabits.length) {
        return { label: shortDayLabel(dayKey), value: 0 }
      }

      const totalStrength = activeHabits.reduce((sum, habit) => {
        const streakUnitsAtDayEnd = getConsecutiveSuccessUnits(
          habit,
          logs,
          shiftDayKey(dayKey, 1),
          {
            optimisticCurrentDayKey: dayKey === todayKey ? todayKey : undefined,
            hazeCompassionByDay,
          },
        )
        const strengthAtDayEnd = getStrength(getAdaptiveK(habit), streakUnitsAtDayEnd)
        return sum + strengthAtDayEnd
      }, 0)

      return {
        label: shortDayLabel(dayKey),
        dayKey,
        value: totalStrength / activeHabits.length,
      }
    })
  }, [activeHabits, logs, todayKey, insightRange, fullRangeStartDay, hazeCompassionByDay])

  const systemHazeRanges = useMemo(
    () => mapHazeRangesToChart(strengthDaySeries, detectedHazePeriods, visualizedConfirmedHazeStartDayKey),
    [strengthDaySeries, detectedHazePeriods, visualizedConfirmedHazeStartDayKey],
  )

  const totalGrowth = useMemo(() => {
    if (strengthDaySeries.length < 2) {
      return 0
    }
    return strengthDaySeries[strengthDaySeries.length - 1].value - strengthDaySeries[0].value
  }, [strengthDaySeries])

  const averageStrength = useMemo(() => {
    if (!activeHabits.length) {
      return 0
    }
    const total = activeHabits.reduce((sum, habit) => {
      const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey, { hazeCompassionByDay })
      const strength = getStrength(getAdaptiveK(habit), streakUnits)
      return sum + strength
    }, 0)
    return total / activeHabits.length
  }, [activeHabits, logs, todayKey, hazeCompassionByDay])

  const riskBuckets = useMemo(() => {
    let fragile = 0
    let forming = 0
    let automatic = 0

    for (const habit of activeHabits) {
      const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey, { hazeCompassionByDay })
      const strength = getStrength(getAdaptiveK(habit), streakUnits)
      const tier = getRiskTier(strength).title
      if (tier === 'Fragile') fragile += 1
      if (tier === 'Forming') forming += 1
      if (tier === 'Automatic') automatic += 1
    }

    return { fragile, forming, automatic }
  }, [activeHabits, logs, todayKey, hazeCompassionByDay])

  const insightHabitsSorted = useMemo(() => {
    return [...activeHabits].sort((a, b) => {
      const strengthA = getStrength(
        getAdaptiveK(a),
        getConsecutiveSuccessUnits(a, logs, todayKey, { hazeCompassionByDay }),
      )
      const strengthB = getStrength(
        getAdaptiveK(b),
        getConsecutiveSuccessUnits(b, logs, todayKey, { hazeCompassionByDay }),
      )
      return strengthB - strengthA
    })
  }, [activeHabits, logs, todayKey, hazeCompassionByDay])

  const activeGalleryHabit = useMemo(
    () => insightHabitsSorted.find((habit) => habit.id === galleryHabitId) ?? null,
    [galleryHabitId, insightHabitsSorted],
  )

  const activeGalleryEntries = useMemo<MediaGalleryEntry[]>(() => {
    if (!activeGalleryHabit) {
      return []
    }

    return logs
      .filter((log) => log.habitId === activeGalleryHabit.id)
      .map((log) => ({
        logId: log.id,
        dayKey: log.dayKey,
        completedAt: log.completedAt,
        report: parseReport(log.reportValue),
      }))
      .filter(
        (
          entry,
        ): entry is {
          logId: string
          dayKey: string
          completedAt: string
          report: ParsedReport & { type: 'photo' | 'selfie'; imageDataUrl: string }
        } => isMediaGalleryReport(entry.report),
      )
      .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
  }, [activeGalleryHabit, logs])

  const selectedActiveGalleryEntry = useMemo(() => {
    if (!galleryHabitId) {
      return null
    }

    return (
      activeGalleryEntries.find((entry) => entry.logId === selectedMediaLogIds[galleryHabitId]) ??
      activeGalleryEntries[0] ??
      null
    )
  }, [activeGalleryEntries, galleryHabitId, selectedMediaLogIds])

  useEffect(() => {
    if (!galleryHabitId) {
      return
    }

    if (!activeGalleryEntries.length) {
      setGalleryHabitId(null)
      return
    }

    const selectedLogId = selectedMediaLogIds[galleryHabitId]
    if (!selectedLogId) {
      setSelectedMediaLogIds((prev) => ({
        ...prev,
        [galleryHabitId]: activeGalleryEntries[0].logId,
      }))
      return
    }

    const stillExists = activeGalleryEntries.some((entry) => entry.logId === selectedLogId)
    if (!stillExists) {
      setSelectedMediaLogIds((prev) => ({
        ...prev,
        [galleryHabitId]: activeGalleryEntries[0].logId,
      }))
    }
  }, [activeGalleryEntries, galleryHabitId, selectedMediaLogIds])

  function openAddEditor(): void {
    setEditingHabitId(null)
    setDraft(defaultDraft())
    setIsEditorOpen(true)
  }

  function openEditEditor(habit: Habit): void {
    setEditingHabitId(habit.id)
    setDraft({
      name: habit.name,
      description: habit.description,
      desiredCount: habit.desiredFrequency.count,
      desiredPer: habit.desiredFrequency.per,
      difficultyK: habit.difficultyK,
      decayFactor: habit.decayFactor,
      phase: habit.phase,
      reportingType: habit.reportingType,
    })
    setIsEditorOpen(true)
  }

  function incrementStreakBreakIfNeeded(habit: Habit): void {
    const todayCount = countHabitCompletionsForDay(habit.id, todayKey, logs)
    if (todayCount > 0) {
      return
    }

    const previous = logs
      .filter((log) => log.habitId === habit.id && log.dayKey < todayKey)
      .sort((a, b) => b.dayKey.localeCompare(a.dayKey))[0]

    if (!previous) {
      return
    }

    const yesterday = shiftDayKey(todayKey, -1)
    if (previous.dayKey !== yesterday) {
      setHabits((prev) =>
        prev.map((entry) =>
          entry.id === habit.id ? { ...entry, streakBreaks: entry.streakBreaks + 1 } : entry,
        ),
      )
    }
  }

  function clearPostCompletionInputs(habitId: string): void {
    setCardInputs((prev) => {
      const next = { ...prev }
      delete next[habitId]
      return next
    })
    setEmotionPrimary((prev) => ({ ...prev, [habitId]: null }))
  }

  function appendHabitLog(
    habit: Habit,
    report: ParsedReport,
    targetDayKey = todayKey,
  ): HabitLog {
    if (targetDayKey === todayKey) {
      incrementStreakBreakIfNeeded(habit)
    }

    const entry: HabitLog = {
      id: crypto.randomUUID(),
      habitId: habit.id,
      dayKey: targetDayKey,
      completedAt: new Date().toISOString(),
      reportValue: JSON.stringify(report),
    }

    setLogs((previous) => [...previous, entry])
    clearPostCompletionInputs(habit.id)
    return entry
  }

  function updateHabitLogReport(logId: string, report: ParsedReport): void {
    setLogs((previous) =>
      previous.map((log) =>
        log.id === logId
          ? {
              ...log,
              reportValue: JSON.stringify(report),
            }
          : log,
      ),
    )
  }

  function completeHabit(habit: Habit, report: ParsedReport, targetDayKey = todayKey): void {
    appendHabitLog(habit, report, targetDayKey)
    const encouragements = language === 'fa' ? ENCOURAGEMENTS_FA : ENCOURAGEMENTS
    setRewardMessage(encouragements[Math.floor(Math.random() * encouragements.length)])
  }

  function saveHabit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!draft.name.trim()) {
      return
    }

    const normalizedK = clamp(draft.difficultyK, 0.01, 0.12)
    const normalizedDecay = clamp(draft.decayFactor, 0.5, 0.98)
    const normalizedCount = clamp(Math.round(draft.desiredCount), 1, 14)

    if (editingHabitId) {
      setHabits((prev) =>
        prev.map((habit) =>
          habit.id === editingHabitId
            ? {
                ...habit,
                name: draft.name.trim(),
                description: draft.description.trim(),
                desiredFrequency: {
                  count: normalizedCount,
                  per: draft.desiredPer,
                },
                difficultyK: normalizedK,
                decayFactor: normalizedDecay,
                phase: draft.phase,
                reportingType: draft.reportingType,
              }
            : habit,
        ),
      )
    } else {
      const newHabit: Habit = {
        id: crypto.randomUUID(),
        name: draft.name.trim(),
        description: draft.description.trim(),
        desiredFrequency: {
          count: normalizedCount,
          per: draft.desiredPer,
        },
        difficultyK: normalizedK,
        decayFactor: normalizedDecay,
        streakBreaks: 0,
        phase: draft.phase,
        reportingType: draft.reportingType,
        srhiReports: [],
        createdAt: new Date().toISOString(),
        archived: false,
      }
      setHabits((prev) => [...prev, newHabit])
    }

    setIsEditorOpen(false)
  }

  function archiveHabit(): void {
    if (!editingHabitId) {
      return
    }
    setHabits((prev) =>
      prev.map((habit) =>
        habit.id === editingHabitId ? { ...habit, archived: true } : habit,
      ),
    )
    setIsEditorOpen(false)
  }

  function startCardLongPress(habit: Habit): void {
    if (cardLongPressTimer.current) {
      window.clearTimeout(cardLongPressTimer.current)
    }
    cardLongPressTimer.current = window.setTimeout(() => {
      openEditEditor(habit)
    }, 600)
  }

  function clearCardLongPress(): void {
    if (cardLongPressTimer.current) {
      window.clearTimeout(cardLongPressTimer.current)
      cardLongPressTimer.current = null
    }
  }

  function startAddLongPress(): void {
    if (addButtonTimer.current) {
      window.clearTimeout(addButtonTimer.current)
    }
    addButtonTimer.current = window.setTimeout(() => {
      ignoreAddClick.current = true
      setIsImportExportOpen(true)
    }, 600)
  }

  function endAddPress(): void {
    if (addButtonTimer.current) {
      window.clearTimeout(addButtonTimer.current)
      addButtonTimer.current = null
    }
  }

  function handleAddClick(): void {
    if (ignoreAddClick.current) {
      ignoreAddClick.current = false
      return
    }
    openAddEditor()
  }

  function updateCardInput(habitId: string, value: string): void {
    setCardInputs((prev) => ({ ...prev, [habitId]: value }))
  }

  function closeCameraSession(): void {
    const stream = cameraStreamRef.current
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop()
      }
    }
    cameraStreamRef.current = null
    if (cameraVideoRef.current) {
      cameraVideoRef.current.srcObject = null
    }
    setCameraPreviewReady(false)
    setCameraStreamError('')
    setCameraSession(null)
    setCaptureBusyHabitId(null)
  }

  async function saveCapturedImage(
    habit: Habit,
    targetDayKey: string,
    mode: 'photo' | 'selfie',
    imageDataUrl: string,
  ): Promise<void> {
    const caption = (cardInputs[habit.id] ?? '').trim()

    if (mode === 'photo') {
      completeHabit(
        habit,
        {
          type: 'photo',
          imageDataUrl,
          caption,
        },
        targetDayKey,
      )
      return
    }

    const pendingReport: ParsedReport = {
      type: 'selfie',
      imageDataUrl,
      caption,
      faceAnalysisStatus: 'pending',
      faceAnalysisMessage: tx(
        'Waiting for face analysis to finish.',
        'در انتظار پایان تحلیل چهره.',
      ),
    }
    const entry = appendHabitLog(habit, pendingReport, targetDayKey)
    setRewardMessage(
      tx(
        'Selfie saved. Face tone is being analyzed in the background.',
        'سلفی ذخیره شد. تحلیل حالِ چهره در پس‌زمینه انجام می‌شود.',
      ),
    )

    void analyzeFaceSentiment(imageDataUrl)
      .then((analysis) => {
        updateHabitLogReport(entry.id, {
          type: 'selfie',
          imageDataUrl,
          caption,
          faceLabel: analysis.result?.label,
          faceScore: analysis.result?.score,
          sentiment: analysis.result?.score,
          faceAnalysisStatus: analysis.status === 'ready' ? 'ready' : 'unavailable',
          faceAnalysisMessage: analysis.message,
          faceAnalysisDelegate: analysis.delegate,
        })
      })
      .catch(() => {
        updateHabitLogReport(entry.id, {
          type: 'selfie',
          imageDataUrl,
          caption,
          faceAnalysisStatus: 'unavailable',
          faceAnalysisMessage: tx(
            'Face analysis crashed before it could finish.',
            'تحلیل چهره پیش از تکمیل متوقف شد.',
          ),
        })
      })
  }

  async function chooseImageFromFiles(
    habit: Habit,
    targetDayKey: string,
    mode: 'photo' | 'selfie',
  ): Promise<void> {
    const file = await openImageCapture(mode === 'photo' ? 'environment' : 'user')
    if (!file) {
      return
    }

    const imageDataUrl = await fileToCompressedImageDataUrl(file)
    await saveCapturedImage(habit, targetDayKey, mode, imageDataUrl)
  }

  async function capturePhotoFromPreview(): Promise<void> {
    if (!cameraSession) {
      return
    }

    const video = cameraVideoRef.current
    if (!video || !video.videoWidth || !video.videoHeight) {
      setCameraStreamError(
        tx(
          'The camera preview is not ready yet. Try again in a moment.',
          'پیش‌نمایش دوربین هنوز آماده نیست. یک لحظه دیگر دوباره تلاش کن.',
        ),
      )
      return
    }

    const habit = habits.find((entry) => entry.id === cameraSession.habitId)
    if (!habit) {
      closeCameraSession()
      return
    }

    try {
      const canvas = document.createElement('canvas')
      canvas.width = video.videoWidth
      canvas.height = video.videoHeight
      const context = canvas.getContext('2d')
      if (!context) {
        throw new Error(tx('Could not capture this frame.', 'ثبت این فریم انجام نشد.'))
      }

      context.drawImage(video, 0, 0, canvas.width, canvas.height)
      const imageDataUrl = canvas.toDataURL('image/jpeg', 0.85)
      await saveCapturedImage(habit, cameraSession.targetDayKey, cameraSession.mode, imageDataUrl)
      closeCameraSession()
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tx('Could not capture the photo.', 'گرفتن عکس انجام نشد.')
      setCameraStreamError(message)
    }
  }

  async function syncDriveBackup(reason: 'manual' | 'auto'): Promise<boolean> {
    const clientId = effectiveDriveClientId
    if (!clientId) {
      setDriveBackupStatus(
        tx(
          'Google Drive is not configured yet. Add an app client ID first.',
          'گوگل‌درایو هنوز پیکربندی نشده است. ابتدا شناسه کلاینت برنامه را اضافه کن.',
        ),
      )
      return false
    }

    if (reason === 'auto' && isDriveSyncing) {
      return false
    }

    setIsDriveSyncing(true)

    try {
      const result = await uploadBackupToDrive({
        clientId,
        content: exportPayload,
        fileId: driveBackupSettings.fileId,
        interactive: reason === 'manual',
      })

      const syncedAt = result.modifiedTime ?? new Date().toISOString()
      setDriveBackupSettings((prev) => ({
        ...prev,
        clientId,
        enabled: true,
        fileId: result.fileId,
        lastSyncedAt: syncedAt,
        lastError: '',
      }))
      lastDriveBackupPayloadRef.current = exportPayload
      setDriveBackupStatus(
        tx('Google Drive backup is up to date.', 'پشتیبان‌گیری گوگل‌درایو به‌روز شد.'),
      )
      return true
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tx('Drive backup failed.', 'پشتیبان‌گیری درایو انجام نشد.')
      setDriveBackupSettings((prev) => ({
        ...prev,
        lastError: message,
      }))
      setDriveBackupStatus(message)
      return false
    } finally {
      setIsDriveSyncing(false)
    }
  }

  async function restoreFromGoogleDrive(): Promise<void> {
    const clientId = effectiveDriveClientId
    if (!clientId) {
      setDriveBackupStatus(
        tx(
          'Google Drive is not configured yet. Add an app client ID first.',
          'گوگل‌درایو هنوز پیکربندی نشده است. ابتدا شناسه کلاینت برنامه را اضافه کن.',
        ),
      )
      return
    }

    setIsDriveSyncing(true)

    try {
      const restored = await restoreBackupFromDrive({
        clientId,
        fileId: driveBackupSettings.fileId,
        interactive: true,
      })
      const imported = fromImportedData(restored.state)
      if (!imported) {
        throw new Error(tx('The Drive backup file is invalid.', 'فایل پشتیبان درایو معتبر نیست.'))
      }

      setHabits(imported.habits)
      setLogs(imported.logs)
      setHazeUiState(defaultHazeUiState())
      const restoredAt = new Date().toISOString()
      setDriveBackupSettings((prev) => ({
        ...prev,
        clientId,
        enabled: true,
        fileId: restored.fileId,
        lastSyncedAt: restoredAt,
        lastError: '',
      }))
      lastDriveBackupPayloadRef.current = JSON.stringify(toExportData(imported), null, 2)
      setDriveBackupStatus(
        tx('Drive backup restored into this device.', 'پشتیبان درایو روی این دستگاه بازیابی شد.'),
      )
      setRewardMessage(
        tx('Your latest Drive backup is back in place.', 'آخرین پشتیبان درایو دوباره سر جایش قرار گرفت.'),
      )
      setIsImportExportOpen(false)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tx('Could not restore from Google Drive.', 'بازیابی از گوگل‌درایو انجام نشد.')
      setDriveBackupSettings((prev) => ({
        ...prev,
        lastError: message,
      }))
      setDriveBackupStatus(message)
    } finally {
      setIsDriveSyncing(false)
    }
  }

  function resetDriveBackup(): void {
    setDriveBackupSettings({
      ...defaultDriveBackupSettings(),
      clientId: configuredDriveClientId,
    })
    setDriveBackupStatus(
      tx(
        'Drive backup settings cleared for this device.',
        'تنظیمات پشتیبان‌گیری درایو برای این دستگاه پاک شد.',
      ),
    )
    lastDriveBackupPayloadRef.current = ''
  }

  async function handleCameraReport(
    habit: Habit,
    targetDayKey: string,
    mode: 'photo' | 'selfie',
  ): Promise<void> {
    try {
      setCaptureBusyHabitId(habit.id)
      if (typeof navigator.mediaDevices?.getUserMedia === 'function') {
        setCameraSession({
          habitId: habit.id,
          targetDayKey,
          mode,
        })
        return
      }

      await chooseImageFromFiles(habit, targetDayKey, mode)
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : tx('Could not process the selected photo.', 'عکس انتخاب‌شده پردازش نشد.')
      alert(message)
    } finally {
      setCaptureBusyHabitId(null)
    }
  }

  function exportData(): void {
    const blob = new Blob([exportPayload], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = `habit-feed-export-${todayKey}.json`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(url)
    setIsImportExportOpen(false)
  }

  async function importData(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) {
      return
    }

    try {
      const content = await file.text()
      const parsed = JSON.parse(content)
      const imported = fromImportedData(parsed)
      if (!imported) {
        alert('Import failed: invalid file structure.')
        return
      }
      setHabits(imported.habits)
      setLogs(imported.logs)
      setHazeUiState(defaultHazeUiState())
      setIsImportExportOpen(false)
      setRewardMessage(tx('Import completed. You are safely back online.', 'ورود اطلاعات انجام شد. همه چیز آماده است.'))
    } catch {
      alert('Import failed: invalid JSON.')
    }
  }

  function openSrhiReport(habit: Habit): void {
    setSrhiHabitId(habit.id)
    const latest = habit.srhiReports.at(-1)
    setSrhiDraft(latest?.scores ?? [4, 4, 4, 4])
  }

  function saveSrhiReport(): void {
    if (!srhiHabitId) {
      return
    }

    const report: SrhiReport = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      scores: srhiDraft,
    }

    setHabits((prev) =>
      prev.map((habit) =>
        habit.id === srhiHabitId
          ? { ...habit, srhiReports: [...habit.srhiReports, report] }
          : habit,
      ),
    )

    setSrhiHabitId(null)
    setRewardMessage(tx('SRHI check-in saved. You are learning your pattern.', 'ثبت SRHI ذخیره شد. الگوی خودت را بهتر می‌شناسی.'))
  }

  if (!isLoaded) {
    return <main className="app-shell">{tx('Loading your habits…', 'در حال بارگذاری عادت‌ها…')}</main>
  }

  function renderHabitCard(habit: Habit, targetDayKey: string, isBackfill = false) {
    const streakUnits = getConsecutiveSuccessUnits(habit, logs, targetDayKey, { hazeCompassionByDay })
    const adaptiveK = getAdaptiveK(habit)
    const strength = getStrength(adaptiveK, streakUnits)
    const riskTier = getRiskTier(strength)
    const stage = getStageProgress(strength)
    const period = getPeriodProgress(habit, logs, targetDayKey)
    const isTodayCard = targetDayKey === todayKey
    const periodLabel =
      habit.desiredFrequency.per === 'day'
        ? language === 'fa'
          ? `${period.done}/${period.target} ${isTodayCard ? 'امروز' : 'دیروز'}`
          : `${period.done}/${period.target} ${isTodayCard ? 'today' : 'yesterday'}`
        : language === 'fa'
          ? `${period.done}/${period.target} ${isTodayCard ? 'این هفته' : 'هفته قبل'}`
          : `${period.done}/${period.target} ${isTodayCard ? 'this week' : 'last week'}`

    return (
      <article
        key={`${habit.id}-${targetDayKey}`}
        className={`habit-card ${riskTier.className}`}
        onPointerDown={!isBackfill ? () => startCardLongPress(habit) : undefined}
        onPointerUp={!isBackfill ? clearCardLongPress : undefined}
        onPointerLeave={!isBackfill ? clearCardLongPress : undefined}
        onPointerCancel={!isBackfill ? clearCardLongPress : undefined}
      >
        <div className="habit-header">
          <h2>{habit.name}</h2>
          <span className="phase-chip">{getPhaseLabel(habit.phase, language)}</span>
        </div>

        <p className="status-line">
          <span>{riskTier.icon}</span>
          <strong>{getRiskTitle(riskTier.title, language)}</strong>
        </p>
        <p className="status-hint">
          {getRiskHint(riskTier.title, language)} · {periodLabel}
        </p>

        <div className="stage-progress">
          <p className="stage-progress-label">
            {stage.next
              ? tx(
                  `${getRiskTitle(stage.current, language)} → ${getRiskTitle(stage.next, language)}: ${stage.progressPct.toFixed(0)}%`,
                  `${getRiskTitle(stage.current, language)} ← ${getRiskTitle(stage.next, language)}: ${stage.progressPct.toFixed(0)}%`,
                )
              : tx('Automatic growth: ', 'رشد خودکار: ') + `${stage.progressPct.toFixed(0)}%`}
          </p>
          <div className="stage-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.progressPct)}>
            <div className="stage-progress-fill" style={{ width: `${stage.progressPct}%` }}></div>
          </div>
        </div>

        <div className="reporting-box">
          {habit.reportingType === 'button' && (
            <button className="primary-btn" onClick={() => completeHabit(habit, { type: 'button' }, targetDayKey)}>
              {tx('I did it', 'انجام شد')} ({period.remaining} {tx('left', 'باقی‌مانده')})
            </button>
          )}

          {habit.reportingType === 'mood' && (
            <>
              <label className="field-label">{tx('Pick your mood', 'حال خودت را انتخاب کن')}</label>
              <div className="emoji-row">
                {MOOD_EMOJIS.map((emoji, index) => (
                  <button
                    key={`${habit.id}-${targetDayKey}-mood-${emoji}`}
                    className="emoji-btn"
                    onClick={() => completeHabit(habit, { type: 'mood', mood: index + 1 }, targetDayKey)}
                    title={`Mood ${index + 1}`}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            </>
          )}

          {habit.reportingType === 'emotion' && (
            <>
              <label className="field-label">{tx('Primary emotion', 'احساس اصلی')}</label>
              <div className="emotion-grid">
                {EMOTION_GROUPS.map((group) => (
                  <button
                    key={`${habit.id}-${targetDayKey}-${group.key}`}
                    className="chip-btn emotion-primary"
                    style={{ borderColor: group.color }}
                    onClick={() =>
                      setEmotionPrimary((prev) => ({
                        ...prev,
                        [habit.id]: group.key,
                      }))
                    }
                  >
                    {language === 'fa' ? group.labelFa : group.labelEn}
                  </button>
                ))}
              </div>

              {emotionPrimary[habit.id] && (
                <>
                  <label className="field-label">{tx('Secondary emotion', 'احساس ثانویه')}</label>
                  <div className="emotion-grid">
                    {EMOTION_GROUPS.find((group) => group.key === emotionPrimary[habit.id])?.secondary.map(
                      (secondary) => (
                        <button
                          key={`${habit.id}-${targetDayKey}-${secondary.en}`}
                          className="chip-btn"
                          onClick={() =>
                            completeHabit(
                              habit,
                              {
                                type: 'emotion',
                                emotionPrimary:
                                  EMOTION_GROUPS.find((group) => group.key === emotionPrimary[habit.id])
                                    ?.labelEn ?? '',
                                emotionSecondary: secondary.en,
                              },
                              targetDayKey,
                            )
                          }
                        >
                          {language === 'fa' ? secondary.fa : secondary.en}
                        </button>
                      ),
                    )}
                  </div>
                </>
              )}
            </>
          )}

          {habit.reportingType === 'text' && (
            <>
              <label className="field-label" htmlFor={`text-${habit.id}-${targetDayKey}`}>
                {tx('Journal note', 'یادداشت روزانه')}
              </label>
              <textarea
                id={`text-${habit.id}-${targetDayKey}`}
                className="text-input text-area"
                placeholder={
                  isTodayCard
                    ? tx('Write a few lines about this habit today…', 'چند خط درباره این عادت امروز بنویس…')
                    : tx('Write a few lines about this habit yesterday…', 'چند خط درباره این عادت دیروز بنویس…')
                }
                value={cardInputs[habit.id] ?? ''}
                onChange={(event) => updateCardInput(habit.id, event.target.value)}
              />
              <button
                className="primary-btn"
                onClick={() => {
                  const text = (cardInputs[habit.id] ?? '').trim()
                  if (!text) {
                    return
                  }
                  completeHabit(
                    habit,
                    {
                      type: 'text',
                      text,
                      sentiment: analyzeSentiment(text),
                    },
                    targetDayKey,
                  )
                }}
              >
                {tx('Save journal entry', 'ثبت یادداشت')}
              </button>
            </>
          )}

          {habit.reportingType === 'photo' && (
            <>
              <label className="field-label" htmlFor={`photo-caption-${habit.id}-${targetDayKey}`}>
                {tx('Photo note (optional)', 'یادداشت عکس (اختیاری)')}
              </label>
              <textarea
                id={`photo-caption-${habit.id}-${targetDayKey}`}
                className="text-input text-area"
                placeholder={
                  isTodayCard
                    ? tx('What does this photo capture today?', 'این عکس امروز چه چیزی را ثبت می‌کند؟')
                    : tx('Add a short note for this catch-up photo…', 'برای این عکس جبرانی یک توضیح کوتاه بنویس…')
                }
                value={cardInputs[habit.id] ?? ''}
                onChange={(event) => updateCardInput(habit.id, event.target.value)}
              />
              <button
                className="primary-btn"
                disabled={captureBusyHabitId === habit.id}
                onClick={() => {
                  void handleCameraReport(habit, targetDayKey, 'photo')
                }}
              >
                {captureBusyHabitId === habit.id
                  ? tx('Opening camera…', 'در حال باز کردن دوربین…')
                  : tx('Take photo journal', 'ثبت ژورنال تصویری')}
              </button>
            </>
          )}

          {habit.reportingType === 'selfie' && (
            <>
              <label className="field-label" htmlFor={`selfie-caption-${habit.id}-${targetDayKey}`}>
                {tx('Selfie note (optional)', 'یادداشت سلفی (اختیاری)')}
              </label>
              <textarea
                id={`selfie-caption-${habit.id}-${targetDayKey}`}
                className="text-input text-area"
                placeholder={
                  isTodayCard
                    ? tx('Add context for this moment if you want…', 'اگر دوست داری برای این لحظه توضیح بنویس…')
                    : tx('Add context for this catch-up selfie…', 'برای این سلفی جبرانی توضیح کوتاهی بنویس…')
                }
                value={cardInputs[habit.id] ?? ''}
                onChange={(event) => updateCardInput(habit.id, event.target.value)}
              />
              <p className="meta-line camera-helper">
                {tx(
                  'A lightweight on-device face read estimates a rough tone. It is only a cue, not a diagnosis.',
                  'یک خوانش سبکِ روی دستگاه، حال تقریبی چهره را حدس می‌زند. فقط یک نشانه است، نه تشخیص.',
                )}
              </p>
              <button
                className="primary-btn"
                disabled={captureBusyHabitId === habit.id}
                onClick={() => {
                  void handleCameraReport(habit, targetDayKey, 'selfie')
                }}
              >
                {captureBusyHabitId === habit.id
                  ? tx('Opening camera…', 'در حال باز کردن دوربین…')
                  : tx('Take selfie + read tone', 'گرفتن سلفی + خواندن حال')}
              </button>
            </>
          )}
        </div>
      </article>
    )
  }

  return (
    <main className="app-shell" dir={language === 'fa' ? 'rtl' : 'ltr'}>
      <header className="top-bar">
        <div className="top-row">
          <h1>{tx('Habit Feed', 'فید عادت‌ها')}</h1>
          <div className="top-actions">
            <button className="secondary-btn" onClick={() => setIsInsightsOpen(true)}>
              {tx('Insights', 'تحلیل‌ها')}
            </button>
            {!isInstalled && deferredInstallPrompt && (
              <button className="secondary-btn" onClick={() => void installPwa()}>
                {tx('Install', 'نصب')}
              </button>
            )}
            <button
              className="secondary-btn"
              onClick={() => setLanguage((prev) => (prev === 'en' ? 'fa' : 'en'))}
            >
              {language === 'en' ? 'FA' : 'EN'}
            </button>
          </div>
        </div>
        <p>
          {getPhaseLabel(currentPhase, language)} · {visibleHabits.length}{' '}
          {tx('active cards', 'کارت فعال')} · {completedToday} {tx('habits touched today', 'عادت ثبت‌شده امروز')}
        </p>
      </header>

      {rewardMessage && <div className="reward-toast">{rewardMessage}</div>}

      <section className="feed" aria-label="Daily habits feed">
        {(showHazeEntryPrompt || showHazeExitPrompt) && (
          <article className="haze-card">
            <div className="haze-card-copy">
              <span className="haze-card-icon">☁️</span>
              <div>
                <h2>
                  {showHazeEntryPrompt
                    ? tx('Looks like an off-days stretch', 'به نظر می‌رسد وارد چند روز غبارآلود شده‌ای')
                    : showHazeExitPrompt
                      ? tx('Things look lighter again', 'به نظر می‌رسد هوا دوباره سبک‌تر شده')
                      : tx('Haze mode is on', 'حالت غبارآلود فعال است')}
                </h2>
                <p>
                  {showHazeEntryPrompt
                    ? tx(
                        'Your recent completion rhythm dipped below your usual baseline. If this is real, the app can soften the decline and stay gentle until you come out of it.',
                        'ریتم چند روز اخیرت از خط پایه معمولت پایین‌تر آمده است. اگر این وضعیت واقعی است، برنامه می‌تواند افت را نرم‌تر حساب کند و تا خروج از این فاز غبارآلود با تو مهربان بماند.',
                      )
                    : showHazeExitPrompt
                      ? tx(
                          'Your recent days look steadier. If you are coming out of the haze, I can close this stretch and keep the softened dip it earned.',
                          'چند روز اخیرت باثبات‌تر به نظر می‌رسد. اگر داری از این دوره غبارآلود خارج می‌شوی، می‌توانم این بازه را ببندم و همان افت نرم‌شده را حفظ کنم.',
                        )
                      : tx(
                          'During haze, decline is softened and tiny reps still count. If you rebound after it, the dip gets forgiven even more.',
                          'در دوره غبارآلود، افت نرم‌تر محاسبه می‌شود و قدم‌های خیلی کوچک هم حساب می‌شوند. اگر بعدش دوباره اوج بگیری، افت این دوره بیشتر بخشیده می‌شود.',
                        )}
                </p>
                {activeHazeStat && (
                  <p className="haze-card-meta">
                    {tx('Today vs baseline', 'امروز در مقایسه با خط پایه')}: {' '}
                    <strong>{Math.round(activeHazeStat.ratio * 100)}%</strong>
                    {typeof activeHazeStat.baseline === 'number' && (
                      <>
                        {' '}
                        · {tx('baseline', 'خط پایه')} <strong>{Math.round(activeHazeStat.baseline * 100)}%</strong>
                      </>
                    )}
                  </p>
                )}
              </div>
            </div>

            <div className="haze-card-actions">
              {showHazeEntryPrompt && currentDetectedHaze && (
                <>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      setHazeUiState((prev) => ({
                        ...prev,
                        confirmedStartDayKey: currentDetectedHaze.startDayKey,
                        lastConfirmedStartDayKey: currentDetectedHaze.startDayKey,
                        dismissedStartDayKey: null,
                        dismissedUntilDayKey: null,
                        exitPromptSnoozedUntilDayKey: null,
                      }))
                      setRewardMessage(
                        tx(
                          'Haze mode is on. The app will be gentler with this dip.',
                          'حالت غبارآلود فعال شد. برنامه با این افت مهربان‌تر برخورد می‌کند.',
                        ),
                      )
                    }}
                  >
                    {tx('Yes, this is a haze stretch', 'بله، این یک دوره غبارآلود است')}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setHazeUiState((prev) => ({
                        ...prev,
                        confirmedStartDayKey:
                          prev.confirmedStartDayKey === currentDetectedHaze.startDayKey
                            ? null
                            : prev.confirmedStartDayKey,
                        lastConfirmedStartDayKey:
                          prev.lastConfirmedStartDayKey === currentDetectedHaze.startDayKey
                            ? null
                            : prev.lastConfirmedStartDayKey,
                        dismissedStartDayKey: currentDetectedHaze.startDayKey,
                        dismissedUntilDayKey: shiftDayKey(todayKey, 3),
                      }))
                    }}
                  >
                    {tx('Not really', 'نه، لزوماً این‌طور نیست')}
                  </button>
                </>
              )}

              {!showHazeEntryPrompt && showHazeExitPrompt && (
                <>
                  <button
                    type="button"
                    className="primary-btn"
                    onClick={() => {
                      setHazeUiState((prev) => ({
                        ...prev,
                        confirmedStartDayKey: null,
                        lastConfirmedStartDayKey: prev.confirmedStartDayKey ?? prev.lastConfirmedStartDayKey,
                        exitPromptSnoozedUntilDayKey: null,
                        dismissedStartDayKey: prev.confirmedStartDayKey,
                        dismissedUntilDayKey: shiftDayKey(todayKey, 2),
                      }))
                      setRewardMessage(
                        tx(
                          'Marked as coming out of haze. Welcome back gently.',
                          'خروج از فاز غبارآلود ثبت شد. خوش برگشتی، آرام و مهربان.',
                        ),
                      )
                    }}
                  >
                    {tx('Yes, I am coming out', 'بله، دارم از آن خارج می‌شوم')}
                  </button>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => {
                      setHazeUiState((prev) => ({
                        ...prev,
                        exitPromptSnoozedUntilDayKey: shiftDayKey(todayKey, 2),
                      }))
                    }}
                  >
                    {tx('Still in it', 'هنوز در آن هستم')}
                  </button>
                </>
              )}

            </div>
          </article>
        )}

        {visibleHabits.length === 0 && (
          <article className="empty-state">
            <h2>{tx('Feed is clear ✨', 'فید خلوت شد ✨')}</h2>
            <p>
              {tx(
                'Cards flow in by phase, and long press + opens import/export. You are doing enough.',
                'کارت‌ها با فازهای روز وارد می‌شوند و نگه‌داشتن + ابزار ورود/خروج داده را باز می‌کند. همین مقدار کافی و عالی است.',
              )}
            </p>
          </article>
        )}

        {visibleHabits.map((habit) => renderHabitCard(habit, todayKey))}

        <div className="anytime-section">
          <div className="feed-separator">
            <span>
              {tx('Anytime habits', 'عادت‌های هرزمان')}
              {hasUrgentAnytimeHabits ? ` · ${tx('deadline approaching', 'نزدیک به پایان بازه')}` : ''}
            </span>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowAnytimeHabits((prev) => !prev)}
            >
              {showAnytimeHabits
                ? tx('Hide anytime habits', 'مخفی‌کردن عادت‌های هرزمان')
                : tx('Show anytime habits', 'نمایش عادت‌های هرزمان')}
            </button>
          </div>

          {showAnytimeHabits && (
            <div className="anytime-list">
              {anytimeHabits.length === 0 ? (
                <article className="empty-state">
                  <h2>{tx('Anytime list is clear ✨', 'لیست هرزمان خلوت شد ✨')}</h2>
                  <p>{tx('No pending anytime habits right now.', 'فعلاً عادت هرزمانیِ باقی‌مانده‌ای نداری.')}</p>
                </article>
              ) : (
                anytimeHabits.map((habit) => renderHabitCard(habit, todayKey))
              )}
            </div>
          )}
        </div>

        <div className="backfill-section">
          <div className="feed-separator">
            <span>{tx('Missed yesterday?', 'دیروز جا موند؟')}</span>
            <button
              type="button"
              className="secondary-btn"
              onClick={() => setShowPreviousDayHabits((prev) => !prev)}
            >
              {showPreviousDayHabits
                ? tx('Hide previous day', 'مخفی‌کردن دیروز')
                : tx('Load previous day habits', 'نمایش عادت‌های دیروز')}
            </button>
          </div>

          {showPreviousDayHabits && (
            <div className="backfill-list">
              {previousDayHabits.length === 0 ? (
                <article className="empty-state">
                  <h2>{tx('Nothing pending from yesterday ✨', 'از دیروز موردی باقی نمانده ✨')}</h2>
                  <p>{tx('You are caught up.', 'همه چیز به‌روز است.')}</p>
                </article>
              ) : (
                previousDayHabits.map((habit) => renderHabitCard(habit, yesterdayKey, true))
              )}
            </div>
          )}
        </div>
      </section>

      <input
        ref={importInputRef}
        type="file"
        accept="application/json"
        className="hidden-file"
        onChange={(event) => {
          void importData(event)
        }}
      />

      <button
        className="fab"
        onPointerDown={startAddLongPress}
        onPointerUp={endAddPress}
        onPointerLeave={endAddPress}
        onPointerCancel={endAddPress}
        onClick={handleAddClick}
        aria-label={tx('Add habit', 'افزودن عادت')}
      >
        +
      </button>

      {isEditorOpen && (
        <div className="overlay" role="dialog" aria-modal="true">
          <form className="modal" onSubmit={saveHabit}>
            <h3>{editingHabitId ? tx('Manage habit', 'مدیریت عادت') : tx('Add habit', 'افزودن عادت')}</h3>

            <label className="field-label" htmlFor="habit-name">
              {tx('Habit name', 'نام عادت')}
            </label>
            <input
              id="habit-name"
              className="text-input"
              required
              value={draft.name}
              onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))}
            />

            <label className="field-label" htmlFor="habit-description">
              {tx('Description', 'توضیح')}
            </label>
            <textarea
              id="habit-description"
              className="text-input text-area"
              value={draft.description}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, description: event.target.value }))
              }
            />

            <label className="field-label">{tx('Desired frequency', 'تناوب هدف')}</label>
            <div className="inline-fields">
              <input
                className="text-input"
                type="number"
                min={1}
                max={14}
                value={draft.desiredCount}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    desiredCount: Number(event.target.value) || 1,
                  }))
                }
              />
              <select
                className="text-input"
                value={draft.desiredPer}
                onChange={(event) =>
                  setDraft((prev) => ({
                    ...prev,
                    desiredPer: event.target.value as 'day' | 'week',
                  }))
                }
              >
                <option value="day">{tx('per day', 'در روز')}</option>
                <option value="week">{tx('per week', 'در هفته')}</option>
              </select>
            </div>

            <label className="field-label" htmlFor="habit-phase">
              {tx('Time phase', 'فاز زمانی')}
            </label>
            <select
              id="habit-phase"
              className="text-input"
              value={draft.phase}
              onChange={(event) =>
                setDraft((prev) => ({ ...prev, phase: event.target.value as HabitPhase }))
              }
            >
              {PHASE_OPTIONS.map((phase) => (
                <option key={phase} value={phase}>
                  {getPhaseLabel(phase, language)}
                </option>
              ))}
            </select>

            <label className="field-label" htmlFor="habit-difficulty-k">
              {tx('Difficulty model (learning rate k)', 'مدل سختی (نرخ یادگیری k)')}
            </label>
            <input
              id="habit-difficulty-k"
              className="range-input"
              type="range"
              step="0.001"
              min={0.01}
              max={0.12}
              value={draft.difficultyK}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  difficultyK: Number(event.target.value) || 0.05,
                }))
              }
            />
            <p className="difficulty-helper">
              k = {draft.difficultyK.toFixed(3)} · {getDifficultyQualifier(draft.difficultyK, language)}
            </p>

            <label className="field-label" htmlFor="habit-decay-factor">
              {tx('Setback sensitivity (decay factor)', 'حساسیت به عقب‌گرد (ضریب افت)')}
            </label>
            <input
              id="habit-decay-factor"
              className="range-input"
              type="range"
              step="0.01"
              min={0.5}
              max={0.98}
              value={draft.decayFactor}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  decayFactor: Number(event.target.value) || 0.82,
                }))
              }
            />
            <p className="difficulty-helper">
              {tx('Decay factor', 'ضریب افت')} = {draft.decayFactor.toFixed(2)} · {getDecayQualifier(draft.decayFactor, language)}
            </p>
            <p className="meta-line">
              {tx(
                'Meaning: after a missed period, momentum is multiplied by this value. Lower = harsher setback (good for high-risk habits like smoking).',
                'معنی: بعد از یک دوره از دست‌رفته، مومنتوم در این مقدار ضرب می‌شود. کمتر = عقب‌گرد شدیدتر (مناسب عادت‌های پرریسک مثل سیگار).',
              )}
            </p>

            <label className="field-label" htmlFor="habit-report">
              {tx('Reporting type', 'نوع گزارش')}
            </label>
            <select
              id="habit-report"
              className="text-input"
              value={draft.reportingType}
              onChange={(event) =>
                setDraft((prev) => ({
                  ...prev,
                  reportingType: event.target.value as ReportingType,
                }))
              }
            >
              {(Object.keys(REPORTING_LABELS) as ReportingType[]).map((reportingType) => (
                <option key={reportingType} value={reportingType}>
                  {getReportingLabel(reportingType, language)}
                </option>
              ))}
            </select>

            {managedHabit && (() => {
              const streakUnits = getConsecutiveSuccessUnits(managedHabit, logs, todayKey, {
                hazeCompassionByDay,
              })
              const adaptiveK = getAdaptiveK(managedHabit)
              const strength = getStrength(adaptiveK, streakUnits)
              const risk = 100 - strength
              const period = getPeriodProgress(managedHabit, logs, todayKey)
              const periodLabel =
                language === 'fa'
                  ? `${period.done}/${period.target} ${managedHabit.desiredFrequency.per === 'day' ? 'امروز' : 'این هفته'}`
                  : period.label
              const compassionSource = language === 'fa' ? CARD_COMPASSION_FA : CARD_COMPASSION
              const compassionLine = pickCompassion(`${managedHabit.id}-${todayKey}`, compassionSource)
              const latestSrhi = managedHabit.srhiReports.at(-1)
              const latestSrhiAverage = latestSrhi ? srhiAverage(latestSrhi.scores) : null
              const srhiZone =
                latestSrhiAverage !== null && latestSrhiAverage >= 5.5
                  ? tx('Automaticity zone ✅', 'ناحیه خودکاری ✅')
                  : tx('Not automatic yet', 'هنوز خودکار نشده')

              const textLogs = logs
                .filter((log) => log.habitId === managedHabit.id)
                .map((log) => parseReport(log.reportValue))
                .filter((report) => report.type === 'text' && report.text)
              const photoLogs = logs
                .filter((log) => log.habitId === managedHabit.id)
                .map((log) => parseReport(log.reportValue))
                .filter((report) => report.type === 'photo' && report.imageDataUrl)
              const selfieLogs = logs
                .filter((log) => log.habitId === managedHabit.id)
                .map((log) => parseReport(log.reportValue))
                .filter((report) => report.type === 'selfie')
              const latestSelfie = selfieLogs.at(-1)

              const sentimentSeries = textLogs
                .slice(-8)
                .map((report) => report.sentiment ?? analyzeSentiment(report.text ?? ''))
              const sentimentAverage =
                sentimentSeries.length > 0
                  ? sentimentSeries.reduce((sum, n) => sum + n, 0) / sentimentSeries.length
                  : null

              const wordCounts = new Map<string, number>()
              for (const report of textLogs.slice(-20)) {
                const words = (report.text ?? '')
                  .toLowerCase()
                  .replace(/[^a-z\s]/g, ' ')
                  .split(/\s+/)
                  .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
                for (const word of words) {
                  wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
                }
              }
              const topWords = [...wordCounts.entries()]
                .sort((a, b) => b[1] - a[1])
                .slice(0, 6)

              return (
                <div className="management-insights">
                  <h4>{tx('Current status', 'وضعیت فعلی')}</h4>
                  <p className="strength-strip">{getProgressBarSegments(strength).join(' ')}</p>
                  <div className="metrics-grid">
                    <p>
                      <span title={tx('Momentum after growth and setbacks over time', 'مومنتوم حاصل از رشد و عقب‌گرد در طول زمان')}>
                        {tx('Momentum units', 'واحدهای مومنتوم')} <strong>{streakUnits.toFixed(1)}</strong>
                      </span>
                    </p>
                    <p>
                      {tx('Progress', 'پیشرفت')} <strong>{periodLabel}</strong>
                    </p>
                    <p>
                      {tx('Learning rate', 'نرخ یادگیری')} <strong>{adaptiveK.toFixed(3)}</strong>
                    </p>
                    <p>
                      {tx('Skipping risk', 'ریسک رد کردن')}{' '}
                      <strong>
                        {risk > 66
                          ? tx('High ⚠️', 'زیاد ⚠️')
                          : risk > 30
                            ? tx('Medium 🟡', 'متوسط 🟡')
                            : tx('Low 🟢', 'کم 🟢')}
                      </strong>
                    </p>
                  </div>

                  <p className="meta-line">
                    {formatFrequencyLabel(managedHabit)} · {getReportingLabel(managedHabit.reportingType, language)} ·{' '}
                    {tx('Breaks tracked', 'تعداد شکست روند')}: {managedHabit.streakBreaks}
                  </p>
                  <p className="meta-line">
                    {tx('Decay factor', 'ضریب افت')}: {managedHabit.decayFactor.toFixed(2)} · {getDecayQualifier(managedHabit.decayFactor, language)}
                  </p>
                  <p className="compassion-line">💛 {compassionLine}</p>

                  {strength >= SRHI_TRIGGER_STRENGTH && (
                    <div className="srhi-preview">
                      <p>
                        {tx('SRHI check', 'بررسی SRHI')}: <strong>{latestSrhiAverage?.toFixed(2) ?? tx('Not submitted yet', 'هنوز ثبت نشده')}</strong> ·{' '}
                        {latestSrhi ? srhiZone : tx('Ready for your first check-in', 'آماده اولین ثبت SRHI')}
                      </p>
                      <button
                        type="button"
                        className="secondary-btn"
                        onClick={() => openSrhiReport(managedHabit)}
                      >
                        {latestSrhi ? tx('Update SRHI report', 'به‌روزرسانی SRHI') : tx('Submit SRHI report', 'ثبت گزارش SRHI')}
                      </button>
                    </div>
                  )}

                  {managedHabit.reportingType === 'text' && (
                    <div className="sentiment-panel">
                      <p className="field-label">{tx('Sentiment over time', 'روند احساس در زمان')}</p>
                      <p className="trend-row">
                        {sentimentSeries.length
                          ? sentimentSeries.map((score, index) => (
                              <span key={`${managedHabit.id}-s-${index}`}>{sentimentEmoji(score)}</span>
                            ))
                          : tx('No journal sentiment yet', 'هنوز احساسی ثبت نشده')}
                      </p>
                      {sentimentAverage !== null && (
                        <p className="meta-line">
                          {tx('Average tone', 'میانگین حال‌وهوا')}: <strong>{sentimentEmoji(sentimentAverage)}</strong>
                        </p>
                      )}
                      {topWords.length > 0 && (
                        <div className="word-cloud">
                          {topWords.map(([word, count]) => (
                            <span
                              key={`${managedHabit.id}-${word}`}
                              style={{ fontSize: `${0.75 + count * 0.08}rem` }}
                            >
                              {word}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {managedHabit.reportingType === 'photo' && (
                    <div className="sentiment-panel">
                      <p className="field-label">{tx('Photo journal rhythm', 'ریتم ژورنال تصویری')}</p>
                      <p className="meta-line">
                        {tx('Saved photos', 'عکس‌های ذخیره‌شده')}: <strong>{photoLogs.length}</strong>
                      </p>
                      <p className="meta-line">
                        {tx(
                          'Photos are kept inside the habit log and will be included in exports and Drive backups.',
                          'عکس‌ها داخل لاگ عادت نگه‌داری می‌شوند و در خروجی و پشتیبان درایو هم می‌آیند.',
                        )}
                      </p>
                    </div>
                  )}

                  {managedHabit.reportingType === 'selfie' && (
                    <div className="sentiment-panel">
                      <p className="field-label">{tx('Face tone trend', 'روند حال چهره')}</p>
                      <p className="trend-row">
                        {selfieLogs.length
                          ? selfieLogs.slice(-8).map((report, index) => (
                              <span key={`${managedHabit.id}-selfie-${index}`}>
                                {getFaceAnalysisStatusEmoji(report)}
                              </span>
                            ))
                          : tx('No selfie tone logs yet', 'هنوز ثبت حالِ سلفی نداری')}
                      </p>
                      {latestSelfie && (
                        <p className="meta-line">
                          {tx('Latest tone', 'آخرین حال')}: <strong>{getFaceAnalysisStatusLabel(latestSelfie, language)}</strong>
                        </p>
                      )}
                      {latestSelfie && getFaceAnalysisDetail(latestSelfie, language) && (
                        <p className="meta-line">
                          {getFaceAnalysisDetail(latestSelfie, language)}
                        </p>
                      )}
                      <p className="meta-line">
                        {tx(
                          'The face read is a rough mood cue from blendshapes, not a medical or psychological judgment.',
                          'خوانش چهره فقط یک نشانه تقریبی از حال است و قضاوت پزشکی یا روان‌شناختی نیست.',
                        )}
                      </p>
                    </div>
                  )}
                </div>
              )
            })()}

            <div className="modal-actions">
              <button
                type="button"
                className="secondary-btn"
                onClick={() => setIsEditorOpen(false)}
              >
                {tx('Cancel', 'انصراف')}
              </button>
              {editingHabitId && (
                <button type="button" className="danger-btn" onClick={archiveHabit}>
                  {tx('Archive', 'بایگانی')}
                </button>
              )}
              <button type="submit" className="primary-btn">
                {tx('Save', 'ذخیره')}
              </button>
            </div>
          </form>
        </div>
      )}

      {isImportExportOpen && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal mini-modal">
            <h3>{tx('Data tools', 'ابزار داده')}</h3>
            <p>{tx('Export your IndexedDB data, or import from a JSON backup.', 'داده‌های IndexedDB را خروجی بگیر یا از فایل JSON وارد کن.')}</p>
            <div className="backup-panel">
              <h4>{tx('Google Drive backup', 'پشتیبان‌گیری گوگل‌درایو')}</h4>
              <p className="meta-line">
                {configuredDriveClientId
                  ? tx(
                      'Click connect once and Google will handle sign-in in a popup. After that, backups can happen automatically while the app is open.',
                      'یک‌بار روی اتصال بزن و گوگل ورود را در پنجره پاپ‌آپ انجام می‌دهد. بعد از آن، تا وقتی برنامه باز است پشتیبان‌گیری می‌تواند خودکار انجام شود.',
                    )
                  : tx(
                      'This app needs a Google OAuth client ID from its owner. If you self-host it, add one once in an env file. End users should not have to look this up.',
                      'این برنامه به شناسه کلاینت OAuth گوگل از طرف سازنده نیاز دارد. اگر برنامه را خودت میزبانی می‌کنی، آن را یک‌بار در فایل env قرار بده. کاربر نهایی نباید دنبال آن بگردد.',
                    )}
              </p>

              {!configuredDriveClientId && (
                <>
                  <label className="field-label" htmlFor="drive-client-id">
                    {tx('Google OAuth client ID', 'شناسه کلاینت OAuth گوگل')}
                  </label>
                  <input
                    id="drive-client-id"
                    className="text-input"
                    value={driveBackupSettings.clientId}
                    placeholder="1234567890-abcdef.apps.googleusercontent.com"
                    onChange={(event) =>
                      setDriveBackupSettings((prev) => ({
                        ...prev,
                        clientId: event.target.value,
                        lastError: '',
                      }))
                    }
                  />
                </>
              )}

              {configuredDriveClientId && (
                <p className="backup-ok">
                  {tx(
                    'Google Drive sign-in is preconfigured by the app.',
                    'ورود گوگل‌درایو از قبل توسط برنامه پیکربندی شده است.',
                  )}
                </p>
              )}

              <div className="inline-fields backup-inline-fields">
                <label className="backup-toggle">
                  <input
                    type="checkbox"
                    checked={driveBackupSettings.enabled}
                    onChange={(event) =>
                      setDriveBackupSettings((prev) => ({
                        ...prev,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  <span>{tx('Enable auto backup', 'فعال‌کردن پشتیبان‌گیری خودکار')}</span>
                </label>

                <div>
                  <label className="field-label" htmlFor="drive-interval">
                    {tx('Backup cadence', 'بازه پشتیبان‌گیری')}
                  </label>
                  <select
                    id="drive-interval"
                    className="text-input"
                    value={driveBackupSettings.intervalMinutes}
                    onChange={(event) =>
                      setDriveBackupSettings((prev) => ({
                        ...prev,
                        intervalMinutes: Number(event.target.value) || 60,
                      }))
                    }
                  >
                    <option value={15}>{tx('About every 15 minutes', 'حدود هر ۱۵ دقیقه')}</option>
                    <option value={60}>{tx('About every hour', 'حدود هر ۱ ساعت')}</option>
                    <option value={360}>{tx('About every 6 hours', 'حدود هر ۶ ساعت')}</option>
                    <option value={1440}>{tx('About every day', 'حدود هر روز')}</option>
                  </select>
                </div>
              </div>

              <div className="backup-actions">
                <button
                  className="secondary-btn"
                  disabled={isDriveSyncing}
                  onClick={() => {
                    void syncDriveBackup('manual')
                  }}
                >
                  {isDriveSyncing
                    ? tx('Syncing…', 'در حال همگام‌سازی…')
                    : !driveBackupSettings.lastSyncedAt && configuredDriveClientId
                      ? tx('Connect Google Drive', 'اتصال به گوگل‌درایو')
                      : tx('Back up now', 'همین حالا پشتیبان بگیر')}
                </button>
                <button
                  className="secondary-btn"
                  disabled={isDriveSyncing}
                  onClick={() => {
                    void restoreFromGoogleDrive()
                  }}
                >
                  {tx('Restore latest Drive backup', 'بازیابی آخرین پشتیبان درایو')}
                </button>
                <button className="danger-btn" onClick={resetDriveBackup}>
                  {tx('Clear Drive setup', 'پاک‌کردن تنظیمات درایو')}
                </button>
              </div>

              <p className="meta-line">
                {tx('Last synced', 'آخرین همگام‌سازی')}: {formatRelativeDateTime(driveBackupSettings.lastSyncedAt, language)}
              </p>
              {driveBackupSettings.lastError && (
                <p className="backup-error">{driveBackupSettings.lastError}</p>
              )}
              {driveBackupStatus && !driveBackupSettings.lastError && (
                <p className="backup-ok">{driveBackupStatus}</p>
              )}
            </div>
            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setIsImportExportOpen(false)}>
                {tx('Close', 'بستن')}
              </button>
              <button className="secondary-btn" onClick={exportData}>
                {tx('Export JSON', 'خروجی JSON')}
              </button>
              <button
                className="primary-btn"
                onClick={() => {
                  importInputRef.current?.click()
                }}
              >
                {tx('Import JSON', 'ورود JSON')}
              </button>
            </div>
          </div>
        </div>
      )}

      {isInsightsOpen && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal insights-modal">
            <h3>{tx('Insights', 'تحلیل‌ها')}</h3>
            <p className="meta-line">{tx('How your habit system is strengthening over time.', 'روند قوی‌تر شدن سیستم عادت‌های شما در طول زمان.')}</p>

            <h4>{tx('All habits', 'همه عادت‌ها')}</h4>
            <div className="insight-kpis">
              <article>
                <span>{tx('Active habits', 'عادت‌های فعال')}</span>
                <strong>{activeHabits.length}</strong>
              </article>
              <article>
                <span>{tx('Today touched', 'ثبت‌شده امروز')}</span>
                <strong>{completedToday}</strong>
              </article>
              <article>
                <span>{tx('Avg strength now', 'میانگین قدرت فعلی')}</span>
                <strong>{averageStrength.toFixed(1)}%</strong>
              </article>
              <article>
                <span>
                  {insightRange === '30d'
                    ? tx('Total growth (30d)', 'رشد کل (۳۰ روز)')
                    : tx('Total growth (full range)', 'رشد کل (بازه کامل)')}
                </span>
                <strong>{totalGrowth >= 0 ? '+' : ''}{totalGrowth.toFixed(1)}%</strong>
              </article>
            </div>

            <div className="chart-block">
              <div className="chart-block-head">
                <div className="chart-tools-row">
                  <label className="fog-toggle">
                    <input
                      type="checkbox"
                      checked={showUnderFogDetails}
                      onChange={(event) => setShowUnderFogDetails(event.target.checked)}
                    />
                    <span>
                      {showUnderFogDetails
                        ? tx('Hide data under haze', 'پنهان‌کردن داده زیر مه')
                        : tx('Show data under haze', 'نمایش داده زیر مه')}
                    </span>
                  </label>
                  <button
                    type="button"
                    className="secondary-btn"
                    onClick={() => setInsightRange((prev) => (prev === '30d' ? 'full' : '30d'))}
                  >
                    {insightRange === '30d' ? tx('Full range', 'بازه کامل') : tx('Last 30 days', '۳۰ روز اخیر')}
                  </button>
                </div>
              </div>
              <StrengthLineChart
                data={strengthDaySeries}
                color="#10b981"
                fill="rgba(16, 185, 129, 0.14)"
                optimisticLastPoint
                optimisticColor="#3b82f6"
                hazeRanges={systemHazeRanges}
                showUnderFogDetails={showUnderFogDetails}
              />
              <p className="chart-legend haze-legend">
                ☁︎ {tx('Haze overlays mark off-day stretches. Confirmed haze also softens decline.', 'ابرهای مه، دوره‌های کم‌جان را نشان می‌دهند. مه تأییدشده افت را هم نرم‌تر می‌کند.')}
              </p>
            </div>

            <div className="chart-block">
              <p className="field-label">{tx('Risk mix', 'ترکیب ریسک')}</p>
              <p className="meta-line">
                {tx('Fragile', 'شکننده')}: {riskBuckets.fragile} · {tx('Forming', 'در حال شکل‌گیری')}: {riskBuckets.forming} · {tx('Automatic', 'خودکار')}: {riskBuckets.automatic}
              </p>
              <p className="meta-line">
                {tx('Goal: move habits from fragile/forming toward automatic by protecting streaks and reducing skips.', 'هدف: انتقال عادت‌ها از شکننده/درحال‌تشکیل به خودکار با حفظ تداوم و کاهش رد کردن.')}
              </p>
            </div>

            <h4>{tx('Individual habits', 'عادت‌های فردی')}</h4>
            <div className="insight-accordion">
              {insightHabitsSorted.map((habit) => {
                const isOpen = expandedInsightHabitId === habit.id
                const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey, { hazeCompassionByDay })
                const adaptiveK = getAdaptiveK(habit)
                const strength = getStrength(adaptiveK, streakUnits)
                const risk = 100 - strength
                const riskTier = getRiskTier(strength)
                const tierColor = getTierColor(riskTier.title)
                const stage = getStageProgress(strength)
                const period = getPeriodProgress(habit, logs, todayKey)
                const periodLabel =
                  language === 'fa'
                    ? `${period.done}/${period.target} ${habit.desiredFrequency.per === 'day' ? 'امروز' : 'این هفته'}`
                    : period.label

                const habitCreatedDay = formatDayKey(new Date(habit.createdAt))
                const habitLogDayKeys = logs
                  .filter((log) => log.habitId === habit.id)
                  .map((log) => log.dayKey)
                const habitStartDay = [habitCreatedDay, ...habitLogDayKeys]
                  .sort((a, b) => a.localeCompare(b))[0]
                const habitSeriesDayKeys =
                  insightRange === '30d'
                    ? getRecentDayKeys(todayKey, 30)
                    : getDayKeysBetween(habitStartDay <= todayKey ? habitStartDay : todayKey, todayKey)

                const habitStrengthSeries = habitSeriesDayKeys.map((dayKey) => {
                  const streakAtDayEnd = getConsecutiveSuccessUnits(
                    habit,
                    logs,
                    shiftDayKey(dayKey, 1),
                    {
                      optimisticCurrentDayKey: dayKey === todayKey ? todayKey : undefined,
                      hazeCompassionByDay,
                    },
                  )
                  return {
                    label: shortDayLabel(dayKey),
                    dayKey,
                    value: getStrength(adaptiveK, streakAtDayEnd),
                  }
                })
                const habitHazeRanges = mapHazeRangesToChart(
                  habitStrengthSeries,
                  detectedHazePeriods,
                  visualizedConfirmedHazeStartDayKey,
                )

                const latestSrhi = habit.srhiReports.at(-1)
                const latestSrhiAverage = latestSrhi ? srhiAverage(latestSrhi.scores) : null
                const habitReports = logs
                  .filter((log) => log.habitId === habit.id)
                  .map((log) => parseReport(log.reportValue))

                const moodCounts = Array.from({ length: MOOD_EMOJIS.length }, () => 0)
                for (const report of habitReports) {
                  if (report.type === 'mood' && report.mood) {
                    const moodIndex = Math.max(1, Math.min(MOOD_EMOJIS.length, report.mood)) - 1
                    moodCounts[moodIndex] += 1
                  }
                }
                const moodData: MiniBarDatum[] = MOOD_EMOJIS.map((emoji, index) => ({
                  label: emoji,
                  value: moodCounts[index],
                }))

                const emotionData: MiniBarDatum[] = EMOTION_GROUPS.map((group) => {
                  const primaryReports = habitReports.filter(
                    (report) => report.type === 'emotion' && report.emotionPrimary === group.labelEn,
                  )

                  return {
                    label: language === 'fa' ? group.labelFa : group.labelEn,
                    value: primaryReports.length,
                    color: group.color,
                  }
                })

                const textReports = habitReports
                  .filter((report) => report.type === 'text' && report.text)
                  .map((report) => ({
                    text: report.text ?? '',
                    sentiment: report.sentiment ?? analyzeSentiment(report.text ?? ''),
                  }))
                const mediaReports = logs
                  .filter((log) => log.habitId === habit.id)
                  .map((log) => ({
                    logId: log.id,
                    dayKey: log.dayKey,
                    completedAt: log.completedAt,
                    report: parseReport(log.reportValue),
                  }))
                  .filter(
                    (
                      entry,
                    ): entry is {
                      logId: string
                      dayKey: string
                      completedAt: string
                      report: ParsedReport & { type: 'photo' | 'selfie'; imageDataUrl: string }
                    } => isMediaGalleryReport(entry.report),
                  )
                  .sort((a, b) => b.completedAt.localeCompare(a.completedAt))
                const selectedMediaReport =
                  mediaReports.find((entry) => entry.logId === selectedMediaLogIds[habit.id]) ??
                  mediaReports[0] ??
                  null
                const selfieCounts = {
                  joyful: 0,
                  calm: 0,
                  flat: 0,
                  stressed: 0,
                }
                for (const report of habitReports) {
                  if (report.type === 'selfie' && report.faceLabel) {
                    selfieCounts[report.faceLabel] += 1
                  }
                }
                const selfieData: MiniBarDatum[] = (
                  Object.keys(FACE_TONE_LABELS) as Array<keyof typeof FACE_TONE_LABELS>
                ).map((label) => ({
                  label: `${getFaceToneEmoji(label)} ${getFaceToneLabel(label, language)}`,
                  value: selfieCounts[label],
                  color:
                    label === 'joyful'
                      ? '#34d399'
                      : label === 'calm'
                        ? '#60a5fa'
                        : label === 'flat'
                          ? '#94a3b8'
                          : '#f87171',
                }))

                const wordStats = new Map<string, { count: number; sentimentSum: number }>()
                for (const report of textReports) {
                  const words = report.text
                    .toLowerCase()
                    .replace(/[^a-z\s]/g, ' ')
                    .split(/\s+/)
                    .filter((word) => word.length > 3 && !STOP_WORDS.has(word))

                  for (const word of words) {
                    const entry = wordStats.get(word) ?? { count: 0, sentimentSum: 0 }
                    entry.count += 1
                    const lexicalHint = POSITIVE_WORDS.has(word)
                      ? 0.5
                      : NEGATIVE_WORDS.has(word)
                        ? -0.5
                        : 0
                    entry.sentimentSum += report.sentiment + lexicalHint
                    wordStats.set(word, entry)
                  }
                }

                const topWords = [...wordStats.entries()]
                  .map(([word, stats]) => ({
                    word,
                    count: stats.count,
                    avgSentiment: stats.sentimentSum / Math.max(1, stats.count),
                  }))
                  .sort((a, b) => b.count - a.count)
                  .slice(0, 8)

                const termsData: MiniBarDatum[] = topWords.map((entry) => ({
                  label: entry.word,
                  value: entry.count,
                  color:
                    entry.avgSentiment > 0.18
                      ? '#34d399'
                      : entry.avgSentiment < -0.18
                        ? '#f87171'
                        : '#60a5fa',
                }))
                const hasSecondaryAnalytics =
                  (habit.reportingType === 'mood' && moodData.some((entry) => entry.value > 0)) ||
                  (habit.reportingType === 'emotion' && emotionData.some((entry) => entry.value > 0)) ||
                  (habit.reportingType === 'text' && termsData.length > 0) ||
                  (habit.reportingType === 'photo' && mediaReports.length > 0) ||
                  (habit.reportingType === 'selfie' && (selfieData.some((entry) => entry.value > 0) || mediaReports.length > 0))
                const secondaryVisible = Boolean(showSecondaryAnalytics[habit.id])
                const insightCardStyle = {
                  '--insight-progress': `${stage.progressPct.toFixed(1)}%`,
                  '--insight-phase-color': tierColor,
                } as CSSProperties

                return (
                  <article
                    key={`insight-card-${habit.id}`}
                    className={`insight-card ${riskTier.className}`}
                    style={insightCardStyle}
                  >
                    <button
                      className="insight-card-head"
                      onClick={() => setExpandedInsightHabitId((prev) => (prev === habit.id ? null : habit.id))}
                    >
                      <span className="insight-head-main">
                        <span>{habit.name}</span>
                        <span className="phase-chip insight-phase-chip">{getPhaseLabel(habit.phase, language)}</span>
                      </span>
                      <span className="insight-head-side">
                        <span className="insight-strength-pill">{strength.toFixed(1)}%</span>
                        <span>{isOpen ? '−' : '+'}</span>
                      </span>
                    </button>

                    {isOpen && (
                      <div className="insight-card-body">
                        <div className="insight-card-actions">
                          <button
                            type="button"
                            className="secondary-btn"
                            onClick={() => {
                              setIsInsightsOpen(false)
                              openEditEditor(habit)
                            }}
                          >
                            {tx('Edit habit', 'ویرایش عادت')}
                          </button>
                          {hasSecondaryAnalytics && (
                            <button
                              type="button"
                              className="secondary-btn"
                              style={{ marginLeft: '8px' }}
                              onClick={() =>
                                setShowSecondaryAnalytics((prev) => ({
                                  ...prev,
                                  [habit.id]: !prev[habit.id],
                                }))
                              }
                            >
                              {secondaryVisible
                                ? tx('Hide details', 'پنهان‌کردن جزئیات')
                                : tx('Show details', 'نمایش جزئیات')}
                            </button>
                          )}
                        </div>
                        <p className="meta-line">
                          {getPhaseLabel(habit.phase, language)} · {formatFrequencyLabel(habit)} · {getReportingLabel(habit.reportingType, language)}
                        </p>
                        <p className="status-line">
                          <span>{riskTier.icon}</span>
                          <strong>{getRiskTitle(riskTier.title, language)}</strong>
                        </p>
                        <p className="status-hint">{getRiskHint(riskTier.title, language)}</p>

                        <div className="stage-progress">
                          <p className="stage-progress-label">
                            {stage.next
                              ? tx(
                                  `${getRiskTitle(stage.current, language)} → ${getRiskTitle(stage.next, language)}: ${stage.progressPct.toFixed(0)}%`,
                                  `${getRiskTitle(stage.current, language)} ← ${getRiskTitle(stage.next, language)}: ${stage.progressPct.toFixed(0)}%`,
                                )
                              : tx('Automatic growth: ', 'رشد خودکار: ') + `${stage.progressPct.toFixed(0)}%`}
                          </p>
                          <div className="stage-progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(stage.progressPct)}>
                            <div className="stage-progress-fill insight-stage-progress-fill" style={{ width: `${stage.progressPct}%`, background: tierColor }}></div>
                          </div>
                        </div>

                        <div className="metrics-grid">
                          <p>{tx('Current strength', 'قدرت فعلی')} <strong>{strength.toFixed(1)}%</strong></p>
                          <p>{tx('Current risk', 'ریسک فعلی')} <strong>{risk.toFixed(1)}%</strong></p>
                          <p title={tx('Momentum after growth and setbacks over time', 'مومنتوم حاصل از رشد و عقب‌گرد در طول زمان')}>
                            {tx('Momentum units', 'واحدهای مومنتوم')} <strong>{streakUnits.toFixed(1)}</strong>
                          </p>
                          <p>{tx('Progress', 'پیشرفت')} <strong>{periodLabel}</strong></p>
                          <p>{tx('Learning rate', 'نرخ یادگیری')} <strong>{adaptiveK.toFixed(3)}</strong></p>
                          <p>{tx('Breaks tracked', 'تعداد شکست روند')} <strong>{habit.streakBreaks}</strong></p>
                        </div>

                        <div className="chart-block">
                          <div className="chart-block-head">
                            <button
                              type="button"
                              className="secondary-btn"
                              onClick={() => setInsightRange((prev) => (prev === '30d' ? 'full' : '30d'))}
                            >
                              {insightRange === '30d' ? tx('Full range', 'بازه کامل') : tx('Last 30 days', '۳۰ روز اخیر')}
                            </button>
                          </div>
                          <StrengthLineChart
                            data={habitStrengthSeries}
                            color="#3b82f6"
                            fill="rgba(59, 130, 246, 0.12)"
                            optimisticLastPoint
                            optimisticColor="#10b981"
                            hazeRanges={habitHazeRanges}
                            showUnderFogDetails={showUnderFogDetails}
                          />
                          <p className="chart-legend haze-legend">
                            ☁︎ {tx('Global haze stretches are projected onto each habit trend too.', 'بازه‌های مهِ کلی روی نمودار هر عادت هم نمایش داده می‌شوند.')}
                          </p>
                        </div>

                        {secondaryVisible && habit.reportingType === 'mood' && moodData.length > 0 && (
                          <div className="chart-block discrete-block">
                            <D3VerticalBars data={moodData} fallbackColor="#60a5fa" />
                          </div>
                        )}

                        {secondaryVisible && habit.reportingType === 'emotion' && emotionData.length > 0 && (
                          <div className="chart-block discrete-block">
                            <D3VerticalBars data={emotionData} fallbackColor="#a78bfa" />
                          </div>
                        )}

                        {secondaryVisible && habit.reportingType === 'text' && termsData.length > 0 && (
                          <div className="chart-block discrete-block">
                            <div className="insight-terms-text">
                              {termsData.map((entry) => {
                                const intensity = entry.value / Math.max(1, termsData[0]?.value ?? 1)
                                return (
                                  <span
                                    key={`${habit.id}-term-${entry.label}`}
                                    style={{
                                      fontSize: `${0.82 + intensity * 0.56}rem`,
                                      color: entry.color ?? '#4b5563',
                                      opacity: 0.42 + intensity * 0.58,
                                    }}
                                    title={`${entry.label} · ${entry.value}`}
                                  >
                                    {entry.label}
                                  </span>
                                )
                              })}
                            </div>
                          </div>
                        )}

                        {secondaryVisible &&
                          (habit.reportingType === 'photo' || habit.reportingType === 'selfie') &&
                          selectedMediaReport && (
                            <div className="chart-block discrete-block">
                              <button
                                type="button"
                                className="media-preview-card"
                                onClick={() => {
                                  setSelectedMediaLogIds((prev) => ({
                                    ...prev,
                                    [habit.id]: selectedMediaReport.logId,
                                  }))
                                  setGalleryHabitId(habit.id)
                                }}
                              >
                                <img
                                  src={selectedMediaReport.report.imageDataUrl}
                                  alt={tx('Saved habit snapshot', 'تصویر ذخیره‌شده عادت')}
                                  className="media-preview-image"
                                />
                                <span className="media-preview-copy">
                                  <strong>
                                    {tx('Latest saved moment', 'آخرین لحظه ذخیره‌شده')} ·{' '}
                                    {formatDayKeyForDisplay(selectedMediaReport.dayKey, language)}
                                  </strong>
                                  <span>
                                    {formatRelativeDateTime(selectedMediaReport.completedAt, language)}
                                  </span>
                                  {selectedMediaReport.report.caption && (
                                    <span>{selectedMediaReport.report.caption}</span>
                                  )}
                                  {selectedMediaReport.report.type === 'selfie' && (
                                    <>
                                      <span>
                                        {tx('Face tone', 'حال چهره')}: {getFaceAnalysisStatusEmoji(selectedMediaReport.report)}{' '}
                                        {getFaceAnalysisStatusLabel(selectedMediaReport.report, language)}
                                        {typeof selectedMediaReport.report.faceScore === 'number' && (
                                          <>
                                            {' '}
                                            · {tx('score', 'امتیاز')} {selectedMediaReport.report.faceScore.toFixed(2)}
                                          </>
                                        )}
                                      </span>
                                      {getFaceAnalysisDetail(selectedMediaReport.report, language) && (
                                        <span>{getFaceAnalysisDetail(selectedMediaReport.report, language)}</span>
                                      )}
                                    </>
                                  )}
                                  <span className="media-preview-hint">
                                    {tx('Tap to open gallery and pick another day.', 'برای باز کردن گالری و انتخاب روز دیگر لمس کن.')}
                                  </span>
                                </span>
                              </button>
                            </div>
                          )}

                        {secondaryVisible && habit.reportingType === 'selfie' && selfieData.length > 0 && (
                          <div className="chart-block discrete-block">
                            <D3VerticalBars data={selfieData} fallbackColor="#60a5fa" />
                            <p className="meta-line">
                              {tx(
                                'These face-tone buckets come from an on-device blendshape heuristic.',
                                'این دسته‌های حالِ چهره از یک حدس مبتنی بر بلِندشیپ روی خود دستگاه می‌آیند.',
                              )}
                            </p>
                          </div>
                        )}

                        {latestSrhiAverage !== null && (
                          <p className="meta-line">
                            {tx('Latest SRHI', 'آخرین SRHI')}: {latestSrhiAverage.toFixed(2)}
                          </p>
                        )}
                      </div>
                    )}
                  </article>
                )
              })}
            </div>

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setIsInsightsOpen(false)}>
                {tx('Close', 'بستن')}
              </button>
            </div>
          </div>
        </div>
      )}

      {galleryHabitId && activeGalleryHabit && selectedActiveGalleryEntry && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal media-gallery-modal">
            <h3>{tx('Media gallery', 'گالری رسانه')}</h3>
            <p className="meta-line">
              {activeGalleryHabit.name} · {getReportingLabel(activeGalleryHabit.reportingType, language)}
            </p>

            <div className="media-gallery-focus">
              <img
                src={selectedActiveGalleryEntry.report.imageDataUrl}
                alt={tx('Selected habit media', 'رسانه انتخاب‌شده عادت')}
                className="media-gallery-focus-image"
              />
              <div className="media-gallery-focus-copy">
                <strong>{formatDayKeyForDisplay(selectedActiveGalleryEntry.dayKey, language)}</strong>
                <span>{formatRelativeDateTime(selectedActiveGalleryEntry.completedAt, language)}</span>
                {selectedActiveGalleryEntry.report.caption ? (
                  <p>{selectedActiveGalleryEntry.report.caption}</p>
                ) : (
                  <p>{tx('No note saved for this moment.', 'برای این لحظه یادداشتی ذخیره نشده است.')}</p>
                )}

                {selectedActiveGalleryEntry.report.type === 'selfie' && (
                  <>
                    <p className="meta-line">
                      {tx('Face tone', 'حال چهره')}: {getFaceAnalysisStatusEmoji(selectedActiveGalleryEntry.report)}{' '}
                      {getFaceAnalysisStatusLabel(selectedActiveGalleryEntry.report, language)}
                      {typeof selectedActiveGalleryEntry.report.faceScore === 'number' && (
                        <>
                          {' '}
                          · {tx('score', 'امتیاز')} {selectedActiveGalleryEntry.report.faceScore.toFixed(2)}
                        </>
                      )}
                    </p>
                    {getFaceAnalysisDetail(selectedActiveGalleryEntry.report, language) && (
                      <p className="meta-line">
                        {getFaceAnalysisDetail(selectedActiveGalleryEntry.report, language)}
                      </p>
                    )}
                  </>
                )}
              </div>
            </div>

            <div className="media-gallery-grid">
              {activeGalleryEntries.map((entry) => {
                const isSelected = entry.logId === selectedActiveGalleryEntry.logId
                return (
                  <button
                    key={entry.logId}
                    type="button"
                    className={`media-gallery-thumb ${isSelected ? 'selected-media-thumb' : ''}`}
                    onClick={() =>
                      setSelectedMediaLogIds((prev) => ({
                        ...prev,
                        [activeGalleryHabit.id]: entry.logId,
                      }))
                    }
                  >
                    <img src={entry.report.imageDataUrl} alt={formatDayKeyForDisplay(entry.dayKey, language)} />
                    <span>{formatDayKeyForDisplay(entry.dayKey, language)}</span>
                  </button>
                )
              })}
            </div>

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setGalleryHabitId(null)}>
                {tx('Close', 'بستن')}
              </button>
            </div>
          </div>
        </div>
      )}

      {srhiHabitId && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>{tx('SRHI report', 'گزارش SRHI')}</h3>
            <p className="meta-line">{tx('Pick one emoji (1-7) per statement.', 'برای هر گزاره یک ایموجی (۱ تا ۷) انتخاب کن.')}</p>
            {[
              tx('I do this without thinking.', 'این کار را بدون فکر انجام می‌دهم.'),
              tx('I do this automatically.', 'این کار را خودکار انجام می‌دهم.'),
              tx('I would find it hard not to do this.', 'انجام ندادن این کار برایم سخت است.'),
              tx('I have no need to think about doing this.', 'لازم نیست برای انجامش فکر کنم.'),
            ].map((statement, index) => (
              <div key={statement} className="srhi-emoji-item">
                <span>{statement}</span>
                <div className="emoji-row">
                  {MOOD_EMOJIS.map((emoji, emojiIndex) => {
                    const value = emojiIndex + 1
                    const active = srhiDraft[index] === value
                    return (
                      <button
                        key={`${statement}-${emoji}`}
                        className={`emoji-btn ${active ? 'active-emoji' : ''}`}
                        onClick={() => {
                          setSrhiDraft((prev) => {
                            const next = [...prev] as [number, number, number, number]
                            next[index] = value
                            return next
                          })
                        }}
                      >
                        {emoji}
                      </button>
                    )
                  })}
                </div>
              </div>
            ))}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setSrhiHabitId(null)}>
                {tx('Cancel', 'انصراف')}
              </button>
              <button className="primary-btn" onClick={saveSrhiReport}>
                {tx('Submit SRHI', 'ثبت SRHI')}
              </button>
            </div>
          </div>
        </div>
      )}

      {cameraSession && (
        <div className="overlay" role="dialog" aria-modal="true">
          <div className="modal camera-modal">
            <h3>
              {cameraSession.mode === 'selfie'
                ? tx('Take a selfie', 'گرفتن سلفی')
                : tx('Take a photo', 'گرفتن عکس')}
            </h3>
            <p className="meta-line">
              {cameraSession.mode === 'selfie'
                ? tx(
                    'Use the webcam to capture a selfie, or switch to file upload if you prefer.',
                    'از وب‌کم برای گرفتن سلفی استفاده کن، یا اگر خواستی به‌جایش فایل بارگذاری کن.',
                  )
                : tx(
                    'Use the webcam to capture a photo journal shot, or switch to file upload if you prefer.',
                    'از وب‌کم برای گرفتن عکس ژورنال استفاده کن، یا اگر خواستی به‌جایش فایل بارگذاری کن.',
                  )}
            </p>

            <div className="camera-preview-shell">
              <video
                ref={cameraVideoRef}
                className="camera-preview"
                autoPlay
                muted
                playsInline
              />
              {!cameraPreviewReady && (
                <div className="camera-preview-placeholder">
                  {cameraStreamError ||
                    tx('Waiting for the camera preview…', 'در انتظار پیش‌نمایش دوربین…')}
                </div>
              )}
            </div>

            {cameraStreamError && <p className="backup-error">{cameraStreamError}</p>}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={closeCameraSession}>
                {tx('Cancel', 'انصراف')}
              </button>
              <button
                className="secondary-btn"
                onClick={() => {
                  const habit = habits.find((entry) => entry.id === cameraSession.habitId)
                  if (!habit) {
                    closeCameraSession()
                    return
                  }
                  void chooseImageFromFiles(habit, cameraSession.targetDayKey, cameraSession.mode)
                    .then(() => closeCameraSession())
                    .catch((error: unknown) => {
                      const message =
                        error instanceof Error
                          ? error.message
                          : tx('Could not process the selected photo.', 'عکس انتخاب‌شده پردازش نشد.')
                      setCameraStreamError(message)
                    })
                }}
              >
                {tx('Upload instead', 'بارگذاری به‌جایش')}
              </button>
              <button
                className="primary-btn"
                disabled={!cameraPreviewReady}
                onClick={() => {
                  void capturePhotoFromPreview()
                }}
              >
                {cameraSession.mode === 'selfie'
                  ? tx('Capture selfie', 'ثبت سلفی')
                  : tx('Capture photo', 'ثبت عکس')}
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}

export default App
