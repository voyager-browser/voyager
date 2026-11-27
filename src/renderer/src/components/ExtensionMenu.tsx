import { Puzzle } from 'lucide-react'
import type { MouseEvent } from 'react'
import type { ExtensionInfo } from '../../../shared/types'
import { IconButton } from './ui/IconButton'

interface ExtensionMenuProps {
  extensions: ExtensionInfo[]
}

/**
 * Toolbar entry point for extension actions. Pinned actions open their popup
 * directly from their own icon; the puzzle button opens the Chrome-style HTML
 * menu in an in-window panel so the chrome view is never resized.
 */
export function ExtensionMenu({ extensions }: ExtensionMenuProps): React.JSX.Element | null {
  const actions = extensions.filter(
    (extension) => extension.loaded && extension.id && extension.action?.popup
  )
  const pinned = actions.filter((extension) => extension.pinned)
  if (actions.length === 0) return null

  const openPinned = (extension: ExtensionInfo, event: MouseEvent<HTMLButtonElement>): void => {
    if (!extension.id || !extension.action?.popup) return
    const rect = event.currentTarget.getBoundingClientRect()
    void window.voyager.extensions.openPopup(
      extension.id,
      extension.action.popup,
      rect.right,
      rect.bottom
    )
  }

  const showMenu = (event: MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    void window.voyager.extensions.showActionMenu(rect.right, rect.bottom)
  }

  return (
    <>
      {pinned.map((extension) => (
        <IconButton
          key={extension.path}
          label={`Open ${extension.name}`}
          onClick={(event) => openPinned(extension, event)}
        >
          {extension.action?.iconUrl ? (
            <img src={extension.action.iconUrl} alt="" className="h-4 w-4 object-contain" />
          ) : (
            <Puzzle className="h-4 w-4" />
          )}
        </IconButton>
      ))}
      <IconButton label="Extensions" onClick={showMenu}>
        <Puzzle className="h-4 w-4" />
      </IconButton>
    </>
  )
}
