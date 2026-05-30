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

const SETTINGS_KEY = 'habit-feed-drive-backup-settings-v1'
const BACKUP_FILE_NAME = 'habit-feed-backup.json'
const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata'

interface GoogleTokenResponse {
  access_token?: string
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
            reject(new Error(response.error_description || response.error || 'Google authorization failed.'))
            return
          }
          resolve(response.access_token)
        },
      })

      tokenClient.requestAccessToken({ prompt })
    })

  if (interactive) {
    return requestToken('consent')
  }

  return requestToken('')
}

async function listBackupFiles(accessToken: string): Promise<Array<{ id: string; modifiedTime?: string }>> {
  const query = encodeURIComponent(`name='${BACKUP_FILE_NAME}' and 'appDataFolder' in parents and trashed=false`)
  const response = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=appDataFolder&fields=files(id,modifiedTime)&orderBy=modifiedTime desc`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
  )

  if (!response.ok) {
    throw new Error('Could not list Google Drive backups.')
  }

  const payload = (await response.json()) as { files?: Array<{ id: string; modifiedTime?: string }> }
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

export async function uploadBackupToDrive(options: {
  clientId: string
  content: string
  fileId?: string | null
  interactive: boolean
}): Promise<DriveBackupResult> {
  const accessToken = await getAccessToken(options.clientId, options.interactive)
  const boundary = `habit-feed-${crypto.randomUUID()}`
  let method = 'POST'
  let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart'
  let fileId = options.fileId ?? null

  if (!fileId) {
    const existingFiles = await listBackupFiles(accessToken)
    fileId = existingFiles[0]?.id ?? null
  }

  if (fileId) {
    method = 'PATCH'
    url = `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
  }

  const metadata = fileId
    ? { name: BACKUP_FILE_NAME }
    : { name: BACKUP_FILE_NAME, parents: ['appDataFolder'] }

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

export async function restoreBackupFromDrive(options: {
  clientId: string
  fileId?: string | null
  interactive: boolean
}): Promise<{ fileId: string; state: PersistedState }> {
  const accessToken = await getAccessToken(options.clientId, options.interactive)
  let fileId = options.fileId ?? null

  if (!fileId) {
    const existingFiles = await listBackupFiles(accessToken)
    fileId = existingFiles[0]?.id ?? null
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
