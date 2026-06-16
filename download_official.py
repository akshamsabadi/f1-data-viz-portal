import urllib.request
import json
import time
import os

os.makedirs("f1-data-viz-portal/src/assets/logos", exist_ok=True)

files = {
    "ferrari": "Scuderia_Ferrari_Logo.svg",
    "redbull": "Red_Bull_Racing_logo.svg",
    "rbf1": "Visa_Cash_App_RB_F1_Team_logo.svg",
    "audi": "Audi-Logo_2016.svg",
    "williams": "Williams_Racing_2020_logo.svg",
    "cadillac": "Cadillac_emblem_2021.svg",
    "astonmartin": "Aston_Martin_Aramco_Cognizant_F1.svg"
}

headers = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8"
}

for team, fname in files.items():
    urls_to_try = [
        f"https://en.wikipedia.org/w/api.php?action=query&titles=File:{fname}&prop=imageinfo&iiprop=url&format=json",
        f"https://commons.wikimedia.org/w/api.php?action=query&titles=File:{fname}&prop=imageinfo&iiprop=url&format=json"
    ]
    img_url = None
    for api_url in urls_to_try:
        try:
            req = urllib.request.Request(api_url, headers=headers)
            data = json.loads(urllib.request.urlopen(req).read())
            pages = data['query']['pages']
            for pid in pages:
                if 'imageinfo' in pages[pid]:
                    img_url = pages[pid]['imageinfo'][0]['url']
                    break
        except Exception as e:
            pass
        if img_url:
            break
            
    if img_url:
        print(f"Found URL for {team}: {img_url}")
        try:
            req = urllib.request.Request(img_url, headers=headers)
            img_data = urllib.request.urlopen(req).read()
            with open(f"f1-data-viz-portal/src/assets/logos/{team}.svg", "wb") as f:
                f.write(img_data)
            print(f"Downloaded {team}")
        except Exception as e:
            print(f"Failed to download {team}: {e}")
    else:
        print(f"Could not resolve API for {team}")
        
    time.sleep(1)
