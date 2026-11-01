"""Runtime configuration (all values can be overridden with environment variables)."""
import os
from pathlib import Path

# <repo>/apps/backend/app/config.py  ->  parents[3] is the monorepo root
ROOT = Path(__file__).resolve().parents[3]
PACKAGES_DIR = ROOT / "packages"
MODELS_DIR = PACKAGES_DIR / "open_ntn_ttff" / "models"

# TLE files live in <workspace>/datasets (inside Docker they are mounted at /data/datasets)
DATASET_DIR = Path(os.getenv("NTN_DATASET_DIR", str(ROOT / "6G_Datasets")))

# Artefacts exported by the Colab notebook
WEIGHTS_PATH = Path(os.getenv("NTN_WEIGHTS_PATH", str(MODELS_DIR / "doppler_lstm_weights.pt")))
NORM_PATH = Path(os.getenv("NTN_NORM_PATH", str(MODELS_DIR / "doppler_norm_stats.npz")))

# Ground station (Ahmedabad)
STATION_NAME = os.getenv("NTN_STATION_NAME", "Ahmedabad")
STATION_LAT = float(os.getenv("NTN_STATION_LAT", "23.0225"))
STATION_LON = float(os.getenv("NTN_STATION_LON", "72.5714"))
STATION_ALT_KM = float(os.getenv("NTN_STATION_ALT_KM", "0.053"))

TICK_HZ = float(os.getenv("NTN_TICK_HZ", "5"))            # telemetry packets per wall-clock second
MIN_ELEVATION_DEG = float(os.getenv("NTN_MIN_ELEV_DEG", "10"))
MAX_ONEWEB = int(os.getenv("NTN_MAX_ONEWEB", "0")) or None  # cap OneWeb satellites (0 = all)

CORS_ORIGINS = [o.strip() for o in os.getenv(
    "NTN_CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o.strip()]
# Optional regex for extra origins, e.g. https://.*\.vercel\.app (Vercel production + preview URLs)
CORS_ORIGIN_REGEX = os.getenv("NTN_CORS_ORIGIN_REGEX", "") or None
