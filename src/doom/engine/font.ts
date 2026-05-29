// Procedural 5x7 bitmap font — DATA only, no drawing. framebuffer.ts consumes glyphRows.
// Each glyph is 7 row-bitmasks; bit (GLYPH_W-1) === 4 is the leftmost pixel of a row.

export const GLYPH_W = 5
export const GLYPH_H = 7
export const GLYPH_SPACING = 1

// A blank glyph is seven empty rows; unknown characters fall back to it.
const BLANK: readonly number[] = [0, 0, 0, 0, 0, 0, 0]

// Convenience: build a row from a 5-char string of ' ' / '#'.
function row(pattern: string): number {
  let bits = 0
  for (let i = 0; i < GLYPH_W; i++) {
    bits <<= 1
    if (pattern.charAt(i) === '#') bits |= 1
  }
  return bits
}

type GlyphPatterns = readonly [string, string, string, string, string, string, string]

// Build a full glyph from 7 pattern strings.
function glyph(...rows: GlyphPatterns): readonly number[] {
  return rows.map(row)
}

const GLYPHS: Readonly<Record<string, readonly number[]>> = {
  A: glyph(' ### ', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'),
  B: glyph('#### ', '#   #', '#   #', '#### ', '#   #', '#   #', '#### '),
  C: glyph(' ### ', '#   #', '#    ', '#    ', '#    ', '#   #', ' ### '),
  D: glyph('#### ', '#   #', '#   #', '#   #', '#   #', '#   #', '#### '),
  E: glyph('#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#####'),
  F: glyph('#####', '#    ', '#    ', '#### ', '#    ', '#    ', '#    '),
  G: glyph(' ### ', '#   #', '#    ', '# ###', '#   #', '#   #', ' ### '),
  H: glyph('#   #', '#   #', '#   #', '#####', '#   #', '#   #', '#   #'),
  I: glyph(' ### ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '),
  J: glyph('  ###', '   # ', '   # ', '   # ', '#  # ', '#  # ', ' ##  '),
  K: glyph('#   #', '#  # ', '# #  ', '##   ', '# #  ', '#  # ', '#   #'),
  L: glyph('#    ', '#    ', '#    ', '#    ', '#    ', '#    ', '#####'),
  M: glyph('#   #', '## ##', '# # #', '#   #', '#   #', '#   #', '#   #'),
  N: glyph('#   #', '##  #', '# # #', '#  ##', '#   #', '#   #', '#   #'),
  O: glyph(' ### ', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '),
  P: glyph('#### ', '#   #', '#   #', '#### ', '#    ', '#    ', '#    '),
  Q: glyph(' ### ', '#   #', '#   #', '#   #', '# # #', '#  # ', ' ## #'),
  R: glyph('#### ', '#   #', '#   #', '#### ', '# #  ', '#  # ', '#   #'),
  S: glyph(' ####', '#    ', '#    ', ' ### ', '    #', '    #', '#### '),
  T: glyph('#####', '  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '  #  '),
  U: glyph('#   #', '#   #', '#   #', '#   #', '#   #', '#   #', ' ### '),
  V: glyph('#   #', '#   #', '#   #', '#   #', '#   #', ' # # ', '  #  '),
  W: glyph('#   #', '#   #', '#   #', '#   #', '# # #', '## ##', '#   #'),
  X: glyph('#   #', '#   #', ' # # ', '  #  ', ' # # ', '#   #', '#   #'),
  Y: glyph('#   #', '#   #', ' # # ', '  #  ', '  #  ', '  #  ', '  #  '),
  Z: glyph('#####', '    #', '   # ', '  #  ', ' #   ', '#    ', '#####'),
  '0': glyph(' ### ', '#   #', '#  ##', '# # #', '##  #', '#   #', ' ### '),
  '1': glyph('  #  ', ' ##  ', '  #  ', '  #  ', '  #  ', '  #  ', ' ### '),
  '2': glyph(' ### ', '#   #', '    #', '   # ', '  #  ', ' #   ', '#####'),
  '3': glyph('#####', '   # ', '  #  ', '   # ', '    #', '#   #', ' ### '),
  '4': glyph('   # ', '  ## ', ' # # ', '#  # ', '#####', '   # ', '   # '),
  '5': glyph('#####', '#    ', '#### ', '    #', '    #', '#   #', ' ### '),
  '6': glyph(' ### ', '#    ', '#    ', '#### ', '#   #', '#   #', ' ### '),
  '7': glyph('#####', '    #', '   # ', '  #  ', ' #   ', ' #   ', ' #   '),
  '8': glyph(' ### ', '#   #', '#   #', ' ### ', '#   #', '#   #', ' ### '),
  '9': glyph(' ### ', '#   #', '#   #', ' ####', '    #', '    #', ' ### '),
  ' ': BLANK,
  '.': glyph('     ', '     ', '     ', '     ', '     ', ' ##  ', ' ##  '),
  ':': glyph('     ', ' ##  ', ' ##  ', '     ', ' ##  ', ' ##  ', '     '),
  '!': glyph('  #  ', '  #  ', '  #  ', '  #  ', '  #  ', '     ', '  #  '),
  '?': glyph(' ### ', '#   #', '    #', '   # ', '  #  ', '     ', '  #  '),
  '-': glyph('     ', '     ', '     ', '#####', '     ', '     ', '     '),
  '/': glyph('    #', '    #', '   # ', '  #  ', ' #   ', '#    ', '#    '),
  '%': glyph('##   ', '##  #', '   # ', '  #  ', ' #   ', '#  ##', '   ##'),
  '(': glyph('   # ', '  #  ', ' #   ', ' #   ', ' #   ', '  #  ', '   # '),
  ')': glyph(' #   ', '  #  ', '   # ', '   # ', '   # ', '  #  ', ' #   '),
  '+': glyph('     ', '  #  ', '  #  ', '#####', '  #  ', '  #  ', '     '),
  ',': glyph('     ', '     ', '     ', '     ', ' ##  ', ' ##  ', ' #   '),
  "'": glyph(' ##  ', ' ##  ', ' #   ', '     ', '     ', '     ', '     '),
}

/**
 * Seven row-bitmasks for a character. Input is uppercased; unknown characters
 * (and anything outside the supported set) render as a blank glyph.
 */
export function glyphRows(ch: string): readonly number[] {
  const key = ch.toUpperCase()
  return GLYPHS[key] ?? BLANK
}

/** Pixel width of text at an integer block scale, including inter-glyph spacing. */
export function textWidth(text: string, scale: number): number {
  if (text.length === 0) return 0
  const advance = (GLYPH_W + GLYPH_SPACING) * scale
  return text.length * advance - GLYPH_SPACING * scale
}
