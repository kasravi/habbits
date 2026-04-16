const CACHE_NAME = 'habbits-pwa-v3'

function getBasePath() {
  const scope = self.registration?.scope
  if (!scope) {
    return '/'
  }
  return new URL(scope).pathname
}

function withBase(path) {
  const base = getBasePath()
  if (path.startsWith('/')) {
    return `${base}${path.slice(1)}`
  }
  return `${base}${path}`
}

const ASSETS = [
  withBase(''),
  withBase('index.html'),
  withBase('manifest.webmanifest'),
  withBase('icons/icon-192.png'),
  withBase('icons/icon-512.png'),
]

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting()
  }
})

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ),
    ),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return
  }

  const requestUrl = new URL(event.request.url)
  const isNavigationRequest = event.request.mode === 'navigate'
  const isSameOrigin = requestUrl.origin === self.location.origin

  if (isNavigationRequest) {
    event.respondWith(
      fetch(event.request, { cache: 'no-store' })
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const responseClone = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(withBase('index.html'), responseClone)
            })
          }
          return networkResponse
        })
        .catch(() => caches.match(withBase('index.html'))),
    )
    return
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse && isSameOrigin) {
        fetch(event.request)
          .then((networkResponse) => {
            if (!networkResponse || networkResponse.status !== 200) {
              return
            }
            const responseClone = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseClone)
            })
          })
          .catch(() => undefined)
        return cachedResponse
      }

      return fetch(event.request)
        .then((networkResponse) => {
          if (!networkResponse || networkResponse.status !== 200) {
            return networkResponse
          }

          const responseClone = networkResponse.clone()
          caches.open(CACHE_NAME).then((cache) => {
            cache.put(event.request, responseClone)
          })
          return networkResponse
        })
        .catch(() => caches.match(withBase('index.html')))
    }),
  )
})
