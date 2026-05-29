import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '~/App'

describe('App', () => {
  it('renders a top-level heading without crashing', () => {
    const { getByRole, unmount } = render(<App />)
    expect(getByRole('heading', { level: 1 }).textContent).toContain('It works')
    unmount()
  })
})
