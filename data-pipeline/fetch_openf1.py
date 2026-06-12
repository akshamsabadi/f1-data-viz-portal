import requests
import json
import argparse
import os
import dateutil.parser
import time

def fetch_openf1_data(year, gp_name, out_path):
    print(f"Fetching OpenF1 data for {year} {gp_name}...")
    
    # Get session
    sessions_url = f"https://api.openf1.org/v1/sessions?year={year}&session_name=Race"
    r = requests.get(sessions_url)
    time.sleep(0.4)
    sessions = r.json()
    if isinstance(sessions, dict):
        print(f"API Error for sessions: {sessions}")
        return
        
    # Try to find the right session
    session = None
    for s in sessions:
        if s['country_name'].lower() in gp_name.lower() or s['circuit_short_name'].lower() in gp_name.lower() or gp_name.lower() in s['country_name'].lower():
            session = s
            break
            
    if not session:
        print("Could not find session for", gp_name)
        return
        
    session_key = session['session_key']
    print(f"Found session_key: {session_key}")
    
    # Get drivers
    r = requests.get(f"https://api.openf1.org/v1/drivers?session_key={session_key}")
    time.sleep(0.4)
    drivers_data = r.json()
    if isinstance(drivers_data, dict):
        print(f"API Error for drivers: {drivers_data}")
        return
    
    drivers_dict = {}
    drivers_list = []
    for d in drivers_data:
        # OpenF1 has multiple entries per driver sometimes, use dict to unique
        if d['driver_number'] not in drivers_dict:
            color = d.get('team_colour', 'ffffff')
            if color is None: color = 'ffffff'
            
            drivers_dict[d['driver_number']] = {
                "code": d.get('name_acronym', str(d['driver_number'])),
                "name": d.get('full_name', str(d['driver_number'])),
                "team": d.get('team_name', 'Unknown'),
                "color": f"#{color}"
            }
            drivers_list.append(drivers_dict[d['driver_number']])
            
    # Get Laps
    r = requests.get(f"https://api.openf1.org/v1/laps?session_key={session_key}")
    time.sleep(0.4)
    laps_data = r.json()
    if isinstance(laps_data, dict):
        print(f"API Error for laps: {laps_data}")
        return
    if not laps_data:
        print("No lap data available.")
        return
        
    # Get Stints
    r = requests.get(f"https://api.openf1.org/v1/stints?session_key={session_key}")
    time.sleep(0.4)
    stints_data = r.json()
    if isinstance(stints_data, dict):
        print(f"API Error for stints: {stints_data}")
        stints_data = []
    
    # Helper to find compound
    def get_stint_info(driver_num, lap_num):
        for s in stints_data:
            if s['driver_number'] == driver_num:
                start = s.get('lap_start', 0)
                end = s.get('lap_end', 1000)
                if start <= lap_num <= end:
                    age_at_start = s.get('tyre_age_at_start', 0)
                    tyre_life = (lap_num - start) + age_at_start + 1
                    compound = s.get('compound', 'UNKNOWN')
                    if compound is None: compound = 'UNKNOWN'
                    return compound, tyre_life
        return "UNKNOWN", 1

    # We need to calculate session_time and position
    # Let's track cumulative time per driver
    driver_cumulative = {d: 0.0 for d in drivers_dict.keys()}
    
    # First, sort laps by driver and then by lap_number
    laps_data.sort(key=lambda x: (x['driver_number'], x['lap_number']))
    
    formatted_laps = []
    
    for l in laps_data:
        driver_num = l['driver_number']
        lap_num = l['lap_number']
        lap_time = l.get('lap_duration')
        
        if lap_time is None:
            continue
            
        driver_cumulative[driver_num] += lap_time
        
        compound, tyre_life = get_stint_info(driver_num, lap_num)
        
        driver_info = drivers_dict.get(driver_num)
        if not driver_info:
            continue
            
        formatted_laps.append({
            "driver_num": driver_num, # temp
            "driver": driver_info['code'],
            "lap": lap_num,
            "time": round(lap_time, 3),
            "compound": compound,
            "tyre_life": tyre_life,
            "session_time": round(driver_cumulative[driver_num], 3)
        })
        
    # Group by lap to determine position
    max_lap = max([l['lap'] for l in formatted_laps]) if formatted_laps else 0
    
    final_laps = []
    
    for current_lap in range(1, max_lap + 1):
        lap_group = [l for l in formatted_laps if l['lap'] == current_lap]
        lap_group.sort(key=lambda x: x['session_time'])
        
        for pos, l in enumerate(lap_group, 1):
            l['position'] = pos
            # Remove driver_num
            del l['driver_num']
            final_laps.append(l)

    # Determine winner
    winner = None
    if final_laps:
        last_lap = [l for l in final_laps if l['lap'] == max_lap]
        if last_lap:
            last_lap.sort(key=lambda x: x['position'])
            winner = last_lap[0]['driver']
            
    race_info = {
        "year": year,
        "gp": session['country_name'] + " Grand Prix",
        "total_laps": max_lap,
        "winner": winner
    }

    payload = {
        "race_info": race_info,
        "drivers": drivers_list,
        "session_events": [],
        "laps": final_laps
    }

    os.makedirs(os.path.dirname(os.path.abspath(out_path)), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2)
    print(f"Data saved to {out_path}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--year", type=int, required=True)
    parser.add_argument("--gp", type=str, required=True)
    parser.add_argument("--out", type=str, required=True)
    args = parser.parse_args()
    
    fetch_openf1_data(args.year, args.gp, args.out)