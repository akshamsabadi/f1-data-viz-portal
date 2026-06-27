import os
import sys
import json
import requests

# Ensure imports from parent/sibling modules work
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_openf1 import fetch_openf1_data
from generate_corner_speeds import calculate_corner_speeds

def main():
    print("Starting automated calendar update check...")
    
    # Paths
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    manifest_path = os.path.join(base_dir, "src", "assets", "data", "races_manifest.json")
    
    # Load current manifest
    if not os.path.exists(manifest_path):
        print(f"Error: Manifest not found at {manifest_path}")
        return
        
    with open(manifest_path, 'r') as f:
        manifest = json.load(f)
        
    current_races = manifest.get("races", [])
    registered_ids = {r["id"].lower() for r in current_races}
    
    print(f"Loaded manifest with {len(current_races)} registered races: {list(registered_ids)}")
    
    # Query OpenF1 for completed 2026 races
    api_url = "https://api.openf1.org/v1/sessions?year=2026&session_name=Race"
    print(f"Querying OpenF1 API: {api_url}")
    try:
        r = requests.get(api_url, timeout=15)
    except Exception as e:
        print(f"Network error querying sessions API: {e}")
        return
        
    if r.status_code != 200:
        print(f"API Error (HTTP {r.status_code}): {r.text}")
        return
        
    sessions = r.json()
    if isinstance(sessions, dict) and "detail" in sessions:
        print(f"OpenF1 API restricted or locked: {sessions['detail']}")
        print("This is normal during active live F1 session windows. Exiting gracefully.")
        return
        
    if not isinstance(sessions, list):
        print(f"Unexpected response format from OpenF1: {sessions}")
        return

    print(f"Retrieved {len(sessions)} sessions from OpenF1 API.")
    
    updated = False
    
    for s in sessions:
        country = s.get("country_name")
        circuit = s.get("circuit_short_name")
        session_key = s.get("session_key")
        
        if not country:
            continue
            
        # Standardize ID (e.g. "Spain" -> "spain")
        gp_id = country.lower().replace(" ", "_")
        
        # Skip if already registered in manifest
        if gp_id in registered_ids:
            print(f"GP '{country}' ({gp_id}) is already registered in manifest. Skipping.")
            continue
            
        print(f"\n--- NEW RACE DETECTED! ---")
        print(f"Country: {country} | Circuit: {circuit} | Session Key: {session_key}")
        
        gp_name = f"{country} Grand Prix"
        if "spain" in gp_id or "catalunya" in gp_id:
            gp_name = "Barcelona-Catalunya Grand Prix"
            
        out_filename = f"{gp_id}.json"
        out_path = os.path.join(base_dir, "src", "assets", "data", "races", "2026", out_filename)
        
        # 1. Fetch race data from OpenF1
        print(f"Executing fetch_openf1_data for {gp_name} -> {out_path}...")
        try:
            fetch_openf1_data(2026, country, out_path)
        except Exception as ex:
            print(f"Error fetching data for {gp_name}: {ex}")
            continue
            
        if not os.path.exists(out_path):
            print(f"Error: Generated file {out_path} does not exist after fetch. Skipping manifest register.")
            continue
            
        # 2. Compute corner speeds for the new race file
        print(f"Executing calculate_corner_speeds on {out_path}...")
        try:
            calculate_corner_speeds(out_path)
        except Exception as ex:
            print(f"Error calculating corner speeds: {ex}")
            
        # 3. Append to manifest
        new_race_entry = {
            "year": 2026,
            "id": gp_id,
            "name": gp_name,
            "file": f"races/2026/{out_filename}"
        }
        current_races.append(new_race_entry)
        registered_ids.add(gp_id)
        updated = True
        print(f"Successfully registered {gp_name} in manifest!")
        
    if updated:
        # Save updated manifest
        manifest["races"] = current_races
        with open(manifest_path, 'w') as f:
            json.dump(manifest, f, indent=2)
        print("\nManifest updated and saved successfully.")
    else:
        print("\nNo new races needed to be fetched. Everything is up to date!")

if __name__ == "__main__":
    main()
