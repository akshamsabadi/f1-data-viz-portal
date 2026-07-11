import urllib.request
import os
import shutil

os.makedirs("f1-data-viz-portal/src/assets/logos", exist_ok=True)

# 1. Download Williams, Cadillac, Aston Martin from unpkg (Simple Icons)
teams = ["williams", "cadillac", "astonmartin"]
headers = {"User-Agent": "Mozilla/5.0"}

for team in teams:
    url = f"https://unpkg.com/simple-icons@v13/icons/{team}.svg"
    try:
        req = urllib.request.Request(url, headers=headers)
        data = urllib.request.urlopen(req).read().decode('utf-8')
        
        # force fill="none" and stroke="currentColor"?
        # Actually, let's keep them as original (which is solid shapes). 
        # But we'll force fill to black, wait!
        # Simple Icons SVGs have fill="currentColor" or fill="#XXXXXX".
        # If we put them inside a white circle, they should be black or dark grey so they are visible!
        # Yes! Simple Icons by default has fill="none" or fill="#XXXXXX".
        # Let's see: if we keep the original SVG from simple-icons, they are colored or black. 
        # On a white circular dot, black or colored logos look extremely crisp and readable!
        
        # Let's save them directly.
        with open(f"f1-data-viz-portal/src/assets/logos/{team}.svg", "w") as f:
            f.write(data)
        print(f"Downloaded {team} from Simple Icons")
    except Exception as e:
        print(f"Failed to download {team} from Simple Icons: {e}")

# 2. Copy redbull.svg to rbf1.svg since Racing Bulls and Toro Rosso use the official Red Bull bull silhouette!
try:
    shutil.copy("f1-data-viz-portal/src/assets/logos/redbull.svg", "f1-data-viz-portal/src/assets/logos/rbf1.svg")
    print("Copied redbull.svg to rbf1.svg")
except Exception as e:
    print(f"Failed to copy redbull: {e}")
