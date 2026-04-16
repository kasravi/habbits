import { type ChangeEvent, type FormEvent, useEffect, useMemo, useRef, useState } from 'react'
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
import emotionsData from '../emotions.json'

const PHASE_ORDER: HabitPhase[] = ['morning', 'afterWork', 'beforeBed']
const PHASE_LABELS: Record<HabitPhase, string> = {
  morning: 'Morning',
  afterWork: 'After work',
  beforeBed: 'Before bed',
}
const PHASE_LABELS_FA: Record<HabitPhase, string> = {
  morning: 'صبح',
  afterWork: 'بعد از کار',
  beforeBed: 'قبل خواب',
}

const REPORTING_LABELS: Record<ReportingType, string> = {
  button: 'Simple button',
  text: 'Journal + sentiment',
  emotion: 'Emotion wheel',
  mood: 'Mood emoji',
}
const REPORTING_LABELS_FA: Record<ReportingType, string> = {
  button: 'دکمه ساده',
  text: 'ژورنال + احساس',
  emotion: 'چرخه احساسات',
  mood: 'ایموجی حال',
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

interface HabitDraft {
  name: string
  description: string
  desiredCount: number
  desiredPer: 'day' | 'week'
  difficultyK: number
  phase: HabitPhase
  reportingType: ReportingType
}

interface ParsedReport {
  type: 'button' | 'mood' | 'emotion' | 'text' | 'unknown'
  mood?: number
  emotionPrimary?: string
  emotionSecondary?: string
  text?: string
  sentiment?: number
}

function defaultDraft(): HabitDraft {
  return {
    name: '',
    description: '',
    desiredCount: 1,
    desiredPer: 'day',
    difficultyK: 0.05,
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
  shifted.setHours(shifted.getHours() - 3)
  return formatDayKey(shifted)
}

function dayKeyToDate(dayKey: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function shiftDayKey(dayKey: string, deltaDays: number): string {
  const date = dayKeyToDate(dayKey)
  date.setDate(date.getDate() + deltaDays)
  return formatDayKey(date)
}

function getCurrentPhase(now = new Date()): HabitPhase {
  const hour = now.getHours()
  const minute = now.getMinutes()

  if (hour < 3) {
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

function shouldShowHabitBySchedule(
  habit: Habit,
  logs: HabitLog[],
  todayKey: string,
): boolean {
  const progress = getPeriodProgress(habit, logs, todayKey)
  if (progress.completed) {
    return false
  }

  if (habit.desiredFrequency.per === 'day') {
    return true
  }

  const target = Math.max(1, habit.desiredFrequency.count)
  const doneThisWeek = progress.done
  const nextDueDayOffset = Math.min(6, Math.floor((doneThisWeek * 7) / target))
  const currentDayOffset = getWeekDayOffset(todayKey)

  return currentDayOffset >= nextDueDayOffset
}

function getConsecutiveSuccessUnits(habit: Habit, logs: HabitLog[], todayKey: string): number {
  const target = Math.max(1, habit.desiredFrequency.count)

  if (habit.desiredFrequency.per === 'day') {
    let streak = 0
    let cursor = shiftDayKey(todayKey, -1)
    while (countHabitCompletionsForDay(habit.id, cursor, logs) >= target) {
      streak += 1
      cursor = shiftDayKey(cursor, -1)
    }
    return streak
  }

  let streak = 0
  let cursor = shiftDayKey(getWeekStart(todayKey), -7)
  while (countHabitCompletionsForWeek(habit.id, cursor, logs) >= target) {
    streak += 1
    cursor = shiftDayKey(cursor, -7)
  }
  return streak
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

function getRecentWeekStarts(todayKey: string, weeks: number): string[] {
  const currentWeek = getWeekStart(todayKey)
  return Array.from({ length: weeks }, (_, index) =>
    shiftDayKey(currentWeek, -7 * (weeks - 1 - index)),
  )
}

function shortDayLabel(dayKey: string): string {
  const date = dayKeyToDate(dayKey)
  return `${date.getMonth() + 1}/${date.getDate()}`
}

function getAllHabitCoverageForDay(habits: Habit[], logs: HabitLog[], dayKey: string): number {
  if (!habits.length) {
    return 0
  }

  const ratioSum = habits.reduce((sum, habit) => {
    if (habit.desiredFrequency.per === 'day') {
      const done = countHabitCompletionsForDay(habit.id, dayKey, logs)
      return sum + Math.min(1, done / Math.max(1, habit.desiredFrequency.count))
    }

    const weekStart = getWeekStart(dayKey)
    const done = countHabitCompletionsForWeek(habit.id, weekStart, logs)
    return sum + Math.min(1, done / Math.max(1, habit.desiredFrequency.count))
  }, 0)

  return ratioSum / habits.length
}

function getTopWordsFromReports(reports: ParsedReport[], limit = 8): Array<[string, number]> {
  const wordCounts = new Map<string, number>()
  for (const report of reports) {
    const words = (report.text ?? '')
      .toLowerCase()
      .replace(/[^a-z\s]/g, ' ')
      .split(/\s+/)
      .filter((word) => word.length > 3 && !STOP_WORDS.has(word))
    for (const word of words) {
      wordCounts.set(word, (wordCounts.get(word) ?? 0) + 1)
    }
  }

  return [...wordCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

interface ChartPoint {
  label: string
  value: number
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>
}

function getEmotionDisplayName(label: string, language: 'en' | 'fa'): string {
  const primary = EMOTION_GROUPS.find((group) => group.labelEn === label)
  if (primary) {
    return language === 'fa' ? primary.labelFa : primary.labelEn
  }

  for (const group of EMOTION_GROUPS) {
    const secondary = group.secondary.find((item) => item.en === label)
    if (secondary) {
      return language === 'fa' ? secondary.fa : secondary.en
    }
  }

  return label
}

function App() {
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
  const [rewardMessage, setRewardMessage] = useState('')
  const [isEditorOpen, setIsEditorOpen] = useState(false)
  const [isInsightsOpen, setIsInsightsOpen] = useState(false)
  const [isImportExportOpen, setIsImportExportOpen] = useState(false)
  const [deferredInstallPrompt, setDeferredInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isInstalled, setIsInstalled] = useState(false)
  const [editingHabitId, setEditingHabitId] = useState<string | null>(null)
  const [insightHabitId, setInsightHabitId] = useState<string | null>(null)
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

  const todayKey = useMemo(() => getEffectiveDayKey(clockNow), [clockNow])
  const currentPhase = useMemo(() => getCurrentPhase(clockNow), [clockNow])
  const tx = (en: string, fa: string): string => (language === 'fa' ? fa : en)

  useEffect(() => {
    window.localStorage.setItem('habit-feed-language', language)
    document.documentElement.lang = language
    document.documentElement.dir = language === 'fa' ? 'rtl' : 'ltr'
  }, [language])

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
        setIsLoaded(true)
      })
      .catch(() => {
        if (!mounted) {
          return
        }
        setIsLoaded(true)
      })

    return () => {
      mounted = false
    }
  }, [])

  useEffect(() => {
    if (!isLoaded) {
      return
    }
    void savePersistedState({ habits, logs })
  }, [habits, logs, isLoaded])

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

  const completedToday = useMemo(() => {
    const completedSet = new Set(
      logs.filter((log) => log.dayKey === todayKey).map((log) => log.habitId),
    )
    return completedSet.size
  }, [logs, todayKey])

  const visibleHabits = useMemo(() => {
    const currentPhaseIndex = PHASE_ORDER.indexOf(currentPhase)

    return habits
      .filter((habit) => !habit.archived && PHASE_ORDER.indexOf(habit.phase) <= currentPhaseIndex)
      .filter((habit) => shouldShowHabitBySchedule(habit, logs, todayKey))
      .sort((a, b) => {
        const phaseDiff = PHASE_ORDER.indexOf(b.phase) - PHASE_ORDER.indexOf(a.phase)
        if (phaseDiff !== 0) {
          return phaseDiff
        }
        return a.createdAt.localeCompare(b.createdAt)
      })
  }, [habits, logs, currentPhase, todayKey])

  const managedHabit = useMemo(
    () => habits.find((habit) => habit.id === editingHabitId) ?? null,
    [habits, editingHabitId],
  )

  const activeHabits = useMemo(() => habits.filter((habit) => !habit.archived), [habits])

  const parsedLogEntries = useMemo(
    () => logs.map((log) => ({ log, report: parseReport(log.reportValue) })),
    [logs],
  )

  useEffect(() => {
    if (insightHabitId) {
      return
    }
    const firstHabit = activeHabits[0]
    if (firstHabit) {
      setInsightHabitId(firstHabit.id)
    }
  }, [activeHabits, insightHabitId])

  const selectedInsightHabit = useMemo(
    () => activeHabits.find((habit) => habit.id === insightHabitId) ?? activeHabits[0] ?? null,
    [activeHabits, insightHabitId],
  )

  const allCompletionsChart = useMemo(() => {
    const dayKeys = getRecentDayKeys(todayKey, 14)
    return dayKeys.map((dayKey) => ({
      label: shortDayLabel(dayKey),
      value: logs.filter((log) => log.dayKey === dayKey).length,
    }))
  }, [logs, todayKey])

  const allCoverageChart = useMemo(() => {
    const dayKeys = getRecentDayKeys(todayKey, 14)
    return dayKeys.map((dayKey) => ({
      label: shortDayLabel(dayKey),
      value: getAllHabitCoverageForDay(activeHabits, logs, dayKey),
    }))
  }, [activeHabits, logs, todayKey])

  const averageStrength = useMemo(() => {
    if (!activeHabits.length) {
      return 0
    }
    const total = activeHabits.reduce((sum, habit) => {
      const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey)
      const strength = getStrength(getAdaptiveK(habit), streakUnits)
      return sum + strength
    }, 0)
    return total / activeHabits.length
  }, [activeHabits, logs, todayKey])

  const riskBuckets = useMemo(() => {
    let fragile = 0
    let forming = 0
    let automatic = 0

    for (const habit of activeHabits) {
      const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey)
      const strength = getStrength(getAdaptiveK(habit), streakUnits)
      const tier = getRiskTier(strength).title
      if (tier === 'Fragile') fragile += 1
      if (tier === 'Forming') forming += 1
      if (tier === 'Automatic') automatic += 1
    }

    return { fragile, forming, automatic }
  }, [activeHabits, logs, todayKey])

  const moodDistribution = useMemo(() => {
    const counts = Array.from({ length: 7 }, () => 0)
    for (const entry of parsedLogEntries) {
      if (entry.report.type === 'mood' && entry.report.mood) {
        const mood = clamp(entry.report.mood, 1, 7)
        counts[mood - 1] += 1
      }
    }
    return counts
  }, [parsedLogEntries])

  const emotionDistribution = useMemo(() => {
    const map = new Map<string, number>()
    for (const entry of parsedLogEntries) {
      if (entry.report.type === 'emotion' && entry.report.emotionPrimary) {
        const key = entry.report.emotionPrimary
        map.set(key, (map.get(key) ?? 0) + 1)
      }
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
  }, [parsedLogEntries])

  const reportingMix = useMemo(() => {
    const counts: Record<ReportingType, number> = {
      button: 0,
      mood: 0,
      emotion: 0,
      text: 0,
    }

    for (const habit of activeHabits) {
      counts[habit.reportingType] += 1
    }
    return counts
  }, [activeHabits])

  const habitChart = useMemo<ChartPoint[]>(() => {
    if (!selectedInsightHabit) {
      return []
    }

    if (selectedInsightHabit.desiredFrequency.per === 'day') {
      const dayKeys = getRecentDayKeys(todayKey, 14)
      return dayKeys.map((dayKey) => ({
        label: shortDayLabel(dayKey),
        value: Math.min(
          1,
          countHabitCompletionsForDay(selectedInsightHabit.id, dayKey, logs) /
            Math.max(1, selectedInsightHabit.desiredFrequency.count),
        ),
      }))
    }

    const weekStarts = getRecentWeekStarts(todayKey, 8)
    return weekStarts.map((weekStart) => ({
      label: shortDayLabel(weekStart),
      value: Math.min(
        1,
        countHabitCompletionsForWeek(selectedInsightHabit.id, weekStart, logs) /
          Math.max(1, selectedInsightHabit.desiredFrequency.count),
      ),
    }))
  }, [selectedInsightHabit, todayKey, logs])

  const selectedHabitTextReports = useMemo(() => {
    if (!selectedInsightHabit || selectedInsightHabit.reportingType !== 'text') {
      return [] as ParsedReport[]
    }

    return parsedLogEntries
      .filter((entry) => entry.log.habitId === selectedInsightHabit.id)
      .map((entry) => entry.report)
      .filter((report) => report.type === 'text' && report.text)
  }, [selectedInsightHabit, parsedLogEntries])

  const selectedHabitSentiment = useMemo(() => {
    return selectedHabitTextReports
      .slice(-10)
      .map((report) => report.sentiment ?? analyzeSentiment(report.text ?? ''))
  }, [selectedHabitTextReports])

  const selectedHabitTopWords = useMemo(
    () => getTopWordsFromReports(selectedHabitTextReports, 8),
    [selectedHabitTextReports],
  )

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

  function completeHabit(habit: Habit, report: ParsedReport): void {
    incrementStreakBreakIfNeeded(habit)

    setLogs((previous) => {
      const entry: HabitLog = {
        id: crypto.randomUUID(),
        habitId: habit.id,
        dayKey: todayKey,
        completedAt: new Date().toISOString(),
        reportValue: JSON.stringify(report),
      }
      return [...previous, entry]
    })

    setCardInputs((prev) => {
      const next = { ...prev }
      delete next[habit.id]
      return next
    })
    setEmotionPrimary((prev) => ({ ...prev, [habit.id]: null }))
    const encouragements = language === 'fa' ? ENCOURAGEMENTS_FA : ENCOURAGEMENTS
    setRewardMessage(encouragements[Math.floor(Math.random() * encouragements.length)])
  }

  function saveHabit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    if (!draft.name.trim()) {
      return
    }

    const normalizedK = clamp(draft.difficultyK, 0.01, 0.12)
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

  function exportData(): void {
    const payload = JSON.stringify(toExportData({ habits, logs }), null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
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

        {visibleHabits.map((habit) => {
          const streakUnits = getConsecutiveSuccessUnits(habit, logs, todayKey)
          const adaptiveK = getAdaptiveK(habit)
          const strength = getStrength(adaptiveK, streakUnits)
          const riskTier = getRiskTier(strength)
          const period = getPeriodProgress(habit, logs, todayKey)
          const periodLabel =
            language === 'fa'
              ? `${period.done}/${period.target} ${habit.desiredFrequency.per === 'day' ? 'امروز' : 'این هفته'}`
              : period.label

          return (
            <article
              key={habit.id}
              className={`habit-card ${riskTier.className}`}
              onPointerDown={() => startCardLongPress(habit)}
              onPointerUp={clearCardLongPress}
              onPointerLeave={clearCardLongPress}
              onPointerCancel={clearCardLongPress}
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

              <div className="reporting-box">
                {habit.reportingType === 'button' && (
                  <button
                    className="primary-btn"
                    onClick={() => completeHabit(habit, { type: 'button' })}
                  >
                    {tx('I did it', 'انجام شد')} ({period.remaining} {tx('left', 'باقی‌مانده')})
                  </button>
                )}

                {habit.reportingType === 'mood' && (
                  <>
                    <label className="field-label">{tx('Pick your mood', 'حال خودت را انتخاب کن')}</label>
                    <div className="emoji-row">
                      {MOOD_EMOJIS.map((emoji, index) => (
                        <button
                          key={`${habit.id}-mood-${emoji}`}
                          className="emoji-btn"
                          onClick={() => completeHabit(habit, { type: 'mood', mood: index + 1 })}
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
                          key={`${habit.id}-${group.key}`}
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
                                key={`${habit.id}-${secondary.en}`}
                                className="chip-btn"
                                onClick={() =>
                                  completeHabit(habit, {
                                    type: 'emotion',
                                    emotionPrimary:
                                      EMOTION_GROUPS.find((group) => group.key === emotionPrimary[habit.id])
                                        ?.labelEn ?? '',
                                    emotionSecondary: secondary.en,
                                  })
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
                    <label className="field-label" htmlFor={`text-${habit.id}`}>
                      {tx('Journal note', 'یادداشت روزانه')}
                    </label>
                    <textarea
                      id={`text-${habit.id}`}
                      className="text-input text-area"
                      placeholder={tx('Write a few lines about this habit today…', 'چند خط درباره این عادت امروز بنویس…')}
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
                        completeHabit(habit, {
                          type: 'text',
                          text,
                          sentiment: analyzeSentiment(text),
                        })
                      }}
                    >
                      {tx('Save journal entry', 'ثبت یادداشت')}
                    </button>
                  </>
                )}
              </div>
            </article>
          )
        })}
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
              {PHASE_ORDER.map((phase) => (
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
              const streakUnits = getConsecutiveSuccessUnits(managedHabit, logs, todayKey)
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
                      {tx('Streak units', 'واحدهای تداوم')} <strong>{streakUnits}</strong>
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
            <p className="meta-line">{tx('Overall trends and individual habit analytics.', 'روندهای کلی و تحلیل تک‌عادت.')}</p>

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
                <span>{tx('Avg strength', 'میانگین قدرت')}</span>
                <strong>{averageStrength.toFixed(1)}%</strong>
              </article>
              <article>
                <span>{tx('Risk mix', 'ترکیب ریسک')}</span>
                <strong>{riskBuckets.fragile}/{riskBuckets.forming}/{riskBuckets.automatic}</strong>
              </article>
            </div>

            <div className="chart-block">
              <p className="field-label">{tx('Completions per day (14d)', 'تعداد انجام در روز (۱۴ روز)')}</p>
              <div className="bar-chart">
                {allCompletionsChart.map((point) => (
                  <div key={`all-c-${point.label}`} className="bar-col">
                    <div className="bar-fill" style={{ height: `${Math.max(6, point.value * 12)}%` }}></div>
                    <span>{point.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="chart-block">
              <p className="field-label">{tx('Consistency coverage (14d)', 'پوشش پیوستگی (۱۴ روز)')}</p>
              <div className="bar-chart">
                {allCoverageChart.map((point) => (
                  <div key={`all-k-${point.label}`} className="bar-col">
                    <div className="bar-fill accent" style={{ height: `${Math.max(6, point.value * 100)}%` }}></div>
                    <span>{point.label}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="insight-split">
              <div>
                <p className="field-label">{tx('Reporting mix', 'ترکیب گزارش‌دهی')}</p>
                <ul className="mini-list">
                  <li>{tx('Button', 'دکمه')}: {reportingMix.button}</li>
                  <li>{tx('Mood', 'حال')}: {reportingMix.mood}</li>
                  <li>{tx('Emotion', 'احساس')}: {reportingMix.emotion}</li>
                  <li>{tx('Text', 'متن')}: {reportingMix.text}</li>
                </ul>
              </div>
              <div>
                <p className="field-label">{tx('Mood distribution', 'توزیع حال')}</p>
                <p className="trend-row">
                  {MOOD_EMOJIS.map((emoji, index) => (
                    <span
                      key={`mood-dist-${emoji}`}
                      title={`${moodDistribution[index]} ${tx('logs', 'ثبت')}`}
                    >
                      {emoji} {moodDistribution[index]}
                    </span>
                  ))}
                </p>
                {emotionDistribution.length > 0 && (
                  <>
                    <p className="field-label">{tx('Top emotions', 'احساسات پرتکرار')}</p>
                    <ul className="mini-list">
                      {emotionDistribution.map(([emotion, count]) => (
                        <li key={`emotion-${emotion}`}>
                          {getEmotionDisplayName(emotion, language)}: {count}
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            </div>

            <h4>{tx('Individual habit', 'هر عادت')}</h4>
            <select
              className="text-input"
              value={selectedInsightHabit?.id ?? ''}
              onChange={(event) => setInsightHabitId(event.target.value)}
            >
              {activeHabits.map((habit) => (
                <option key={`insight-habit-${habit.id}`} value={habit.id}>
                  {habit.name}
                </option>
              ))}
            </select>

            {selectedInsightHabit && (
              <>
                <p className="meta-line">
                  {formatFrequencyLabel(selectedInsightHabit)} · {getReportingLabel(selectedInsightHabit.reportingType, language)}
                </p>
                <div className="chart-block">
                  <p className="field-label">
                    {selectedInsightHabit.desiredFrequency.per === 'day'
                      ? tx('Consistency by day (14d)', 'پیوستگی روزانه (۱۴ روز)')
                      : tx('Consistency by week (8w)', 'پیوستگی هفتگی (۸ هفته)')}
                  </p>
                  <div className="bar-chart">
                    {habitChart.map((point) => (
                      <div key={`habit-c-${point.label}`} className="bar-col">
                        <div className="bar-fill success" style={{ height: `${Math.max(6, point.value * 100)}%` }}></div>
                        <span>{point.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {selectedInsightHabit.reportingType === 'text' && (
                  <div className="sentiment-panel">
                    <p className="field-label">{tx('Sentiment timeline', 'خط زمان احساس')}</p>
                    <p className="trend-row">
                      {selectedHabitSentiment.length
                        ? selectedHabitSentiment.map((score, index) => (
                            <span key={`habit-s-${index}`}>{sentimentEmoji(score)}</span>
                          ))
                        : tx('No sentiment entries yet', 'هنوز ورودی احساسی ثبت نشده')}
                    </p>
                    {selectedHabitTopWords.length > 0 && (
                      <div className="word-cloud">
                        {selectedHabitTopWords.map(([word, count]) => (
                          <span key={`habit-word-${word}`} style={{ fontSize: `${0.75 + count * 0.08}rem` }}>
                            {word}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            <div className="modal-actions">
              <button className="secondary-btn" onClick={() => setIsInsightsOpen(false)}>
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
    </main>
  )
}

export default App
