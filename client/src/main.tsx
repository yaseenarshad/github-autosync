import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './app.css'

async function start() {
  // Plain Vite in a browser has no preload: fall back to a seeded in-memory API so the UI can be viewed.
  // Dev only, so a production build drops the fake (and its demo data) entirely.
  if (import.meta.env.DEV && !window.autosync) window.autosync = (await import('./dev/fakeApi')).createFakeApi()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
