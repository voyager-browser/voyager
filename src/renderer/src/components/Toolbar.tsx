import { ArrowLeft, ArrowRight, Download, RotateCw, Star, VenetianMask, X } from 'lucide-react'
import { cn } from '../lib/cn'
import { isNewTab } from '../../../shared/url'
import { PROFILE_COLOR_CLASSES } from '../../../shared/profiles'
import { useActiveTab, useBrowserStore } from '../state/browserStore'
import { useBookmarksStore, useIsBookmarked } from '../state/bookmarksStore'
import { useDownloadsStore } from '../state/downloadsStore'
import { IconButton } from './ui/IconButton'
import { Omnibox } from './Omnibox'

const RING_RADIUS = 8
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

function DownloadProgressRing({ progress }: { progress: number | null }): React.JSX.Element {
  if (progress === null) {
    return (
      <span
        className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
        aria-hidden="true"
      />
    )
  }

  return (
    <svg className="h-4 w-4 -rotate-90" viewBox="0 0 20 20" aria-hidden="true">
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.2"
        strokeWidth="2"
      />
      <circle
        cx="10"
        cy="10"
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={RING_CIRCUMFERENCE * (1 - progress / 100)}
      />
    </svg>
  )
}

export function Toolbar(): React.JSX.Element {
  const activeTab = useActiveTab()
  const incognito = useBrowserStore((state) => state.incognito)
  const profile = useBrowserStore((state) => state.profile)
  const goBack = useBrowserStore((state) => state.goBack)
  const goForward = useBrowserStore((state) => state.goForward)
  const reload = useBrowserStore((state) => state.reload)
  const stop = useBrowserStore((state) => state.stop)

  const addBookmark = useBookmarksStore((state) => state.addBookmark)
  const removeBookmark = useBookmarksStore((state) => state.removeBookmark)
  const isBookmarked = useIsBookmarked(activeTab?.url ?? '')
  const downloads = useDownloadsStore((state) => state.items)

  const activeDownloads = downloads.filter((item) => item.state === 'progressing')
  const downloadTotal = activeDownloads.reduce((total, item) => total + item.totalBytes, 0)
  const downloadReceived = activeDownloads.reduce((total, item) => total + item.receivedBytes, 0)
  const downloadProgress =
    activeDownloads.length === 0
      ? null
      : activeDownloads.some((item) => item.totalBytes <= 0) || downloadTotal <= 0
        ? undefined
        : Math.min(100, Math.round((downloadReceived / downloadTotal) * 100))
  const downloadLabel =
    downloadProgress === undefined
      ? 'Downloads - in progress'
      : downloadProgress === null
        ? 'Downloads'
        : `Downloads - ${downloadProgress}%`

  const loading = activeTab?.loading ?? false
  const canGoBack = activeTab?.canGoBack ?? false
  const canGoForward = activeTab?.canGoForward ?? false
  const bookmarkDisabled = activeTab === undefined || isNewTab(activeTab.url)

  const toggleBookmark = (): void => {
    if (activeTab === undefined) return
    if (isBookmarked) {
      const existing = useBookmarksStore.getState().items.find((item) => item.url === activeTab.url)
      if (existing) removeBookmark(existing.id)
    } else {
      addBookmark(activeTab.title || activeTab.url, activeTab.url, activeTab.favicon)
    }
  }

  return (
    <div className="flex h-[44px] shrink-0 items-center gap-1 border-b border-border bg-bg px-2">
      <IconButton label="Back" disabled={!canGoBack} onClick={goBack}>
        <ArrowLeft className="h-4 w-4" />
      </IconButton>
      <IconButton label="Forward" disabled={!canGoForward} onClick={goForward}>
        <ArrowRight className="h-4 w-4" />
      </IconButton>
      {loading ? (
        <IconButton label="Stop" onClick={stop}>
          <X className="h-4 w-4" />
        </IconButton>
      ) : (
        <IconButton label="Reload" onClick={reload}>
          <RotateCw className="h-4 w-4" />
        </IconButton>
      )}

      <button
        type="button"
        className="no-drag mx-1 h-4 w-px shrink-0 bg-border"
        aria-hidden="true"
        tabIndex={-1}
      />

      <Omnibox />

      {incognito && (
        <span
          className="no-drag ml-1 flex shrink-0 items-center rounded-md border border-border bg-surface px-2 py-1 text-[11px] font-medium text-muted"
          title="You are in incognito mode"
          aria-label="You are in incognito mode"
        >
          <VenetianMask className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
          Incognito
        </span>
      )}

      <div className="w-1" />
      <IconButton
        label={isBookmarked ? 'Remove bookmark' : 'Bookmark this page'}
        disabled={bookmarkDisabled}
        onClick={toggleBookmark}
      >
        <Star className={cn('h-4 w-4', isBookmarked && 'fill-accent text-accent')} />
      </IconButton>
      <IconButton
        label={downloadLabel}
        aria-valuenow={
          downloadProgress === null || downloadProgress === undefined ? undefined : downloadProgress
        }
        onClick={() => window.dispatchEvent(new Event('voyager:open-downloads'))}
      >
        {activeDownloads.length > 0 ? (
          <DownloadProgressRing
            progress={downloadProgress === undefined ? null : downloadProgress}
          />
        ) : (
          <Download className="h-4 w-4" />
        )}
      </IconButton>
      {profile && !incognito && (
        <button
          type="button"
          className={cn(
            'no-drag ml-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-white transition-opacity hover:opacity-90',
            PROFILE_COLOR_CLASSES[profile.color] ?? PROFILE_COLOR_CLASSES.blue
          )}
          title={`${profile.name} profile`}
          aria-label={`Profile: ${profile.name}. Manage profiles.`}
          onClick={() => void window.voyager.settings.open({ page: 'profiles' })}
        >
          {(profile.name.trim()[0] ?? '?').toUpperCase()}
        </button>
      )}
    </div>
  )
}
