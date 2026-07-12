import json

SEED = r"D:/work/map-war/apps/web/src/data/chinaCities.seed.json"

# 势力 -> (史料总兵力 k, 基础士气 0-100, 首都含名[用于加权/士气加成])
FACTION = {
    "KMT": (1700, 58, ["南京"]),
    "CCP": (40,   85, ["瑞金"]),
    "JPN": (20,   80, ["台湾"]),
    "NEA": (300,  50, ["沈阳"]),
    "SHX": (150,  62, ["太原"]),
    "GXC": (100,  78, ["南宁"]),
    "SCC": (300,  45, ["成都", "重庆"]),
    "MA":  (50,   75, ["西宁"]),
    "XJ":  (15,   40, ["乌鲁木齐", "迪化"]),
    "TIB": (10,   55, ["拉萨"]),
}

def clamp(v, lo, hi):
    return max(lo, min(hi, v))

with open(SEED, encoding="utf-8") as f:
    cities = json.load(f)

groups = {f: [] for f in FACTION}
for c in cities:
    owner = c.get("owner") or "NEUTRAL"
    if owner in FACTION:
        lvl = c.get("cityLevel") or 1
        ind = max(c.get("industry") or 1, 1)
        w = lvl * ind
        if any(cs in (c.get("name") or "") for cs in FACTION[owner][2]):
            w *= 2
        groups[owner].append((c, w))

for f, (total_k, base, caps) in FACTION.items():
    lst = groups[f]
    if not lst:
        continue
    sw = sum(w for _, w in lst)
    raw = []
    for c, w in lst:
        val = total_k * w / sw
        raw.append([c, w, val, int(val)])
    rem = total_k - sum(r[3] for r in raw)
    order = sorted(range(len(raw)), key=lambda i: raw[i][2] - raw[i][3], reverse=True)
    for i in range(rem):
        raw[order[i % len(order)]][3] += 1
    for c, w, val, troops in raw:
        troops = max(troops, 0)  # 小城可无兵（贴合"防务空虚"）
        is_cap = any(cs in (c.get("name") or "") for cs in caps)
        lvl = c.get("cityLevel") or 1
        morale = clamp(base + (8 if is_cap else 0) + (lvl - 3) * 3, 20, 100)
        c["troops"] = troops
        c["morale"] = int(morale)

# 中立/无主城市：按城防等级给少量驻军
for c in cities:
    owner = c.get("owner") or "NEUTRAL"
    if owner not in FACTION:
        lvl = c.get("cityLevel") or 1
        fort = c.get("fort") or 0
        c["troops"] = max(lvl * 4 + fort * 2, 1)
        c["morale"] = int(clamp(50 + (lvl - 3) * 2, 20, 100))

with open(SEED, "w", encoding="utf-8") as f:
    json.dump(cities, f, ensure_ascii=False, indent=2)
    f.write("\n")

print("=== 各势力兵力(k) / 城市数 / 平均士气 ===")
for f in FACTION:
    cs = [c for c in cities if (c.get("owner") or "NEUTRAL") == f]
    t = sum(c.get("troops", 0) for c in cs)
    m = sum(c.get("morale", 0) for c in cs) / max(len(cs), 1)
    print(f"{f:8} troops={t:5}k  cities={len(cs):3}  morale_avg={m:5.1f}")
cs = [c for c in cities if (c.get("owner") or "NEUTRAL") not in FACTION]
print(f"{'NEUTRAL':8} troops={sum(c.get('troops',0) for c in cs):5}k  cities={len(cs):3}")
print(f"总计城市={len(cities)}")
