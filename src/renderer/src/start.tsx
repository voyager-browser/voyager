import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { StartPage } from './components/StartPage'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found')
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider>
      <StartPage />
    </ThemeProvider>
  </StrictMode>
)
