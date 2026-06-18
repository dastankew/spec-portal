import { Routes, Route, Navigate } from 'react-router-dom'
import SpecList    from './pages/SpecList.jsx'
import SpecEditor  from './pages/SpecEditor.jsx'
import Catalog     from './pages/Catalog.jsx'

export default function App() {
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
