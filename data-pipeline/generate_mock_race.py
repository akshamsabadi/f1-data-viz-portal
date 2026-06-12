import json
import random
import os

def generate_mock_race():
    race_info = {
        "year": 2026,
        "gp": "Bahrain Grand Prix",
        "total_laps": 57,
        "winner": "VER"
    }

    drivers_list = [
        {"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#3671C6"},
        {"code": "LAW", "name": "Liam Lawson", "team": "Red Bull", "color": "#3671C6"},
        {"code": "LEC", "name": "Charles Leclerc", "team": "Ferrari", "color": "#E80020"},
        {"code": "HAM", "name": "Lewis Hamilton", "team": "Ferrari", "color": "#E80020"},
        {"code": "RUS", "name": "George Russell", "team": "Mercedes", "color": "#27F4D2"},
        {"code": "ANT", "name": "Kimi Antonelli", "team": "Mercedes", "color": "#27F4D2"},
        {"code": "NOR", "name": "Lando Norris", "team": "McLaren", "color": "#FF8000"},
        {"code": "PIA", "name": "Oscar Piastri", "team": "McLaren", "color": "#FF8000"},
        {"code": "ALO", "name": "Fernando Alonso", "team": "Aston Martin", "color": "#229971"},
        {"code": "STR", "name": "Lance Stroll", "team": "Aston Martin", "color": "#229971"},
        {"code": "HUL", "name": "Nico Hülkenberg", "team": "Audi", "color": "#00E701"},
        {"code": "BOR", "name": "Gabriel Bortoleto", "team": "Audi", "color": "#00E701"},
        {"code": "TSU", "name": "Yuki Tsunoda", "team": "RB", "color": "#6692FF"},
        {"code": "HAD", "name": "Isack Hadjar", "team": "RB", "color": "#6692FF"},
        {"code": "ALB", "name": "Alexander Albon", "team": "Williams", "color": "#005AFF"},
        {"code": "SAI", "name": "Carlos Sainz", "team": "Williams", "color": "#005AFF"},
        {"code": "OCO", "name": "Esteban Ocon", "team": "Haas", "color": "#FFFFFF"},
        {"code": "BEA", "name": "Oliver Bearman", "team": "Haas", "color": "#FFFFFF"},
        {"code": "GAS", "name": "Pierre Gasly", "team": "Alpine", "color": "#FF87BC"},
        {"code": "DOO", "name": "Jack Doohan", "team": "Alpine", "color": "#FF87BC"}
    ]

    laps_data = []
    
    compounds = ["SOFT", "MEDIUM", "HARD"]
    
    # State tracking
    driver_states = {}
    for i, d in enumerate(drivers_list):
        driver_states[d['code']] = {
            "compound": random.choice(compounds),
            "tyre_life": 1,
            "base_pace": 95.0 + (i * 0.15), # VER is fastest, scale pace down slightly
            "total_time": 0
        }

    for lap in range(1, 58):
        # Calculate lap times
        lap_results = []
        for d in drivers_list:
            code = d['code']
            state = driver_states[code]
            
            # Tyre degradation
            deg = state["tyre_life"] * 0.05
            
            # Random variation
            var = random.uniform(-0.5, 1.0)
            
            lap_time = state["base_pace"] + deg + var
            
            # Pitstop simulation
            if state["tyre_life"] > 20 and random.random() > 0.8:
                lap_time += 25.0
                state["compound"] = random.choice(compounds)
                state["tyre_life"] = 1
            else:
                state["tyre_life"] += 1
                
            state["total_time"] += lap_time
            
            lap_results.append({
                "driver": code,
                "time": lap_time,
                "total": state["total_time"],
                "compound": state["compound"],
                "tyre_life": state["tyre_life"]
            })
            
        # Sort by total time to get position
        lap_results.sort(key=lambda x: x["total"])
        
        for pos, res in enumerate(lap_results, 1):
            laps_data.append({
                "driver": res["driver"],
                "lap": lap,
                "time": round(res["time"], 3),
                "compound": res["compound"],
                "tyre_life": res["tyre_life"],
                "position": pos,
                "session_time": round(res["total"], 3)
            })

    payload = {
        "race_info": race_info,
        "drivers": drivers_list,
        "session_events": [],
        "laps": laps_data
    }

    out_path = os.path.join(os.path.dirname(__file__), "..", "src", "assets", "data", "races", "2026", "bahrain.json")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, 'w') as f:
        json.dump(payload, f, indent=2)
    print(f"Mock data saved to {out_path}")

if __name__ == "__main__":
    generate_mock_race()