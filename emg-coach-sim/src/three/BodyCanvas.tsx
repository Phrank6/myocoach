import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html, OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { CanvasTexture, CapsuleGeometry, Color, CylinderGeometry, Group, LatheGeometry, MeshStandardMaterial, SphereGeometry, Spherical, Vector2, Vector3, BoxGeometry } from 'three';
import { NEUTRAL_POSE, type Pose } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, muscleLabel, type MuscleId } from '../domain/muscles';
import { bodyDims, type BodyDims, type BodyProfile } from '../domain/profile';
import { heatColor } from './heat';

export interface BodyCanvasProps {
  profile: BodyProfile;
  /** Per-muscle value 0..1 (activation or normalised load), read every frame. */
  getValues: () => number[];
  getPose?: () => Pose;
  selected?: MuscleId | null;
  onSelect?: (m: MuscleId | null) => void;
  dumbbells?: boolean;
  autoRotate?: boolean;
  smoothing?: number;
  valueLabel?: string;
  facing?: { side: 'front' | 'back'; n: number };
  /** Floating labels pinned to muscles (used on the summary). */
  labels?: { muscle: MuscleId; text: string }[];
  hint?: boolean;
}

type Mats = Record<MuscleId, MeshStandardMaterial>;
interface ArmRefs {
  yaw: Group | null;
  joint: Group | null;
  elbow: Group | null;
}

const SPHERE = new SphereGeometry(1, 28, 18);
const DEG = Math.PI / 180;
const skinMat = new MeshStandardMaterial({ color: '#2a2c33', roughness: 0.8, metalness: 0.05 });
const skinDark = new MeshStandardMaterial({ color: '#1f2026', roughness: 0.85 });
const ironMat = new MeshStandardMaterial({ color: '#8d8f96', roughness: 0.3, metalness: 0.85 });
const SELECT = new Color('#ff7a45');

function floorTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
  grad.addColorStop(0, 'rgba(255,255,255,0.10)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.03)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 256, 256);
  return new CanvasTexture(c);
}

/** Label anchor per muscle on the +x side, in body units, for the neutral pose. */
function labelAnchor(m: MuscleId, d: BodyDims): [number, number, number] {
  const w = d.width;
  const sx = 0.2 * w + 0.012;
  const L1 = 0.29 * d.arm;
  switch (m) {
    case 'pecs': return [0.085 * w, 1.36, 0.14 * w];
    case 'delt_front': return [sx + 0.01, 1.4, 0.08];
    case 'delt_side': return [sx + 0.075, 1.39, 0];
    case 'delt_rear': return [sx + 0.01, 1.39, -0.08];
    case 'biceps': return [sx + 0.03, 1.43 - L1 * 0.55, 0.06];
    case 'triceps': return [sx + 0.03, 1.43 - L1 * 0.45, -0.07];
    case 'forearms': return [sx + 0.06, 1.43 - L1 - 0.08, 0.04];
    case 'lats': return [0.17 * w + 0.03, 1.24, -0.04];
    case 'traps': return [0.08 * w, 1.51, -0.03];
    case 'rhomboids': return [0.06 * w, 1.29, -0.14 * w];
  }
}

interface MuscleProps {
  id: MuscleId;
  mats: Mats;
  position: [number, number, number];
  scale: [number, number, number];
  rotation?: [number, number, number];
  onSelect?: (m: MuscleId | null) => void;
  onHover: (m: MuscleId | null) => void;
}

function Muscle({ id, mats, position, scale, rotation, onSelect, onHover }: MuscleProps) {
  return (
    <mesh
      geometry={SPHERE}
      material={mats[id]}
      position={position}
      scale={scale}
      rotation={rotation}
     
      onClick={(e: ThreeEvent<MouseEvent>) => {
        e.stopPropagation();
        onSelect?.(id);
      }}
      onPointerOver={(e: ThreeEvent<PointerEvent>) => {
        e.stopPropagation();
        onHover(id);
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        onHover(null);
        document.body.style.cursor = '';
      }}
    />
  );
}

function Arm({ side, d, mats, refs, onSelect, onHover, dumbbells }: {
  side: 1 | -1;
  d: BodyDims;
  mats: Mats;
  refs: MutableRefObject<ArmRefs>;
  onSelect?: (m: MuscleId | null) => void;
  onHover: (m: MuscleId | null) => void;
  dumbbells: boolean;
}) {
  const mf = d.muscle;
  const L1 = 0.29 * d.arm;
  const L2 = 0.26 * d.arm;
  const geo = useMemo(
    () => ({
      upper: new CapsuleGeometry(0.04, L1 - 0.06, 6, 14),
      fore: new CapsuleGeometry(0.032, L2 - 0.05, 6, 14),
      handle: new CylinderGeometry(0.012, 0.012, 0.16, 10),
      plate: new BoxGeometry(0.035, 0.1, 0.1),
    }),
    [L1, L2],
  );
  const sx = 0.2 * d.width + 0.012;
  const mp = { mats, onSelect, onHover };
  return (
    <group ref={(g) => { refs.current.yaw = g; }} position={[side * sx, 1.43, -0.005]}>
      <group ref={(g) => { refs.current.joint = g; }}>
        <mesh geometry={SPHERE} material={skinMat} scale={0.052} />
        <Muscle id="delt_front" {...mp} position={[side * 0.008, -0.035, 0.045]} scale={[0.048 * mf, 0.085, 0.036 * mf]} rotation={[0.15, 0, 0]} />
        <Muscle id="delt_side" {...mp} position={[side * 0.048, -0.04, 0]} scale={[0.036 * mf, 0.09, 0.05 * mf]} rotation={[0, 0, side * 0.12]} />
        <Muscle id="delt_rear" {...mp} position={[side * 0.008, -0.035, -0.045]} scale={[0.048 * mf, 0.085, 0.036 * mf]} rotation={[-0.15, 0, 0]} />
        <mesh geometry={geo.upper} material={skinMat} position={[0, -L1 / 2, 0]} />
        <Muscle id="biceps" {...mp} position={[0, -L1 * 0.54, 0.03]} scale={[0.034 * mf, L1 * 0.3, 0.033 * mf]} />
        <Muscle id="triceps" {...mp} position={[0, -L1 * 0.46, -0.031]} scale={[0.037 * mf, L1 * 0.37, 0.035 * mf]} />
        <group ref={(g) => { refs.current.elbow = g; }} position={[0, -L1, 0]}>
          <mesh geometry={SPHERE} material={skinDark} scale={0.036} />
          <mesh geometry={geo.fore} material={skinMat} position={[0, -L2 / 2, 0]} />
          <Muscle id="forearms" {...mp} position={[0, -L2 * 0.32, 0.004]} scale={[0.042 * mf, L2 * 0.36, 0.04 * mf]} />
          <mesh geometry={SPHERE} material={skinDark} position={[0, -L2 - 0.03, 0]} scale={[0.032, 0.045, 0.03]} />
          {dumbbells && (
            <group position={[0, -L2 - 0.035, 0.0]}>
              <mesh geometry={geo.handle} material={ironMat} rotation={[0, 0, Math.PI / 2]} />
              <mesh geometry={geo.plate} material={ironMat} position={[0.075, 0, 0]} />
              <mesh geometry={geo.plate} material={ironMat} position={[-0.075, 0, 0]} />
            </group>
          )}
        </group>
      </group>
    </group>
  );
}

function Body({ profile, getValues, getPose, selected, onSelect, onHover, dumbbells, smoothing, labels }: BodyCanvasProps & { onHover: (m: MuscleId | null) => void }) {
  const d = bodyDims(profile);
  const w = d.width;
  const mf = d.muscle;
  const mats = useMemo(
    () => Object.fromEntries(MUSCLE_IDS.map((m) => [m, new MeshStandardMaterial({ color: '#2c2e37', roughness: 0.42, metalness: 0.08, emissive: new Color('#000000') })])) as Mats,
    [],
  );
  const torso = useMemo(() => {
    const pts = [
      [0.0, 0.9], [0.125, 0.905], [0.14, 0.97], [0.132, 1.08], [0.148, 1.2], [0.168, 1.31], [0.174, 1.39], [0.15, 1.465], [0.075, 1.515], [0.0, 1.53],
    ].map(([r, y]) => new Vector2(r, y));
    return new LatheGeometry(pts, 32);
  }, []);
  const neck = useMemo(() => new CylinderGeometry(0.05, 0.058, 0.12, 16), []);
  const left = useRef<ArmRefs>({ yaw: null, joint: null, elbow: null });
  const right = useRef<ArmRefs>({ yaw: null, joint: null, elbow: null });
  const shown = useRef<number[]>(MUSCLE_IDS.map(() => 0));
  const tmp = useMemo(() => new Color(), []);
  const floor = useMemo(() => floorTexture(), []);

  useFrame(({ clock }) => {
    const vals = getValues();
    const k = smoothing ?? 0.25;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
    MUSCLE_IDS.forEach((m, i) => {
      const v = (shown.current[i] += ((vals[MUSCLE_INDEX[m]] ?? 0) - shown.current[i]) * k);
      const mat = mats[m];
      heatColor(v, mat.color);
      mat.emissive.copy(heatColor(v, tmp)).multiplyScalar(0.04 + 0.5 * Math.min(1, v) ** 1.4);
      if (selected === m) mat.emissive.lerp(SELECT, 0.35 + 0.25 * pulse);
    });
    const p = getPose?.() ?? NEUTRAL_POSE;
    for (const [side, r] of [[1, left.current], [-1, right.current]] as const) {
      if (!r.yaw || !r.joint || !r.elbow) continue;
      r.yaw.rotation.y = side * p.yaw * DEG;
      r.yaw.position.y = 1.43 + p.shrug * 0.035;
      r.joint.rotation.set(-p.flex * DEG, side * p.rot * DEG, side * p.abd * DEG, 'ZXY');
      r.elbow.rotation.x = -p.elbow * DEG;
    }
  });

  const mp = { mats, onSelect, onHover };
  return (
    <group scale={d.scale} position={[0, -0.9 * d.scale, 0]}>
      <mesh geometry={torso} material={skinMat} scale={[1.15 * w, 1, 0.68 * w]} />
      <mesh geometry={neck} material={skinMat} position={[0, 1.565, -0.005]} />
      <mesh geometry={SPHERE} material={skinMat} position={[0, 1.69, 0.005]} scale={[0.088, 0.108, 0.098]} />
      {([1, -1] as const).map((s) => (
        <group key={s}>
          <Muscle id="pecs" {...mp} position={[s * 0.085 * w, 1.355, 0.096 * w]} scale={[0.088 * w * mf ** 0.5, 0.064, 0.042 * mf]} rotation={[0.1, s * 0.18, s * -0.14]} />
          <Muscle id="lats" {...mp} position={[s * 0.148 * w, 1.24, -0.035 * w]} scale={[0.045 * mf, 0.145, 0.085 * w]} rotation={[0, 0, s * 0.22]} />
          <Muscle id="traps" {...mp} position={[s * 0.075 * w, 1.487, -0.02]} scale={[0.088 * w, 0.034 * mf, 0.055]} rotation={[0, 0, s * -0.42]} />
          <Muscle id="rhomboids" {...mp} position={[s * 0.058 * w, 1.29, -0.108 * w]} scale={[0.046 * w, 0.06, 0.028 * mf]} rotation={[-0.1, 0, s * 0.3]} />
        </group>
      ))}
      <Muscle id="traps" {...mp} position={[0, 1.4, -0.104 * w]} scale={[0.07 * w, 0.095, 0.03 * mf]} rotation={[-0.15, 0, 0]} />

      <Arm side={1} d={d} mats={mats} refs={left} onSelect={onSelect} onHover={onHover} dumbbells={!!dumbbells} />
      <Arm side={-1} d={d} mats={mats} refs={right} onSelect={onSelect} onHover={onHover} dumbbells={!!dumbbells} />

      <mesh position={[0, 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.62, 64]} />
        <meshBasicMaterial map={floor} transparent depthWrite={false} />
      </mesh>
      <mesh position={[0, 0.886, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.455, 0.46, 96]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.08} />
      </mesh>
      {labels && MUSCLE_IDS.map((m) => {
        // drei <Html> nodes throw on unmount under React 19, so they stay mounted and only toggle visibility.
        const l = labels.find((x) => x.muscle === m);
        return (
          <Html key={m} position={labelAnchor(m, d)} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
            <div className={`mlabel ${l ? '' : 'off'}`}>
              <i />
              <span>{l?.text ?? ''}</span>
            </div>
          </Html>
        );
      })}
    </group>
  );
}

/** Snaps the orbit camera to a front or back view whenever `facing` changes. */
function ViewSnap({ facing }: { facing?: { side: 'front' | 'back'; n: number } }) {
  const controls = useThree((s) => s.controls) as unknown as { target: Vector3; update: () => void } | null;
  const camera = useThree((s) => s.camera);
  useEffect(() => {
    if (!facing || !controls) return;
    const offset = camera.position.clone().sub(controls.target);
    const sph = new Spherical().setFromVector3(offset);
    sph.theta = facing.side === 'front' ? 0.3 : Math.PI + 0.3;
    camera.position.copy(controls.target).add(new Vector3().setFromSpherical(sph));
    controls.update();
  }, [facing, controls, camera]);
  return null;
}

export function BodyCanvas(props: BodyCanvasProps) {
  const [hover, setHover] = useState<MuscleId | null>(null);
  const valueRef = useRef(props.getValues);
  valueRef.current = props.getValues;
  const h = bodyDims(props.profile).scale;
  return (
    <div className="body-canvas">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0.9, 0.55 * h, 2.1], fov: 34 }}
        onPointerMissed={() => props.onSelect?.(null)}
        gl={{ preserveDrawingBuffer: true, antialias: true, alpha: true }}
      >
        <hemisphereLight args={['#d9dcff', '#0b0c0f', 0.55]} />
        <directionalLight position={[1.8, 2.6, 2.4]} intensity={1.7} color="#fff1e6" />
        <directionalLight position={[-2.4, 1.6, -2.2]} intensity={1.5} color="#8fa6ff" />
        <directionalLight position={[2.4, 0.8, -1.8]} intensity={0.6} color="#ffb48a" />
        <pointLight position={[0, 0.5, 1.6]} intensity={0.35} color="#ffffff" />
        <Body {...props} onHover={setHover} />
        <ViewSnap facing={props.facing} />
        <OrbitControls
          makeDefault
          target={[0, 0.38 * h, 0]}
          enablePan={false}
          minDistance={1.1}
          maxDistance={3.6}
          autoRotate={props.autoRotate}
          autoRotateSpeed={1.2}
          minPolarAngle={0.5}
          maxPolarAngle={2.2}
        />
      </Canvas>
      {hover && (
        <div className="hover-tip">
          <b>{muscleLabel(hover)}</b>
          <span>
            {Math.round((valueRef.current()[MUSCLE_INDEX[hover]] ?? 0) * 100)}% {props.valueLabel ?? 'activation'}
          </span>
        </div>
      )}
      {props.hint !== false && <div className="canvas-hint">Drag to orbit · click a muscle</div>}
    </div>
  );
}
