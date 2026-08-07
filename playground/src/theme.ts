import type { CSSProperties } from 'react'

export const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 6,
  background: '#fff',
  font: 'inherit',
  textAlign: 'left',
  width: '100%',
  cursor: 'grab',
}

export const listStyle: CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  display: 'grid',
  gap: 6,
  maxWidth: 420,
}

export const panelStyle: CSSProperties = {
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: 16,
  background: '#f8fafc',
}
