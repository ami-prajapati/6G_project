"""
open_ntn_ttff.dataset_loader
============================
TLE parsing and the feature pipeline that turns satellite geometry into LSTM inputs.

  load_constellations()  -> {name: Constellation}  parsed from the local TLE files
  FeaturePipeline        -> builds the 10-step history window (4 features) + the 50 ms ground truth

Feature / target definitions are identical to the Colab training script:
  doppler_shift_hz        = geometric Doppler + carrier * oscillator drift + measurement noise
  clock_bias_seconds      = simulated satellite oscillator bias
  future_doppler_error_hz = true Doppler at t+50 ms  -  (doppler(t) + doppler_rate(t) * 0.05)
"""
from __future__ import annotations

import logging
import zlib
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np
from sgp4.api import Satrec

from .propagator import (
    CLOCK_PERIOD_S, CONSTELLATIONS, ConstellationPropagator, NoiseTable, OscillatorModel,
    Receiver, doppler_hz, gmst_rad, observe, teme_to_ecef, unix_to_jd_fr,
)

log = logging.getLogger("open_ntn_ttff.dataset")

WINDOW = 10        # history steps fed to the LSTM
STEP_S = 1.0       # spacing of the history steps (s)
LEAD_S = 0.05      # prediction horizon (50 ms)
FEATURES = ["relative_velocity_km_s", "elevation_angle_deg", "doppler_shift_hz", "clock_bias_seconds"]


# --------------------------------------------------------------------------- TLE parsing
@dataclass
class TleRecord:
    name: str
    norad_id: int
    satrec: Satrec
    key: int = 0                      # stable integer used to index the noise table


@dataclass
class Constellation:
    name: str
    spec: dict
    records: list[TleRecord]
    propagator: ConstellationPropagator
    oscillators: list[OscillatorModel] = field(default_factory=list)

    @property
    def carrier_hz(self) -> float:
        return self.spec["carrier_hz"]

    def __len__(self):
        return len(self.records)


def parse_tle_text(text: str) -> list[tuple[str, int, Satrec]]:
    """Parse 2-line or 3-line (named) TLE text into (name, norad_id, Satrec) tuples."""
    lines = [ln.strip() for ln in text.replace("\r", "").split("\n") if ln.strip()]
    out, i = [], 0
    while i < len(lines):
        if lines[i].startswith("1 ") and i + 1 < len(lines) and lines[i + 1].startswith("2 "):
            l1, l2, name, i = lines[i], lines[i + 1], None, i + 2
        elif i + 2 < len(lines) and lines[i + 1].startswith("1 ") and lines[i + 2].startswith("2 "):
            name, l1, l2, i = lines[i], lines[i + 1], lines[i + 2], i + 3
        else:
            i += 1
            continue
        try:
            norad = int(l1[2:7])
        except ValueError:
            norad = 0
        try:
            sat = Satrec.twoline2rv(l1, l2)
        except Exception as exc:                                   # malformed element set
            log.warning("skipping bad TLE (%s): %s", name or norad, exc)
            continue
        out.append((name or f"NORAD-{norad}", norad, sat))
    return out


def load_constellations(dataset_dir, names=None, max_sats: dict | None = None) -> dict[str, Constellation]:
    """Load the configured constellations from `dataset_dir` (e.g. C:\\Users\\91851\\6G_Datasets)."""
    dataset_dir = Path(dataset_dir)
    max_sats = max_sats or {}
    result: dict[str, Constellation] = {}
    for name, spec in CONSTELLATIONS.items():
        if names and name not in names:
            continue
        path = dataset_dir / spec["file"]
        if not path.is_file():
            log.warning("TLE file missing, skipping %s: %s", name, path)
            continue
        parsed = parse_tle_text(path.read_text(encoding="utf-8", errors="ignore"))
        if max_sats.get(name):
            parsed = parsed[: max_sats[name]]
        records = [TleRecord(n, nid, sat, key=zlib.crc32(f"{name}:{nid}".encode()) & 0x7FFFFFFF)
                   for n, nid, sat in parsed]
        if not records:
            log.warning("no satellites parsed for %s", name)
            continue
        result[name] = Constellation(
            name=name, spec=spec, records=records,
            propagator=ConstellationPropagator([r.satrec for r in records]),
            oscillators=[OscillatorModel.from_key(f"{name}:{r.norad_id}:{r.name}",
                                                  spec["clk_drift_sigma"], spec["clk_walk"]) for r in records],
        )
        log.info("%-8s %4d satellites from %s", name, len(records), path.name)
    if not result:
        raise FileNotFoundError(f"No TLE files could be loaded from {dataset_dir}")
    return result


# --------------------------------------------------------------------------- feature pipeline
@dataclass
class WindowSample:
    """One satellite's 10-step history window and its 50 ms ground truth."""
    window: np.ndarray                # (WINDOW, 4) raw features, oldest first
    d_meas_hz: float                  # latest measured Doppler
    radial_velocity_km_s: float
    elevation_deg: float
    range_km: float
    clock_bias_s: float
    extrapolated_hz: float            # receiver's own prediction for t+50 ms
    truth_error_hz: float             # true Doppler(t+50 ms) - extrapolated  (the LSTM target)


class FeaturePipeline:
    """Builds LSTM input windows for any satellite at any simulation time (stateless)."""

    def __init__(self, receiver: Receiver, sim_epoch_unix: float, noise: NoiseTable | None = None):
        self.receiver = receiver
        self.sim_epoch_unix = sim_epoch_unix
        self.noise = noise or NoiseTable()

    def build(self, const: Constellation, index: int, t_end_unix: float) -> WindowSample | None:
        rec, osc, f_c = const.records[index], const.oscillators[index], const.carrier_hz
        # WINDOW history samples ending at t_end (1 s apart) plus the +50 ms look-ahead instant
        t = np.concatenate([t_end_unix - (WINDOW - 1 - np.arange(WINDOW)) * STEP_S, [t_end_unix + LEAD_S]])
        jd, fr = unix_to_jd_fr(t)
        err, r, v = rec.satrec.sgp4_array(jd, fr)
        if np.any(err != 0) or not np.all(np.isfinite(r)):
            return None
        r_ecef, v_ecef = teme_to_ecef(r, v, gmst_rad(jd, fr))
        rho, radial_v, elev = observe(r_ecef, v_ecef, self.receiver)

        t_clk = np.mod(t - self.sim_epoch_unix, CLOCK_PERIOD_S)
        drift, bias = osc.drift(t_clk), osc.bias(t_clk)
        d_geo = doppler_hz(radial_v, f_c)
        d_meas = d_geo[:WINDOW] + f_c * drift[:WINDOW] + self.noise.at(rec.key, t[:WINDOW])
        d_future_true = d_geo[WINDOW] + f_c * drift[WINDOW]

        rate = (d_meas[-1] - d_meas[-2]) / STEP_S                      # receiver's Doppler-rate estimate
        extrapolated = d_meas[-1] + rate * LEAD_S
        window = np.stack([radial_v[:WINDOW], elev[:WINDOW], d_meas, bias[:WINDOW]], axis=1)
        return WindowSample(window=window, d_meas_hz=float(d_meas[-1]),
                            radial_velocity_km_s=float(radial_v[WINDOW - 1]),
                            elevation_deg=float(elev[WINDOW - 1]), range_km=float(rho[WINDOW - 1]),
                            clock_bias_s=float(bias[WINDOW - 1]), extrapolated_hz=float(extrapolated),
                            truth_error_hz=float(d_future_true - extrapolated))
