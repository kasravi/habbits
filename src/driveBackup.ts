import type { PersistedState } from './db'

export interface DriveBackupSettings {
  clientId: string
  enabled: boolean
  intervalMinutes: number
  fileId: string | null
  lastSyncedAt: string | null
  lastError: string
}

export interface DriveBackupResult {
  fileId: string
  modifiedTime?: string
}

export const DRIVE_REAUTH_REQUIRED_MESSAGE = 'Google Drive needs you to reconnect manually.'

const SETTINGS_KEY = 'habit-feed-drive-backup-settings-v1'
const LATEST_BACKUP_FILE_NAME = 'habit-feed-backup.json'
const SNAPSHOT_FILE_PREFIX = 'habit-feed-backup-snapshot-'
const SNAPSHOT_RETENTION_DAYS = 3
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

interface DriveFileRecord {
  id: string
  name: string
  modifiedTime?: string
}

interface GoogleTokenResponse {
  access_token?: string
  expires_in?: number
  error?: string
  error_description?: string
}

interface GoogleTokenClient {
  requestAccessToken: (options?: { prompt?: string }) => void
}

interface GoogleAccountsOauth2 {
  initTokenClient: (config: {
    client_id: string
    scope: string
    callback: (response: GoogleTokenResponse) => void
  }) => GoogleTokenClient
}

interface GoogleIdentity {
  accounts: {
    oauth2: GoogleAccountsOauth2
  }
}

declare global {
  interface Window {
    google?: GoogleIdentity
  }
}

export function defaultDriveBackupSettings(): DriveBackupSettings {
  return {
    clientId: '',
    enabled: false,
    intervalMinutes: 60,
    fileId: null,
    lastSyncedAt: null,
    lastError: '',
  }
}

export function loadDriveBackupSettings(): DriveBackupSettings {
  if (typeof window === 'undefined') {
    return defaultDriveBackupSettings()
  }

  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY)
    if (!raw) {
      return defaultDriveBackupSettings()
    }

    const parsed = JSON.parse(raw) as Partial<DriveBackupSettings>
    return {
      clientId: typeof parsed.clientId === 'string' ? parsed.clientId : '',
      enabled: Boolean(parsed.enabled),
      intervalMinutes:
        typeof parsed.intervalMinutes === 'number' && Number.isFinite(parsed.intervalMinutes)
          ? Math.max(5, Math.min(24 * 60, Math.round(parsed.intervalMinutes)))
          : 60,
      fileId: typeof parsed.fileId === 'string' ? parsed.fileId : null,
      lastSyncedAt: typeof parsed.lastSyncedAt === 'string' ? parsed.lastSyncedAt : null,
      lastError: typeof parsed.lastError === 'string' ? parsed.lastError : '',
    }
  } catch {
    return defaultDriveBackupSettings()
  }
}

export function saveDriveBackupSettings(settings: DriveBackupSettings): void {
  if (typeof window === 'undefined') {
    return
  }

  window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings))
}

let googleScriptPromise: Promise<void> | null = null
let accessTokenCache: {
  clientId: string
  token: string
  expiresAt: number
} | null = null

function ensureGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') {
    return Promise.reject(new Error('Google Drive backup only works in the browser.'))
  }

  if (window.google?.accounts?.oauth2) {
    return Promise.resolve()
  }

  if (!googleScriptPromise) {
    googleScriptPromise = new Promise((resolve, reject) => {
      const existingScript = document.querySelector<HTMLScriptElement>('script[data-google-identity="true"]')
      if (existingScript) {
        existingScript.addEventListener('load', () => resolve(), { once: true })
        existingScript.addEventListener('error', () => reject(new Error('Could not load Google Identity Services.')), {
          once: true,
        })
        return
      }

      const script = document.createElement('script')
      script.src = 'https://accounts.google.com/gsi/client'
      script.async = true
      script.defer = true
      script.dataset.googleIdentity = 'true'
      script.onload = () => resolve()
      script.onerror = () => reject(new Error('Could not load Google Identity Services.'))
      document.head.appendChild(script)
    })
  }

  return googleScriptPromise
}

async function getAccessToken(clientId: string, interactive: boolean): Promise<string> {
  await ensureGoogleScript()

  if (
    accessTokenCache &&
    accessTokenCache.clientId === clientId &&
    accessTokenCache.expiresAt > Date.now() + 30_000
  ) {
    return accessTokenCache.token
  }

  const requestToken = (prompt: string): Promise<string> =>
    new Promise((resolve, reject) => {
      const oauth = window.google?.accounts?.oauth2
      if (!oauth) {
        reject(new Error('Google Identity Services is not available.'))
        return
      }

      const tokenClient = oauth.initTokenClient({
        client_id: clientId,
        scope: DRIVE_SCOPE,
        callback: (response) => {
          if (response.error || !response.access_token) {
            const errorText = response.error_description || response.error || 'Google authorization failed.'
            if (!interactive) {
              reject(new Error(DRIVE_REAUTH_REQUIRED_MESSAGE))
              return
            }
            reject(new Error(errorText))
            return
          }
          accessTokenCache = {
            clientId,
            token: response.access_token,
            expiresAt: Date.now() + Math.max(60, response.expires_in ?? 3600) * 1000,
          }
          resolve(response.access_token)
        },
      })

      tokenClient.requestAccessToken({ prompt })
    })

  if (interactive) {
    return requestToken('consent')
  }

  return requestToken('none')
}

export function clearDriveAccessTokenCache(): void {
  accessTokenCache = null
}

function formatDayKey(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function getSnapshotFileName(dayKey: string): string {
  return `${SNAPSHOT_FILE_PREFIX}${dayKey}.json`
}

async function listBackupFiles(accessToken: string): Promise<DriveFileRecord[]> {
  const query = encodeURIComponent(
    `'appDataFolder' in parents and trashed=false and (name='${LATEST_BACKUP_FILE_NAME}' or name contains '${SNAPSHOT_FILE_PREFIX}')`,
  )
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error('Could not list Google Drive backups.')
  }

  const payload = (await response.json()) as { files?: DriveFileRecord[] }
  return payload.files ?? []
}

function createMultipartBody(metadata: Record<string, unknown>, content: string, boundary: string): string {
  return [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
}

async function upsertBackupFile(options: {
  clientId: string
  accessToken?: string
  content: string
  name: string
  fileId?: string | null
  interactive: boolean
}): Promise<DriveBackupResult> {
  const accessToken = options.accessToken ?? (await getAccessToken(options.clientId, options.interactive))
  const boundary = `habit-feed-${crypto.randomUUID()}`
  let method = 'POST'
  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  let fileId = options.fileId ?? null

  if (fileId) {
    method = 'PATCH'
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
  }

  const metadata = fileId
    ? { name: options.name }
    : { name: options.name, parents: ['appDataFolder'] }

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': `multipart/related; boundary=${boundary}`,
    },
    body: createMultipartBody(metadata, options.content, boundary),
  })

  if (!response.ok) {
    throw new Error('Could not upload the backup to Google Drive.')
  }

  const payload = (await response.json()) as { id: string; modifiedTime?: string }
  return {
    fileId: payload.id,
    modifiedTime: payload.modifiedTime,
  }
}

async function deleteBackupFile(accessToken: string, fileId: string): Promise<void> {
  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok && response.status !== 404) {
    throw new Error('Could not clean up old Google Drive snapshots.')
  }
}

export async function uploadBackupToDrive(options: {
  clientId: string
  content: string
  fileId?: string | null
  interactive: boolean
}): Promise<DriveBackupResult> {
  const accessToken = await getAccessToken(options.clientId, options.interactive)
  const existingFiles = await listBackupFiles(accessToken)
  const latestFile =
    existingFiles.find((entry) => entry.id === options.fileId) ??
    existingFiles.find((entry) => entry.name === LATEST_BACKUP_FILE_NAME) ??
    null

  const latestResult = await upsertBackupFile({
    clientId: options.clientId,
    accessToken,
    content: options.content,
    name: LATEST_BACKUP_FILE_NAME,
    fileId: latestFile?.id ?? null,
    interactive: options.interactive,
  })

  const todaySnapshotName = getSnapshotFileName(formatDayKey(new Date()))
  const snapshotFile = existingFiles.find((entry) => entry.name === todaySnapshotName) ?? null

  await upsertBackupFile({
    clientId: options.clientId,
    accessToken,
    content: options.content,
    name: todaySnapshotName,
    fileId: snapshotFile?.id ?? null,
    interactive: options.interactive,
  })

  const staleSnapshots = existingFiles
    .filter((entry) => entry.name.startsWith(SNAPSHOT_FILE_PREFIX) && entry.name !== todaySnapshotName)
    .sort((a, b) => b.name.localeCompare(a.name))
    .slice(SNAPSHOT_RETENTION_DAYS - 1)

  await Promise.all(staleSnapshots.map((entry) => deleteBackupFile(accessToken, entry.id)))

  return latestResult
}

export async function restoreBackupFromDrive(options: {
  clientId: string
  fileId?: string | null
  interactive: boolean
}): Promise<{ fileId: string; state: PersistedState }> {
  const accessToken = await getAccessToken(options.clientId, options.interactive)
  let fileId = options.fileId ?? null

  if (!fileId) {
    const existingFiles = await listBackupFiles(accessToken)
    const latest = existingFiles.find((entry) => entry.name === LATEST_BACKUP_FILE_NAME)
    const latestSnapshot = [...existingFiles]
      .filter((entry) => entry.name.startsWith(SNAPSHOT_FILE_PREFIX))
      .sort((a, b) => b.name.localeCompare(a.name))[0]
    fileId = latest?.id ?? latestSnapshot?.id ?? null
  }

  if (!fileId) {
    throw new Error('No Google Drive backup was found yet.')
  }

  const response = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  })

  if (!response.ok) {
    throw new Error('Could not download the Google Drive backup.')
  }

  const payload = (await response.json()) as PersistedState
  return {
    fileId,
    state: payload,
  }
}
