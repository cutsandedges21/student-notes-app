/**
 * The symbols and structures the equation editor offers.
 *
 * The point of this table is that a student never has to know LaTeX. They pick
 * a symbol out of a grid and the source is written for them, so the only thing
 * they type is the part that is genuinely theirs -- the numbers and the
 * letters.
 *
 * Each entry carries three things: what goes into the source, what the button
 * shows, and where the caret lands afterwards. The last one is what makes
 * structures usable: inserting a fraction and leaving the caret after it means
 * hunting back into the braces to fill it in, so the caret is placed in the
 * first empty slot instead.
 */

export interface MathSymbol {
  /** Written into the source at the caret. */
  insert: string
  /**
   * Where the caret lands, as an offset into `insert`.
   *
   * Omitted for plain symbols, which take the caret to the end. Set for
   * structures, to the inside of the slot the student fills first.
   */
  caret?: number
  /** Rendered on the button. Defaults to `insert`. */
  preview?: string
  /** Accessible name, since the button's only visible content is a glyph. */
  label: string
}

export interface MathGroup {
  /** Shown on the closed trigger, and as the menu's accessible name. */
  title: string
  /** The trigger's glyphs, rendered as maths so the button reads as maths. */
  triggerLatex: string
  /** Grid width, chosen per group to match how the symbols pair up. */
  columns: number
  items: MathSymbol[]
}

/** Plain symbol: the source is the command and the button shows it set. */
const sym = (insert: string, label: string): MathSymbol => ({ insert, label })

/**
 * Structure with slots.
 *
 * `caret` is counted rather than searched for: several of these have more than
 * one empty pair of braces, and the first is not always the one to start in.
 */
const tpl = (
  insert: string,
  caret: number,
  preview: string,
  label: string,
): MathSymbol => ({ insert, caret, preview, label })

export const MATH_GROUPS: MathGroup[] = [
  {
    title: 'Greek letters',
    triggerLatex: '\\alpha\\beta\\Delta',
    columns: 6,
    items: [
      sym('\\alpha', 'alpha'),
      sym('\\beta', 'beta'),
      sym('\\gamma', 'gamma'),
      sym('\\delta', 'delta'),
      sym('\\epsilon', 'epsilon'),
      sym('\\varepsilon', 'epsilon variant'),
      sym('\\zeta', 'zeta'),
      sym('\\eta', 'eta'),
      sym('\\theta', 'theta'),
      sym('\\vartheta', 'theta variant'),
      sym('\\iota', 'iota'),
      sym('\\kappa', 'kappa'),
      sym('\\lambda', 'lambda'),
      sym('\\mu', 'mu'),
      sym('\\nu', 'nu'),
      sym('\\xi', 'xi'),
      sym('\\pi', 'pi'),
      sym('\\varpi', 'pi variant'),
      sym('\\rho', 'rho'),
      sym('\\varrho', 'rho variant'),
      sym('\\sigma', 'sigma'),
      sym('\\varsigma', 'sigma variant'),
      sym('\\tau', 'tau'),
      sym('\\upsilon', 'upsilon'),
      sym('\\phi', 'phi'),
      sym('\\varphi', 'phi variant'),
      sym('\\chi', 'chi'),
      sym('\\psi', 'psi'),
      sym('\\omega', 'omega'),
      sym('\\Gamma', 'capital gamma'),
      sym('\\Delta', 'capital delta'),
      sym('\\Theta', 'capital theta'),
      sym('\\Lambda', 'capital lambda'),
      sym('\\Xi', 'capital xi'),
      sym('\\Pi', 'capital pi'),
      sym('\\Sigma', 'capital sigma'),
      sym('\\Upsilon', 'capital upsilon'),
      sym('\\Phi', 'capital phi'),
      sym('\\Psi', 'capital psi'),
      sym('\\Omega', 'capital omega'),
    ],
  },

  {
    title: 'Operations',
    triggerLatex: '\\times\\div\\exists',
    columns: 6,
    items: [
      sym('\\times', 'multiply'),
      sym('\\div', 'divide'),
      sym('\\cdot', 'dot product'),
      sym('\\pm', 'plus or minus'),
      sym('\\mp', 'minus or plus'),
      sym('\\ast', 'asterisk'),
      sym('\\star', 'star'),
      sym('\\circ', 'ring'),
      sym('\\bullet', 'bullet'),
      sym('\\oplus', 'circled plus'),
      sym('\\ominus', 'circled minus'),
      sym('\\oslash', 'circled slash'),
      sym('\\otimes', 'circled times'),
      sym('\\odot', 'circled dot'),
      sym('\\dagger', 'dagger'),
      sym('\\ddagger', 'double dagger'),
      sym('\\vee', 'logical or'),
      sym('\\wedge', 'logical and'),
      sym('\\cap', 'intersection'),
      sym('\\cup', 'union'),
      sym('\\aleph', 'aleph'),
      sym('\\Re', 'real part'),
      sym('\\Im', 'imaginary part'),
      sym('\\wp', 'Weierstrass p'),
      sym('\\bot', 'perpendicular'),
      sym('\\infty', 'infinity'),
      sym('\\partial', 'partial derivative'),
      sym('\\forall', 'for all'),
      sym('\\exists', 'there exists'),
      sym('\\neg', 'not'),
      sym('\\triangle', 'triangle'),
      sym('\\diamond', 'diamond'),
    ],
  },

  {
    title: 'Relations',
    triggerLatex: '<\\neq>',
    columns: 6,
    items: [
      sym('\\leq', 'less than or equal to'),
      sym('\\geq', 'greater than or equal to'),
      sym('\\prec', 'precedes'),
      sym('\\succ', 'succeeds'),
      sym('\\preceq', 'precedes or equals'),
      sym('\\succeq', 'succeeds or equals'),
      sym('\\ll', 'much less than'),
      sym('\\gg', 'much greater than'),
      sym('\\equiv', 'equivalent to'),
      sym('\\sim', 'similar to'),
      sym('\\simeq', 'asymptotically equal to'),
      sym('\\asymp', 'asymptotic to'),
      sym('\\approx', 'approximately equal to'),
      sym('\\neq', 'not equal to'),
      sym('\\subset', 'subset of'),
      sym('\\subseteq', 'subset of or equal to'),
      sym('\\supset', 'superset of'),
      sym('\\supseteq', 'superset of or equal to'),
      sym('\\in', 'element of'),
      sym('\\ni', 'contains'),
      sym('\\notin', 'not an element of'),
    ],
  },

  {
    /*
     * The only group whose entries are structures rather than characters.
     * Every one leaves empty braces behind for the student to fill, and the
     * caret starts in the slot they would reach for first -- the numerator,
     * the radicand, the lower limit.
     */
    title: 'Math',
    triggerLatex: '\\sqrt{\\;}x^{\\square}',
    columns: 6,
    items: [
      tpl('\\frac{}{}', 6, '\\frac{a}{b}', 'fraction'),
      tpl('\\sqrt{}', 6, '\\sqrt{x}', 'square root'),
      tpl('\\sqrt[]{}', 6, '\\sqrt[n]{x}', 'nth root'),
      tpl('x_{}^{}', 3, 'x_a^b', 'subscript and superscript'),
      tpl('x_{}', 3, 'x_a', 'subscript'),
      tpl('x^{}', 3, 'x^b', 'superscript'),
      tpl('\\bar{}', 5, '\\bar{x}', 'bar'),
      tpl('\\hat{}', 5, '\\hat{x}', 'hat'),
      tpl('\\bigcap_{}^{}', 10, '\\bigcap_{a}^{b}', 'intersection over a range'),
      tpl('\\bigcup_{}^{}', 10, '\\bigcup_{a}^{b}', 'union over a range'),
      tpl('\\prod_{}^{}', 8, '\\prod_{a}^{b}', 'product over a range'),
      tpl('\\coprod_{}^{}', 10, '\\coprod_{a}^{b}', 'coproduct over a range'),
      tpl('\\left(\\right)', 6, '(\\;)', 'parentheses'),
      tpl('\\left[\\right]', 6, '[\\;]', 'brackets'),
      tpl('\\left\\{\\right\\}', 7, '\\{\\;\\}', 'braces'),
      tpl('\\left|\\right|', 6, '|\\;|', 'absolute value'),
      tpl('\\int_{}^{}', 7, '\\int_{a}^{b}', 'integral'),
      tpl('\\oint_{}^{}', 8, '\\oint_{a}^{b}', 'contour integral'),
      tpl('\\sum_{}^{}', 7, '\\sum_{a}^{b}', 'sum over a range'),
      tpl('\\lim_{ \\to }', 6, '\\lim_{a \\to b}', 'limit'),
    ],
  },

  {
    title: 'Arrows',
    triggerLatex: '\\leftarrow\\uparrow\\Rightarrow',
    columns: 6,
    items: [
      sym('\\leftarrow', 'left arrow'),
      sym('\\rightarrow', 'right arrow'),
      sym('\\leftrightarrow', 'left right arrow'),
      sym('\\Leftarrow', 'double left arrow'),
      sym('\\Rightarrow', 'implies'),
      sym('\\Leftrightarrow', 'if and only if'),
      sym('\\uparrow', 'up arrow'),
      sym('\\downarrow', 'down arrow'),
      sym('\\updownarrow', 'up down arrow'),
      sym('\\Uparrow', 'double up arrow'),
      sym('\\Downarrow', 'double down arrow'),
      sym('\\Updownarrow', 'double up down arrow'),
    ],
  },
]
