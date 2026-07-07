import json

with open('public/中国_市.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

cities = [{"name": feat['properties']['name'], "gb": feat['properties']['gb']} for feat in data['features']]

with open('public/市列表.json', 'w', encoding='utf-8') as f:
    json.dump(cities, f, ensure_ascii=False, indent=2)

print(f'Done! {len(cities)} cities written to public/市列表.json')
