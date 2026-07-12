#!/usr/bin/env python3
"""
build_adjacency.py — 从 GeoJSON 行政边界预计算城市邻接表

方法：对每个城市的 MultiPolygon 做两两几何相交检测。
  - 共享边界（touches）  → 交集为一条线段（length > LEN_TOL）
  - 拓扑重叠（overlaps，数据源误差） → 交集为 Polygon（area > AREA_TOL）
两者均判为"接壤（陆地共享边界）"。海上仅顶点相接不算。

输出：把每个城市的 `adjacent: string[]` 写回种子 JSON 副本（原始字段全部保留）。
邻接是对称的，脚本会强制对称。

依赖：shapely >= 2.0
    pip install shapely

用法：
    python build_adjacency.py \
        --seed    apps/web/src/data/chinaCities.seed.json \
        --geojson apps/web/public/中国_市.geojson \
        --out     apps/web/src/data/chinaCities.seed.adjacent.json
"""
import json
import argparse
from shapely.geometry import shape
from shapely.strtree import STRtree

# ── 可调参数 ──
LEN_TOL = 1e-4   # 度，约 11m。共享边界线段长度低于此值视为"仅顶点相接"，不算接壤
AREA_TOL = 1e-6  # 度²。重叠面积低于此值视为浮点误差，不算接壤
BUFFER = 0.05    # 度，约 5km。空间索引候选检索时的扩张半径（仅缩小候选集，不影响判定）


def load_geojson(path):
    with open(path, encoding='utf-8') as f:
        gj = json.load(f)
    geoms = {}
    for feat in gj['features']:
        gb = feat.get('properties', {}).get('gb')
        if not gb:
            continue
        try:
            g = shape(feat['geometry'])
        except Exception as e:
            print(f"  [warn] 解析 {gb} 几何失败: {e}")
            continue
        geoms[gb] = g
    return geoms


def is_adjacent(a, b):
    try:
        inter = a.intersection(b)
    except Exception:
        return False
    if inter.is_empty:
        return False
    gt = inter.geom_type
    if gt in ('LineString', 'MultiLineString'):
        return inter.length > LEN_TOL
    if gt in ('Polygon', 'MultiPolygon'):
        return inter.area > AREA_TOL
    if gt == 'GeometryCollection':
        for g in inter.geoms:
            if (g.geom_type in ('LineString', 'MultiLineString') and g.length > LEN_TOL) or \
               (g.geom_type in ('Polygon', 'MultiPolygon') and g.area > AREA_TOL):
                return True
    return False


def build(seed_path, geojson_path, out_path):
    with open(seed_path, encoding='utf-8') as f:
        cities = json.load(f)
    geoms = load_geojson(geojson_path)
    print(f"种子城市数: {len(cities)}   GeoJSON 几何数: {len(geoms)}")

    # 仅对种子里有几何的城市建索引
    items = [(c['gb'], geoms[c['gb']]) for c in cities if c.get('gb') in geoms]
    missing = [c.get('gb') for c in cities if c.get('gb') not in geoms]
    if missing:
        print(f"  [warn] {len(missing)} 个种子城市在 GeoJSON 中无几何: "
              f"{missing[:10]}{'...' if len(missing) > 10 else ''}")

    gb_list = [gb for gb, _ in items]
    geom_list = [g for _, g in items]
    tree = STRtree(geom_list)

    adj = {gb: set() for gb in gb_list}
    pairs = 0
    for i, (gb_a, geom_a) in enumerate(items):
        for j in tree.query(geom_a.buffer(BUFFER)):
            j = int(j)
            if j == i:
                continue
            gb_b, geom_b = gb_list[j], geom_list[j]
            if gb_b in adj[gb_a]:
                continue
            if is_adjacent(geom_a, geom_b):
                adj[gb_a].add(gb_b)
                adj[gb_b].add(gb_a)
                pairs += 1

    # 写回：保留原始字段，附加 adjacent（排序便于阅读/diff）
    by_gb = {c['gb']: c for c in cities}
    for gb, neighbors in adj.items():
        by_gb[gb]['adjacent'] = sorted(neighbors)
    for gb in missing:           # 缺几何的城市给空列表，避免运行时 KeyError
        if gb in by_gb:
            by_gb[gb]['adjacent'] = []

    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(cities, f, ensure_ascii=False, indent=2)

    # ── 统计摘要 ──
    degrees = {gb: len(adj[gb]) for gb in gb_list}
    isolated = [gb for gb, d in degrees.items() if d == 0]
    top = sorted(degrees.items(), key=lambda x: -x[1])[:5]
    name_of = {c['gb']: c['name'] for c in cities}
    print(f"\n邻接对总数（无向）: {pairs}")
    print(f"有邻接关系的城市: {sum(1 for d in degrees.values() if d > 0)} / {len(gb_list)}")
    print(f"度数=0（孤岛/沿海/未匹配）: {len(isolated)} -> "
          f"{[name_of.get(g, g) for g in isolated[:15]]}")
    print("邻居最多的城市:")
    for gb, d in top:
        print(f"    {name_of.get(gb, gb)} ({gb}): {d} 个 -> "
              f"{[name_of.get(n, n) for n in sorted(adj[gb])][:8]}")
    print(f"\n已写入: {out_path}")


if __name__ == '__main__':
    ap = argparse.ArgumentParser(description='从 GeoJSON 预计算城市邻接表')
    ap.add_argument('--seed', default='apps/web/src/data/chinaCities.seed.json')
    ap.add_argument('--geojson', default='apps/web/public/中国_市.geojson')
    ap.add_argument('--out', default='apps/web/src/data/chinaCities.seed.adjacent.json')
    args = ap.parse_args()
    build(args.seed, args.geojson, args.out)
