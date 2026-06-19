import { useState, useEffect, useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { C, FONT, money } from '../constants.js'
import * as XLSX from 'xlsx'

const PAGE = 50

export default function Catalog() {
  const navigate  = useNavigate()
  const fileRef   = useRef()

  const [catalogs, setCatalogs]       = useState([])
  const [activeCatId, setActiveCatId] = useState(null) // null = все базы
  const [newCatName, setNewCatName]   = useState('')
  const [showNewCat, setShowNewCat]   = useState(false)

  const [items, setItems]             = useState([])
  const [loading, setLoading]         = useState(true)
  const [importing, setImporting]     = useState(false)
  const [error, setError]             = useState('')
  const [info, setInfo]               = useState('')
  const [q, setQ]                     = useState('')
  const [category, setCategory]       = useState('')
  const [shown, setShown]             = useState(PAGE)
  const [openId, setOpenId]           = useState(null)

  // ── Загрузка каталогов ────────────────────────────────────────────────────
  const loadCatalogs = () =>
    supabase.from('catalogs').select('id, name, created_at').order('created_at')
      .then(({ data }) => setCatalogs(data || []))

  // ── Загрузка позиций (фильтр по активному каталогу) ──────────────────────
  const load = (catId = activeCatId) => {
    setLoading(true)
    let q = supabase.from('price_items')
      .select('id, catalog_id, code, category, name, unit, price, price_vat')
      .order('category').order('name')
    if (catId) q = q.eq('catalog_id', catId)
    q.then(({ data, error }) => {
      if (error) setError('Не удалось загрузить справочник: ' + error.message)
      else setItems(data || [])
      setLoading(false)
    })
  }

  useEffect(() => { loadCatalogs(); load(null) }, [])

  const switchCatalog = (id) => {
    setActiveCatId(id); setCategory(''); setQ(''); setShown(PAGE)
    load(id)
  }

  const categories = useMemo(() => {
    const m = {}
    items.forEach((i) => { if (i.category) m[i.category] = (m[i.category] || 0) + 1 })
    return Object.entries(m).sort((a, b) => b[1] - a[1])
  }, [items])

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) =>
      (!category || i.category === category) &&
      (!needle || i.name.toLowerCase().includes(needle) || (i.code || '').toLowerCase().includes(needle))
    )
  }, [items, q, category])

  useEffect(() => setShown(PAGE), [q, category])

  // ── Импорт Excel ──────────────────────────────────────────────────────────
  const handleFile = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setError(''); setInfo('')

    // Определяем catalog_id для импорта
    let targetCatId = activeCatId
    if (!targetCatId) {
      // Нужно создать каталог
      const name = newCatName.trim() || file.name.replace(/\.[^.]+$/, '')
      const { data, error } = await supabase.from('catalogs').insert({ name }).select('id').single()
      if (error) { setError('Не удалось создать базу: ' + error.message); setImporting(false); e.target.value = ''; return }
      targetCatId = data.id
      await loadCatalogs()
      setNewCatName('')
      setShowNewCat(false)
    }

    try {
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf)
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      if (!raw.length) { setError('Файл пустой или нечитаемый'); setImporting(false); return }

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
        const sample = raw.slice(0, Math.min(20, raw.length)).filter(r => r.filter(c => String(c).trim()).length >= 3)
        if (!sample.length) { setError('Не удалось определить структуру файла'); setImporting(false); return }
        const numCols = Math.max(...sample.map(r => r.length))
        const cols = Array.from({ length: numCols }, (_, c) => c)
        const cellStr  = (r, c) => String(r[c] ?? '').trim()
        const avgLen   = (c) => sample.reduce((s, r) => s + cellStr(r, c).length, 0) / sample.length
        const avgVal   = (c) => sample.reduce((s, r) => s + Number(cellStr(r, c)), 0) / sample.length
        const isNumCol = (c) => sample.every(r => { const v = Number(cellStr(r, c)); return cellStr(r, c) !== '' && !isNaN(v) && v > 0 })
        const isCodeCol= (c) => sample.filter(r => /^\d{3}-\d{3}/.test(cellStr(r, c))).length >= sample.length * 0.5
        const isUnitCol= (c) => sample.every(r => { const v = cellStr(r, c); return v.length <= 15 && /[а-яёa-z²³]/i.test(v) })
        iCode     = cols.find(isCodeCol) ?? null
        iName     = cols.reduce((best, c) => avgLen(c) > avgLen(best) ? c : best, 0)
        iUnit     = cols.find(c => c !== iName && c !== iCode && isUnitCol(c)) ?? null
        const numericCols = cols.filter(c => c !== iName && c !== iCode && c !== iUnit && isNumCol(c)).sort((a, b) => avgVal(b) - avgVal(a))
        iPrice    = numericCols[0] ?? null
        iPriceVat = numericCols[1] ?? null
        iCategory = cols.find(c => c !== iName && c !== iCode && c !== iUnit && c !== iPrice && c !== iPriceVat && avgLen(c) > 5 && !isNumCol(c)) ?? null
        dataRows  = raw
      }

      if (iName === null) { setError('Не удалось определить колонку с наименованием.'); setImporting(false); return }

      const toInsert = dataRows.map((r) => {
        const name = String(r[iName] ?? '').trim()
        if (!name) return null
        const priceRaw    = iPrice    != null ? Number(String(r[iPrice]    ?? '').replace(/[^\d.]/g, '')) || null : null
        const priceVatRaw = iPriceVat != null ? Number(String(r[iPriceVat] ?? '').replace(/[^\d.]/g, '')) || null : null
        return {
          catalog_id: targetCatId,
          code:      iCode     != null ? String(r[iCode]     ?? '').trim() || null : null,
          category:  iCategory != null ? String(r[iCategory] ?? '').trim() || null : null,
          name,
          unit:      iUnit     != null ? String(r[iUnit]     ?? '').trim() || null : null,
          price:     priceRaw,
          price_vat: priceVatRaw ?? (priceRaw ? Math.round(priceRaw * 1.16 * 100) / 100 : null),
        }
      }).filter(Boolean)

      if (!toInsert.length) { setError('Нет строк для импорта'); setImporting(false); return }

      let inserted = 0
      for (let i = 0; i < toInsert.length; i += 500) {
        const { error } = await supabase.from('price_items').insert(toInsert.slice(i, i + 500))
        if (error) { setError('Ошибка вставки: ' + error.message); setImporting(false); return }
        inserted += toInsert.slice(i, i + 500).length
      }

      setInfo(`Импортировано ${inserted} позиций`)
      switchCatalog(targetCatId)
    } catch (ex) {
      setError('Ошибка разбора файла: ' + ex.message)
    }
    setImporting(false)
    e.target.value = ''
  }

  // ── Удалить базу цен ──────────────────────────────────────────────────────
  const deleteCatalog = async (cat) => {
    if (!confirm(`Удалить базу "${cat.name}" и все её позиции? Это не затронет уже созданные спецификации.`)) return
    await supabase.from('price_items').delete().eq('catalog_id', cat.id)
    await supabase.from('catalogs').delete().eq('id', cat.id)
    await loadCatalogs()
    switchCatalog(null)
    setInfo(`База "${cat.name}" удалена`)
  }

  const visible = filtered.slice(0, shown)
  const activeCat = catalogs.find((c) => c.id === activeCatId)

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, color: C.ink }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${C.brand}, ${C.action})` }} />

      {/* Шапка */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/')} style={btnGhost}>← Назад</button>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Базы цен</span>
          </div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {activeCat && (
              <button onClick={() => deleteCatalog(activeCat)} style={{ ...btnGhost, color: C.danger, borderColor: C.danger }}>
                Удалить базу
              </button>
            )}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleFile} style={{ display: 'none' }} />
            <button
              onClick={() => {
                if (!activeCatId && catalogs.length > 0) { setShowNewCat(true) }
                else fileRef.current?.click()
              }}
              disabled={importing}
              style={btnPrimary}
            >
              {importing ? 'Импорт...' : activeCatId ? `Загрузить в «${activeCat?.name}»` : '+ Загрузить Excel в новую базу'}
            </button>
          </div>
        </div>
      </div>

      {/* Вкладки каталогов */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 0, overflowX: 'auto' }}>
          <button
            onClick={() => switchCatalog(null)}
            style={tabStyle(activeCatId === null)}
          >
            Все базы
            <span style={{ marginLeft: 6, fontSize: 11, color: activeCatId === null ? C.action : C.muted }}>
              {items.length > 0 && activeCatId === null ? `(${items.length})` : ''}
            </span>
          </button>
          {catalogs.map((cat) => (
            <button
              key={cat.id}
              onClick={() => switchCatalog(cat.id)}
              style={tabStyle(activeCatId === cat.id)}
            >
              {cat.name}
            </button>
          ))}
        </div>
      </div>

      {/* Панель создания новой базы */}
      {showNewCat && (
        <div style={{ background: C.actionSoft, borderBottom: `1px solid ${C.lineDark}`, padding: '12px 24px' }}>
          <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Название новой базы:</span>
            <input
              autoFocus
              value={newCatName}
              onChange={(e) => setNewCatName(e.target.value)}
              placeholder="Напр.: Справочник РСНБ 2024"
              style={{ ...inputStyle, flex: 1, padding: '7px 12px', fontSize: 13 }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={!newCatName.trim() || importing}
              style={{ ...btnPrimary, padding: '7px 16px', fontSize: 13 }}
            >
              Выбрать Excel
            </button>
            <button onClick={() => { setShowNewCat(false); setNewCatName('') }} style={{ ...btnGhost, padding: '7px 12px', fontSize: 13 }}>
              Отмена
            </button>
          </div>
        </div>
      )}

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
        {error && <div style={{ color: C.danger, marginBottom: 12, padding: '10px 14px', background: C.dangerSoft, borderRadius: 8, fontSize: 13 }}>{error}</div>}
        {info  && <div style={{ color: C.success, marginBottom: 12, padding: '10px 14px', background: C.successSoft, borderRadius: 8, fontSize: 13 }}>{info}</div>}

        {/* Пустое состояние */}
        {items.length === 0 && !loading && catalogs.length === 0 && (
          <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, padding: 32, textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 8 }}>Баз цен пока нет</div>
            <div style={{ color: C.muted, fontSize: 13, marginBottom: 20 }}>
              Загрузите Excel-файл с прайс-листом — он станет первой базой цен.
            </div>
            <button onClick={() => { setShowNewCat(true) }} style={btnPrimary}>+ Загрузить первую базу</button>
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
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ ...inputStyle, flex: 'none', width: 240 }}>
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
            {filtered.length === 0 && items.length > 0 && (
              <div style={{ color: C.muted, textAlign: 'center', padding: 40 }}>Ничего не найдено</div>
            )}
            {visible.length > 0 && (
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
                        <span style={{ fontSize: 11, color: C.muted, whiteSpace: 'nowrap', minWidth: 70 }}>{item.code}</span>
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
                          {item.code && <div><span style={{ color: C.muted }}>Код: </span><b>{item.code}</b></div>}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

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

const tabStyle = (active) => ({
  background: 'none', border: 'none', borderBottom: active ? `2px solid ${C.action}` : '2px solid transparent',
  padding: '14px 18px', fontSize: 13, fontWeight: active ? 700 : 400,
  color: active ? C.action : C.muted, cursor: 'pointer', fontFamily: FONT,
  whiteSpace: 'nowrap', transition: 'color .15s',
})
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
