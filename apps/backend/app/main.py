"""FastAPI entrypoint for the 6G LEO-Assisted Fast GNSS TTFF Engine."""
import logging
import sys
from contextlib import asynccontextmanager

from . import config

# Make the shared `open_ntn_ttff` package importable when running from the monorepo checkout.
if str(config.PACKAGES_DIR) not in sys.path:
    sys.path.insert(0, str(config.PACKAGES_DIR))

from fastapi import FastAPI                                   # noqa: E402
from fastapi.middleware.cors import CORSMiddleware            # noqa: E402

from open_ntn_ttff.dataset_loader import load_constellations  # noqa: E402
from open_ntn_ttff.propagator import Receiver                 # noqa: E402

from .routers import inference, telemetry                     # noqa: E402
from .services.predictor import DopplerPredictor              # noqa: E402
from .services.simulation import SimulationEngine             # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("ntn.main")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Load TLEs, the LSTM weights and the simulation engine once at start-up."""
    log.info("Dataset directory: %s", config.DATASET_DIR)
    constellations = load_constellations(config.DATASET_DIR, max_sats={"OneWeb": config.MAX_ONEWEB})
    predictor = DopplerPredictor(config.WEIGHTS_PATH, config.NORM_PATH)
    receiver = Receiver(config.STATION_NAME, config.STATION_LAT, config.STATION_LON, config.STATION_ALT_KM)
    app.state.predictor = predictor
    app.state.engine = SimulationEngine(constellations, receiver, predictor, config.MIN_ELEVATION_DEG)
    log.info("Ready: %s | LSTM loaded: %s", {n: len(c) for n, c in constellations.items()}, predictor.loaded)
    yield


app = FastAPI(title="6G LEO-Assisted Fast GNSS TTFF Engine", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_origin_regex=config.CORS_ORIGIN_REGEX,
                   allow_methods=["*"], allow_headers=["*"])
app.include_router(telemetry.router)
app.include_router(inference.router)


@app.get("/api/health")
async def health():
    engine, predictor = app.state.engine, app.state.predictor
    return {"status": "ok", "constellations": {n: len(c) for n, c in engine.cons.items()},
            "model_loaded": predictor.loaded, "model_reason": predictor.reason or None}
