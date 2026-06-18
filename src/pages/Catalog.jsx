import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { C, FONT, MONO, money } from '../constants.js'
import * as XLSX from 'xlsx'

const PAGE = 50

export default function Catalog() {
  const navigate  = useNavigate()
  const fileRef   = useRef()

  const [items, setItems]       = useState([])
  const [loading, setLoading]   = useState(true)
  const [importing, setImporting] = useState(false)
  const [error, setError]       = useState('')
  const [info, setInfo]         = useState('')
  const [q, setQ]               = useState('')
  const [category, setCategory] = useState('')
  const [shown, setShown]       = useState(PAGE)
  const [openId, setOpenId]     = useState(null)

  const load = () => {
    setLoading(true)
    supabase.from('price_items')
      .select('id, code, category, name, unit, price, price_vat')
      .order('category').order('name')
      .then(({ data, error }) => {
        if (error) setError('Не удалось загрузить справочник: ' + error.message)
        else setItems(data || [])
        setLoading(false)
      })
  }

  useEffect(load, [])

  const categories = useMemo(() => {
    const m = {}
    items.forEach((i) => { if (i.category) m[i.category] = (m[i.category] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) =>
      (!category || i.category === category) &&
      (!needle ||
        i.name.toLowerCase().includes(needle) ||
        (i.code || '').toLowerCase().includes(needle))
    )
  }, [items, q, category])

  useEffect(() => setShown(PAGE), [q, category])

  // ── Импорт Excel ──────────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setError(''); setInfo('')
    try {
      const buf  = await file.arrayBuffer()
      const wb   = XLSX.read(buf)
      const ws   = wb.Sheets[wb.SheetNames[0]]

      // Читаем как массив массивов, чтобы найти строку-заголовок
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (!raw.length) { setError('Файл пустой или нечитаемый'); setImporting(false); return }

      // Ищем строку-заголовок среди первых 15 строк:
      // строка должна содержать ≥2 непустых ячеек И хотя бы одно ключевое слово
      const HEADER_WORDS = ['наимен', 'назван', 'name', 'описание', 'номенклатур']
      let headerIdx = -1
      for (let i = 0; i < Math.min(15, raw.length); i++) {
        const row = raw[i]
        const nonEmpty = row.filter((c) => String(c).trim()).length
        const hasKeyword = row.some((cell) => HEADER_WORDS.some((w) => String(cell).toLowerCase().includes(w)))
        if (nonEmpty >= 2 && hasKeyword) { headerIdx = i; break }
      }

      let iCode, iCategory, iName, iUnit, iPrice, iPriceVat, dataRows

      if (headerIdx >= 0) {
        // Найдена строка заголовков — определяем колонки по словам
        const headers = raw[headerIdx].map((h) => String(h).trim())
        dataRows = raw.slice(headerIdx + 1)
        const find = (...words) => {
          const idx = headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)))
          return idx >= 0 ? idx : null
        }
        iCode     = find('код', 'шифр', 'артикул', 'code')
        iCategory = find('раздел', 'категор', 'группа', 'section', 'cat')
        iName     = find('наимен', 'назван', 'номенклатур', 'name', 'описание')
        iUnit     = find('ед', 'единиц', 'unit')
        iPrice    = find('смет', 'цена без', 'без ндс', 'price_no') ?? find('отпуск', 'цена', 'price')
        iPriceVat = find('с ндс', 'price_vat', 'с нд', 'отпуск')
      } else {
        // Заголовков нет — файл начинается сразу с данных.
        // Определяем колонки по содержимому.
        const sample = raw.slice(0, Math.min(20, raw.length)).filter(r => r.filter(c => String(c).trim()).length >= 3)
        if (!sample.length) { setError('Не удалось определить структуру файла'); setImporting(false); return }
        const numCols = Math.max(...sample.map(r => r.length))
        const cols = Array.from({ length: numCols }, (_, c) => c)

        // helpers
        const cellStr  = (r, c) => String(r[c] ?? '').trim()
        const avgLen   = (c) => sample.reduce((s, r) => s + cellStr(r, c).length, 0) / sample.length
        // числовая колонка: все значения — положительные числа
        const isNumCol = (c) => sample.every(r => { const v = Number(cellStr(r, c)); return cellStr(r, c) !== '' && !isNaN(v) && v > 0 })
        // колонка с кодом-шифром вида "521-101-..."
        const isCodeCol = (c) => sample.filter(r => /^\d{3}-\d{3}/.test(cellStr(r, c))).length >= sample.length * 0.5
        // единица изм.: короткое слово с буквами (шт., м2, комплект...)
        const isUnitCol = (c) => sample.every(r => { const v = cellStr(r, c); return v.length <= 15 && /[а-яёa-z²³]/i.test(v) })

        iCode     = cols.find(isCodeCol) ?? null
        iName     = cols.reduce((best, c) => avgLen(c) > avgLen(best) ? c : best, 0)  // самые длинные строки
        iUnit     = cols.find(c => c !== iName && c !== iCode && isUnitCol(c)) ?? null
        const avgVal = (c) => sample.reduce((s, r) => s + Number(cellStr(r, c)), 0) / sample.length
        // числовые колонки, сортируем по убыванию среднего значения (цены > порядковых номеров)
        const numericCols = cols
          .filter(c => c !== iName && c !== iCode && c !== iUnit && isNumCol(c))
          .sort((a, b) => avgVal(b) - avgVal(a))
        iPrice    = numericCols[0] ?? null
        iPriceVat = numericCols[1] ?? null
        // категория: длинная нечисловая строка, не название
        iCategory = cols.find(c =>
          c !== iName && c !== iCode && c !== iUnit && c !== iPrice && c !== iPriceVat &&
          avgLen(c) > 5 && !isNumCol(c)
        ) ?? null
        dataRows  = raw
      }

      if (iName === null) {
        setError('Не удалось определить колонку с наименованием. Проверьте формат файла.')
        setImporting(false); return
      }

      const toInsert = dataRows
        .map((r) => {
          const name = String(r[iName] ?? '').trim()
          if (!name) return null
          const priceRaw    = iPrice    != null ? Number(String(r[iPrice]   ?? '').replace(/[^\d.]/g, '')) || null : null
          const priceVatRaw = iPriceVat != null ? Number(String(r[iPriceVat]?? '').replace(/[^\d.]/g, '')) || null : null
          return {
            code:      iCode     != null ? String(r[iCode]     ?? '').trim() || null : null,
            category:  iCategory != null ? String(r[iCategory] ?? '').trim() || null : null,
            name,
            unit:      iUnit     != null ? String(r[iUnit]     ?? '').trim() || null : null,
            price:     priceRaw,
            price_vat: priceVatRaw ?? (priceRaw ? Math.round(priceRaw * 1.16 * 100) / 100 : null),
          }
        })
        .filter(Boolean)

      if (!toInsert.length) { setError('Нет строк для импорта'); setImporting(false); return }

      // Пишем порциями по 500
      let inserted = 0
      for (let i = 0; i < toInsert.length; i += 500) {
        const chunk = toInsert.slice(i, i + 500)
        const { error } = await supabase.from('price_items').insert(chunk)
        if (error) { setError('Ошибка вставки: ' + error.message); setImporting(false); return }
        inserted += chunk.length
      }

      setInfo(`Импортировано ${inserted} позиций`)
      load()
    } catch (e) {
      setError('Ошибка разбора файла: ' + e.message)
    }
    setImporting(false)
    e.target.value = ''
  }

  const clearAll = async () => {
    if (!confirm('Удалить все позиции справочника? Это не затронет уже созданные спецификации.')) return
    await supabase.from('price_items').delete().neq('id', '00000000-0000-0000-0000-000000000000')
    setItems([])
    setInfo('Справочник очищен')
  }

  const visible = filtered.slice(0, shown)

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, color: C.ink }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${C.brand}, ${C.action})` }} />

      {/* Шапка */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/')} style={btnGhost}>← Назад</button>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Справочник цен</span>
            {items.length > 0 && (
              <span style={{ fontFamily: FONT, fontSize: 11, color: C.muted }}>{items.length} позиций</span>
            )}
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {items.length > 0 && (
              <button onClick={clearAll} style={{ ...btnGhost, color: C.danger, borderColor: C.danger }}>Очистить</button>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={importing} style={btnPrimary}>
              {importing ? 'Импорт...' : 'Загрузить Excel'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
        {error && <div style={{ color: C.danger, marginBottom: 12, padding: '10px 14px', background: C.dangerSoft, borderRadius: 8, fontSize: 13 }}>{error}</div>}
        {info  && <div style={{ color: C.success, marginBottom: 12, padding: '10px 14px', background: C.successSoft, borderRadius: 8, fontSize: 13 }}>{info}</div>}

        {/* Инфо по колонкам */}
        {items.length === 0 && !loading && (
          <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, padding: 24, marginBottom: 20 }}>
            <div style={{ fontWeight: 700, marginBottom: 10 }}>Формат файла Excel</div>
            <div style={{ fontSize: 13, color: C.muted, lineHeight: 1.7 }}>
              Система автоматически определяет колонки по заголовкам. Ожидаемые колонки:
            </div>
            <table style={{ marginTop: 12, borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
              <thead>
                <tr>{['Колонка','Ключевые слова в заголовке','Обязательно'].map((h) => (
                  <th key={h} style={{ textAlign: 'left', padding: '6px 12px', background: C.page, color: C.muted, fontSize: 11, textTransform: 'uppercase', letterSpacing: '.06em' }}>{h}</th>
                ))}</tr>
              </thead>
              <tbody>
                {[
                  ['Наименование', 'наименование, название, работа, name', 'Да'],
                  ['Код / Шифр',   'код, шифр, артикул, code',             'Нет'],
                  ['Раздел',       'раздел, категория, группа, section',    'Нет'],
                  ['Ед. изм.',     'ед, единиц, unit',                      'Нет'],
                  ['Цена без НДС', 'цена без, без ндс, price_no, цена',     'Нет'],
                  ['Цена с НДС',   'с ндс, цена_с, price_vat',              'Нет'],
                ].map(([col, keys, req]) => (
                  <tr key={col} style={{ borderTop: `1px solid ${C.line}` }}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{col}</td>
                    <td style={{ padding: '8px 12px', color: C.muted, fontFamily: FONT, fontSize: 12 }}>{keys}</td>
                    <td style={{ padding: '8px 12px', color: req === 'Да' ? C.danger : C.dim }}>{req}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Фильтры */}
        {items.length > 0 && (
          <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <input
              placeholder="Поиск по названию или коду..."
              value={q} onChange={(e) => setQ(e.target.value)}
              style={inputStyle}
            />
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, width: 220 }}>
              <option value="">Все разделы</option>
              {categories.map(([cat, cnt]) => (
                <option key={cat} value={cat}>{cat} ({cnt})</option>
              ))}
            </select>
          </div>
        )}

        {loading ? (
          <div style={{ color: C.muted, textAlign: 'center', padding: 60 }}>Загрузка...</div>
        ) : (
          <>
            {visible.length === 0 && items.length > 0 && (
              <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Ничего не найдено</div>
            )}
            <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, overflow: 'hidden' }}>
              {visible.map((item, idx) => (
                <div key={item.id}>
                  <div
                    onClick={() => setOpenId(openId === item.id ? null : item.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px',
                      borderTop: idx > 0 ? `1px solid ${C.line}` : 'none',
                      cursor: 'pointer', background: openId === item.id ? C.actionSoft : 'transparent',
                    }}
                  >
                    {item.code && (
                      <span style={{ fontFamily: FONT, fontSize: 11, color: C.muted, whiteSpace: 'nowrap', minWidth: 70 }}>{item.code}</span>
                    )}
                    <span style={{ flex: 1, fontSize: 13.5, color: C.ink }}>{item.name}</span>
                    {item.category && (
                      <span style={{ fontSize: 11, color: C.brand, background: C.actionSoft, borderRadius: 5, padding: '2px 8px', whiteSpace: 'nowrap' }}>{item.category}</span>
                    )}
                    <span style={{ color: C.muted, fontSize: 12, whiteSpace: 'nowrap' }}>{item.unit || '—'}</span>
                    <span style={{ fontWeight: 700, fontSize: 13.5, whiteSpace: 'nowrap', minWidth: 110, textAlign: 'right' }}>{money(item.price)}</span>
                  </div>
                  {openId === item.id && (
                    <div style={{ padding: '10px 16px 12px 16px', background: C.tint, borderTop: `1px solid ${C.line}` }}>
                      <div style={{ display: 'flex', gap: 24, fontSize: 13 }}>
                        <div><span style={{ color: C.muted }}>Без НДС: </span><b>{money(item.price)}</b></div>
                        <div><span style={{ color: C.muted }}>С НДС 16%: </span><b>{money(item.price_vat)}</b></div>
                        {item.unit && <div><span style={{ color: C.muted }}>Ед. изм.: </span><b>{item.unit}</b></div>}
                        {item.code && <div><span style={{ color: C.muted }}>Код: </span><b style={{ fontFamily: FONT }}>{item.code}</b></div>}
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            {filtered.length > shown && (
              <div style={{ textAlign: 'center', marginTop: 16 }}>
                <button onClick={() => setShown((n) => n + PAGE)} style={btnGhost}>
                  Показать ещё ({filtered.length - shown} осталось)
                </button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

const inputStyle = {
  background: C.surface, color: C.ink, border: `1px solid ${C.lineDark}`, borderRadius: 8,
  padding: '9px 13px', fontSize: 14, outline: 'none', fontFamily: FONT, flex: 1, minWidth: 200,
}
const btnPrimary = {
  background: C.action, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 18px',
  fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: FONT,
  boxShadow: '0 8px 20px -8px rgba(39,86,232,.6)',
}
const btnGhost = {
  background: 'transparent', color: C.muted, border: `1px solid ${C.lineDark}`, borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: FONT,
}
