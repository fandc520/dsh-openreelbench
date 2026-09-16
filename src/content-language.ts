/**
 * What language the FILM is in — which is not the same question as what
 * language the panel is in, and not the same question as what language the
 * director skills are written in.
 *
 * Three different things, and conflating any two of them breaks something:
 *
 *   panel language      `config.language` — labels and buttons
 *   content language    this file — the script, the narration, the subtitles
 *   skill language      always Chinese; it INSTRUCTS the model, and what it
 *                       asks for is carried as data, not as prose style
 *
 * The content language defaults to the panel's — someone driving an English
 * panel is working in English, and a film that narrates in Chinese because a
 * default never moved is a film regenerated — and a project can override it.
 *
 * THE RATE IS WHY THIS IS A TABLE AND NOT A STRING. The script request tells
 * the model how long the narration may be, and a playbook's `chars_per_second`
 * is a figure for Chinese characters. Handing an English script a budget of
 * "约 105 字" is not a slightly wrong number, it is a number in the wrong unit:
 * 105 English words is four times the film. So every language carries the unit
 * its budget is counted in and roughly how much of it fits in a second.
 *
 * The rates are round figures for BUDGETING, not measurements — the timeline is
 * cut from what ffprobe measures of the real audio, and nothing downstream
 * reads these. They exist so the number in the request is in the right unit and
 * the right order of magnitude.
 */

export interface ContentLanguage {
  id: string
  /** Shown in the picker, in the language itself. Never translated. */
  label: string
  /** How the request names it to the model. */
  name: string
  /** What its budget counts. */
  unit: 'char' | 'word'
  /**
   * Units per second of narration. Undefined for Chinese, which takes the
   * style playbook's own figure — that one is tuned per style and is the only
   * rate here anybody has actually calibrated.
   */
  perSecond?: number
}

export const CONTENT_LANGUAGES: readonly ContentLanguage[] = [
  { id: 'zh', label: '中文', name: '中文（简体）', unit: 'char' },
  { id: 'en', label: 'English', name: 'English', unit: 'word', perSecond: 2.4 },
  // Kana and Hangul are dense like Chinese, so they are counted in characters
  // rather than words; the Latin-script languages are counted in words.
  { id: 'ja', label: '日本語', name: '日本語', unit: 'char', perSecond: 6.5 },
  { id: 'ko', label: '한국어', name: '한국어', unit: 'char', perSecond: 5.5 },
  { id: 'es', label: 'Español', name: 'Español', unit: 'word', perSecond: 2.6 },
  { id: 'fr', label: 'Français', name: 'Français', unit: 'word', perSecond: 2.4 },
  { id: 'de', label: 'Deutsch', name: 'Deutsch', unit: 'word', perSecond: 2.1 },
  { id: 'ru', label: 'Русский', name: 'Русский', unit: 'word', perSecond: 2.1 },
]

export const CONTENT_LANGUAGE_IDS = CONTENT_LANGUAGES.map((entry) => entry.id)

/**
 * The language a project's content is in.
 *
 * An unknown or absent id falls back to the panel's language, and an unknown
 * panel language falls back to Chinese. Neither throws: this is read on the
 * way into a request, and refusing to compose one because a marker carries a
 * value from a future version would punish the user for our own history.
 */
export function resolveContentLanguage(
  projectLanguage: string | undefined,
  panelLanguage: string | undefined,
): ContentLanguage {
  const wanted = projectLanguage ?? panelLanguage
  return CONTENT_LANGUAGES.find((entry) => entry.id === wanted)
    ?? CONTENT_LANGUAGES[0]!
}

/**
 * The narration budget for one film, in the unit its language is counted in.
 *
 * `charsPerSecond` is the style playbook's figure and is used only for Chinese
 * — every other language brings its own, because the playbook's was calibrated
 * against Chinese characters and means nothing applied to words.
 */
export function narrationBudget(
  language: ContentLanguage,
  durationSeconds: number,
  charsPerSecond: number,
): { amount: number; unit: string; perSecond: number } {
  const rate = language.perSecond ?? charsPerSecond
  return {
    amount: Math.round(durationSeconds * rate),
    unit: language.unit === 'char' ? ' 字' : ' words',
    perSecond: rate,
  }
}

/**
 * The line every generation request carries.
 *
 * Empty for Chinese: that is what the skills already assume, and a line saying
 * "write in Chinese" on every request is noise the model has to read past. It
 * only appears when it changes something.
 */
export function contentLanguageLine(language: ContentLanguage): string {
  if (language.id === 'zh') return ''
  return '**产出语言：' + language.name + '**。'
    + '台词、字幕、旁白全部用这个语言写——不要中文，也不要中英对照。'
}
