// Module 1 - Interactive 3D globe (Three.js via React Three Fiber).
//
// Frame handling: the backend streams inertial (TEME) positions plus the Earth's rotation angle
// (GMST). Satellites and orbit rings are drawn in the inertial frame; the Earth group is rotated by
// GMST, so the Ahmedabad pin (a child of the Earth group) stays at the right place on the globe.
// TEME (x, y, z) -> three.js (x, z, -y), 1 scene unit = 1 Earth radius.
import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Html, Line, OrbitControls, Stars } from '@react-three/drei'
import * as THREE from 'three'

const R_KM = 6378.137
const toScene = (x, y, z) => [x / R_KM, z / R_KM, -y / R_KM]

// latitude/longitude (deg) -> point on a sphere in the Earth-fixed three.js frame
function latLon(lat, lon, r = 1) {
  const p = (lat * Math.PI) / 180
  const l = (lon * Math.PI) / 180
  return [r * Math.cos(p) * Math.cos(l), r * Math.sin(p), -r * Math.cos(p) * Math.sin(l)]
}

function satPosition(packet, cons, index) {
  const flat = packet.constellations[cons]?.positions_km
  if (!flat) return null
  return toScene(flat[3 * index], flat[3 * index + 1], flat[3 * index + 2])
}

// ------------------------------------------------------------------ Earth + ground station
function StationPin({ lat, lon }) {
  const ring = useRef()
  const pos = useMemo(() => latLon(lat, lon, 1.006), [lat, lon])
  const quat = useMemo(() => {
    const n = new THREE.Vector3(...pos).normalize()
    return new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), n)
  }, [pos])
  useFrame(({ clock }) => {
    if (!ring.current) return
    const k = 1 + 0.6 * ((clock.elapsedTime * 1.2) % 1)
    ring.current.scale.set(k, k, k)
    ring.current.material.opacity = 0.9 * (1 - ((clock.elapsedTime * 1.2) % 1))
  })
  return (
    <group position={pos} quaternion={quat}>
      <mesh>
        <sphereGeometry args={[0.014, 16, 16]} />
        <meshBasicMaterial color="#f43f5e" />
      </mesh>
      <mesh ref={ring}>
        <ringGeometry args={[0.02, 0.026, 32]} />
        <meshBasicMaterial color="#f43f5e" transparent side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

function Earth({ gmst, station }) {
  const graticule = useMemo(() => {
    const pts = []
    for (let lat = -75; lat <= 75; lat += 15)
      for (let lon = 0; lon < 360; lon += 5) pts.push(...latLon(lat, lon, 1.002), ...latLon(lat, lon + 5, 1.002))
    for (let lon = 0; lon < 360; lon += 15)
      for (let lat = -90; lat < 90; lat += 5) pts.push(...latLon(lat, lon, 1.002), ...latLon(lat + 5, lon, 1.002))
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [])

  return (
    <group rotation={[0, gmst, 0]}>
      <mesh>
        <sphereGeometry args={[1, 64, 64]} />
        <meshStandardMaterial color="#0b2a4a" emissive="#06182c" roughness={0.95} metalness={0.05} />
      </mesh>
      <lineSegments geometry={graticule}>
        <lineBasicMaterial color="#2563a8" transparent opacity={0.45} />
      </lineSegments>
      {station && (
        <>
          <StationPin lat={station.lat} lon={station.lon} />
          <Html position={latLon(station.lat, station.lon, 1.05)} center style={{ pointerEvents: 'none' }}>
            <div className="whitespace-nowrap rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] text-rose-300">
              {station.name}
            </div>
          </Html>
        </>
      )}
    </group>
  )
}

// ------------------------------------------------------------------ orbit rings + satellites
function OrbitRings({ orbits, enabled, colors, opacity }) {
  const converted = useMemo(() => {
    const out = {}
    for (const [name, rings] of Object.entries(orbits?.orbits || {})) {
      out[name] = rings.map((ring) => {
        const pts = ring.map((p) => toScene(p[0], p[1], p[2]))
        if (pts.length) pts.push(pts[0])
        return pts
      })
    }
    return out
  }, [orbits])

  return Object.entries(converted).map(([name, rings]) =>
    enabled.includes(name)
      ? rings.map((pts, i) => (
          <Line key={`${name}-${i}`} points={pts} color={colors[name]} lineWidth={1} transparent opacity={opacity} />
        ))
      : null,
  )
}

function PointCloud({ flat, color, size, circle = true }) {
  const geo = useRef()
  useEffect(() => {
    if (!geo.current) return
    const arr = new Float32Array(flat.length)
    for (let i = 0; i < flat.length; i += 3) {
      const p = toScene(flat[i], flat[i + 1], flat[i + 2])
      arr[i] = p[0]
      arr[i + 1] = p[1]
      arr[i + 2] = p[2]
    }
    geo.current.setAttribute('position', new THREE.BufferAttribute(arr, 3))
    geo.current.computeBoundingSphere()
  }, [flat])
  return (
    <points frustumCulled={false}>
      <bufferGeometry ref={geo} />
      <pointsMaterial color={color} size={size} sizeAttenuation transparent opacity={circle ? 0.95 : 1} depthWrite={false} />
    </points>
  )
}

function VisiblePoints({ packet, ink }) {
  const flat = useMemo(() => {
    const out = []
    for (const v of packet.visible) {
      const p = packet.constellations[v.c]?.positions_km
      if (p) out.push(p[3 * v.i], p[3 * v.i + 1], p[3 * v.i + 2])
    }
    return out
  }, [packet])
  return flat.length ? <PointCloud flat={flat} color={ink} size={0.045} /> : null
}

// ------------------------------------------------------------------ animated RF links
function RfLink({ from, to, color, tracked, ink }) {
  const line = useRef()
  const pulse = useRef()
  useFrame(({ clock }, delta) => {
    if (!tracked) return
    if (line.current && line.current.material) line.current.material.dashOffset -= delta * 0.5
    if (pulse.current) {
      const u = (clock.elapsedTime * 0.9) % 1
      pulse.current.position.set(
        from[0] + (to[0] - from[0]) * u,
        from[1] + (to[1] - from[1]) * u,
        from[2] + (to[2] - from[2]) * u,
      )
    }
  })
  return (
    <>
      <Line
        ref={line}
        points={[from, to]}
        color={tracked ? ink : color}
        lineWidth={tracked ? 2.2 : 0.8}
        transparent
        opacity={tracked ? 0.95 : 0.3}
        dashed={tracked}
        dashSize={0.06}
        gapSize={0.04}
      />
      {tracked && (
        <mesh ref={pulse}>
          <sphereGeometry args={[0.013, 12, 12]} />
          <meshBasicMaterial color={color} />
        </mesh>
      )}
    </>
  )
}

function RfLinks({ packet, colors, ink }) {
  const station = toScene(...packet.station.teme_km)
  return packet.visible.map((v) => {
    const to = satPosition(packet, v.c, v.i)
    if (!to) return null
    return <RfLink key={`${v.c}-${v.i}`} from={station} to={to} color={colors[v.c]} tracked={v.tracked} ink={ink} />
  })
}

function TrackedLabel({ packet }) {
  const t = packet.visible.find((v) => v.tracked)
  if (!t) return null
  const p = satPosition(packet, t.c, t.i)
  if (!p) return null
  return (
    <Html position={p} center style={{ pointerEvents: 'none', transform: 'translateY(-16px)' }}>
      <div className="whitespace-nowrap rounded bg-slate-900/85 px-1.5 py-0.5 font-mono text-[10px] text-slate-100">
        {t.name} · {t.el.toFixed(0)}°
      </div>
    </Html>
  )
}

// ------------------------------------------------------------------ public component
export default function GlobeViewer({ packet, hello, orbits, enabled, theme = 'dark' }) {
  const light = theme === 'light'
  const ink = light ? '#0f172a' : '#ffffff'      // colour of highlighted satellites / tracked link
  const colors = useMemo(
    () => Object.fromEntries((hello?.constellations || []).map((c) => [c.name, c.color])),
    [hello],
  )
  const gmst = packet ? packet.gmst_rad : 0

  return (
    <div className="absolute inset-0 overflow-hidden rounded-lg bg-slate-950">
      <Canvas camera={{ position: [0, 1.4, 3.6], fov: 45 }} dpr={[1, 2]}>
        <color attach="background" args={[light ? '#e8eef6' : '#020617']} />
        <ambientLight intensity={0.7} />
        <directionalLight position={[5, 3, 5]} intensity={1.3} />
        {!light && <Stars radius={90} depth={40} count={2500} factor={3} fade />}
        <Earth gmst={gmst} station={hello?.station} />
        {/* soft atmosphere */}
        <mesh>
          <sphereGeometry args={[1.035, 48, 48]} />
          <meshBasicMaterial color="#38bdf8" transparent opacity={0.07} side={THREE.BackSide} />
        </mesh>
        <OrbitRings orbits={orbits} enabled={enabled} colors={colors} opacity={light ? 0.6 : 0.3} />
        {packet &&
          Object.entries(packet.constellations).map(([name, c]) => (
            <PointCloud key={name} flat={c.positions_km} color={colors[name] || '#ffffff'} size={name === 'OneWeb' ? 0.016 : 0.03} />
          ))}
        {packet && <VisiblePoints packet={packet} ink={ink} />}
        {packet && <RfLinks packet={packet} colors={colors} ink={ink} />}
        {packet && <TrackedLabel packet={packet} />}
        <OrbitControls enablePan={false} minDistance={1.6} maxDistance={16} rotateSpeed={0.6} />
      </Canvas>

      <div className="pointer-events-none absolute left-3 top-3 space-y-1 rounded bg-slate-950/70 p-2 text-[11px]">
        {(hello?.constellations || []).map((c) => (
          <div key={c.name} className={`flex items-center gap-2 ${enabled.includes(c.name) ? '' : 'opacity-30'}`}>
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: c.color }} />
            {c.name}
          </div>
        ))}
        <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-slate-100" />visible</div>
        <div className="flex items-center gap-2"><span className="inline-block h-2 w-2 rounded-full bg-rose-500" />ground station</div>
      </div>
      <div className="pointer-events-none absolute bottom-2 right-3 text-[10px] text-slate-500">drag to rotate · scroll to zoom</div>
    </div>
  )
}
