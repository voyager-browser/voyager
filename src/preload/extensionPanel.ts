/**
 * Preload for extension-owned documents shown in an in-window panel.
 *
 * Extension pages get the Chrome API shim from the session-level
 * `extensionCompat` preload. They must never receive Voyager's browser
 * management bridge, so this entry intentionally exposes nothing.
 */
export {}
