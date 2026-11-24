import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { SettingsPage } from './components/SettingsPage'
import { ThemeProvider } from './components/providers/ThemeProvider'
import './styles/globals.css'

const container = document.getElementById('root')
if (!container) {
  throw new Error('Root container #root was not found')
}

createRoot(container).render(
  <StrictMode>
    <ThemeProvider applyChromeTheme={false}>
      <SettingsPage />
    </ThemeProvider>
  </StrictMode>
)
