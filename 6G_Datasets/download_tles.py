"""Re-download fresh TLE sets from CelesTrak (run on a machine with internet)."""
import urllib.request, pathlib
OUT = pathlib.Path(__file__).parent
BASE = "https://celestrak.org/NORAD/elements/gp.php?GROUP={g}&FORMAT=tle"
SETS = {
    "navic_constellation.tle": "irnss",
    "gps_constellation.tle": "gps-ops",
    "galileo_constellation.tle": "galileo",
    "leo_6g_oneweb.tle": "oneweb",
    "leo_6g_starlink.tle": "starlink",
    "sbas_gagan.tle": "sbas",
}
for name, group in SETS.items():
    data = urllib.request.urlopen(BASE.format(g=group), timeout=60).read()
    (OUT / name).write_bytes(data.replace(b"\r", b""))
    print("saved", name, len(data), "bytes")
