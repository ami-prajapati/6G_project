"""
Builds doppler_training.csv for the DopplerLSTMModel from the TLEs + trajectories in this folder.
Requires: pip install sgp4 numpy pandas
  python generate_doppler_training.py                       # 20 OneWeb sats, trajectory profile 3, L-band
  python generate_doppler_training.py --carrier-ghz 12 --profile 6 --nsats 40 --duration 1800

Columns: sat, timestamp, relative_velocity_km_s, elevation_angle_deg, doppler_shift_hz,
         clock_bias_seconds, future_doppler_error_hz
future_doppler_error_hz = true Doppler at t+50 ms minus a linear extrapolation of the current
Doppler (doppler + doppler_rate*0.05). Swap in your own baseline if you define the target differently.
clock_bias_seconds is a SYNTHETIC receiver-oscillator random walk (no real data exists for it).
"""
import argparse, pathlib, numpy as np, pandas as pd
from sgp4.api import Satrec, jday

C = 299792.458                      # km/s
WE = 7.2921150e-5                   # Earth rotation rad/s
A, F = 6378.137, 1 / 298.257223563
HERE = pathlib.Path(__file__).parent

def read_tles(path):
    ls = [l.rstrip() for l in open(path).read().replace("\r", "").split("\n") if l.strip()]
    out, i = [], 0
    while i < len(ls):
        if ls[i].startswith("1 "): name, l1, l2, i = ls[i][2:7], ls[i], ls[i + 1], i + 2
        else: name, l1, l2, i = ls[i].strip(), ls[i + 1], ls[i + 2], i + 3
        out.append((name, Satrec.twoline2rv(l1, l2)))
    return out

def gmst(jd):                       # radians, jd = full UT1~UTC julian date
    t = (jd - 2451545.0) / 36525.0
    g = 67310.54841 + (876600 * 3600 + 8640184.812866) * t + 0.093104 * t**2 - 6.2e-6 * t**3
    return np.deg2rad((g / 240.0) % 360.0)

def geodetic_to_ecef(lat, lon, h=0.0):
    lat, lon = np.deg2rad(lat), np.deg2rad(lon)
    e2 = F * (2 - F); n = A / np.sqrt(1 - e2 * np.sin(lat)**2)
    return np.stack([(n + h) * np.cos(lat) * np.cos(lon), (n + h) * np.cos(lat) * np.sin(lon),
                     (n * (1 - e2) + h) * np.sin(lat)], -1)

def enu_up(lat, lon):
    lat, lon = np.deg2rad(lat), np.deg2rad(lon)
    return np.stack([np.cos(lat) * np.cos(lon), np.cos(lat) * np.sin(lon), np.sin(lat)], -1)

def sat_ecef(sat, unix):            # unix: array of UTC seconds -> r, v in ECEF (km, km/s)
    dt = (np.asarray(unix) // 1).astype("int64")
    frac = np.asarray(unix) - dt
    jd0 = 2440587.5 + dt / 86400.0                 # fraction carried separately for precision
    jd, fr = np.floor(jd0 + 0.5) - 0.5, (jd0 + 0.5) % 1.0 + frac / 86400.0
    e, r, v = sat.sgp4_array(jd, fr)
    th = gmst(jd + fr); c, s = np.cos(th), np.sin(th)
    rx, ry = c * r[:, 0] + s * r[:, 1], -s * r[:, 0] + c * r[:, 1]
    vx, vy = c * v[:, 0] + s * v[:, 1] + WE * ry, -s * v[:, 0] + c * v[:, 1] - WE * rx
    return np.stack([rx, ry, r[:, 2]], -1), np.stack([vx, vy, v[:, 2]], -1), e

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tle", default="leo_6g_oneweb.tle"); ap.add_argument("--nsats", type=int, default=20)
    ap.add_argument("--profile", type=int, default=3); ap.add_argument("--duration", type=int, default=600)
    ap.add_argument("--carrier-ghz", type=float, default=1.57542); ap.add_argument("--min-elev", type=float, default=10.0)
    ap.add_argument("--lead", type=float, default=0.05); ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default="doppler_training.csv"); a = ap.parse_args()
    rng = np.random.default_rng(a.seed); fc = a.carrier_ghz * 1e9

    tr = pd.read_csv(HERE / "user_trajectory_profiles.csv")
    tr = tr[tr.profile_id == a.profile].iloc[:a.duration].reset_index(drop=True)
    t = tr.timestamp.values; rx = geodetic_to_ecef(tr.latitude.values, tr.longitude.values)
    rv = np.gradient(rx, t, axis=0); up = enu_up(tr.latitude.values, tr.longitude.values)
    clock = np.cumsum(rng.normal(0, 2e-10, len(t))) + 1e-6 * rng.normal()   # synthetic oscillator walk (s)

    def dop(sat, tt, rxp, rvp):
        r, v, e = sat_ecef(sat, tt); los = r - rxp; rng_ = np.linalg.norm(los, axis=1)
        rr = np.einsum("ij,ij->i", los / rng_[:, None], v - rvp)             # range rate km/s
        el = np.rad2deg(np.arcsin(np.einsum("ij,ij->i", los / rng_[:, None], up)))
        return -rr / C * fc, rr, el, e

    rows = []
    for name, sat in read_tles(HERE / a.tle)[:a.nsats]:
        d0, rr, el, e = dop(sat, t, rx, rv)
        d1, _, _, _ = dop(sat, t + a.lead, rx + rv * a.lead, rv)
        rate = np.gradient(d0, t)
        ok = (el >= a.min_elev) & (e == 0)
        df = pd.DataFrame({"sat": name, "timestamp": t, "relative_velocity_km_s": rr,
                           "elevation_angle_deg": el, "doppler_shift_hz": d0,
                           "clock_bias_seconds": clock, "future_doppler_error_hz": d1 - (d0 + rate * a.lead)})
        rows.append(df[ok])
    out = pd.concat(rows, ignore_index=True); out.to_csv(HERE / a.out, index=False)
    print(len(out), "rows ->", a.out, "| |Doppler| max %.1f kHz" % (out.doppler_shift_hz.abs().max() / 1e3))

if __name__ == "__main__":
    main()
