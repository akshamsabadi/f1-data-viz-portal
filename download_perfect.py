import urllib.request
import json
import time
import os

os.makedirs("f1-data-viz-portal/src/assets/logos", exist_ok=True)

# Only resolve files we don't have yet to prevent rate limiting
files = {
    "rbf1": "Toro_Rosso_logo.svg", # Toro Rosso charging bull
    "williams": "Williams_F1_logo.svg", # Blue circular 'W' logo
    "cadillac": "Cadillac_logo.svg", 
    "astonmartin": "Aston_Martin_logo.svg" # Wings emblem
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/115.0"
}

def get_image_url(fname):
    for site in ["commons.wikimedia.org", "en.wikipedia.org"]:
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
                print(f"Rate limited on API {site}. Sleeping 10s...")
                time.sleep(10)
    return None

for team, fname in files.items():
    if os.path.exists(f"f1-data-viz-portal/src/assets/logos/{team}.svg"):
        print(f"Skipping {team} - already exists")
        continue

    print(f"Resolving {team} ({fname})...")
    img_url = None
    for attempt in range(5):
        img_url = get_image_url(fname)
        if img_url:
            break
        print(f"Retry resolving {team} in 10s...")
        time.sleep(10)
        
    if img_url:
        print(f"Downloading {team} from {img_url}...")
        downloaded = False
        for attempt in range(5):
            try:
                req = urllib.request.Request(img_url, headers=headers)
                svg_data = urllib.request.urlopen(req).read()
                with open(f"f1-data-viz-portal/src/assets/logos/{team}.svg", "wb") as f:
                    f.write(svg_data)
                print(f"Successfully saved {team}.svg")
                downloaded = True
                break
            except urllib.error.HTTPError as e:
                if e.code == 429:
                    print(f"429 Rate limited downloading {team}. Retrying in 15s...")
                    time.sleep(15)
                else:
                    print(f"HTTP Error {e.code} downloading {team}.")
                    break
            except Exception as e:
                print(f"Error downloading {team}: {e}")
                break
        if not downloaded:
            print(f"Failed to download {team}")
    else:
        print(f"Could not resolve URL for {team}")
        
    time.sleep(5)
