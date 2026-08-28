export interface FontOption {
  /** Shown in the menu, and rendered in its own typeface as the preview. */
  label: string
  /** Value written to the document, with fallbacks for the web fonts. */
  stack: string
}

export interface FontGroup {
  label: string
  fonts: FontOption[]
}

/**
 * The font menu.
 *
 * Grouped the way Word and Docs group theirs, because a flat list of thirty
 * names is unscannable. Each entry renders in its own typeface so the menu is
 * a specimen sheet rather than a list of strings.
 *
 * Families marked below as web fonts are pulled from Google Fonts in
 * index.html. System families carry a generic fallback so a document still
 * renders sensibly on a machine that lacks them.
 */
export const FONT_GROUPS: FontGroup[] = [
  {
    label: 'Sans serif',
    fonts: [
      { label: 'Arial', stack: 'Arial, Helvetica, sans-serif' },
      { label: 'Verdana', stack: 'Verdana, Geneva, sans-serif' },
      { label: 'Tahoma', stack: 'Tahoma, Geneva, sans-serif' },
      { label: 'Trebuchet MS', stack: '"Trebuchet MS", Helvetica, sans-serif' },
      { label: 'Inter', stack: 'Inter, sans-serif' },
      { label: 'Roboto', stack: 'Roboto, sans-serif' },
      { label: 'Open Sans', stack: '"Open Sans", sans-serif' },
      { label: 'Lato', stack: 'Lato, sans-serif' },
      { label: 'Montserrat', stack: 'Montserrat, sans-serif' },
      { label: 'Poppins', stack: 'Poppins, sans-serif' },
      { label: 'Raleway', stack: 'Raleway, sans-serif' },
      { label: 'Nunito', stack: 'Nunito, sans-serif' },
      { label: 'Oswald', stack: 'Oswald, sans-serif' },
    ],
  },
  {
    label: 'Serif',
    fonts: [
      { label: 'Georgia', stack: 'Georgia, Cambria, serif' },
      { label: 'Times New Roman', stack: '"Times New Roman", Times, serif' },
      { label: 'Garamond', stack: 'Garamond, Baskerville, serif' },
      { label: 'Palatino', stack: '"Palatino Linotype", Palatino, serif' },
      { label: 'Merriweather', stack: 'Merriweather, serif' },
      { label: 'Playfair Display', stack: '"Playfair Display", serif' },
      { label: 'Lora', stack: 'Lora, serif' },
      { label: 'PT Serif', stack: '"PT Serif", serif' },
    ],
  },
  {
    label: 'Monospace',
    fonts: [
      { label: 'Courier New', stack: '"Courier New", Courier, monospace' },
      { label: 'Roboto Mono', stack: '"Roboto Mono", monospace' },
      { label: 'Source Code Pro', stack: '"Source Code Pro", monospace' },
      { label: 'JetBrains Mono', stack: '"JetBrains Mono", monospace' },
    ],
  },
  {
    label: 'Display & handwriting',
    fonts: [
      { label: 'Impact', stack: 'Impact, Charcoal, sans-serif' },
      { label: 'Comic Sans MS', stack: '"Comic Sans MS", cursive' },
      { label: 'Bebas Neue', stack: '"Bebas Neue", cursive' },
      { label: 'Caveat', stack: 'Caveat, cursive' },
      { label: 'Dancing Script', stack: '"Dancing Script", cursive' },
      { label: 'Pacifico', stack: 'Pacifico, cursive' },
    ],
  },
]

export const ALL_FONTS: FontOption[] = FONT_GROUPS.flatMap((group) => group.fonts)

/**
 * Resolves the stored fontFamily attribute back to a menu entry.
 *
 * Tiptap round-trips whatever string was set, so an exact stack match is the
 * common case. The first-family comparison is the fallback for documents whose
 * stack was written by an older build (or pasted from elsewhere) and so no
 * longer matches character-for-character.
 */
export function findFontLabel(fontFamily: string | undefined): string {
  // Matches the document default in tailwind.config.js (font-doc) and the
  // .ProseMirror base rule, so an untouched paragraph reports what it renders.
  if (!fontFamily) return 'Arial'

  const exact = ALL_FONTS.find((font) => font.stack === fontFamily)
  if (exact) return exact.label

  const firstFamily = fontFamily.split(',')[0]!.trim().replace(/^["']|["']$/g, '')
  const loose = ALL_FONTS.find(
    (font) => font.label.toLowerCase() === firstFamily.toLowerCase(),
  )
  return loose?.label ?? firstFamily
}
