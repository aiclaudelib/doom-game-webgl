import { DoomGame } from '~/doom/DoomGame'

// React is only the host: the entire game — menu, HUD, and 3D world — is drawn inside the canvas.
export default function App() {
  return <DoomGame />
}
