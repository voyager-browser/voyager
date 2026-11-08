import { useMemo } from 'react'
import { create } from 'zustand'
import type {
  PermissionKind,
  SitePermissionDecision,
  SitePermissionsState
} from '../../../shared/types'

interface PermissionsStore extends SitePermissionsState {
  ready: boolean
  applyState: (state: SitePermissionsState) => void
  refresh: () => Promise<void>
  remove: (origin: string, kind?: PermissionKind) => Promise<void>
  clear: () => Promise<void>
  undoAutoRemoval: () => Promise<void>
}

export const usePermissionsStore = create<PermissionsStore>()((set) => ({
  decisions: [],
  autoRemovedDecisions: [],
  ready: false,

  applyState: (state) =>
    set({ decisions: state.decisions, autoRemovedDecisions: state.autoRemovedDecisions ?? [], ready: true }),

  refresh: async () => {
    const state = await window.voyager.permissions.getState()
    set({ decisions: state.decisions, autoRemovedDecisions: state.autoRemovedDecisions ?? [], ready: true })
  },

  remove: async (origin, kind) => {
    const state = await window.voyager.permissions.remove(origin, kind)
    set({ decisions: state.decisions, autoRemovedDecisions: state.autoRemovedDecisions ?? [], ready: true })
  },

  clear: async () => {
    const state = await window.voyager.permissions.clear()
    set({ decisions: state.decisions, autoRemovedDecisions: state.autoRemovedDecisions ?? [], ready: true })
  },

  undoAutoRemoval: async () => {
    const state = await window.voyager.permissions.undoAutoRemoval()
    set({ decisions: state.decisions, autoRemovedDecisions: state.autoRemovedDecisions ?? [], ready: true })
  }
}))

export function useOriginPermissions(origin: string | null): SitePermissionDecision[] {
  const decisions = usePermissionsStore((state) => state.decisions)
  return useMemo(
    () => (origin === null ? [] : decisions.filter((decision) => decision.origin === origin)),
    [decisions, origin]
  )
}
