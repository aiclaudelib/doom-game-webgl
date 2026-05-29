// Standard 2D vector operations on the shared Vec2 contract. Pure leaf.

import type { Vec2 } from '~/doom/types'

export function vec(x: number, y: number): Vec2 {
  return { x, y }
}

export function add(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y }
}

export function sub(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x - b.x, y: a.y - b.y }
}

export function scale(a: Vec2, s: number): Vec2 {
  return { x: a.x * s, y: a.y * s }
}

export function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y
}

export function length(a: Vec2): number {
  return Math.hypot(a.x, a.y)
}

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

export function normalize(a: Vec2): Vec2 {
  const len = Math.hypot(a.x, a.y)
  if (len === 0) return { x: 0, y: 0 }
  return { x: a.x / len, y: a.y / len }
}

export function rotate(a: Vec2, radians: number): Vec2 {
  const c = Math.cos(radians)
  const s = Math.sin(radians)
  return { x: a.x * c - a.y * s, y: a.x * s + a.y * c }
}

export function fromAngle(radians: number, len = 1): Vec2 {
  return { x: Math.cos(radians) * len, y: Math.sin(radians) * len }
}

export function clone(a: Vec2): Vec2 {
  return { x: a.x, y: a.y }
}
