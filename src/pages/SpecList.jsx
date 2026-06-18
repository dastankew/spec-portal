import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../supabase.js'
import { C, FONT, MONO, money, fmtDate } from '../constants.js'

export default function SpecList() {
  const navigate = useNavigate()
  const [specs, setSpecs]     = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState('')
  const [deleting, setDeleting] = useState(null)

  const load = () => {
    setLoading(true)
    supabase
      .from('specifications')
      .select('id, title, description, total_no_vat, total_vat, lines_count, created_at, updated_at')
      .order('created_at', { ascending: false })
      .then(({ data, error }) => {
        if (error) setError('Не удалось загрузить список: ' + error.message)
        else setSpecs(data || [])
        setLoading(false)
      })
  }

  useEffect(load, [])

  const deleteSpec = async (id) => {
    if (!confirm('Удалить спецификацию? Это действие необратимо.')) return
    setDeleting(id)
    await supabase.from('spec_lines').delete().eq('spec_id', id)
    await supabase.from('specifications').delete().eq('id', id)
    setSpecs((s) => s.filter((x) => x.id !== id))
    setDeleting(null)
  }

  return (
    <div style={{ minHeight: '100vh', background: C.page, fontFamily: FONT, color: C.ink }}>
      <div style={{ height: 4, background: `linear-gradient(90deg, ${C.brand}, ${C.action})` }} />

      {/* Шапка */}
      <div style={{ background: C.surface, borderBottom: `1px solid ${C.line}`, padding: '0 24px' }}>
        <div style={{ maxWidth: 900, margin: '0 auto', display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 60 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ fontFamily: MONO, fontSize: 11, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: C.brand }}>SPEC PORTAL</span>
            <span style={{ color: C.lineDark }}>|</span>
            <span style={{ fontWeight: 700, fontSize: 15 }}>Спецификации</span>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button onClick={() => navigate('/catalog')} style={btnGhost}>Справочник цен</button>
            <button onClick={() => navigate('/spec/new')} style={btnPrimary}>+ Новая спецификация</button>
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 900, margin: '0 auto', padding: '28px 24px' }}>
        {error && <div style={{ color: C.danger, marginBottom: 16, padding: '10px 14px', background: C.dangerSoft, borderRadius: 8 }}>{error}</div>}

        {loading ? (
          <div style={{ color: C.muted, textAlign: 'center', padding: 60 }}>Загрузка...</div>
        ) : specs.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0', color: C.muted }}>
            <div style={{ fontSize: 15, marginBottom: 14 }}>Спецификаций пока нет</div>
            <button onClick={() => navigate('/spec/new')} style={btnPrimary}>Создать первую</button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {specs.map((s) => (
              <div key={s.id} style={cardStyle} onClick={() => navigate(`/spec/${s.id}`)}>
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 3 }}>{s.title}</div>
                    {s.description && (
                      <div style={{ color: C.muted, fontSize: 13, marginBottom: 6, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description}</div>
                    )}
                    <div style={{ display: 'flex', gap: 16, color: C.dim, fontSize: 12, fontFamily: MONO }}>
                      <span>{fmtDate(s.created_at)}</span>
                      {s.lines_count != null && <span>{s.lines_count} позиций</span>}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    {s.total_vat != null && (
                      <div style={{ fontWeight: 800, fontSize: 16, color: C.action }}>{money(s.total_vat)}</div>
                    )}
                    {s.total_no_vat != null && (
                      <div style={{ fontSize: 12, color: C.muted }}>без НДС: {money(s.total_no_vat)}</div>
                    )}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteSpec(s.id) }}
                      disabled={deleting === s.id}
                      style={{ ...btnDanger, marginTop: 6 }}
                    >
                      {deleting === s.id ? '...' : 'Удалить'}
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
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
const btnDanger = {
  background: 'transparent', color: C.danger, border: `1px solid ${C.danger}`, borderRadius: 6,
  padding: '4px 10px', fontSize: 12, cursor: 'pointer', fontFamily: FONT,
}
const cardStyle = {
  background: C.surface, borderRadius: 12, border: `1px solid ${C.line}`,
  padding: '16px 20px', cursor: 'pointer',
  boxShadow: '0 1px 3px rgba(16,24,40,0.06)',
  transition: 'box-shadow 0.15s',
}
