"""将种子数据中的 industry/food 乘以 10，fort 乘以 20，推进到 0-100 制。"""
import json
import os

SEED_DIR = os.path.join(os.path.dirname(__file__), '..', 'apps', 'web', 'src', 'data')

FILES = [
    'chinaCities.seed.json',
    'chinaCities.seed.adjacent.json',
    'worldCountries.seed.json',
]

for filename in FILES:
    path = os.path.join(SEED_DIR, filename)
    with open(path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    for entry in data:
        for key in ('industry', 'food'):
            if key in entry and isinstance(entry[key], (int, float)):
                entry[key] = int(entry[key] * 10)
        if 'fort' in entry and isinstance(entry['fort'], (int, float)):
            entry['fort'] = int(entry['fort'] * 20)

    with open(path, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')

    print(f'OK: {filename} ({len(data)} entries)')

print('Done.')
