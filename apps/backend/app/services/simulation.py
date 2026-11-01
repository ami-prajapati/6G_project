"""
Live simulation engine.

`SimulationEngine`  - shared, read-only: constellations, receiver, LSTM predictor, cached orbit rings.
`SimulationSession` - one per WebSocket client: play/pause, time-warp, constellation filter and the
                      stepping logic that turns the current simulation time into one telemetry packet.

TTFF numbers are produced by an analytical latency model (see `_ttff`): the conventional cold-start
figure is a modelled constant, the LEO-assisted figure adds the *measured* LSTM inference time to
modelled link / search / processing terms. It is a simulation, not a receiver measurement.
"""
from __future__ import annotations

import datetime as dt
import math
import time

import numpy as np

from open_ntn_ttff.dataset_loader import FEATURES, FeaturePipeline
from open_ntn_ttff.propagator import (
    C_KMS, CONSTELLATIONS, EARTH_RADIUS_KM, EPH_LIMIT_BYTES, EPH_MAX_SATS, UNIX_JD, Receiver, gmst_rad,
    observe, orbit_polyline, pack_ephemeris, select_orbit_samples, teme_to_ecef, unix_to_jd_fr,
)

# ---- TTFF latency model (assumptions, documented in the README) --------------------------------
COLD_START_S = 30.0          # conventional cold start from a ~50 bps broadcast ephemeris
LEO_LINK_BPS = 20e6          # assumed NTN user-link throughput for the ephemeris burst
DOPPLER_SEARCH_MS = 20.0     # residual acquisition search once Doppler is pre-compensated
PROCESSING_MS = 8.0          # parse + CRC + load ephemeris into the tracking channels
NOMINAL_LEO_RANGE_KM = 1200.0
TARGET_MS = 100.0
WARPS = [1, 10, 60]


def _f(x, nd=4):
    """float -> rounded float, or None for NaN/inf (keeps every packet valid JSON)."""
    x = float(x)
    return round(x, nd) if math.isfinite(x) else None


class SimulationEngine:
    def __init__(self, constellations, receiver: Receiver, predictor, min_elevation_deg=10.0):
        self.cons = constellations
        self.receiver = receiver
        self.predictor = predictor
        self.min_elev = min_elevation_deg
        self.start_unix = self._pick_start()
        self.pipeline = FeaturePipeline(receiver, self.start_unix)
        self._orbits = None

    def _pick_start(self) -> float:
        """Start at 'now' when the TLEs are fresh (< 7 days from their median epoch), else at the median epoch."""
        epochs = [(r.satrec.jdsatepoch + r.satrec.jdsatepochF - UNIX_JD) * 86400.0
                  for c in self.cons.values() for r in c.records]
        median, now = float(np.median(epochs)), time.time()
        return now if abs(now - median) < 7 * 86400 else median

    # ------------------------------------------------------------------ static payloads
    def hello_message(self) -> dict:
        return {
            "type": "hello",
            "station": {"name": self.receiver.name, "lat": self.receiver.lat_deg, "lon": self.receiver.lon_deg},
            "earth_radius_km": EARTH_RADIUS_KM,
            "constellations": [
                {"name": n, "count": len(c), "color": c.spec["color"], "carrier_hz": c.carrier_hz,
                 "names": [r.name for r in c.records]} for n, c in self.cons.items()],
            "warps": WARPS, "min_elevation_deg": self.min_elev,
            "features": FEATURES, "target": "future_doppler_error_hz", "horizon_ms": 50,
            "ephemeris_limit_bytes": EPH_LIMIT_BYTES, "ttff_target_ms": TARGET_MS,
            "model": self.predictor.status(),
        }

    def orbits_payload(self) -> dict:
        """Orbit rings (TEME km, rounded to integers) for a few representative planes per constellation."""
        if self._orbits is None:
            jd, fr = (float(x) for x in unix_to_jd_fr(self.start_unix))
            out = {}
            for name, c in self.cons.items():
                rings = []
                for i in select_orbit_samples(c.propagator.satrecs, max_orbits=18):
                    pts = orbit_polyline(c.propagator.satrecs[i], jd, fr)
                    if len(pts) > 3:
                        rings.append(np.rint(pts).astype(int).tolist())
                out[name] = rings
            self._orbits = {"frame": "TEME", "unit": "km", "orbits": out}
        return self._orbits

    # ------------------------------------------------------------------ TTFF model
    def ttff(self, t_s, leo_range_km, payload_bytes, inference_ms, n_sats):
        conventional_s = COLD_START_S + 1.2 * math.sin(t_s / 41.0)          # modelled jitter
        base = {"method": "analytical_model", "conventional_cold_start_s": _f(conventional_s, 2),
                "ephemeris_payload_bytes": payload_bytes, "ephemeris_payload_limit_bytes": 1024,
                "ephemeris_sat_count": n_sats, "target_ms": TARGET_MS}
        if leo_range_km is None:
            return {**base, "leo_link_available": False, "leo_assisted_ms": None, "speedup_x": None,
                    "target_met": False, "breakdown_ms": None}
        parts = {"leo_round_trip": 2.0 * leo_range_km / C_KMS * 1e3,
                 "payload_tx": payload_bytes * 8.0 / LEO_LINK_BPS * 1e3,
                 "ai_inference": inference_ms,
                 "doppler_search": DOPPLER_SEARCH_MS,
                 "processing": PROCESSING_MS}
        total = sum(parts.values())
        return {**base, "leo_link_available": True, "leo_assisted_ms": _f(total, 2),
                "speedup_x": _f(conventional_s * 1e3 / total, 1), "target_met": total < TARGET_MS,
                "breakdown_ms": {k: _f(v, 3) for k, v in parts.items()}}


class SimulationSession:
    """Per-client simulation state + packet generation."""

    def __init__(self, engine: SimulationEngine):
        self.engine = engine
        self.playing = True
        self.warp = 1.0
        self.enabled = set(engine.cons)
        self.track = "auto"
        self.sim_unix = engine.start_unix
        self.seq = 0
        self._tracked: tuple[str, int] | None = None

    # ------------------------------------------------------------------ client commands
    def apply_command(self, msg: dict) -> dict:
        cmd = msg.get("cmd")
        if cmd == "play":
            self.playing = True
        elif cmd == "pause":
            self.playing = False
        elif cmd == "warp":
            self.warp = float(min(max(float(msg.get("value", 1)), 0.1), 3600.0))
        elif cmd == "constellations":
            self.enabled = {n for n in msg.get("enabled", []) if n in self.engine.cons}
        elif cmd == "track":
            value = msg.get("value", "auto")
            self.track = value if value in self.engine.cons else "auto"
            self._tracked = None
        elif cmd == "reset":
            self.sim_unix, self._tracked = self.engine.start_unix, None
        else:
            return {"type": "ack", "ok": False, "error": f"unknown command {cmd!r}"}
        return {"type": "ack", "ok": True, "state": self.state()}

    def state(self) -> dict:
        return {"playing": self.playing, "warp": self.warp, "enabled": sorted(self.enabled), "track": self.track}

    # ------------------------------------------------------------------ tracked-satellite policy
    def _choose_tracked(self, candidates):
        pool = candidates if self.track == "auto" else [c for c in candidates if c[1] == self.track]
        if not pool:
            self._tracked = None
            return None
        preferred = ([c for c in pool if c[1] == "OneWeb"] or pool) if self.track == "auto" else pool
        best = preferred[0]
        if self._tracked:
            cur = next((c for c in preferred if (c[1], c[2]) == self._tracked), None)
            if cur and best[0] - cur[0] < 25.0:            # hysteresis: avoid flapping between satellites
                best = cur
        self._tracked = (best[1], best[2])
        return best

    # ------------------------------------------------------------------ one telemetry packet
    def step(self, wall_dt: float) -> dict:
        eng = self.engine
        if self.playing:
            self.sim_unix += wall_dt * self.warp
        t = self.sim_unix
        jd, fr = (float(x) for x in unix_to_jd_fr(t))
        theta = float(gmst_rad(jd, fr))

        constellations, candidates, leo_range = {}, [], None
        for name, c in eng.cons.items():
            shown = name in self.enabled
            if not shown and name != "OneWeb":
                continue                       # OneWeb is always propagated: it is the NTN ephemeris link
            err, r, v = c.propagator.propagate_teme(jd, fr)
            ok = (err == 0) & np.all(np.isfinite(r), axis=1)
            r_ecef, v_ecef = teme_to_ecef(np.where(ok[:, None], r, 0.0), np.where(ok[:, None], v, 0.0), theta)
            rho, _, elev = observe(r_ecef, v_ecef, eng.receiver)
            vis = np.flatnonzero(ok & (elev >= eng.min_elev))
            if name == "OneWeb" and vis.size:
                leo_range = float(rho[vis[np.argmax(elev[vis])]])
            if not shown:
                continue
            constellations[name] = {"count": len(c), "positions_km": np.rint(np.where(ok[:, None], r, 0.0))
                                    .astype(int).ravel().tolist()}
            for i in vis:
                candidates.append((float(elev[i]), name, int(i), float(rho[i])))
        candidates.sort(key=lambda x: -x[0])

        # satellites whose windows go through the LSTM / into the ephemeris payload (tracked first)
        tracked_c = self._choose_tracked(candidates)
        selected = ([tracked_c] if tracked_c else []) + [c for c in candidates if c is not tracked_c]
        samples = []
        for c in selected:
            if len(samples) >= EPH_MAX_SATS:
                break
            s = eng.pipeline.build(eng.cons[c[1]], c[2], t)
            if s is not None:
                samples.append((c, s))

        preds, inference_ms = eng.predictor.predict_windows(
            np.stack([s.window for _, s in samples])) if samples else (np.zeros(0), 0.0)

        visible, entries = [], []
        for k, ((el, name, idx, rho), s) in enumerate(samples):
            rec = eng.cons[name].records[idx]
            visible.append({"c": name, "i": idx, "name": rec.name, "norad": rec.norad_id,
                            "el": _f(s.elevation_deg, 2), "range_km": _f(s.range_km, 1),
                            "doppler_hz": _f(s.d_meas_hz, 2), "pred_hz": _f(preds[k], 4),
                            "tracked": bool(self._tracked == (name, idx))})
            entries.append({"norad": rec.norad_id, "cons_code": CONSTELLATIONS[name]["code"], "satrec": rec.satrec,
                            "doppler_hz": s.d_meas_hz, "ai_correction_hz": float(preds[k])})
        blob = pack_ephemeris(t, entries)

        tracked = None
        if samples and samples[0][0] is tracked_c:
            (_, name, idx, _), s = samples[0]
            rec, truth, pred = eng.cons[name].records[idx], s.truth_error_hz, float(preds[0])
            tracked = {
                "constellation": name, "name": rec.name, "norad": rec.norad_id,
                "carrier_hz": eng.cons[name].carrier_hz,
                "features": {FEATURES[0]: _f(s.radial_velocity_km_s, 5), FEATURES[1]: _f(s.elevation_deg, 3),
                             FEATURES[2]: _f(s.d_meas_hz, 3), FEATURES[3]: s.clock_bias_s if math.isfinite(s.clock_bias_s) else None},
                "inference": {"future_doppler_error_hz": _f(pred, 4),          # LSTM prediction, 50 ms ahead
                              "truth_future_doppler_error_hz": _f(truth, 4),   # ground truth for the chart
                              "residual_after_correction_hz": _f(truth - pred, 4),
                              "inference_ms": _f(inference_ms, 3), "model_loaded": eng.predictor.loaded},
            }

        self.seq += 1
        return {
            "type": "telemetry", "seq": self.seq,
            "timestamp_utc": dt.datetime.fromtimestamp(t, tz=dt.timezone.utc).isoformat(timespec="milliseconds"),
            "sim_unix": _f(t, 3), "gmst_rad": _f(theta, 6), "state": self.state(),
            "station": {"name": eng.receiver.name, "lat": eng.receiver.lat_deg, "lon": eng.receiver.lon_deg,
                        "teme_km": [_f(x, 1) for x in eng.receiver.teme_position(theta)]},
            "constellations": constellations, "visible": visible, "tracked": tracked,
            "ttff": eng.ttff(t, leo_range, len(blob), inference_ms, len(entries)),
        }
