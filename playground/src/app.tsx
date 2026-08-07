import { useState } from 'react'
import { ComparisonPage } from './comparison-page.js'
import { SortablePage } from './sortable-page.js'
import { TreePage } from './tree-page.js'

const PAGES = {
  sortable: { label: 'Sortable', render: () => <SortablePage /> },
  tree: { label: 'Tree', render: () => <TreePage /> },
  comparison: { label: 'Comparison', render: () => <ComparisonPage /> },
} as const

type PageName = keyof typeof PAGES

export const App = () => {
  const [page, setPage] = useState<PageName>('sortable')

  return (
    <main
      style={{
        font: '15px/1.55 system-ui, sans-serif',
        color: '#0f172a',
        maxWidth: 960,
        margin: '0 auto',
        padding: 24,
      }}
    >
      <h1 style={{ marginTop: 0 }}>fc-react-dnd</h1>

      <nav style={{ display: 'flex', gap: 8, marginBottom: 24 }}>
        {(Object.keys(PAGES) as PageName[]).map((name) => (
          <button
            key={name}
            type="button"
            onClick={() => setPage(name)}
            aria-current={page === name}
            style={{
              padding: '6px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: page === name ? '#0f172a' : '#fff',
              color: page === name ? '#fff' : '#0f172a',
              cursor: 'pointer',
              font: 'inherit',
            }}
          >
            {PAGES[name].label}
          </button>
        ))}
      </nav>

      {PAGES[page].render()}
    </main>
  )
}
