import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { C, FONT, MONO, money } from '../constants.js'
import * as XLSX from 'xlsx'

export default function SpecEditor() {
  const navigate   = useNavigate()
  const { id }     = useParams()
  const isNew      = !id
  const fileRef    = useRef()
  const searchRef  = useRef()

  // Мета-поля спецификации
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')

  // Строки спецификации
  const [lines, setLines]         = useState([])

  // Каталог
  const [catalog, setCatalog]     = useState([])
  const [catLoaded, setCatLoaded] = useState(false)

  // UI состояния
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(!isNew)
  const [saving, setSaving]       = useState(false)
  const [importing, setImporting] = useState(false)
  const [error, setError]         = useState('')
  const [saved, setSaved]         = useState(false)
  const [matchInfo, setMatchInfo] = useState('')

  // ── Загрузка существующей спецификации ────────────────────────────────────
  useEffect(() => {
    if (isNew) return
    Promise.all([
      supabase.from('specifications').select('*').eq('id', id).single(),
      supabase.from('spec_lines').select('*').eq('spec_id', id).order('position'),
    ]).then(([{ data: spec, error: e1 }, { data: lns, error: e2 }]) => {
      if (e1 || e2) { setError('Не удалось загрузить спецификацию'); setLoading(false); return }
      setTitle(spec.title || '')
      setDesc(spec.description || '')
      setLines((lns || []).map((l) => ({
        _key:       l.id,
        id:         l.id,
        price_item_id: l.price_item_id,
        name:       l.name,
        unit:       l.unit || '',
        qty:        l.qty  || 1,
        price:      l.price,
        price_vat:  l.price_vat,
        sum:        l.sum,
        sum_vat:    l.sum_vat,
        manual:     !l.price_item_id,
      })))
      setLoading(false)
    })
  }, [id, isNew])

  // ── Загрузка каталога (один раз) ──────────────────────────────────────────
  const loadCatalog = useCallback(async () => {
    if (catLoaded) return catalog
    const { data, error } = await supabase
      .from('price_items')
      .select('id, code, category, name, unit, price, price_vat')
      .order('name')
    if (error) throw new Error(error.message)
    setCatalog(data || [])
    setCatLoaded(true)
    return data || []
  }, [catLoaded, catalog])

  // ── Поиск по каталогу ─────────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2 || !catLoaded) return []
    return catalog
      .filter((r) => r.name.toLowerCase().includes(q) || (r.code || '').toLowerCase().includes(q))
      .slice(0, 10)
  }, [search, catalog, catLoaded])

  const onSearchFocus = () => { if (!catLoaded) loadCatalog().catch(() => {}) }

  // ── Добавить строку из каталога ───────────────────────────────────────────
  const addFromCatalog = (item) => {
    setLines((ls) => {
      if (ls.some((l) => l.price_item_id === item.id)) return ls
      const qty = 1
      return [...ls, {
        _key:          Date.now() + Math.random(),
        price_item_id: item.id,
        name:          item.name,
        unit:          item.unit || '',
        qty,
        price:         item.price,
        price_vat:     item.price_vat,
        sum:           qty * (item.price || 0),
        sum_vat:       qty * (item.price_vat || 0),
        manual:        false,
      }]
    })
    setSearch('')
  }

  // ── Добавить пустую ручную строку ─────────────────────────────────────────
  const addManual = () => {
    setLines((ls) => [...ls, {
      _key:          Date.now() + Math.random(),
      price_item_id: null,
      name:          '',
      unit:          '',
      qty:           1,
      price:         null,
      price_vat:     null,
      sum:           0,
      sum_vat:       0,
      manual:        true,
    }])
  }

  // ── Изменение строки ──────────────────────────────────────────────────────
  const updateLine = (key, field, val) => {
    setLines((ls) => ls.map((l) => {
      if (l._key !== key) return l
      const next = { ...l, [field]: val }
      if (field === 'qty' || field === 'price' || field === 'price_vat') {
        const qty      = Number(field === 'qty'      ? val : next.qty)      || 0
        const price    = Number(field === 'price'    ? val : next.price)    || 0
        const priceVat = Number(field === 'price_vat'? val : next.price_vat)|| 0
        next.sum     = qty * price
        next.sum_vat = qty * priceVat
      }
      return next
    }))
  }

  const removeLine = (key) => setLines((ls) => ls.filter((l) => l._key !== key))

  // ── Итоги ─────────────────────────────────────────────────────────────────
  const totalNoVat = useMemo(() => lines.reduce((s, l) => s + (Number(l.sum)     || 0), 0), [lines])
  const totalVat   = useMemo(() => lines.reduce((s, l) => s + (Number(l.sum_vat) || 0), 0), [lines])

  // ── Импорт Excel спецификации ─────────────────────────────────────────────
  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setError(''); setMatchInfo('')

    try {
      const cat = await loadCatalog()
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf)
      const ws  = wb.Sheets[wb.SheetNames[0]]
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })

      const keys      = Object.keys(rows[0] || {})
      const find      = (...words) => keys.find((k) => words.some((w) => k.toLowerCase().includes(w))) || null
      const colName   = find('наимен', 'назван', 'работ', 'name', 'позиция')
      const colUnit   = find('ед', 'единиц', 'unit')
      const colQty    = find('кол', 'объём', 'qty', 'количество', 'объем')
      const colPrice  = find('цена без', 'без ндс', 'цена', 'price_no', 'стоимость ед')
      const colPriceV = find('с ндс', 'цена_с', 'price_vat')

      if (!colName) { setError('Не найдена колонка с наименованием'); setImporting(false); return }

      // Нормализация строки для нечёткого поиска
      const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()

      let matched = 0, manual = 0

      const newLines = rows
        .map((r) => {
          const name = String(r[colName] || '').trim()
          if (!name) return null

          const qty      = Number(String(r[colQty]   || '').replace(/[^\d.]/g, '')) || 1
          const price    = Number(String(r[colPrice]  || '').replace(/[^\d.]/g, '')) || null
          const priceVat = Number(String(r[colPriceV] || '').replace(/[^\d.]/g, '')) || null
          const unit     = colUnit ? String(r[colUnit] || '').trim() : ''

          // Ищем совпадение в каталоге
          const needle = norm(name)
          let found = cat.find((c) => norm(c.name) === needle)
          if (!found) found = cat.find((c) => norm(c.name).includes(needle.slice(0, 20)))
          if (!found) found = cat.find((c) => needle.includes(norm(c.name).slice(0, 20)))

          if (found) {
            matched++
            const p  = found.price    || price    || 0
            const pv = found.price_vat || priceVat || Math.round(p * 1.16 * 100) / 100
            return {
              _key:          Date.now() + Math.random(),
              price_item_id: found.id,
              name:          found.name,
              unit:          found.unit || unit,
              qty,
              price:         p,
              price_vat:     pv,
              sum:           qty * p,
              sum_vat:       qty * pv,
              manual:        false,
            }
          }

          // Не нашли — добавляем как ручную строку с ценой из файла
          manual++
          const p  = price    || 0
          const pv = priceVat || Math.round(p * 1.16 * 100) / 100
          return {
            _key:          Date.now() + Math.random(),
            price_item_id: null,
            name,
            unit,
            qty,
            price:         p || null,
            price_vat:     pv || null,
            sum:           qty * p,
            sum_vat:       qty * pv,
            manual:        true,
          }
        })
        .filter(Boolean)

      setLines((ls) => [...ls, ...newLines])
      setMatchInfo(`Загружено ${newLines.length} строк: ${matched} совпало с каталогом, ${manual} — ручные позиции`)
    } catch (ex) {
      setError('Ошибка разбора файла: ' + ex.message)
    }
    setImporting(false)
    e.target.value = ''
  }

  // ── Сохранение ────────────────────────────────────────────────────────────
  const save = async () => {
    if (!title.trim()) { setError('Введите название спецификации'); return }
    setSaving(true); setError('')

    const specData = {
      title:        title.trim(),
      description:  description.trim() || null,
      total_no_vat: totalNoVat,
      total_vat:    totalVat,
      lines_count:  lines.length,
      updated_at:   new Date().toISOString(),
    }

    let specId = id

    if (isNew) {
      const { data, error } = await supabase.from('specifications').insert(specData).select('id').single()
      if (error) { setError('Ошибка сохранения: ' + error.message); setSaving(false); return }
      specId = data.id
    } else {
      const { error } = await supabase.from('specifications').update(specData).eq('id', id)
      if (error) { setError('Ошибка сохранения: ' + error.message); setSaving(false); return }
      await supabase.from('spec_lines').delete().eq('spec_id', id)
    }

    // Сохраняем строки
    if (lines.length) {
      const toInsert = lines.map((l, i) => ({
        spec_id:       specId,
        price_item_id: l.price_item_id || null,
        name:          l.name,
        unit:          l.unit || null,
        qty:           Number(l.qty) || 1,
        price:         Number(l.price) || null,
        price_vat:     Number(l.price_vat) || null,
        sum:           Number(l.sum) || 0,
        sum_vat:       Number(l.sum_vat) || 0,
        position:      i,
      }))
      for (let i = 0; i < toInsert.length; i += 200) {
        const { error } = await supabase.from('spec_lines').insert(toInsert.slice(i, i + 200))
        if (error) { setError('Ошибка сохранения строк: ' + error.message); setSaving(false); return }
      }
    }

    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
    if (isNew) navigate(`/spec/${specId}`, { replace: true })
  }

  // ── Печать / PDF ──────────────────────────────────────────────────────────
  const print = () => {
    const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const rowsHtml = lines.map((l, i) => `
      <tr>
        <td class="c">${i + 1}</td>
        <td>${esc(l.name)}</td>
        <td class="c">${esc(l.unit || '—')}</td>
        <td class="n">${Number(l.qty) || 0}</td>
        <td class="n">${l.price != null ? money(l.price).replace(' ₸','') : '—'}</td>
        <td class="n">${l.price_vat != null ? money(l.price_vat).replace(' ₸','') : '—'}</td>
        <td class="n">${l.sum != null ? money(l.sum).replace(' ₸','') : '—'}</td>
        <td class="n">${l.sum_vat != null ? money(l.sum_vat).replace(' ₸','') : '—'}</td>
      </tr>`).join('')

    const today = new Date().toLocaleDateString('ru-RU')
    const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<style>
  body{font-family:Arial,sans-serif;color:#14181F;margin:20px;font-size:12px}
  h1{font-size:16px;text-align:center;text-transform:uppercase;letter-spacing:.04em;margin:16px 0 4px}
  .sub{text-align:center;color:#374151;margin-bottom:16px}
  .date{text-align:right;color:#6B7585;font-size:11px;margin-bottom:12px}
  table{width:100%;border-collapse:collapse;margin-bottom:12px}
  th,td{border:1px solid #8A93A3;padding:5px 7px;vertical-align:top}
  th{background:#EEF1F5;font-size:10px;text-transform:uppercase;letter-spacing:.04em;text-align:center}
  .c{text-align:center;white-space:nowrap}.n{text-align:right;white-space:nowrap}
  .tot{margin-top:6px;text-align:right;font-size:13px}
  .tot b{font-size:14px}
  @media print{body{margin:10mm}}
</style></head><body>
<div class="date">Дата: ${today}</div>
<h1>Спецификация</h1>
<div class="sub"><b>${esc(title)}</b>${description ? '<br><span style="color:#6B7585">' + esc(description) + '</span>' : ''}</div>
<table>
  <thead><tr>
    <th style="width:28px">№</th>
    <th>Наименование</th>
    <th>Ед.</th>
    <th>Кол-во</th>
    <th>Цена без НДС, ₸</th>
    <th>Цена с НДС, ₸</th>
    <th>Сумма без НДС, ₸</th>
    <th>Сумма с НДС, ₸</th>
  </tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>
<div class="tot">
  Итого без НДС: <b>${money(totalNoVat)}</b> &nbsp;|&nbsp;
  Итого с НДС 16%: <b>${money(totalVat)}</b>
</div>
<script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
    const w = window.open('', '_blank')
    if (!w) { setError('Браузер заблокировал всплывающее окно'); return }
    w.document.write(html); w.document.close()
  }

  // ── UI ────────────────────────────────────────────────────────────────────
  if (loading) return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: C.muted }}>Загрузка...</div>
    </div>
  )

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, color: C.ink }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${C.brand}, ${C.action})` }} />

      {/* Шапка */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 960, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60, gap: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={() => navigate('/')} style={btnGhost}>← Назад</button>
            <span style={{ fontWeight: 700, fontSize: 15 }}>{isNew ? 'Новая спецификация' : 'Редактирование'}</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            {lines.length > 0 && (
              <button onClick={print} style={btnGhost}>Печать / PDF</button>
            )}
            <button onClick={save} disabled={saving} style={btnPrimary}>
              {saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить'}
            </button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: '0 auto', padding: '24px' }}>
        {error    && <div style={{ color: C.danger,  padding: '10px 14px', background: C.dangerSoft,  borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{error}</div>}
        {matchInfo && <div style={{ color: C.success, padding: '10px 14px', background: C.successSoft, borderRadius: 8, marginBottom: 14, fontSize: 13 }}>{matchInfo}</div>}

        {/* Название и описание */}
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, padding: '18px 20px', marginBottom: 16 }}>
          <div style={{ marginBottom: 12 }}>
            <label style={labelStyle}>Название спецификации</label>
            <input
              value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder="Например: Спецификация оборудования склад №3"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
          <div>
            <label style={labelStyle}>Описание (необязательно)</label>
            <input
              value={description} onChange={(e) => setDesc(e.target.value)}
              placeholder="Краткое описание или примечание"
              style={{ ...inputStyle, width: '100%' }}
            />
          </div>
        </div>

        {/* Панель добавления */}
        <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, padding: '16px 20px', marginBottom: 16 }}>
          <div style={{ fontWeight: 700, marginBottom: 12, fontSize: 14 }}>Добавить позиции</div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-start' }}>

            {/* Поиск по каталогу */}
            <div style={{ flex: 1, minWidth: 240, position: 'relative' }}>
              <input
                ref={searchRef}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                onFocus={onSearchFocus}
                placeholder="Поиск по справочнику цен..."
                style={{ ...inputStyle, width: '100%' }}
              />
              {searchResults.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
                  background: C.surface, border: `1px solid ${C.lineDark}`, borderRadius: 8,
                  boxShadow: '0 8px 24px rgba(0,0,0,0.12)', marginTop: 4, overflow: 'hidden',
                }}>
                  {searchResults.map((item) => (
                    <div
                      key={item.id}
                      onClick={() => addFromCatalog(item)}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: `1px solid ${C.line}`, fontSize: 13 }}
                      onMouseEnter={(e) => e.currentTarget.style.background = C.actionSoft}
                      onMouseLeave={(e) => e.currentTarget.style.background = ''}
                    >
                      <div style={{ fontWeight: 600 }}>{item.name}</div>
                      <div style={{ color: C.muted, fontSize: 12, marginTop: 2, display: 'flex', gap: 12 }}>
                        {item.unit && <span>{item.unit}</span>}
                        {item.price != null && <span>{money(item.price)} без НДС</span>}
                        {item.category && <span style={{ color: C.brand }}>{item.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ color: C.dim, fontSize: 13, alignSelf: 'center', whiteSpace: 'nowrap' }}>или</div>

            <button onClick={addManual} style={btnSecondary}>+ Ручная позиция</button>

            {/* Загрузка Excel */}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={importing} style={btnSecondary}>
              {importing ? 'Загрузка...' : 'Загрузить из Excel'}
            </button>
          </div>
        </div>

        {/* Таблица строк */}
        {lines.length > 0 && (
          <div style={{ background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`, overflow: 'hidden', marginBottom: 16 }}>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ background: C.page }}>
                    {['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена без НДС', 'Цена с НДС', 'Сумма без НДС', 'Сумма с НДС', ''].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => (
                    <tr key={l._key} style={{ borderTop: `1px solid ${C.line}` }}>
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontFamily: MONO, fontSize: 12, width: 32 }}>{i + 1}</td>

                      {/* Название */}
                      <td style={{ ...tdStyle, minWidth: 200 }}>
                        {l.manual ? (
                          <input
                            value={l.name} onChange={(e) => updateLine(l._key, 'name', e.target.value)}
                            placeholder="Наименование"
                            style={{ ...inlineInput, width: '100%' }}
                          />
                        ) : (
                          <span style={{ fontSize: 13.5 }}>{l.name}</span>
                        )}
                        {!l.manual && (
                          <span style={{ display: 'block', fontFamily: MONO, fontSize: 10, color: C.brand, marginTop: 2 }}>из каталога</span>
                        )}
                      </td>

                      {/* Ед. изм. */}
                      <td style={{ ...tdStyle, width: 60 }}>
                        {l.manual ? (
                          <input value={l.unit} onChange={(e) => updateLine(l._key, 'unit', e.target.value)}
                            placeholder="шт" style={{ ...inlineInput, width: 52 }} />
                        ) : (
                          <span style={{ color: C.muted, fontSize: 13 }}>{l.unit || '—'}</span>
                        )}
                      </td>

                      {/* Кол-во */}
                      <td style={{ ...tdStyle, width: 80 }}>
                        <input
                          type="number" min="0" step="0.01"
                          value={l.qty} onChange={(e) => updateLine(l._key, 'qty', e.target.value)}
                          style={{ ...inlineInput, width: 68, textAlign: 'right' }}
                        />
                      </td>

                      {/* Цена без НДС */}
                      <td style={{ ...tdStyle, width: 120 }}>
                        {l.manual ? (
                          <input
                            type="number" min="0"
                            value={l.price ?? ''} onChange={(e) => updateLine(l._key, 'price', e.target.value)}
                            placeholder="0"
                            style={{ ...inlineInput, width: 108, textAlign: 'right' }}
                          />
                        ) : (
                          <span style={{ fontSize: 13, fontFamily: MONO }}>{money(l.price)}</span>
                        )}
                      </td>

                      {/* Цена с НДС */}
                      <td style={{ ...tdStyle, width: 120 }}>
                        {l.manual ? (
                          <input
                            type="number" min="0"
                            value={l.price_vat ?? ''} onChange={(e) => updateLine(l._key, 'price_vat', e.target.value)}
                            placeholder="0"
                            style={{ ...inlineInput, width: 108, textAlign: 'right' }}
                          />
                        ) : (
                          <span style={{ fontSize: 13, fontFamily: MONO }}>{money(l.price_vat)}</span>
                        )}
                      </td>

                      {/* Сумма без НДС */}
                      <td style={{ ...tdStyle, width: 120, textAlign: 'right', fontWeight: 600, fontFamily: MONO, fontSize: 13 }}>
                        {money(l.sum)}
                      </td>

                      {/* Сумма с НДС */}
                      <td style={{ ...tdStyle, width: 120, textAlign: 'right', fontWeight: 700, color: C.action, fontFamily: MONO, fontSize: 13 }}>
                        {money(l.sum_vat)}
                      </td>

                      {/* Удалить */}
                      <td style={{ ...tdStyle, width: 32, textAlign: 'center' }}>
                        <button onClick={() => removeLine(l._key)}
                          style={{ background: 'none', border: 'none', color: C.danger, cursor: 'pointer', fontSize: 18, lineHeight: 1, padding: '0 4px' }}>
                          ×
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Итоги */}
            <div style={{ borderTop: `2px solid ${C.line}`, padding: '14px 20px', display: 'flex', justifyContent: 'flex-end', gap: 28, flexWrap: 'wrap' }}>
              <div style={{ fontSize: 14, color: C.muted }}>
                Без НДС: <b style={{ color: C.ink }}>{money(totalNoVat)}</b>
              </div>
              <div style={{ fontSize: 17, fontWeight: 800 }}>
                Итого с НДС 16%: <span style={{ color: C.success }}>{money(totalVat)}</span>
              </div>
            </div>
          </div>
        )}

        {/* Кнопки внизу */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          {lines.length > 0 && <button onClick={print} style={btnGhost}>Печать / PDF</button>}
          <button onClick={save} disabled={saving} style={btnPrimary}>
            {saving ? 'Сохранение...' : saved ? '✓ Сохранено' : 'Сохранить спецификацию'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Стили ──────────────────────────────────────────────────────────────────
const btnPrimary = {
  background: C.action, color: '#fff', border: 'none', borderRadius: 10, padding: '9px 20px',
  fontWeight: 700, fontSize: 14, cursor: 'pointer', fontFamily: FONT,
  boxShadow: '0 8px 20px -8px rgba(39,86,232,.6)',
}
const btnGhost = {
  background: 'transparent', color: C.muted, border: `1px solid ${C.lineDark}`, borderRadius: 8,
  padding: '8px 14px', fontSize: 13, cursor: 'pointer', fontFamily: FONT,
}
const btnSecondary = {
  background: C.actionSoft, color: C.brand, border: `1px solid ${C.lineDark}`, borderRadius: 8,
  padding: '9px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer', fontFamily: FONT, whiteSpace: 'nowrap',
}
const inputStyle = {
  background: C.surface, color: C.ink, border: `1px solid ${C.lineDark}`, borderRadius: 8,
  padding: '9px 13px', fontSize: 14, outline: 'none', fontFamily: FONT,
}
const inlineInput = {
  background: C.tint, color: C.ink, border: `1px solid ${C.lineDark}`, borderRadius: 6,
  padding: '5px 8px', fontSize: 13, outline: 'none', fontFamily: FONT,
}
const labelStyle = {
  display: 'block', fontSize: 12, fontWeight: 600, color: C.muted, marginBottom: 5,
  textTransform: 'uppercase', letterSpacing: '.06em', fontFamily: FONT,
}
const thStyle = {
  textAlign: 'left', padding: '9px 10px', fontSize: 11, fontWeight: 600,
  color: C.muted, textTransform: 'uppercase', letterSpacing: '.04em',
  borderRight: `1px solid ${C.line}`,
}
const tdStyle = {
  padding: '8px 10px', verticalAlign: 'middle', borderRight: `1px solid ${C.line}`,
}
