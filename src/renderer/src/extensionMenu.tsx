import { createRoot } from 'react-dom/client'
import { ThemeProvider } from './components/providers/ThemeProvider'
import { ExtensionMenuPanel } from './components/ExtensionMenuPanel'
import './styles/globals.css'
import './styles/extensionMenu.css'

const container = document.getElementById('root')
if (!container) throw new Error('Root container #root was not found')
createRoot(container).render(
  <ThemeProvider>
    <ExtensionMenuPanel />
  </ThemeProvider>
)
