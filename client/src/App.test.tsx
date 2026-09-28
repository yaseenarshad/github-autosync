import { afterEach, expect, it } from 'vitest'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { App } from './App'

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

it('renders the app name', () => {
  const container = document.body.appendChild(document.createElement('div'))
  root = createRoot(container)
  act(() => root!.render(<App />))
  expect(container.textContent).toBe('GitHub AutoSync')
})
