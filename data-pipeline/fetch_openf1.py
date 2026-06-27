import requests
import json
import argparse
import os
import dateutil.parser
import time

def process_laps_data(laps_data, drivers_dict, stints_data):
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

    # Group raw laps by driver to identify and interpolate gaps
    from collections import defaultdict
    driver_raw_laps = defaultdict(list)
    for l in laps_data:
        driver_raw_laps[l['driver_number']].append(l)
        
    formatted_laps = []
    
    # Calculate global driver averages for fallback
    driver_averages = {}
    for d_num, laps in driver_raw_laps.items():
        valid_times = [l.get('lap_duration') for l in laps if l.get('lap_duration') is not None]
        if valid_times:
            driver_averages[d_num] = sum(valid_times) / len(valid_times)
        else:
            driver_averages[d_num] = 90.0 # general fallback
            
    # Calculate average per lap number across all drivers
    lap_averages = defaultdict(list)
    for l in laps_data:
        if l.get('lap_duration') is not None:
            lap_averages[l['lap_number']].append(l['lap_duration'])
            
    lap_average_times = {}
    for lap_num, times in lap_averages.items():
        lap_average_times[lap_num] = sum(times) / len(times)

    for driver_num, raw_laps in driver_raw_laps.items():
        if not raw_laps:
            continue
            
        raw_laps.sort(key=lambda x: x['lap_number'])
        max_driver_lap = raw_laps[-1]['lap_number']
        
        # Dictionary of valid lap times for quick lookup
        valid_laps = {l['lap_number']: l['lap_duration'] for l in raw_laps if l.get('lap_duration') is not None}
        valid_lap_nums = sorted(valid_laps.keys())
        
        cumulative_time = 0.0
        driver_info = drivers_dict.get(driver_num)
        if not driver_info:
            continue
            
        for lap_num in range(1, max_driver_lap + 1):
            compound, tyre_life = get_stint_info(driver_num, lap_num)
            
            is_interpolated = False
            if lap_num in valid_laps:
                lap_time = valid_laps[lap_num]
            else:
                is_interpolated = True
                # Find preceding and succeeding valid laps
                preceding = [n for n in valid_lap_nums if n < lap_num]
                succeeding = [n for n in valid_lap_nums if n > lap_num]
                
                if preceding and succeeding:
                    # Linear Interpolation
                    p = preceding[-1]
                    s = succeeding[0]
                    t_p = valid_laps[p]
                    t_s = valid_laps[s]
                    lap_time = t_p + (t_s - t_p) * (lap_num - p) / (s - p)
                elif preceding:
                    # Forward-extrapolate (use last valid lap time)
                    lap_time = valid_laps[preceding[-1]]
                elif succeeding:
                    # Backward-extrapolate (use first valid lap time)
                    lap_time = valid_laps[succeeding[0]]
                else:
                    # Fallback to lap average or driver average
                    lap_time = lap_average_times.get(lap_num, driver_averages.get(driver_num, 90.0))
            
            cumulative_time += lap_time
            
            formatted_laps.append({
                "driver_num": driver_num,
                "driver": driver_info['code'],
                "lap": lap_num,
                "time": round(lap_time, 3),
                "compound": compound,
                "tyre_life": tyre_life,
                "session_time": round(cumulative_time, 3),
                "interpolated": is_interpolated
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

    return final_laps, max_lap

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
    
    final_laps, max_lap = process_laps_data(laps_data, drivers_dict, stints_data)

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