export const FONT = "'Onest', -apple-system, 'Segoe UI', Roboto, sans-serif"
export const MONO = "'JetBrains Mono', monospace"

export const C = {
  page:        '#EEF1F5',
  surface:     '#FFFFFF',
  tint:        '#FBFCFE',
  ink:         '#14181F',
  muted:       '#6B7585',
  dim:         '#8A93A3',
  line:        '#E4E8EE',
  lineDark:    '#D9DFE9',
  brand:       '#1F47C2',
  action:      '#2756E8',
  actionSoft:  '#EEF2FE',
  navy:        '#0E1530',
  navyDeep:    '#0B1126',
  success:     '#16915B',
  successSoft: '#E7F5EE',
  danger:      '#B42318',
  dangerSoft:  '#FCEAEA',
  warning:     '#9A6B00',
  warningSoft: '#FBF2DD',
}

export const money = (n) =>
  n == null || isNaN(n)
    ? '—'
    : new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 }).format(Math.round(n)) + ' ₸'

export const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('ru-RU') : '—'
