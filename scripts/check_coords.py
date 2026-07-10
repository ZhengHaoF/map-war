import json

with open('public/中国_市.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

targets = ['重庆市', '柳州市']
for feat in data['features']:
    if feat['properties']['name'] in targets:
        print(f"{feat['properties']['name']}: gb={feat['properties']['gb']}, geometry type={feat['geometry']['type']}")
        coords = feat['geometry']['coordinates']
        if feat['geometry']['type'] == 'Polygon':
            print(f"  first coord: {coords[0][0]}")
        elif feat['geometry']['type'] == 'MultiPolygon':
            print(f"  first coord: {coords[0][0][0]}")
