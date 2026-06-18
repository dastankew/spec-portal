import { Routes, Route, Navigate } from 'react-router-dom'
import SpecList    from './pages/SpecList.jsx'
import SpecEditor  from './pages/SpecEditor.jsx'
import Catalog     from './pages/Catalog.jsx'
import { supabase } from './supabase.js'

function ConfigError() {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', minHeight: '100vh', fontFamily: 'sans-serif',
      background: '#EEF1F5', padding: 32
    }}>
      <div style={{
        background: '#fff', borderRadius: 12, padding: 40, maxWidth: 520,
        boxShadow: '0 4px 24px rgba(0,0,0,.08)', textAlign: 'center'
      }}>
        <div style={{ fontSize: 48, marginBottom: 16 }}>⚙️</div>
        <h2 style={{ margin: '0 0 12px', color: '#1A1D23' }}>Не настроены переменные окружения</h2>
        <p style={{ color: '#666', lineHeight: 1.6, margin: '0 0 20px' }}>
          Переменная <code style={{ background: '#F4F6F9', padding: '2px 6px', borderRadius: 4 }}>VITE_SUPABASE_URL</code> не задана или некорректна.
        </p>
        <div style={{ background: '#F4F6F9', borderRadius: 8, padding: 16, textAlign: 'left', fontSize: 13, color: '#444' }}>
          <b>Для Vercel:</b><br />
          Settings → Environment Variables → добавьте<br />
          <code>VITE_SUPABASE_URL</code> и <code>VITE_SUPABASE_ANON_KEY</code>,<br />
          затем нажмите <b>Redeploy</b>.
        </div>
      </div>
    </div>
  )
}

export default function App() {
  if (!supabase) return <ConfigError />

  return (
    <Routes>
      <Route path="/"            element={<SpecList />} />
      <Route path="/spec/new"    element={<SpecEditor />} />
      <Route path="/spec/:id"    element={<SpecEditor />} />
      <Route path="/catalog"     element={<Catalog />} />
      <Route path="*"            element={<Navigate to="/" replace />} />
    </Routes>
  )
}
