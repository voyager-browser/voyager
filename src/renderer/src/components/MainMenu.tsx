import { Bookmark, Download, ExternalLink, Plus, QrCode, VenetianMask } from 'lucide-react'
import { PROFILE_COLOR_CLASSES } from '../../../shared/profiles'
import { useActiveTab, useBrowserStore } from '../state/browserStore'
import { useUiStore } from '../state/uiStore'
import { useOverlaySignal } from '../lib/overlay'
import { cn } from '../lib/cn'

interface MainMenuProps {
  open: boolean
  onClose: () => void
}

function MenuButton({
  icon,
  label,
  onClick,
  disabled
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left text-[13px] text-fg transition-colors hover:bg-hover disabled:opacity-50"
      onClick={onClick}
      disabled={disabled}
    >
      <span className="text-muted">{icon}</span>
      <span>{label}</span>
    </button>
  )
}

export function MainMenu({ open, onClose }: MainMenuProps): React.JSX.Element | null {
  useOverlaySignal(open)
  const profile = useBrowserStore((state) => state.profile)
  const incognito = useBrowserStore((state) => state.incognito)
  const activeTab = useActiveTab()

  if (!open) return null

  const run = (action: () => void): void => {
    onClose()
    action()
  }

  const openQr = (): void => {
    const url = activeTab?.url ?? ''
    window.dispatchEvent(new CustomEvent('voyager:open-qr-code', { detail: { url } }))
  }

  return (
    <div className="fixed inset-0 z-40" onMouseDown={onClose}>
      <div
        className="no-drag absolute right-3 top-[84px] flex w-[280px] max-w-[calc(100vw-24px)] flex-col overflow-hidden rounded-xl border border-border bg-surface shadow-2xl shadow-black/20"
        onMouseDown={(event) => event.stopPropagation()}
      >
        {profile && !incognito && (
          <div className="border-b border-border p-2">
            <button
              type="button"
              className="flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover"
              onClick={() => run(() => void window.voyager.settings.open({ page: 'profiles' }))}
            >
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden text-[12px] font-semibold text-white',
                  profile.picture ? 'rounded-full' : 'rounded-lg',
                  !profile.picture && (PROFILE_COLOR_CLASSES[profile.color] ?? PROFILE_COLOR_CLASSES.blue)
                )}
                style={
                  profile.backgroundColor && !profile.picture
                    ? { backgroundColor: profile.backgroundColor }
                    : undefined
                }
              >
                {profile.picture ? (
                  <img src={profile.picture} alt="" className="h-full w-full object-cover" />
                ) : (
                  (profile.name.trim()[0] ?? '?').toUpperCase()
                )}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-medium text-fg">{profile.name}</span>
                <span className="block text-[11.5px] text-muted">Manage profiles</span>
              </span>
            </button>
          </div>
        )}

        <div className="p-1.5">
          <MenuButton
            icon={<Plus className="h-4 w-4" />}
            label="New tab"
            onClick={() => run(() => void window.voyager.tabs.create({ active: true }))}
          />
          <MenuButton
            icon={<ExternalLink className="h-4 w-4" />}
            label="New window"
            onClick={() => run(() => void window.voyager.windows.open())}
          />
          <MenuButton
            icon={<VenetianMask className="h-4 w-4" />}
            label="New Incognito window"
            onClick={() => run(() => void window.voyager.windows.openIncognito())}
          />
        </div>

        <div className="border-t border-border p-1.5">
          <MenuButton icon={<QrCode className="h-4 w-4" />} label="Generate QR code" onClick={() => run(openQr)} />
        </div>

        <div className="border-t border-border p-1.5">
          <MenuButton
            icon={<Download className="h-4 w-4" />}
            label="Downloads"
            onClick={() => run(() => window.dispatchEvent(new Event('voyager:open-downloads')))}
          />
          <MenuButton
            icon={<Bookmark className="h-4 w-4" />}
            label="Bookmarks"
            onClick={() => run(() => useUiStore.getState().openBookmarksManager())}
          />
        </div>
      </div>
    </div>
  )
}
