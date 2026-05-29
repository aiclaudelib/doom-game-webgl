import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import App from '~/App'

describe('App', () => {
  it('mounts the canvas-hosted Doom game without crashing', () => {
    // Under jsdom there is no WebGL/2D context, so the engine must stay idle rather than throw.
    const { container, unmount } = render(<App />)
    expect(container.querySelector('canvas')).not.toBeNull()
    unmount()
  })
})
