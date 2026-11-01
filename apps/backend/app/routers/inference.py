"""PyTorch LSTM inference endpoints."""
import numpy as np
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

router = APIRouter(prefix="/api/inference", tags=["inference"])


class PredictRequest(BaseModel):
    """Batch of raw (un-normalised) windows: [batch][10 steps][4 features].

    Feature order: relative_velocity_km_s, elevation_angle_deg, doppler_shift_hz, clock_bias_seconds.
    """
    windows: list[list[list[float]]] = Field(..., min_length=1, max_length=512)


class PredictResponse(BaseModel):
    model_config = ConfigDict(protected_namespaces=())   # allow the field name "model_loaded"

    future_doppler_error_hz: list[float]
    horizon_ms: int = 50
    inference_ms: float
    model_loaded: bool


@router.get("/model")
async def model_info(request: Request):
    """Whether the Colab-trained weights are loaded, plus architecture details."""
    return request.app.state.predictor.status()


@router.post("/predict", response_model=PredictResponse)
async def predict(body: PredictRequest, request: Request):
    predictor = request.app.state.predictor
    arr = np.asarray(body.windows, dtype=np.float64)
    if arr.ndim != 3 or arr.shape[1] != predictor.window or arr.shape[2] != 4:
        raise HTTPException(422, f"windows must have shape [batch, {predictor.window}, 4]; got {list(arr.shape)}")
    preds, ms = predictor.predict_windows(arr)
    return PredictResponse(future_doppler_error_hz=[float(x) for x in preds], inference_ms=ms,
                           model_loaded=predictor.loaded)
