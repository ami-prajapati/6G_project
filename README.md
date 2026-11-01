# 6G LEO-Assisted Fast GNSS TTFF Engine

Simulation framework + live dashboard showing how a 6G Non-Terrestrial-Network (LEO) link that streams a
compact ephemeris burst, combined with an LSTM that predicts the Doppler residual 50 ms ahead, can cut GNSS
cold-start Time-To-First-Fix from ~30 s to well under 100 ms.

```
 Browser (React + R3F)  <--WebSocket JSON @5 Hz-->  FastAPI  -->  open_ntn_ttff (SGP4 + features)
   Globe · TTFF · Doppler · Controls                          \->  PyTorch DopplerLSTMModel (Colab weights)
```

## Repository layout

```
6g_ntn_ttff_workspace/
├── packages/open_ntn_ttff/          shared engine
│   ├── propagator.py                SGP4 batching, frames, geometry, clock model, <1 KB binary ephemeris packer
│   ├── dataset_loader.py            TLE parsing + 10-step feature window / 50 ms ground-truth builder
│   └── models/                      <- put doppler_lstm_weights.pt and doppler_norm_stats.npz here
├── 6G_Datasets/                 TLE files + simulated TEC / trajectories
├── apps/backend/                FastAPI service (app/main.py, routers/, services/, Dockerfile)
├── apps/frontend/              React + Vite + Tailwind + React Three Fiber
├── docker-compose.yml
└── README.md
```

Datasets live in `6G_Datasets/` inside the workspace (NavIC, GPS, Galileo, OneWeb TLE files are used;
`leo_6g_starlink.tle`, `ionosphere_tec.dat` and `user_trajectory_profiles.csv` are not read by the live stream).

## Quick start (Windows, no Docker)

1. **Weights from Colab** - copy `doppler_lstm_weights.pt` **and** `doppler_norm_stats.npz` into
   `packages/open_ntn_ttff/models/`. Without them the API still runs, but the predicted residual is 0 and the
   dashboard shows a warning.
2. **Backend**
   ```powershell
   cd apps\backend
   python -m venv .venv ; .\.venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --reload --port 8000
   ```
   Open http://localhost:8000/docs and http://localhost:8000/api/health.
3. **Frontend**
   ```powershell
   cd apps\frontend
   npm install
   npm run dev
   ```
   Open http://localhost:5173 (Vite proxies `/api` and `/ws` to port 8000).

## Docker

```powershell
docker compose up --build
```
Dashboard: http://localhost:5173 · API: http://localhost:8000. The compose file mounts `./6G_Datasets` and the `models/` folder.

## Configuration (environment variables)

| variable | default | meaning |
|---|---|---|
| `NTN_DATASET_DIR` | `<workspace>/6G_Datasets` | folder with the TLE files |
| `NTN_WEIGHTS_PATH` / `NTN_NORM_PATH` | `packages/open_ntn_ttff/models/...` | Colab artefacts |
| `NTN_TICK_HZ` | `5` | telemetry packets per second |
| `NTN_MAX_ONEWEB` | `0` (all) | cap OneWeb satellites for slower machines |
| `NTN_MIN_ELEV_DEG` | `10` | elevation mask |
| `NTN_CORS_ORIGINS` | `http://localhost:5173,...` | allowed browser origins (comma-separated) |
| `NTN_CORS_ORIGIN_REGEX` | (empty) | extra allowed origins, e.g. `https://.*\.vercel\.app` |

## API

| endpoint | purpose |
|---|---|
| `GET /api/health` | status, satellite counts, whether the LSTM loaded |
| `GET /api/inference/model` | architecture details of the loaded checkpoint |
| `POST /api/inference/predict` | `{"windows": [[[v, el, doppler, clock] x10], ...]}` -> predicted `future_doppler_error_hz` |
| `GET /api/telemetry/orbits` | orbit rings (TEME km) for the globe |
| `GET /api/telemetry/snapshot` | one telemetry packet (debugging) |
| `WS /ws/telemetry` | live stream; one independent simulation per connection |

**WebSocket commands** (client -> server): `{"cmd":"play"|"pause"|"reset"}`, `{"cmd":"warp","value":1|10|60}`,
`{"cmd":"constellations","enabled":["GPS","OneWeb"]}`, `{"cmd":"track","value":"auto"|"OneWeb"|...}`.

**Telemetry packet** (server -> client, every tick):

```jsonc
{
  "type": "telemetry", "seq": 42, "timestamp_utc": "2026-10-18T13:46:39.455+00:00", "gmst_rad": 4.0793,
  "state": {"playing": true, "warp": 1, "enabled": ["GPS","OneWeb"], "track": "auto"},
  "station": {"name": "Ahmedabad", "lat": 23.0225, "lon": 72.5714, "teme_km": [x, y, z]},
  "constellations": {"OneWeb": {"count": 651, "positions_km": [x0,y0,z0, x1,y1,z1, ...]}},
  "visible": [{"c":"OneWeb","i":440,"name":"ONEWEB-0440","norad":50503,"el":51.7,"range_km":1290.2,
               "doppler_hz":-69325.1,"pred_hz":0.0123,"tracked":true}],
  "tracked": {
    "constellation": "OneWeb", "name": "ONEWEB-0440", "norad": 50503, "carrier_hz": 12200000000.0,
    "features": {"relative_velocity_km_s": 1.70, "elevation_angle_deg": 51.7,
                 "doppler_shift_hz": -69325.1, "clock_bias_seconds": -3.3e-8},
    "inference": {"future_doppler_error_hz": 0.012,          // LSTM prediction, 50 ms ahead
                  "truth_future_doppler_error_hz": 0.097,    // simulated ground truth
                  "residual_after_correction_hz": 0.085, "inference_ms": 1.8, "model_loaded": true}
  },
  "ttff": {"conventional_cold_start_s": 31.2, "leo_assisted_ms": 38.1, "speedup_x": 818.8, "target_met": true,
           "ephemeris_payload_bytes": 962, "ephemeris_sat_count": 23,
           "breakdown_ms": {"leo_round_trip": 9.7, "payload_tx": 0.39, "ai_inference": 1.8,
                            "doppler_search": 20.0, "processing": 8.0}}
}
```

## How the numbers are produced (read before presenting results)

* **Orbits** are real: SGP4 on the TLE files. Frames: TEME for positions, ECEF for geometry.
* **Features / target** follow the Colab definitions: Doppler = geometric Doppler + carrier x oscillator drift +
  0.02 Hz noise; `future_doppler_error_hz` = true Doppler at t+50 ms minus the receiver's own extrapolation
  (`doppler + rate x 0.05`). Carriers: NavIC 1176.45 MHz, GPS/Galileo 1575.42 MHz, OneWeb 12.2 GHz (assumption).
* **Clock bias** is a simulated oscillator model (no real satellite-clock data is used).
* **TTFF is an analytical model, not a receiver measurement.** The ~30 s cold start is a modelled constant. The
  LEO-assisted figure = LEO round-trip delay (from the real slant range to the best visible OneWeb satellite) +
  payload transmission at an assumed 20 Mbit/s + the *measured* LSTM batch-inference time + an assumed 20 ms
  Doppler-assisted search + an assumed 8 ms processing. Change the constants at the top of
  `apps/backend/app/services/simulation.py`.
* **Ephemeris payload**: header (19 B) + up to 23 records x 41 B (NORAD id, constellation, Keplerian elements,
  element age, Doppler, AI correction), CRC32-protected, at most 1000 bytes.

## Deviations from the requested tree

* `index.html` sits in `apps/frontend/` (Vite requires it at the project root, not in `public/`).
* The Vite config is `vite.config.js` (lower case - Vite does not find `Vite.config.js` on Linux/Docker).
* Extra files: `app/config.py`, `app/services/simulation.py`, `src/services/useTelemetry.js`,
  `tailwind.config.js`, `postcss.config.js`, and Dockerfile/nginx config for the dashboard.

## Troubleshooting

* *"LSTM not loaded"* banner - copy both Colab artefacts into `packages/open_ntn_ttff/models/`.
* *No satellites / empty globe* - check `NTN_DATASET_DIR` and `GET /api/health`.
* *Predictions look wrong* - the weights must come from the Colab script with the same `doppler_norm_stats.npz`;
  the backend rebuilds the network from the checkpoint and applies the same standardisation.

## Resources panel (research papers, 6G links, datasets)

The dashboard has a **5 · Research papers, 6G references & datasets** panel (header button "Resources"):

* **Research papers / 6G references** - edit `apps/frontend/src/data/resources.js` to add or remove entries.
  Links were collected from public sources and are not re-verified automatically, so open each one before citing it.
* **Datasets** - every file in `6G_Datasets/` has a download button, plus one ZIP with everything. The files are served
  from `apps/frontend/public/downloads/`. If you change `6G_Datasets/`, copy the changed files there too
  (and rebuild the ZIP). TLE files are real CelesTrak data; the ionosphere and trajectory files are **simulated**.

## Deploying: dashboard on Vercel, backend elsewhere

Vercel hosts the **React dashboard** (static files). It cannot host the FastAPI backend: Vercel functions do not
support long-lived WebSockets, and PyTorch exceeds the function size limit. So deploy in two parts:

### 1. Backend (Docker web service, e.g. Render)

1. Push the whole workspace to GitHub (`packages/open_ntn_ttff/models/*.pt` and `*.npz` must be included).
2. On https://render.com choose **New + -> Blueprint**, select the repo - it reads `render.yaml` and builds
   `apps/backend/Dockerfile` (the TLE files are baked into the image).
3. After the first deploy, note the URL, e.g. `https://ntn-ttff-backend.onrender.com`, and open `/api/health`.
4. In the service's Environment tab set `NTN_CORS_ORIGINS` to your Vercel URL (see below).

Notes: free Render instances sleep when idle (the first request can take about a minute) and have 512 MB RAM, which can
be tight for PyTorch - lower `NTN_MAX_ONEWEB`, use a paid plan, or use another Docker host (Railway, Fly.io,
Hugging Face Spaces). The backend only needs: Docker build context = repo root, Dockerfile = `apps/backend/Dockerfile`,
port from `$PORT`.

### 2. Frontend (Vercel)

1. On https://vercel.com choose **Add New -> Project**, import the same GitHub repo.
2. Set **Root Directory** to `apps/frontend` (Framework preset: Vite; `vercel.json` already sets build/output).
3. Add the environment variable `VITE_API_URL` = your backend URL (no trailing slash). The WebSocket URL
   (`wss://.../ws/telemetry`) is derived from it. Optionally set `VITE_WS_URL` explicitly.
4. Deploy. Open the Vercel URL: the status badge should show "WebSocket: connected".
5. Copy the Vercel URL into the backend's `NTN_CORS_ORIGINS` (or rely on `NTN_CORS_ORIGIN_REGEX`) and redeploy the backend if needed.

CLI alternative: `cd apps/frontend && npm i -g vercel && vercel --prod` (set `VITE_API_URL` first with `vercel env add`).
`VITE_*` variables are baked in at build time, so redeploy after changing them.
