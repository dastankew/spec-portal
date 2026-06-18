import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { FONT } from './constants.js'

const root = document.getElementById('root')
root.style.cssText = 'margin:0;padding:0'
document.body.style.cssText = `margin:0;padding:0;background:#EEF1F5;font-family:${FONT}`
document.documentElement.style.cssText = 'margin:0;padding:0'

createRoot(root).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
