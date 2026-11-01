"""
Real-time Doppler error residual estimator.

Loads the LSTM weights trained in Google Colab (`doppler_lstm_weights.pt`) together with the
standardisation statistics (`doppler_norm_stats.npz`) and predicts the Doppler residual 50 ms
ahead for batches of 10-step feature windows.

The architecture is rebuilt from the checkpoint itself (input size, hidden size, layer count),
so changing the Colab hyper-parameters does not require touching this file.
"""
from __future__ import annotations

import logging
import time
from pathlib import Path

import numpy as np

try:
    import torch
    import torch.nn as nn
    TORCH_OK = True
except ImportError:                                  # lets the rest of the API start without torch
    torch, nn, TORCH_OK = None, None, False

log = logging.getLogger("ntn.predictor")

if TORCH_OK:
    class DopplerLSTMModel(nn.Module):
        """Same architecture as the Colab training script (2-layer LSTM + linear head)."""

        def __init__(self, input_size, hidden_size=128, num_layers=2, dropout=0.2):
            super().__init__()
            self.lstm = nn.LSTM(input_size, hidden_size, num_layers=num_layers, batch_first=True,
                                dropout=dropout if num_layers > 1 else 0.0)
            self.head = nn.Linear(hidden_size, 1)

        def forward(self, x):                        # x: (batch, window, input_size)
            out, _ = self.lstm(x)
            return self.head(out[:, -1, :]).squeeze(-1)
else:
    DopplerLSTMModel = None


class DopplerPredictor:
    """Thin inference wrapper. `loaded` is False when weights/stats are missing (zero correction)."""

    def __init__(self, weights_path: Path, norm_path: Path, device: str | None = None):
        self.weights_path, self.norm_path = Path(weights_path), Path(norm_path)
        self.loaded = False
        self.reason = ""
        self.device = None
        self.model = None
        self.window = 10
        self.use_delta = True
        self.info: dict = {}
        try:
            self._load(device)
        except Exception as exc:                     # keep the API alive, report the reason
            self.reason = f"{type(exc).__name__}: {exc}"
            log.error("Doppler LSTM not loaded - %s", self.reason)

    # ------------------------------------------------------------------ loading
    def _load(self, device):
        if not TORCH_OK:
            raise RuntimeError("PyTorch is not installed")
        if not self.weights_path.is_file():
            raise FileNotFoundError(f"weights not found: {self.weights_path}")
        if not self.norm_path.is_file():
            raise FileNotFoundError(f"normalisation stats not found: {self.norm_path} "
                                    "(copy doppler_norm_stats.npz from Colab next to the weights)")
        stats = np.load(self.norm_path, allow_pickle=False)
        self.x_mean, self.x_std = stats["x_mean"].astype(np.float64), stats["x_std"].astype(np.float64)
        self.y_mean, self.y_std = float(stats["y_mean"]), float(stats["y_std"])
        self.use_delta = bool(stats["use_delta"]) if "use_delta" in stats else len(self.x_mean) > 4
        self.window = int(stats["window"]) if "window" in stats else 10

        self.device = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
        state = torch.load(self.weights_path, map_location=self.device)
        w_ih = state["lstm.weight_ih_l0"]
        hidden, input_size = w_ih.shape[0] // 4, w_ih.shape[1]
        layers = sum(1 for k in state if k.startswith("lstm.weight_ih_l") and not k.endswith("reverse"))
        if input_size != len(self.x_mean):
            raise ValueError(f"checkpoint expects {input_size} inputs but norm stats have {len(self.x_mean)}")

        self.model = DopplerLSTMModel(input_size, hidden, layers, dropout=0.0).to(self.device)
        self.model.load_state_dict(state)
        self.model.eval()
        self.loaded = True
        self.info = {"input_size": input_size, "hidden_size": hidden, "num_layers": layers,
                     "window": self.window, "use_delta_features": self.use_delta,
                     "device": str(self.device), "target_std_hz": self.y_std,
                     "parameters": int(sum(p.numel() for p in self.model.parameters()))}
        log.info("Doppler LSTM loaded: %s", self.info)

    # ------------------------------------------------------------------ inference
    def _prepare(self, windows: np.ndarray) -> np.ndarray:
        x = np.asarray(windows, dtype=np.float64)                       # (B, W, 4)
        if self.use_delta:
            x = np.concatenate([x, np.diff(x, axis=1, prepend=x[:, :1, :])], axis=2)
        x = (x - self.x_mean) / self.x_std
        return np.clip(x, -12.0, 12.0).astype(np.float32)               # guard against out-of-range inputs

    def predict_windows(self, windows: np.ndarray) -> tuple[np.ndarray, float]:
        """windows (B, WINDOW, 4) raw features -> (predicted future_doppler_error_hz (B,), latency_ms)."""
        windows = np.asarray(windows, dtype=np.float64)
        if windows.ndim == 2:
            windows = windows[None]
        if not self.loaded or windows.shape[0] == 0:
            return np.zeros(windows.shape[0]), 0.0
        x = torch.from_numpy(self._prepare(windows)).to(self.device)
        t0 = time.perf_counter()
        with torch.inference_mode():
            y = self.model(x)
            if self.device.type == "cuda":
                torch.cuda.synchronize()
        latency_ms = (time.perf_counter() - t0) * 1e3
        return y.cpu().numpy().astype(np.float64) * self.y_std + self.y_mean, latency_ms

    def status(self) -> dict:
        return {"loaded": self.loaded, "reason": self.reason, "weights": str(self.weights_path),
                "norm_stats": str(self.norm_path), **self.info}
