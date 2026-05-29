import { describe, expect, it } from 'vitest'
import {
  add,
  clone,
  dist,
  dot,
  fromAngle,
  length,
  normalize,
  rotate,
  scale,
  sub,
  vec,
} from '~/doom/core/vec'

describe('vec', () => {
  it('constructs a Vec2 from components', () => {
    expect(vec(3, -4)).toEqual({ x: 3, y: -4 })
  })

  it('adds and subtracts componentwise', () => {
    expect(add(vec(1, 2), vec(3, 4))).toEqual({ x: 4, y: 6 })
    expect(sub(vec(5, 7), vec(2, 3))).toEqual({ x: 3, y: 4 })
  })

  it('scales by a scalar', () => {
    expect(scale(vec(2, -3), 4)).toEqual({ x: 8, y: -12 })
  })

  it('computes the dot product', () => {
    expect(dot(vec(1, 0), vec(0, 1))).toBe(0)
    expect(dot(vec(2, 3), vec(4, 5))).toBe(23)
  })

  it('computes length and distance', () => {
    expect(length(vec(3, 4))).toBe(5)
    expect(dist(vec(1, 1), vec(4, 5))).toBe(5)
  })

  it('normalizes to a unit vector', () => {
    const n = normalize(vec(0, 8))
    expect(n).toEqual({ x: 0, y: 1 })
    expect(length(normalize(vec(3, 4)))).toBeCloseTo(1, 12)
  })

  it('returns the zero vector when normalizing a zero vector', () => {
    expect(normalize(vec(0, 0))).toEqual({ x: 0, y: 0 })
  })

  it('rotates a vector by an angle', () => {
    const r = rotate(vec(1, 0), Math.PI / 2)
    expect(r.x).toBeCloseTo(0, 12)
    expect(r.y).toBeCloseTo(1, 12)
  })

  it('rotates back to the original after a full turn', () => {
    const r = rotate(vec(2, -5), Math.PI * 2)
    expect(r.x).toBeCloseTo(2, 12)
    expect(r.y).toBeCloseTo(-5, 12)
  })

  it('builds a vector from an angle with default unit length', () => {
    const v = fromAngle(0)
    expect(v.x).toBeCloseTo(1, 12)
    expect(v.y).toBeCloseTo(0, 12)
    expect(length(fromAngle(1.234))).toBeCloseTo(1, 12)
  })

  it('honours an explicit length argument', () => {
    expect(length(fromAngle(Math.PI / 3, 7))).toBeCloseTo(7, 12)
  })

  it('clones into a distinct object', () => {
    const a = vec(1, 2)
    const c = clone(a)
    expect(c).toEqual(a)
    expect(c).not.toBe(a)
  })
})
