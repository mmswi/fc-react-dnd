import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './app.js'

const container = document.getElementById('root')
if (!container) throw new Error('playground: #root is missing from index.html')

// Every page runs inside StrictMode, so the StrictMode-clean claim is demonstrated rather than
// asserted (perf invariant 8).
createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
