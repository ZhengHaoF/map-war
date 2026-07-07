import json

# Read the GeoJSON file
with open('public/中国_县.geojson', 'r', encoding='utf-8') as f:
    data = json.load(f)

# Extract county names
counties = []
for feature in data['features']:
    if 'properties' in feature and 'name' in feature['properties']:
        counties.append(feature['properties']['name'])

# Sort counties alphabetically
counties.sort()

# Write to txt file
with open('public/县列表.txt', 'w', encoding='utf-8') as f:
    for county in counties:
        f.write(county + '\n')

print(f"Extracted {len(counties)} counties to public/县列表.txt")