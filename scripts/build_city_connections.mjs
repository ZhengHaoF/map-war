/**
 * Deterministic game topology derived from shared boundary SEGMENTS, not vertex contact.
 * Explicit sea lanes are game rules, not claims about historical or actual transport.
 * node scripts/build_city_connections.mjs [--check]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
export function buildCityConnections(geo, seed, overrides = { sea: [], excludeLand: [] }) {
  const ids = new Set(seed.filter((c) => c.gb).map((c) => String(c.gb)));
  const nodes = {};
  const segments = new Map();
  const boundary = new Map();
  const edgeKey = (a, b) => [a, b].sort().join("|");

  function center(geometry) {
    let total = 0,
      lng = 0,
      lat = 0;
    const polygons =
      geometry.type === "MultiPolygon" ? geometry.coordinates : [geometry.coordinates];
    for (const [ring] of polygons) {
      let area = 0,
        cx = 0,
        cy = 0;
      for (let i = 1; i < ring.length; i++) {
        const [x0, y0] = ring[i - 1],
          [x1, y1] = ring[i];
        const cross = x0 * y1 - x1 * y0;
        area += cross;
        cx += (x0 + x1) * cross;
        cy += (y0 + y1) * cross;
      }
      area /= 2;
      if (!area) continue;
      const weight = Math.abs(area);
      total += weight;
      lng += (cx / (6 * area)) * weight;
      lat += (cy / (6 * area)) * weight;
    }
    if (!total) throw new Error("Invalid city geometry");
    return [Number((lng / total).toFixed(6)), Number((lat / total).toFixed(6))];
  }
  function km(a, b) {
    const rad = Math.PI / 180;
    const s =
      Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 +
      Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
  }
  for (const f of geo.features) {
    const id = String(f.properties.gb);
    if (!ids.has(id)) continue;
    if (nodes[id]) throw new Error(`Duplicate city ${id}`);
    const [lng, lat] = center(f.geometry);
    nodes[id] = { lng, lat };
    const polygons =
      f.geometry.type === "MultiPolygon" ? f.geometry.coordinates : [f.geometry.coordinates];
    for (const polygon of polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1]
            .slice(0, 2)
            .map((v) => v.toFixed(5))
            .join(",");
          const b = ring[i]
            .slice(0, 2)
            .map((v) => v.toFixed(5))
            .join(",");
          if (a === b) continue;
          const key = edgeKey(a, b);
          const owners = segments.get(key) ?? new Set();
          if (owners.has(id)) continue;
          for (const other of owners) {
            const edge = edgeKey(id, other);
            boundary.set(edge, (boundary.get(edge) ?? 0) + km(ring[i - 1], ring[i]));
          }
          owners.add(id);
          segments.set(key, owners);
        }
  }
  if (Object.keys(nodes).length !== ids.size) throw new Error("Missing city geometry");
  const excluded = new Set(overrides.excludeLand.map(([a, b]) => edgeKey(a, b)));
  const edges = [...boundary]
    .filter(([key, length]) => length >= 0.1 && !excluded.has(key))
    .map(([key]) => {
      const [from, to] = key.split("|");
      return {
        from,
        to,
        kind: "land",
        distanceKm: Number(
          km([nodes[from].lng, nodes[from].lat], [nodes[to].lng, nodes[to].lat]).toFixed(1),
        ),
      };
    });
  const used = new Set(edges.map((e) => edgeKey(e.from, e.to)));
  for (const lane of overrides.sea) {
    if (
      !nodes[lane.from] ||
      !nodes[lane.to] ||
      lane.from === lane.to ||
      used.has(edgeKey(lane.from, lane.to))
    )
      throw new Error("Invalid or duplicate sea lane");
    used.add(edgeKey(lane.from, lane.to));
    edges.push({
      ...lane,
      kind: "sea",
      distanceKm: Number(
        km(
          [nodes[lane.from].lng, nodes[lane.from].lat],
          [nodes[lane.to].lng, nodes[lane.to].lat],
        ).toFixed(1),
      ),
    });
  }
  edges.sort((a, b) => edgeKey(a.from, a.to).localeCompare(edgeKey(b.from, b.to)));
  return {
    version: 1,
    rule: "Shared boundary segments >= 100m at five-decimal precision; sea lanes explicit game overrides.",
    nodes: Object.fromEntries(Object.entries(nodes).sort(([a], [b]) => a.localeCompare(b))),
    edges,
  };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const source = read("apps/web/public/中国_市.geojson");
  const seed = JSON.parse(read("apps/web/src/data/chinaCities.seed.json"));
  const overrides = JSON.parse(read("apps/web/src/data/cityConnections.overrides.json"));
  const built = buildCityConnections(JSON.parse(source), seed, overrides);
  const output =
    JSON.stringify(
      {
        version: built.version,
        sourceSha256: createHash("sha256").update(source).digest("hex"),
        rule: built.rule,
        nodes: built.nodes,
        edges: built.edges,
      },
      null,
      2,
    ) + "\n";
  const target = new URL("../apps/web/src/data/cityConnections.seed.json", import.meta.url);
  if (process.argv.includes("--check")) {
    if (readFileSync(target, "utf8") !== output)
      throw new Error("City topology is stale; rebuild it");
  } else writeFileSync(target, output);
  console.log(
    `${Object.keys(built.nodes).length} cities, ${built.edges.filter((e) => e.kind === "land").length} land edges, ${overrides.sea.length} sea lanes; ${process.argv.includes("--check") ? "checked" : "generated"}`,
  );
}
