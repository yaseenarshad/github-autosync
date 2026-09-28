import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './app.css'

async function start() {
  // Plain Vite in a browser has no preload: fall back to a seeded in-memory API so the UI can be viewed.
  if (!window.autosync) window.autosync = (await import('./dev/fakeApi')).createFakeApi()
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}

void start()
