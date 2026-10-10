import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { buildCityConnections } from '../../../scripts/build_city_connections.mjs'

const square = (gb: string, x: number, y: number, side = 1) => ({
  type: 'Feature',
  properties: { gb },
  geometry: {
    type: 'Polygon',
    coordinates: [
      [
        [x, y],
        [x + side, y],
        [x + side, y + side],
        [x, y + side],
        [x, y],
      ],
    ],
  },
})
const data = (...features: ReturnType<typeof square>[]) => ({ type: 'FeatureCollection', features })
describe('offline topology generation', () => {
  it('does not turn corner contact into a land connection', () => {
    const graph = buildCityConnections(
      data(square('A', 0, 0), square('B', 1, 0), square('C', 2, 1)),
      [{ gb: 'A' }, { gb: 'B' }, { gb: 'C' }],
    )
    expect(graph.edges.map((e: { from: string; to: string }) => [e.from, e.to])).toEqual([
      ['A', 'B'],
    ])
  })
  it('rejects contact shorter than 100 meters', () => {
    const graph = buildCityConnections(
      data(square('A', 0, 0, 0.0005), square('B', 0.0005, 0, 0.0005)),
      [{ gb: 'A' }, { gb: 'B' }],
    )
    expect(graph.edges).toHaveLength(0)
  })
  it('supports only explicit sea overrides, never automatic nearest-city bridging', () => {
    const geo = data(square('A', 0, 0), square('B', 10, 0))
    const seeds = [{ gb: 'A' }, { gb: 'B' }]
    expect(buildCityConnections(geo, seeds).edges).toHaveLength(0)
    const graph = buildCityConnections(geo, seeds, {
      sea: [{ from: 'A', to: 'B', label: 'test lane' }],
      excludeLand: [],
    })
    expect(graph.edges[0]).toMatchObject({ from: 'A', to: 'B', kind: 'sea' })
  })
  it('fails on missing city geometry and invalid overrides', () => {
    const geo = data(square('A', 0, 0))
    expect(() => buildCityConnections(geo, [{ gb: 'A' }, { gb: 'B' }])).toThrow('Missing city')
    expect(() =>
      buildCityConnections(geo, [{ gb: 'A' }], { sea: [{ from: 'A', to: 'B' }], excludeLand: [] }),
    ).toThrow('Invalid')
  })
  it('regenerates the committed graph deterministically from the current source', () => {
    const parse = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
    const graph = buildCityConnections(
      parse('../public/中国_市.geojson'),
      parse('../src/data/chinaCities.seed.json'),
      parse('../src/data/cityConnections.overrides.json'),
    )
    const saved = parse('../src/data/cityConnections.seed.json')
    expect(graph.nodes).toEqual(saved.nodes)
    expect(graph.edges).toEqual(saved.edges)
  })
})
