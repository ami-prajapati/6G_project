"""
open_ntn_ttff.propagator
========================
SGP4 orbital-mechanics engine for the 6G LEO-Assisted Fast GNSS TTFF Engine.

Responsibilities
  * time / frame helpers   (UTC -> Julian date, GMST, TEME <-> ECEF)
  * receiver geometry      (range, radial velocity, elevation for a ground station)
  * constellation batching (propagate every satellite of a constellation in one SGP4 call)
  * orbit polylines        (for the 3-D globe)
  * oscillator + noise model (deterministic simulation of satellite clock drift)
  * binary ephemeris packer (< 1 KB payload streamed over the NTN link)

The conventions (carrier frequencies, Doppler sign, clock model, GMST formula) match the
Google Colab training script, so features computed here are in-distribution for the LSTM.
"""
from __future__ import annotations

import math
import struct
import zlib
from dataclasses import dataclass

import numpy as np
from sgp4.api import SatrecArray

# --------------------------------------------------------------------------- constants
C_KMS = 299792.458                      # speed of light (km/s)
WE = 7.2921150e-5                       # Earth rotation rate (rad/s)
WGS84_A, WGS84_F = 6378.137, 1.0 / 298.257223563
EARTH_RADIUS_KM = WGS84_A
UNIX_JD = 2440587.5                     # Julian date of 1970-01-01 00:00 UTC

# Per-constellation simulation parameters (carrier + assumed oscillator stability).
# Keep in sync with the Colab training script.
CONSTELLATIONS: dict[str, dict] = {
    "NavIC":   dict(file="navic_constellation.tle",   carrier_hz=1176.45e6, clk_drift_sigma=1e-11, clk_walk=1e-13, color="#f59e0b", code=0),
    "GPS":     dict(file="gps_constellation.tle",     carrier_hz=1575.42e6, clk_drift_sigma=5e-12, clk_walk=1e-13, color="#22d3ee", code=1),
    "Galileo": dict(file="galileo_constellation.tle", carrier_hz=1575.42e6, clk_drift_sigma=2e-12, clk_walk=5e-14, color="#a78bfa", code=2),
    "OneWeb":  dict(file="leo_6g_oneweb.tle",         carrier_hz=12.2e9,    clk_drift_sigma=1e-9,  clk_walk=1e-11, color="#34d399", code=3),
}
MEAS_NOISE_HZ = 0.02                    # receiver Doppler measurement noise (1-sigma)
CLOCK_PERIOD_S = 7200.0                 # oscillator model repeats every 2 h (keeps features in range)


# --------------------------------------------------------------------------- time & frames
def unix_to_jd_fr(unix_s):
    """UTC unix seconds (scalar or array) -> (jd, fr) in the sgp4 convention (jd = x.5 at 00:00 UTC)."""
    days = np.asarray(unix_s, dtype=np.float64) / 86400.0
    whole = np.floor(days)
    return UNIX_JD + whole, days - whole


def gmst_rad(jd, fr):
    """Greenwich Mean Sidereal Time in radians (UT1 ~ UTC)."""
    d = (np.asarray(jd) - 2451545.0) + np.asarray(fr)
    t = d / 36525.0
    sec = 67310.54841 + (876600.0 * 3600.0 + 8640184.812866) * t + 0.093104 * t ** 2 - 6.2e-6 * t ** 3
    return np.deg2rad((sec / 240.0) % 360.0)


def teme_to_ecef(r, v, theta):
    """Rotate TEME position/velocity (km, km/s) to ECEF. `theta` (GMST) must broadcast with r[..., 0]."""
    c, s = np.cos(theta), np.sin(theta)
    rx = c * r[..., 0] + s * r[..., 1]
    ry = -s * r[..., 0] + c * r[..., 1]
    vx = c * v[..., 0] + s * v[..., 1] + WE * ry      # v_ecef = R v - w x r
    vy = -s * v[..., 0] + c * v[..., 1] - WE * rx
    return np.stack([rx, ry, r[..., 2]], axis=-1), np.stack([vx, vy, v[..., 2]], axis=-1)


# --------------------------------------------------------------------------- receiver
@dataclass(frozen=True)
class Receiver:
    """Static ground receiver (default usage: Ahmedabad)."""
    name: str
    lat_deg: float
    lon_deg: float
    alt_km: float = 0.0

    @property
    def ecef(self) -> np.ndarray:
        lat, lon = math.radians(self.lat_deg), math.radians(self.lon_deg)
        e2 = WGS84_F * (2.0 - WGS84_F)
        n = WGS84_A / math.sqrt(1.0 - e2 * math.sin(lat) ** 2)
        return np.array([(n + self.alt_km) * math.cos(lat) * math.cos(lon),
                         (n + self.alt_km) * math.cos(lat) * math.sin(lon),
                         (n * (1.0 - e2) + self.alt_km) * math.sin(lat)])

    @property
    def up(self) -> np.ndarray:
        lat, lon = math.radians(self.lat_deg), math.radians(self.lon_deg)
        return np.array([math.cos(lat) * math.cos(lon), math.cos(lat) * math.sin(lon), math.sin(lat)])

    def teme_position(self, theta: float) -> np.ndarray:
        """Receiver position in the inertial (TEME) frame for a given GMST."""
        x, y, z = self.ecef
        c, s = math.cos(theta), math.sin(theta)
        return np.array([c * x - s * y, s * x + c * y, z])


def observe(r_ecef, v_ecef, receiver: Receiver):
    """Return (range_km, radial_velocity_km_s, elevation_deg); radial velocity > 0 = receding."""
    los = r_ecef - receiver.ecef
    rho = np.linalg.norm(los, axis=-1)
    u = los / rho[..., None]
    radial_v = np.sum(u * v_ecef, axis=-1)           # receiver is static in ECEF
    elev = np.degrees(np.arcsin(np.clip(u @ receiver.up, -1.0, 1.0)))
    return rho, radial_v, elev


def doppler_hz(radial_v_km_s, carrier_hz):
    """Geometric Doppler shift: positive while the satellite approaches."""
    return -np.asarray(radial_v_km_s) / C_KMS * carrier_hz


# --------------------------------------------------------------------------- constellation batch
class ConstellationPropagator:
    """Propagates every satellite of one constellation in a single vectorised SGP4 call."""

    def __init__(self, satrecs):
        self.satrecs = list(satrecs)
        self._array = SatrecArray(self.satrecs)

    def __len__(self):
        return len(self.satrecs)

    def propagate_teme(self, jd: float, fr: float):
        """-> (err (n,), r_teme (n,3) km, v_teme (n,3) km/s) at one instant."""
        err, r, v = self._array.sgp4(np.array([jd], dtype=np.float64), np.array([fr], dtype=np.float64))
        return err[:, 0], r[:, 0, :], v[:, 0, :]


def orbit_polyline(satrec, jd: float, fr: float, n_points: int = 96) -> np.ndarray:
    """One full revolution of TEME positions (km) for drawing an orbit ring."""
    period_s = 2.0 * math.pi / satrec.no_kozai * 60.0             # no_kozai is rad/min
    ts = np.linspace(0.0, period_s, n_points)
    err, r, _ = satrec.sgp4_array(np.full(n_points, jd), fr + ts / 86400.0)
    return r[err == 0]


def select_orbit_samples(satrecs, max_orbits: int = 18) -> list[int]:
    """Pick satellites that represent distinct orbital planes (bucketed by RAAN and inclination)."""
    seen, picks = set(), []
    for i, s in enumerate(satrecs):
        key = (round(math.degrees(s.nodeo) / 15.0), round(math.degrees(s.inclo) / 5.0))
        if key not in seen:
            seen.add(key)
            picks.append(i)
    if len(picks) > max_orbits:
        step = len(picks) / max_orbits
        picks = [picks[int(k * step)] for k in range(max_orbits)]
    return picks


# --------------------------------------------------------------------------- oscillator & noise
@dataclass(frozen=True)
class OscillatorModel:
    """Deterministic, smooth satellite-clock model: constant drift + two slow wander terms.

    drift(t) [s/s] and bias(t) [s] are closed-form, so any time can be evaluated without state.
    """
    b0: float
    d0: float
    amp: float
    w1: float
    w2: float
    ph1: float
    ph2: float

    @staticmethod
    def from_key(key: str, drift_sigma: float, walk: float) -> "OscillatorModel":
        rng = np.random.default_rng(zlib.crc32(key.encode()))
        return OscillatorModel(
            b0=float(rng.normal(0.0, 1e-7)),
            d0=float(rng.normal(0.0, drift_sigma)),
            amp=walk * 42.0,                                        # ~ walk * sqrt(1800 s)
            w1=2 * math.pi / float(rng.uniform(600.0, 1200.0)),
            w2=2 * math.pi / float(rng.uniform(150.0, 400.0)),
            ph1=float(rng.uniform(0, 2 * math.pi)),
            ph2=float(rng.uniform(0, 2 * math.pi)),
        )

    def drift(self, t):
        t = np.asarray(t, dtype=np.float64)
        return self.d0 + self.amp * (np.sin(self.w1 * t + self.ph1) + 0.5 * np.sin(self.w2 * t + self.ph2))

    def bias(self, t):
        t = np.asarray(t, dtype=np.float64)
        return (self.b0 + self.d0 * t
                + self.amp * ((math.cos(self.ph1) - np.cos(self.w1 * t + self.ph1)) / self.w1
                              + 0.5 * (math.cos(self.ph2) - np.cos(self.w2 * t + self.ph2)) / self.w2))


class NoiseTable:
    """Pre-generated Gaussian measurement noise, indexed by (satellite key, whole second)."""

    def __init__(self, sigma: float = MEAS_NOISE_HZ, size: int = 1 << 16, seed: int = 1234):
        self.size = size
        self.table = np.random.default_rng(seed).normal(0.0, sigma, size)

    def at(self, sat_key: int, t_s):
        idx = (np.floor(np.asarray(t_s)).astype(np.int64) + int(sat_key) * 7919) % self.size
        return self.table[idx]


# --------------------------------------------------------------------------- binary ephemeris packer
EPH_MAGIC = b"NTN1"
EPH_HEADER = struct.Struct("<4sBHdI")   # magic, version, sat_count, unix_time, crc32(records)  -> 19 B
EPH_RECORD = struct.Struct("<IB9f")     # norad, constellation code, 9 x float32                 -> 41 B
EPH_LIMIT_BYTES = 1000                  # hard cap, keeps every packet under 1 KB
EPH_MAX_SATS = (EPH_LIMIT_BYTES - EPH_HEADER.size) // EPH_RECORD.size          # 23


def pack_ephemeris(unix_s: float, entries: list[dict]) -> bytes:
    """Pack up to EPH_MAX_SATS records.

    entry = {norad:int, cons_code:int, satrec, doppler_hz:float, ai_correction_hz:float}
    record floats = [inclo, nodeo, ecco, argpo, mo, no_kozai, element_age_s, doppler_hz, ai_correction_hz]
    """
    body = bytearray()
    entries = entries[:EPH_MAX_SATS]
    for e in entries:
        s = e["satrec"]
        epoch_unix = (s.jdsatepoch + s.jdsatepochF - UNIX_JD) * 86400.0
        body += EPH_RECORD.pack(int(e["norad"]), int(e["cons_code"]),
                                s.inclo, s.nodeo, s.ecco, s.argpo, s.mo, s.no_kozai,
                                unix_s - epoch_unix, e["doppler_hz"], e["ai_correction_hz"])
    header = EPH_HEADER.pack(EPH_MAGIC, 1, len(entries), unix_s, zlib.crc32(bytes(body)) & 0xFFFFFFFF)
    return header + bytes(body)


def unpack_ephemeris(blob: bytes) -> dict:
    """Inverse of pack_ephemeris (used for verification and tests)."""
    magic, version, count, unix_s, crc = EPH_HEADER.unpack_from(blob, 0)
    if magic != EPH_MAGIC:
        raise ValueError("bad magic")
    body = blob[EPH_HEADER.size:]
    if zlib.crc32(body) & 0xFFFFFFFF != crc:
        raise ValueError("CRC mismatch")
    recs = []
    for k in range(count):
        f = EPH_RECORD.unpack_from(body, k * EPH_RECORD.size)
        recs.append(dict(norad=f[0], cons_code=f[1], inclo=f[2], nodeo=f[3], ecco=f[4], argpo=f[5],
                         mo=f[6], no_kozai=f[7], element_age_s=f[8], doppler_hz=f[9], ai_correction_hz=f[10]))
    return dict(version=version, unix_s=unix_s, count=count, records=recs)
