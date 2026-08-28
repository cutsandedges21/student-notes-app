/**
 * Which side the AI sidebar occupies. Single source of truth so the sidebar
 * can be moved without hunting through CSS.
 */
export const AI_SIDEBAR_SIDE: 'left' | 'right' = 'left'

/**
 * The panel's width lives in CSS as `--ai-panel-w` (src/index.css), because the
 * document-centring offsets are derived from it in the same stylesheet. This
 * mirror exists only for the mobile drawer, which sizes itself in JS.
 */
export const AI_SIDEBAR_WIDTH_PX = 312
