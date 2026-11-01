"""
Builds the LARGE 6G_Datasets set.
  python build_large_datasets.py            -> downloads full TLE catalogs (needs internet) + generates TEC/trajectories
  python build_large_datasets.py --offline  -> only generates TEC/trajectories
"""
import sys, math, pathlib, urllib.request
import numpy as np

OUT = pathlib.Path(__file__).parent
T0 = 1792000000.0          # start epoch (UTC seconds); change to match your TLE epoch
rng = np.random.default_rng(42)

# ---------- 1. TLE catalogs (CelesTrak) ----------
TLE_SETS = {
    "navic_constellation.tle": "irnss", "gps_constellation.tle": "gps-ops",
    "galileo_constellation.tle": "galileo", "glonass_constellation.tle": "glo-ops",
    "beidou_constellation.tle": "beidou", "sbas_gagan.tle": "sbas",
    "leo_6g_oneweb.tle": "oneweb", "leo_6g_starlink.tle": "starlink",
    "leo_6g_iridium.tle": "iridium-NEXT", "leo_6g_kuiper.tle": "kuiper",
}
def download_tles():
    for name, grp in TLE_SETS.items():
        url = f"https://celestrak.org/NORAD/elements/gp.php?GROUP={grp}&FORMAT=tle"
        try:
            d = urllib.request.urlopen(url, timeout=90).read().replace(b"\r", b"")
            (OUT / name).write_bytes(d); print("saved", name, len(d))
        except Exception as e:
            print("FAILED", name, e)

# ---------- 2. Ionosphere TEC: 7 days x 12 Indian sites, 60 s ----------
SITES = {"Ahmedabad":(23.0225,72.5714),"Delhi":(28.61,77.21),"Mumbai":(19.08,72.88),
 "Bengaluru":(12.97,77.59),"Chennai":(13.08,80.27),"Kolkata":(22.57,88.36),
 "Hyderabad":(17.39,78.49),"Pune":(18.52,73.86),"Jaipur":(26.91,75.79),
 "Lucknow":(26.85,80.95),"Guwahati":(26.14,91.74),"Thiruvananthapuram":(8.52,76.94)}
F_L1 = 1575.42e6
def gen_tec(days=7, step=60):
    t = np.arange(0, days*86400, step)
    rows = []
    for i,(city,(lat,lon)) in enumerate(SITES.items()):
        lt = ((T0 + t)/3600.0 + lon/15.0) % 24          # local solar time
        diurnal = np.maximum(0, np.cos((lt-14)/24*2*np.pi))  # peak ~14h LT
        eia = 1 + 0.5*np.exp(-((abs(lat)-15)/10)**2)          # equatorial anomaly bump
        day_trend = 1 + 0.15*np.sin(2*np.pi*t/(86400*27))     # solar rotation
        tec = (8 + 32*diurnal*eia*day_trend) + np.cumsum(rng.normal(0,0.05,len(t)))*0.2
        tec = np.clip(tec, 2, 90)
        delay = 40.3*tec*1e16/F_L1**2/299792458.0            # seconds, L1
        for a,b,c in zip(T0+t, tec, delay):
            rows.append(f"{a:.1f}, {lat:.4f}, {lon:.4f}, {b:.4f}, {c:.4e}")
    (OUT/"ionosphere_tec.dat").write_text(
        "# TIMESTAMP_SEC | LATITUDE | LONGITUDE | TEC_TOTAL_ELECTRON_CONTENT | DELAY_SEC\n" + "\n".join(rows) + "\n")
    print("TEC rows", len(rows))

# ---------- 3. Trajectories: 24 profiles, 1 Hz ----------
PROFILES = [("pedestrian",5,1800),("cyclist",18,3600),("city_car",40,7200),
            ("highway_car",90,7200),("bus",30,7200),("train",110,10800),
            ("highspeed_rail",250,7200),("truck",70,10800)]
def gen_traj():
    lines = ["profile_id,mode,timestamp,latitude,longitude,speed_kmh"]
    pid = 0
    for rep in range(3):
        for mode, vmean, dur in PROFILES:
            city = list(SITES.values())[rng.integers(len(SITES))]
            lat, lon = city[0]+rng.normal(0,0.05), city[1]+rng.normal(0,0.05)
            hdg = rng.uniform(0,2*np.pi); v = vmean
            for s in range(dur):
                if mode in ("pedestrian","cyclist","city_car","bus"):
                    hdg += rng.normal(0,0.05) + (rng.random()<0.004)*rng.choice([-1,1])*np.pi/2
                    if rng.random()<0.003: v = 0                # stop
                    else: v = np.clip(v + rng.normal(0,vmean*0.05), 0, vmean*1.4) if v>0 else vmean*0.3
                else:
                    hdg += rng.normal(0,0.002); v = np.clip(v+rng.normal(0,vmean*0.01), vmean*0.7, vmean*1.2)
                d = v/3.6                                         # metres per second
                lat += d*math.cos(hdg)/111320.0
                lon += d*math.sin(hdg)/(111320.0*math.cos(math.radians(lat)))
                lines.append(f"{pid},{mode},{T0+s:.1f},{lat:.6f},{lon:.6f},{v:.2f}")
            pid += 1
    (OUT/"user_trajectory_profiles.csv").write_text("\n".join(lines)+"\n")
    print("trajectory rows", len(lines)-1, "profiles", pid)

if __name__ == "__main__":
    if "--offline" not in sys.argv: download_tles()
    gen_tec(); gen_traj()
