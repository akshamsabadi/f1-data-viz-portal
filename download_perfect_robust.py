import urllib.request
import json
import time
import os

os.makedirs("f1-data-viz-portal/src/assets/logos", exist_ok=True)

# Using exact Wikipedia/Commons file titles for the clean minimalist emblems where possible,
# and official full logos as fallback.
files = {
    "mercedes": "Mercedes-Benz_Star_2022.svg",
    "mclaren": "McLaren_Racing_logo.svg",
    "ferrari": "Scuderia_Ferrari_HP_logo_24.svg",
    "alpine": "Alpine_F1_Team_Logo.svg",
    "redbull": "Red_Bull_Racing_-_2021_Logo.svg", # Clean bull logo
    "rbf1": "Toro_Rosso_logo.svg", # Toro Rosso charging bull
    "haas": "MoneyGram_Haas_F1_Team_Logo.svg",
    "audi": "Audi-Logo_2016.svg",
    "williams": "Williams_Racing_2020_logo.svg",
    "cadillac": "Cadillac_emblem_2021.svg",
    "astonmartin": "Aston_Martin_Aramco_Cognizant_F1.svg"
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36"
}

def get_image_url(fname):
    for site in ["en.wikipedia.org", "commons.wikimedia.org"]:
        api_url = f"https://{site}/w/api.php?action=query&titles=File:{urllib.parse.quote(fname)}&prop=imageinfo&iiprop=url&format=json"
        try:
            req = urllib.request.Request(api_url, headers=headers)
            resp = urllib.request.urlopen(req)
            data = json.loads(resp.read())
            pages = data['query']['pages']
            for pid in pages:
                if 'imageinfo' in pages[pid]:
                    return pages[pid]['imageinfo'][0]['url']
        except Exception as e:
            if "429" in str(e):
                print("Rate limited. Sleeping 10s...")
                time.sleep(10)
    return None

for team, fname in files.items():
    print(f"Resolving {team}...")
    img_url = None
    for attempt in range(3):
        img_url = get_image_url(fname)
        if img_url:
            break
        print(f"Waiting to retry resolving {team}...")
        time.sleep(5)
        
    if img_url:
        print(f"Downloading {team} from {img_url}...")
        downloaded = False
        for attempt in range(3):
            try:
                req = urllib.request.Request(img_url, headers=headers)
                svg_data = urllib.request.urlopen(req).read()
                
                # Check if we accidentally downloaded HTML
                content_str = svg_data.decode('utf-8', errors='ignore')
                if "<html" in content_str.lower() or "<!doctype" in content_str.lower():
                    print(f"Error: Downloaded HTML instead of SVG for {team}. Retrying...")
                    time.sleep(5)
                    continue
                    
                with open(f"f1-data-viz-portal/src/assets/logos/{team}.svg", "wb") as f:
                    f.write(svg_data)
                print(f"Successfully saved {team}.svg")
                downloaded = True
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"Rate limited. Retrying {team} in 10s...")
                    time.sleep(10)
                else:
                    print(f"HTTP Error {e.code} for {team}")
                    break
            except Exception as e:
                print(f"Error for {team}: {e}")
                break
        if not downloaded:
            print(f"Failed {team}")
    else:
        print(f"Could not resolve URL for {team}")
        
    time.sleep(3)
