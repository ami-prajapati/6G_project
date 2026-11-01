"""Live simulation + WebSocket telemetry stream."""
import asyncio
import json
import logging
import time

from fastapi import APIRouter, Request, WebSocket, WebSocketDisconnect

from .. import config
from ..services.simulation import SimulationSession

log = logging.getLogger("ntn.telemetry")
router = APIRouter(tags=["telemetry"])


@router.get("/api/telemetry/orbits")
async def orbits(request: Request):
    """Orbit rings (TEME frame, km) for the 3-D globe."""
    return request.app.state.engine.orbits_payload()


@router.get("/api/telemetry/constellations")
async def constellations(request: Request):
    return request.app.state.engine.hello_message()


@router.get("/api/telemetry/snapshot")
async def snapshot(request: Request):
    """A single telemetry packet at the current time (handy for curl / debugging)."""
    session = SimulationSession(request.app.state.engine)
    return await asyncio.to_thread(session.step, 0.0)


@router.websocket("/ws/telemetry")
async def telemetry_ws(ws: WebSocket):
    """
    One independent simulation per connection.

    server -> client : {"type":"hello"...} once, then {"type":"telemetry"...} at NTN_TICK_HZ
    client -> server : {"cmd":"play"|"pause"|"reset"}
                       {"cmd":"warp","value":1|10|60}
                       {"cmd":"constellations","enabled":["GPS","OneWeb"]}
                       {"cmd":"track","value":"auto"|"OneWeb"|...}
    """
    await ws.accept()
    engine = ws.app.state.engine
    session = SimulationSession(engine)
    await ws.send_text(json.dumps(engine.hello_message(), separators=(",", ":")))

    async def reader():
        while True:
            try:
                msg = json.loads(await ws.receive_text())
            except json.JSONDecodeError:
                continue
            if isinstance(msg, dict):
                await ws.send_text(json.dumps(session.apply_command(msg), separators=(",", ":")))

    async def writer():
        period, last = 1.0 / config.TICK_HZ, time.monotonic()
        while True:
            now = time.monotonic()
            packet = await asyncio.to_thread(session.step, now - last)
            last = now
            await ws.send_text(json.dumps(packet, separators=(",", ":")))
            await asyncio.sleep(max(0.0, period - (time.monotonic() - now)))

    tasks = [asyncio.create_task(reader()), asyncio.create_task(writer())]
    try:
        done, _ = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for t in done:
            exc = t.exception()
            if exc and not isinstance(exc, WebSocketDisconnect):
                log.warning("telemetry stream ended: %r", exc)
    finally:
        for t in tasks:
            t.cancel()
