import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './tank-theme.css'
import App, { ErrorBoundary } from './App.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
