import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { C, FONT, MONO, money } from '../constants.js'
import { callAI } from '../ai.js'
import * as XLSX from 'xlsx'

// pdfjs-dist загружается динамически только при первом PDF-импорте
let _pdfjs = null
async function getPdfjs() {
  if (_pdfjs) return _pdfjs
  const [lib, { default: workerUrl }] = await Promise.all([
    import('pdfjs-dist'),
    import('pdfjs-dist/build/pdf.worker.min.mjs?url'),
  ])
  lib.GlobalWorkerOptions.workerSrc = workerUrl
  _pdfjs = lib
  return lib
}

export default function SpecEditor() {
  const navigate   = useNavigate()
  const { id }     = useParams()
  const isNew      = !id
  const fileRef    = useRef()
  const pdfFileRef = useRef()
  const searchRef  = useRef()

  // Мета-поля спецификации
  const [title, setTitle]         = useState('')
  const [description, setDesc]    = useState('')

  // Строки спецификации
  const [lines, setLines]         = useState([])

  // Каталог / базы цен
  const [catalog, setCatalog]     = useState([])
  const [catLoaded, setCatLoaded] = useState(false)
  const [catalogs, setCatalogs]   = useState([])
  const [catFilter, setCatFilter] = useState('') // '' = все базы

  // UI состояния
  const [search, setSearch]       = useState('')
  const [loading, setLoading]     = useState(!isNew)
  const [saving, setSaving]       = useState(false)
  const [importing, setImporting] = useState(false)
  const [aiMatching, setAiMatching] = useState(false)
  const [aiProgress, setAiProgress] = useState('')
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

  // ── Загрузка списка каталогов ─────────────────────────────────────────────
  useEffect(() => {
    supabase.from('catalogs').select('id, name').order('created_at')
      .then(({ data }) => setCatalogs(data || []))
  }, [])

  // ── Загрузка каталога (сбрасывается при смене фильтра) ────────────────────
  const loadCatalog = useCallback(async () => {
    if (catLoaded) return catalog
    let q = supabase.from('price_items').select('id, catalog_id, code, category, name, unit, price, price_vat').order('name')
    if (catFilter) q = q.eq('catalog_id', catFilter)
    const { data, error } = await q
    if (error) throw new Error(error.message)
    setCatalog(data || [])
    setCatLoaded(true)
    return data || []
  }, [catLoaded, catalog, catFilter])

  const switchCatFilter = (id) => {
    setCatFilter(id); setCatalog([]); setCatLoaded(false)
  }

  // ── Поиск по каталогу (точный + нечёткий по словам) ──────────────────────
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q.length < 2 || !catLoaded) return []

    const words = q.split(/\s+/).filter((w) => w.length > 2)

    const scored = catalog.map((r) => {
      const hay = r.name.toLowerCase()
      const code = (r.code || '').toLowerCase()
      let sc = 0
      if (hay.includes(q) || code.includes(q)) sc += 100        // точное вхождение
      words.forEach((w) => { if (hay.includes(w)) sc += 20 })   // слово в названии
      return { item: r, sc }
    }).filter((x) => x.sc > 0)
      .sort((a, b) => b.sc - a.sc)

    const exact   = scored.filter((x) => x.sc >= 100).slice(0, 8).map((x) => ({ ...x.item, _analog: false }))
    const analogs = scored.filter((x) => x.sc < 100 && x.sc > 0).slice(0, exact.length < 3 ? 5 : 0).map((x) => ({ ...x.item, _analog: true }))

    return [...exact, ...analogs]
  }, [search, catalog, catLoaded])

  const onSearchFocus = () => { if (!catLoaded) loadCatalog().catch(() => {}) }

  // ── Добавить строку из каталога ───────────────────────────────────────────
  const addFromCatalog = (item) => {
    setLines((ls) => {
      if (ls.some((l) => l.price_item_id === item.id)) return ls
      const qty = 1
      const p  = item.price || 0
      // Если price_vat равна price или не задана — считаем НДС 16%
      const pv = (item.price_vat && item.price_vat !== item.price)
        ? item.price_vat
        : Math.round(p * 1.16 * 100) / 100
      return [...ls, {
        _key:          Date.now() + Math.random(),
        price_item_id: item.id,
        name:          item.name,
        unit:          item.unit || '',
        qty,
        price:         p,
        price_vat:     pv,
        sum:           qty * p,
        sum_vat:       qty * pv,
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

  // ── Экспорт в Excel ───────────────────────────────────────────────────────
  const exportToExcel = () => {
    const wb = XLSX.utils.book_new()
    const rows = []

    if (title)       rows.push([title])
    if (description) rows.push([description])
    rows.push([])
    rows.push(['№', 'Наименование', 'Ед.', 'Кол-во', 'Цена без НДС', 'Цена с НДС', 'Сумма без НДС', 'Сумма с НДС'])

    lines.forEach((l, i) => {
      rows.push([
        i + 1,
        l.name,
        l.unit || '',
        Number(l.qty) || 1,
        l.price    != null ? Number(l.price)    : '',
        l.price_vat != null ? Number(l.price_vat) : '',
        l.sum      != null ? Number(l.sum)      : '',
        l.sum_vat  != null ? Number(l.sum_vat)  : '',
      ])
    })

    rows.push([])
    rows.push(['', '', '', '', '', '', 'Итого без НДС', totalNoVat])
    rows.push(['', '', '', '', '', '', 'Итого с НДС 16%', totalVat])

    const ws = XLSX.utils.aoa_to_sheet(rows)
    ws['!cols'] = [
      { wch: 4 }, { wch: 52 }, { wch: 7 }, { wch: 8 },
      { wch: 16 }, { wch: 16 }, { wch: 16 }, { wch: 16 },
    ]
    XLSX.utils.book_append_sheet(wb, ws, 'Спецификация')
    XLSX.writeFile(wb, `${title || 'спецификация'}.xlsx`)
  }

  // ── Импорт Excel + ИИ-сопоставление ──────────────────────────────────────
  const handleExcelImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImporting(true); setError(''); setMatchInfo('')

    try {
      const cat = await loadCatalog()
      const buf = await file.arrayBuffer()
      const wb  = XLSX.read(buf)
      const ws  = wb.Sheets[wb.SheetNames[0]]

      // Читаем как массивы и находим строку-заголовок среди первых 15 строк
      const raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
      const HEADER_WORDS = ['наимен', 'назван', 'name', 'описание', 'номенклатур']
      let headerIdx = -1
      for (let i = 0; i < Math.min(15, raw.length); i++) {
        const row = raw[i]
        const nonEmpty = row.filter((c) => String(c).trim()).length
        const hasKeyword = row.some((cell) => HEADER_WORDS.some((w) => String(cell).toLowerCase().includes(w)))
        if (nonEmpty >= 2 && hasKeyword) { headerIdx = i; break }
      }

      let iName, iUnit, iQty, iPrice, iPriceV, dataRows

      if (headerIdx >= 0) {
        const headers = raw[headerIdx].map((h) => String(h).trim())
        dataRows = raw.slice(headerIdx + 1)
        const findCol = (...words) => {
          const idx = headers.findIndex((h) => words.some((w) => h.toLowerCase().includes(w)))
          return idx >= 0 ? idx : null
        }
        iName   = findCol('наимен', 'назван', 'name', 'описание', 'номенклатур')
        iUnit   = findCol('ед', 'единиц', 'unit')
        iQty    = findCol('кол', 'объём', 'qty', 'количество', 'объем')
        iPrice  = findCol('стоимость ед', 'цена без', 'без ндс', 'цена', 'price_no', 'стоим')
        iPriceV = findCol('с ндс', 'цена_с', 'price_vat')
      } else {
        // Нет строки заголовков — определяем колонки по содержимому
        const sample = raw.slice(0, Math.min(20, raw.length)).filter(r => r.filter(c => String(c).trim()).length >= 3)
        if (!sample.length) { setError('Не удалось определить структуру файла'); setImporting(false); return }
        const numCols = Math.max(...sample.map(r => r.length))
        const cols = Array.from({ length: numCols }, (_, c) => c)
        const cellStr   = (r, c) => String(r[c] ?? '').trim()
        const avgLen    = (c) => sample.reduce((s, r) => s + cellStr(r, c).length, 0) / sample.length
        const avgVal    = (c) => sample.reduce((s, r) => s + Number(cellStr(r, c)), 0) / sample.length
        const isNumCol  = (c) => sample.every(r => { const v = Number(cellStr(r, c)); return cellStr(r, c) !== '' && !isNaN(v) && v > 0 })
        const isCodeCol = (c) => sample.filter(r => /^\d{3}-\d{3}/.test(cellStr(r, c))).length >= sample.length * 0.5
        const isUnitCol = (c) => sample.every(r => { const v = cellStr(r, c); return v.length <= 15 && /[а-яёa-z²³]/i.test(v) })
        const iCode     = cols.find(isCodeCol) ?? null
        iName           = cols.reduce((best, c) => avgLen(c) > avgLen(best) ? c : best, 0)
        iUnit           = cols.find(c => c !== iName && c !== iCode && isUnitCol(c)) ?? null
        const numCols2  = cols.filter(c => c !== iName && c !== iCode && c !== iUnit && isNumCol(c)).sort((a, b) => avgVal(b) - avgVal(a))
        iPrice          = numCols2[0] ?? null
        iPriceV         = null  // в КП без заголовков вторая числовая = цена с НДС, но нет qty
        iQty            = null  // кол-во не всегда есть
        dataRows        = raw
      }

      if (iName === null) {
        setError('Не удалось определить колонку с наименованием. Проверьте формат файла.')
        setImporting(false); return
      }

      // Распарсить строки из Excel
      const specRows = dataRows
        .map((r) => {
          const name = String(r[iName] ?? '').trim()
          if (!name) return null
          return {
            name,
            qty:      Number(String(r[iQty]    ?? '').replace(/[^\d.]/g, '')) || 1,
            price:    Number(String(r[iPrice]   ?? '').replace(/[^\d.]/g, '')) || null,
            priceVat: Number(String(r[iPriceV]  ?? '').replace(/[^\d.]/g, '')) || null,
            unit:     iUnit != null ? String(r[iUnit] ?? '').trim() : '',
          }
        })
        .filter(Boolean)

      if (!specRows.length) { setError('Нет строк для импорта'); setImporting(false); return }

      setImporting(false)
      setAiMatching(true)
      setAiProgress(`Анализирую ${specRows.length} строк...`)

      // ── Для каждой строки найти топ-5 кандидатов по тексту ───────────
      const norm = (s) => s.toLowerCase().replace(/[^а-яёa-z0-9]/g, ' ').replace(/\s+/g, ' ').trim()

      const specWithCandidates = specRows.map((row, idx) => {
        const needle = norm(row.name)
        const words  = needle.split(' ').filter((w) => w.length > 2)
        const scored = cat
          .map((item) => {
            const hay = norm(item.name)
            let sc = 0
            if (hay === needle) sc += 100
            if (hay.includes(needle.slice(0, 18))) sc += 60
            if (needle.includes(hay.slice(0, 18))) sc += 50
            words.forEach((w) => { if (hay.includes(w)) sc += 15 })
            return { item, sc }
          })
          .filter((x) => x.sc > 0)
          .sort((a, b) => b.sc - a.sc)
          .slice(0, 5)
          .map((x) => x.item)
        return { idx, name: row.name, candidates: scored }
      })

      // ── Вызов ИИ ────────────────────────────────────────────────────────
      let matchMap = {}
      try {
        setAiProgress(`Сопоставляю ${specRows.length} строк с каталогом...`)

        const prompt =
          `Сопоставь строки технической спецификации с позициями прайс-листа.\n` +
          `Учитывай сокращения, опечатки, синонимы и разные формулировки одного и того же.\n\n` +
          `СТРОКИ СПЕЦИФИКАЦИИ И КАНДИДАТЫ ИЗ ПРАЙС-ЛИСТА:\n` +
          specWithCandidates
            .map(({ idx, name, candidates }) =>
              `[${idx}] "${name}"\n` + (
                candidates.length
                  ? candidates.map((c, i) => `  ${i + 1}. id="${c.id}" | "${c.name}"${c.unit ? ` (${c.unit})` : ''}`).join('\n')
                  : '  (кандидатов нет)'
              )
            )
            .join('\n\n') +
          `\n\nВерни ТОЛЬКО JSON-массив без пояснений:\n` +
          `[{"idx":0,"id":"<id кандидата или null если не найдено>"},{"idx":1,"id":"<id или null>"},...]\n`

        const result   = await callAI(prompt)
        const jsonPart = result.match(/\[[\s\S]*\]/)
        if (jsonPart) {
          JSON.parse(jsonPart[0]).forEach(({ idx, id }) => { matchMap[idx] = id || null })
        }
      } catch (aiErr) {
        setMatchInfo(`⚠️ ИИ-сопоставление не сработало (${aiErr.message}). Все строки добавлены без сопоставления — проверьте VITE_ANTHROPIC_KEY в настройках Vercel.`)
      }

      // ── Применить результаты ─────────────────────────────────────────────
      let matched = 0, notFound = 0

      const newLines = specRows.map((row, idx) => {
        const itemId = Object.prototype.hasOwnProperty.call(matchMap, idx) ? matchMap[idx] : undefined
        const found  = itemId ? cat.find((c) => c.id === itemId) : null

        if (found) {
          matched++
          const p  = found.price || row.price || 0
          // Если price_vat равна price — применяем НДС 16%
          const pv = (found.price_vat && found.price_vat !== found.price)
            ? found.price_vat
            : Math.round(p * 1.16 * 100) / 100
          return {
            _key:          Date.now() + Math.random(),
            price_item_id: found.id,
            name:          found.name,
            unit:          found.unit || row.unit,
            qty:           row.qty,
            price:         p,
            price_vat:     pv,
            sum:           row.qty * p,
            sum_vat:       row.qty * pv,
            manual:        false,
            source:        'catalog',
          }
        }

        notFound++
        const p  = row.price    || 0
        const pv = row.priceVat || (p ? Math.round(p * 1.16 * 100) / 100 : 0)
        return {
          _key:          Date.now() + Math.random(),
          price_item_id: null,
          name:          row.name,
          unit:          row.unit,
          qty:           row.qty,
          price:         p  || null,
          price_vat:     pv || null,
          sum:           row.qty * p,
          sum_vat:       row.qty * pv,
          manual:        true,
          source:        'ai_not_found',
        }
      })

      setLines((ls) => [...ls, ...newLines])
      setMatchInfo(
        `Загружено ${newLines.length} строк: ${matched} сопоставлено с каталогом` +
        (notFound > 0 ? `, ${notFound} не найдено — укажите цены вручную` : '')
      )
    } catch (ex) {
      setError('Ошибка разбора файла: ' + ex.message)
    }

    setAiMatching(false)
    setAiProgress('')
    e.target.value = ''
  }

  // ── Импорт PDF ────────────────────────────────────────────────────────────
  const handlePdfImport = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    e.target.value = ''
    setImporting(true); setError(''); setMatchInfo('')

    try {
      // Извлечь текст из PDF, сохраняя структуру строк
      const arrayBuffer = await file.arrayBuffer()
      const pdfjs = await getPdfjs()
      const pdf = await pdfjs.getDocument({ data: arrayBuffer }).promise

      const textLines = []
      for (let p = 1; p <= pdf.numPages; p++) {
        const page = await pdf.getPage(p)
        const tc   = await page.getTextContent()
        const items = tc.items.filter((it) => it.str.trim())
        items.sort((a, b) => b.transform[5] - a.transform[5])

        let bucket = [], lastY = null
        for (const it of items) {
          const y = it.transform[5]
          if (lastY !== null && Math.abs(lastY - y) > 4) {
            if (bucket.length) {
              bucket.sort((a, b) => a.transform[4] - b.transform[4])
              textLines.push(bucket.map((x) => x.str).join('\t'))
            }
            bucket = []
          }
          bucket.push(it)
          lastY = y
        }
        if (bucket.length) {
          bucket.sort((a, b) => a.transform[4] - b.transform[4])
          textLines.push(bucket.map((x) => x.str).join('\t'))
        }
        textLines.push('')
      }

      const fullText = textLines.join('\n').trim()
      if (!fullText) {
        setError('PDF не содержит текста (скан). Загрузите Excel или введите вручную.')
        setImporting(false); return
      }

      setImporting(false)
      setAiMatching(true)
      setAiProgress('ИИ извлекает позиции из PDF...')

      const prompt =
        'Из текста ниже (прайс-лист или спецификация) извлеки список позиций.\n' +
        'Верни ТОЛЬКО JSON-массив без пояснений:\n' +
        '[{"name":"Наименование","unit":"шт","qty":1,"price":1000}]\n' +
        '- name: полное наименование (обязательно, не пустое)\n' +
        '- unit: единица измерения или ""\n' +
        '- qty: количество (число, по умолчанию 1)\n' +
        '- price: цена без НДС в числе или null\n' +
        'Игнорируй заголовки таблиц, итоговые строки, примечания.\n\n' +
        'ТЕКСТ:\n' + fullText.slice(0, 12000)

      const result    = await callAI(prompt)
      const jsonMatch = result.match(/\[[\s\S]*\]/)
      if (!jsonMatch) {
        setError('ИИ не распознал структуру PDF. Попробуйте Excel.')
        return
      }

      const items = JSON.parse(jsonMatch[0]).filter((it) => it.name?.trim())
      if (!items.length) {
        setError('ИИ не нашёл позиций в PDF.')
        return
      }

      const newLines = items.map((item) => {
        const p   = Number(item.price) || 0
        const pv  = p ? Math.round(p * 1.16 * 100) / 100 : 0
        const qty = Number(item.qty)  || 1
        return {
          _key:          Date.now() + Math.random(),
          price_item_id: null,
          name:          String(item.name).trim(),
          unit:          String(item.unit || '').trim(),
          qty,
          price:         p  || null,
          price_vat:     pv || null,
          sum:           qty * p,
          sum_vat:       qty * pv,
          manual:        true,
          source:        'pdf',
        }
      })

      setLines((ls) => [...ls, ...newLines])
      setMatchInfo(`Загружено ${newLines.length} позиций из PDF`)
    } catch (ex) {
      setError('Ошибка чтения PDF: ' + ex.message)
    } finally {
      setImporting(false)
      setAiMatching(false)
      setAiProgress('')
    }
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

      {/* ИИ-overlay */}
      {aiMatching && (
        <div style={{
          position: 'fixed', inset: 0, background: 'rgba(11,17,38,0.62)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999,
        }}>
          <style>{`@keyframes _ai_spin{to{transform:rotate(360deg)}}`}</style>
          <div style={{
            background: C.surface, borderRadius: 16, padding: '32px 40px',
            textAlign: 'center', maxWidth: 320, width: '90%',
            boxShadow: '0 24px 64px rgba(0,0,0,0.28)',
          }}>
            <div style={{
              width: 40, height: 40, borderRadius: '50%', margin: '0 auto 18px',
              border: `3px solid ${C.actionSoft}`, borderTopColor: C.action,
              animation: '_ai_spin 0.8s linear infinite',
            }} />
            <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 8, color: C.ink }}>
              ИИ сопоставляет строки
            </div>
            <div style={{ color: C.muted, fontSize: 13, lineHeight: 1.6 }}>{aiProgress}</div>
          </div>
        </div>
      )}

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
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <span style={{ fontWeight: 700, fontSize: 14 }}>Добавить позиции</span>
            {catalogs.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <span style={{ color: C.muted }}>База:</span>
                <select
                  value={catFilter}
                  onChange={(e) => switchCatFilter(e.target.value)}
                  style={{ background: C.page, border: `1px solid ${C.lineDark}`, borderRadius: 6, padding: '4px 10px', fontSize: 13, fontFamily: FONT, color: C.ink, cursor: 'pointer' }}
                >
                  <option value="">Все базы</option>
                  {catalogs.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            )}
          </div>
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
                      <div style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}>
                        {item.name}
                        {item._analog && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: C.warning, background: C.warningSoft, borderRadius: 4, padding: '1px 5px', whiteSpace: 'nowrap' }}>аналог</span>
                        )}
                      </div>
                      <div style={{ color: C.muted, fontSize: 12, marginTop: 2, display: 'flex', gap: 12 }}>
                        {item.unit && <span>{item.unit}</span>}
                        {item.price != null && <span style={{ color: C.success, fontWeight: 600 }}>{money(item.price)} без НДС</span>}
                        {item.category && <span style={{ color: C.brand }}>{item.category}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div style={{ color: C.dim, fontSize: 13, alignSelf: 'center', whiteSpace: 'nowrap' }}>или</div>

            <button onClick={addManual} style={btnSecondary}>+ Ручная позиция</button>

            {/* Загрузка Excel + ИИ */}
            <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" onChange={handleExcelImport} style={{ display: 'none' }} />
            <button onClick={() => fileRef.current?.click()} disabled={importing || aiMatching} style={btnSecondary}>
              {importing ? 'Чтение...' : aiMatching ? 'ИИ работает...' : '✦ Загрузить из Excel (ИИ)'}
            </button>

            {/* Загрузка PDF + ИИ */}
            <input ref={pdfFileRef} type="file" accept=".pdf" onChange={handlePdfImport} style={{ display: 'none' }} />
            <button onClick={() => pdfFileRef.current?.click()} disabled={importing || aiMatching} style={btnSecondary}>
              {importing || aiMatching ? '...' : '✦ Загрузить из PDF (ИИ)'}
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
                      <td style={{ ...tdStyle, textAlign: 'center', color: C.muted, fontFamily: FONT, fontSize: 12, width: 32 }}>{i + 1}</td>

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
                          <span style={{ display: 'block', fontFamily: FONT, fontSize: 10, color: C.brand, marginTop: 2 }}>из каталога</span>
                        )}
                        {l.source === 'ai_not_found' && (
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            fontFamily: FONT, fontSize: 10, color: C.warning,
                            background: C.warningSoft, borderRadius: 4,
                            padding: '1px 6px', marginTop: 3,
                          }}>
                            не найдено — укажите цену
                          </span>
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
                          <span style={{ fontSize: 13, fontFamily: FONT }}>{money(l.price)}</span>
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
                          <span style={{ fontSize: 13, fontFamily: FONT }}>{money(l.price_vat)}</span>
                        )}
                      </td>

                      {/* Сумма без НДС */}
                      <td style={{ ...tdStyle, width: 120, textAlign: 'right', fontWeight: 600, fontFamily: FONT, fontSize: 13 }}>
                        {money(l.sum)}
                      </td>

                      {/* Сумма с НДС */}
                      <td style={{ ...tdStyle, width: 120, textAlign: 'right', fontWeight: 700, color: C.action, fontFamily: FONT, fontSize: 13 }}>
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
          {lines.length > 0 && <button onClick={exportToExcel} style={btnGhost}>Скачать Excel</button>}
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
