import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.tsx'
import Board from './Board.tsx'
import Kiosk from './Kiosk.tsx'

function pageFromPath(): 'kiosk' | 'board' | 'app' {
  const path = window.location.pathname.replace(/\/+$/, '')
  if (path.endsWith('/kiosk')) return 'kiosk'
  if (path.endsWith('/board')) return 'board'
  return 'app'
}

const page = pageFromPath()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {page === 'kiosk' ? <Kiosk /> : page === 'board' ? <Board /> : <App />}
  </StrictMode>,
)
