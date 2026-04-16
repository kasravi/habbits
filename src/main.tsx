import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

const SW_PATH = `${import.meta.env.BASE_URL}sw.js`

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    void (async () => {
      const expectedScriptUrl = new URL(SW_PATH, window.location.href).href

      const existingRegistrations = await navigator.serviceWorker.getRegistrations()
      for (const registration of existingRegistrations) {
        const sameScope = registration.scope.endsWith(import.meta.env.BASE_URL)
        const activeUrl = registration.active?.scriptURL
        if (sameScope && activeUrl && activeUrl !== expectedScriptUrl) {
          await registration.unregister()
        }
      }

      const registration = await navigator.serviceWorker.register(SW_PATH, {
        updateViaCache: 'none',
      })

      const activateWaitingWorker = () => {
        if (registration.waiting) {
          registration.waiting.postMessage({ type: 'SKIP_WAITING' })
        }
      }

      registration.addEventListener('updatefound', () => {
        const installing = registration.installing
        if (!installing) {
          return
        }

        installing.addEventListener('statechange', () => {
          if (installing.state === 'installed' && navigator.serviceWorker.controller) {
            activateWaitingWorker()
          }
        })
      })

      if (registration.waiting) {
        activateWaitingWorker()
      }

      navigator.serviceWorker.addEventListener('controllerchange', () => {
        window.location.reload()
      })

      window.setInterval(() => {
        void registration.update()
      }, 60 * 1000)
    })()
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
