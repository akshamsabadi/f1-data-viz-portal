import fastf1
import pandas as pd
import json
import argparse
import os
import logging

# Configure FastF1 logging
fastf1.Cache.offline_mode = False

def fetch_race_data(year, gp):
    # Set up cache
    cache_dir = os.path.join(os.path.dirname(__file__), 'cache')
    os.makedirs(cache_dir, exist_ok=True)
    fastf1.Cache.enable_cache(cache_dir)
    
    print(f"Loading session data for {year} {gp}...")
    session = fastf1.get_session(year, gp, 'R')
    
    try:
        session.load(telemetry=False, weather=False)
    except Exception as e:
        print(f"Warning: Failed to fully load session data: {e}")
    
    # Extract Race Info safely
    try:
        event_name = session.event.EventName
    except Exception:
        event_name = str(gp)
        
    try:
        total_laps = int(session.total_laps) if pd.notna(session.total_laps) else 0
    except fastf1.exceptions.DataNotLoadedError:
        total_laps = 0

    try:
        winner = session.results.iloc[0]['Abbreviation'] if not session.results.empty else None
    except Exception:
        winner = None

    race_info = {
        "year": year,
        "gp": event_name,
        "total_laps": total_laps,
        "winner": winner
    }
    
    # Extract Drivers safely
    drivers = []
    try:
        if not session.results.empty:
            for _, driver in session.results.iterrows():
                drivers.append({
                    "code": str(driver['Abbreviation']),
                    "name": str(driver['FullName']),
                    "team": str(driver['TeamName']),
                    "color": f"#{driver['TeamColor']}" if pd.notna(driver['TeamColor']) and str(driver['TeamColor']) != '' else "#ffffff"
                })
    except Exception:
        print("Warning: Driver data not loaded.")
        
    # Extract Session Events (Placeholder)
    session_events = []
    
    # Extract Laps safely
    laps_data = []
    try:
        laps = session.laps
        print("Processing laps...")
        if not laps.empty:
            for _, lap in laps.iterrows():
                if pd.isna(lap['LapTime']):
                    continue
                    
                driver_code = str(lap['Driver'])
                lap_num = int(lap['LapNumber'])
                lap_time_sec = lap['LapTime'].total_seconds()
                
                compound = str(lap['Compound']) if pd.notna(lap['Compound']) else "UNKNOWN"
                tyre_life = int(lap['TyreLife']) if pd.notna(lap['TyreLife']) else 1
                position = int(lap['Position']) if pd.notna(lap['Position']) else None
                
                session_time = lap['Time'].total_seconds() if pd.notna(lap['Time']) else None
                
                laps_data.append({
                    "driver": driver_code,
                    "lap": lap_num,
                    "time": round(lap_time_sec, 3),
                    "compound": compound,
                    "tyre_life": tyre_life,
                    "position": position,
                    "session_time": round(session_time, 3) if session_time else None
                })
    except Exception:
        print("Warning: Lap data not loaded.")
        
    payload = {
        "race_info": race_info,
        "drivers": drivers,
        "session_events": session_events,
        "laps": laps_data
    }
    
    return payload

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Fetch F1 race data and export to JSON")
    parser.add_argument("--year", type=int, required=True, help="Season year (e.g., 2026)")
    parser.add_argument("--gp", type=str, required=True, help="Grand Prix name or round number (e.g., 'Bahrain' or 1)")
    parser.add_argument("--out", type=str, default="race_data.json", help="Output JSON file path")
    args = parser.parse_args()
    
    try:
        gp_param = int(args.gp)
    except ValueError:
        gp_param = args.gp
        
    data = fetch_race_data(args.year, gp_param)
    
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    
    print(f"Saving data to {args.out}...")
    with open(args.out, 'w') as f:
        json.dump(data, f, indent=2)
        
    print(f"Data successfully saved to {args.out}")