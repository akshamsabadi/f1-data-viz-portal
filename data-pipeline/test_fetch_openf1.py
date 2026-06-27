import unittest
import sys
import os

# Add directory to path to enable import
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from fetch_openf1 import process_laps_data

class TestFetchOpenF1(unittest.TestCase):

    def setUp(self):
        # Sample drivers_dict mapping driver_number to driver info
        self.drivers_dict = {
            1: {"code": "VER", "name": "Max Verstappen", "team": "Red Bull", "color": "#ffffff"},
            44: {"code": "HAM", "name": "Lewis Hamilton", "team": "Mercedes", "color": "#ffffff"},
        }
        # Mock stints data
        self.stints_data = [
            {"driver_number": 1, "lap_start": 1, "lap_end": 10, "tyre_age_at_start": 0, "compound": "SOFT"},
            {"driver_number": 44, "lap_start": 1, "lap_end": 10, "tyre_age_at_start": 0, "compound": "MEDIUM"},
        ]

    def test_normal_laps(self):
        # Normal session with no gaps
        laps_data = [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 1, "lap_number": 2, "lap_duration": 91.0},
            {"driver_number": 44, "lap_number": 1, "lap_duration": 92.0},
            {"driver_number": 44, "lap_number": 2, "lap_duration": 89.0},
        ]
        
        final_laps, max_lap = process_laps_data(laps_data, self.drivers_dict, self.stints_data)
        self.assertEqual(max_lap, 2)
        self.assertEqual(len(final_laps), 4)
        
        # Verify lap 1 ordering: VER (90.0) first, HAM (92.0) second
        lap1 = [l for l in final_laps if l['lap'] == 1]
        lap1.sort(key=lambda x: x['position'])
        self.assertEqual(lap1[0]['driver'], "VER")
        self.assertEqual(lap1[0]['position'], 1)
        self.assertEqual(lap1[0]['session_time'], 90.0)
        
        self.assertEqual(lap1[1]['driver'], "HAM")
        self.assertEqual(lap1[1]['position'], 2)
        self.assertEqual(lap1[1]['session_time'], 92.0)
        
        # Verify lap 2 times: HAM (92 + 89 = 181.0), VER (90 + 91 = 181.0)
        lap2_ver = next(l for l in final_laps if l['lap'] == 2 and l['driver'] == "VER")
        lap2_ham = next(l for l in final_laps if l['lap'] == 2 and l['driver'] == "HAM")
        self.assertEqual(lap2_ver['session_time'], 181.0)
        self.assertEqual(lap2_ham['session_time'], 181.0)

    def test_missing_lap_duration_interpolation(self):
        # HAM has a null lap duration on lap 2, preceding is lap 1 (90.0), succeeding is lap 3 (92.0)
        # Linear interpolation should set lap 2 duration to 91.0
        laps_data = [
            {"driver_number": 44, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 44, "lap_number": 2, "lap_duration": None},
            {"driver_number": 44, "lap_number": 3, "lap_duration": 92.0},
        ]
        
        final_laps, max_lap = process_laps_data(laps_data, self.drivers_dict, self.stints_data)
        self.assertEqual(max_lap, 3)
        
        lap2 = next(l for l in final_laps if l['lap'] == 2)
        self.assertTrue(lap2['interpolated'])
        self.assertEqual(lap2['time'], 91.0)
        self.assertEqual(lap2['session_time'], 181.0) # 90 + 91

    def test_missing_lap_number_interpolation(self):
        # VER is missing lap 2 completely in laps_data list, preceding is 1 (90.0), succeeding is 3 (94.0)
        # Linear interpolation should set lap 2 duration to 92.0
        laps_data = [
            {"driver_number": 1, "lap_number": 1, "lap_duration": 90.0},
            {"driver_number": 1, "lap_number": 3, "lap_duration": 94.0},
        ]
        
        final_laps, max_lap = process_laps_data(laps_data, self.drivers_dict, self.stints_data)
        self.assertEqual(max_lap, 3)
        
        lap2 = next(l for l in final_laps if l['lap'] == 2)
        self.assertTrue(lap2['interpolated'])
        self.assertEqual(lap2['time'], 92.0)
        self.assertEqual(lap2['session_time'], 182.0) # 90 + 92

    def test_extrapolation_scenarios(self):
        # HAM has lap 2 (91.0) and lap 3 (92.0), but lap 1 is missing (backward-extrapolate -> 91.0)
        # VER has lap 1 (88.0) and lap 2 (89.0), but lap 3 is missing (forward-extrapolate -> 89.0)
        laps_data = [
            {"driver_number": 44, "lap_number": 2, "lap_duration": 91.0},
            {"driver_number": 44, "lap_number": 3, "lap_duration": 92.0},
            {"driver_number": 1, "lap_number": 1, "lap_duration": 88.0},
            {"driver_number": 1, "lap_number": 2, "lap_duration": 89.0},
            {"driver_number": 1, "lap_number": 3, "lap_duration": None},
        ]
        
        final_laps, max_lap = process_laps_data(laps_data, self.drivers_dict, self.stints_data)
        self.assertEqual(max_lap, 3)
        
        # HAM lap 1 (backward extrapolated to 91.0)
        ham_lap1 = next(l for l in final_laps if l['lap'] == 1 and l['driver'] == "HAM")
        self.assertTrue(ham_lap1['interpolated'])
        self.assertEqual(ham_lap1['time'], 91.0)
        
        # VER lap 3 (forward extrapolated to 89.0)
        ver_lap3 = next(l for l in final_laps if l['lap'] == 3 and l['driver'] == "VER")
        self.assertTrue(ver_lap3['interpolated'])
        self.assertEqual(ver_lap3['time'], 89.0)

if __name__ == '__main__':
    unittest.main()
