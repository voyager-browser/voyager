import { Puzzle } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ExtensionInfo } from '../../../shared/types'
import { IconButton } from './ui/IconButton'

interface ExtensionMenuProps {
  extensions: ExtensionInfo[]
}

/**
 * Toolbar entry point for extension actions. The actions are shown in a native
 * Electron menu: a DOM overlay would require expanding the transparent chrome
 * view to the full window, which can blank the tab strip and block window
 * dragging when an extension popup takes focus.
 */
export function ExtensionMenu({ extensions }: ExtensionMenuProps): React.JSX.Element | null {
  const hasActions = extensions.some(
    (extension) => extension.loaded && extension.id && extension.action?.popup
  )
  if (!hasActions) return null

  const showMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    void window.voyager.extensions.showActionMenu(rect.right, rect.bottom).catch(() => undefined)
  }

  return (
    <IconButton label="Extensions" onClick={showMenu}>
      <Puzzle className="h-4 w-4" />
    </IconButton>
  )
}
