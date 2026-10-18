import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import {
  BoxGeometry,
  BufferGeometry,
  CapsuleGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  LatheGeometry,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PlaneGeometry,
  SphereGeometry,
  Spherical,
  Vector2,
  Vector3,
} from 'three';
import { NEUTRAL_POSE, type Pose } from '../domain/exercises';
import { MUSCLE_IDS, MUSCLE_INDEX, muscleLabel, type MuscleId } from '../domain/muscles';
import { bodyDims, type BodyDims, type BodyProfile } from '../domain/profile';
import { heatColor } from './heat';
import { useTheme, type Theme } from '../theme';
import { useElectrodes } from '../overlay';
import {
  buildPatch,
  fiberTexture,
  forearmSurface,
  muscleSpecs,
  padPlacements,
  padTexture,
  padTransform,
  torsoSurface,
  upperArmSurface,
  TORSO_PROFILE,
  type MuscleSpec,
  type PadPlacement,
  type Surface,
} from './anatomy';

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
}

type Mats = Record<MuscleId, MeshPhysicalMaterial>;
interface ArmRefs {
  yaw: Group | null;
  joint: Group | null;
  elbow: Group | null;
}

const SPHERE = new SphereGeometry(1, 32, 22);
const DEG = Math.PI / 180;
/** Light is Eason's white scene; dark keeps his warm tan mannequin and accents on a warm charcoal ground. */
const SCENE: Record<Theme, { bg: string; skin: string; skinDark: string; floor: string; ring: string; hemi: number; muscle: string }> = {
  light: { bg: '#FFFFFF', skin: '#D9BD8D', skinDark: '#B99B6F', floor: '#F4F4F4', ring: '#C24C30', hemi: 0.9, muscle: '#C4846A' },
  dark: { bg: '#1a1817', skin: '#8a7253', skinDark: '#6d5940', floor: '#262321', ring: '#E66A32', hemi: 0.75, muscle: '#7d5242' },
};
const skinMat = new MeshStandardMaterial({ color: SCENE.light.skin, roughness: 0.82, metalness: 0 });
const skinDark = new MeshStandardMaterial({ color: SCENE.light.skinDark, roughness: 0.85, metalness: 0 });
const ironMat = new MeshStandardMaterial({ color: '#9aa3b5', roughness: 0.35, metalness: 0.8 });
const PAD_PAIR = new PlaneGeometry(0.034, 0.062);
const PAD_REF = new PlaneGeometry(0.036, 0.036);
const GLOW = new Color('#FFD9A0');

function makeMuscleMat(): MeshPhysicalMaterial {
  const tex = fiberTexture();
  return new MeshPhysicalMaterial({
    color: SCENE.light.muscle,
    map: tex,
    bumpMap: tex,
    bumpScale: 1.4,
    vertexColors: true,
    roughness: 0.52,
    metalness: 0,
    clearcoat: 0.28,
    clearcoatRoughness: 0.45,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new Color('#FFE3CC'),
    emissive: new Color('#000000'),
  });
}

interface MuscleProps {
  id: MuscleId;
  geometry: BufferGeometry;
  mats: Mats;
  mirror?: boolean;
  onSelect?: (m: MuscleId | null) => void;
  onHover: (m: MuscleId | null) => void;
}

function Muscle({ id, geometry, mats, mirror, onSelect, onHover }: MuscleProps) {
  return (
    <mesh
      geometry={geometry}
      material={mats[id]}
      scale={mirror ? [-1, 1, 1] : undefined}
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

function Pad({ surf, pad, mirror, theme }: { surf: Surface; pad: PadPlacement; mirror: boolean; theme: Theme }) {
  const tf = useMemo(() => padTransform(surf, pad.u, pad.v, pad.lift, pad.rot, mirror), [surf, pad, mirror]);
  const mat = useMemo(
    () => new MeshStandardMaterial({ map: padTexture(pad.no, theme === 'dark'), transparent: true, alphaTest: 0.4, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -2 }),
    [pad.no, theme],
  );
  return <mesh geometry={PAD_PAIR} material={mat} position={tf.position} quaternion={tf.quaternion} raycast={() => null} />;
}

function RefPad({ theme }: { theme: Theme }) {
  const mat = useMemo(
    () => new MeshStandardMaterial({ map: padTexture('REF', theme === 'dark'), transparent: true, alphaTest: 0.4, roughness: 0.9 }),
    [theme],
  );
  return <mesh geometry={PAD_REF} material={mat} position={[0, 1.548, -0.067]} rotation={[0, Math.PI, 0]} raycast={() => null} />;
}

function Arm({ side, d, mats, specs, refs, onSelect, onHover, dumbbells, pads, electrodes, theme }: {
  side: 1 | -1;
  d: BodyDims;
  mats: Mats;
  specs: { upper: [MuscleSpec, BufferGeometry][]; fore: [MuscleSpec, BufferGeometry][] };
  refs: MutableRefObject<ArmRefs>;
  onSelect?: (m: MuscleId | null) => void;
  onHover: (m: MuscleId | null) => void;
  dumbbells: boolean;
  pads: PadPlacement[];
  electrodes: boolean;
  theme: Theme;
}) {
  const L1 = 0.29 * d.arm;
  const L2 = 0.26 * d.arm;
  const geo = useMemo(
    () => ({
      upper: new CapsuleGeometry(0.04, L1 - 0.06, 8, 20),
      fore: new CapsuleGeometry(0.032, L2 - 0.05, 8, 20),
      handle: new CylinderGeometry(0.012, 0.012, 0.16, 10),
      plate: new BoxGeometry(0.035, 0.1, 0.1),
    }),
    [L1, L2],
  );
  const upperSurf = useMemo(() => upperArmSurface(L1), [L1]);
  const sx = 0.2 * d.width + 0.012;
  const mirror = side < 0;
  const mp = { mats, onSelect, onHover, mirror };
  return (
    <group ref={(g) => { refs.current.yaw = g; }} position={[side * sx, 1.43, -0.005]}>
      <group ref={(g) => { refs.current.joint = g; }}>
        <mesh geometry={SPHERE} material={skinMat} scale={0.052} />
        <mesh geometry={geo.upper} material={skinMat} position={[0, -L1 / 2, 0]} />
        {specs.upper.map(([s, g], i) => <Muscle key={i} id={s.id} geometry={g} {...mp} />)}
        <group visible={electrodes}>
          {pads.map((p) => <Pad key={p.no} surf={upperSurf} pad={p} mirror={mirror} theme={theme} />)}
        </group>
        <group ref={(g) => { refs.current.elbow = g; }} position={[0, -L1, 0]}>
          <mesh geometry={SPHERE} material={skinDark} scale={0.036} />
          <mesh geometry={geo.fore} material={skinMat} position={[0, -L2 / 2, 0]} />
          {specs.fore.map(([s, g], i) => <Muscle key={i} id={s.id} geometry={g} {...mp} />)}
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

function Body({ profile, getValues, getPose, selected, onSelect, onHover, dumbbells, smoothing, theme, electrodes }: BodyCanvasProps & { onHover: (m: MuscleId | null) => void; theme: Theme; electrodes: boolean }) {
  useEffect(() => {
    skinMat.color.set(SCENE[theme].skin);
    skinDark.color.set(SCENE[theme].skinDark);
  }, [theme]);
  const d = bodyDims(profile);
  const w = d.width;
  const mf = d.muscle;
  const L1 = 0.29 * d.arm;
  const L2 = 0.26 * d.arm;
  const mats = useMemo(() => Object.fromEntries(MUSCLE_IDS.map((m) => [m, makeMuscleMat()])) as Mats, []);
  const front = useMemo(() => torsoSurface(w, false), [w]);
  const back = useMemo(() => torsoSurface(w, true), [w]);
  const built = useMemo(() => {
    const upperS = upperArmSurface(L1);
    const foreS = forearmSurface(L2);
    const out = { front: [] as [MuscleSpec, BufferGeometry][], back: [] as [MuscleSpec, BufferGeometry][], upper: [] as [MuscleSpec, BufferGeometry][], fore: [] as [MuscleSpec, BufferGeometry][] };
    for (const s of muscleSpecs(mf, L1, L2)) {
      const surf = s.region === 'front' ? front : s.region === 'back' ? back : s.region === 'upper' ? upperS : foreS;
      out[s.region].push([s, buildPatch(surf, s)]);
    }
    return out;
  }, [mf, L1, L2, front, back]);
  useEffect(() => () => {
    for (const list of Object.values(built)) for (const [, g] of list) g.dispose();
  }, [built]);
  const pads = useMemo(() => padPlacements(mf, L1), [mf, L1]);
  const armPads = useMemo(() => pads.filter((p) => p.region === 'upper'), [pads]);
  const torso = useMemo(() => new LatheGeometry(TORSO_PROFILE.map(([r, y]) => new Vector2(r, y)), 48), []);
  const neck = useMemo(() => new CylinderGeometry(0.05, 0.058, 0.12, 20), []);
  const left = useRef<ArmRefs>({ yaw: null, joint: null, elbow: null });
  const right = useRef<ArmRefs>({ yaw: null, joint: null, elbow: null });
  const shown = useRef<number[]>(MUSCLE_IDS.map(() => 0));
  const tmp = useMemo(() => new Color(), []);
  const base = useMemo(() => new Color(), []);
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useFrame(({ clock }) => {
    const vals = getValues();
    const k = smoothing ?? 0.25;
    const pulse = 0.5 + 0.5 * Math.sin(clock.elapsedTime * 6);
    base.set(SCENE[themeRef.current].muscle);
    MUSCLE_IDS.forEach((m, i) => {
      const v = (shown.current[i] += ((vals[MUSCLE_INDEX[m]] ?? 0) - shown.current[i]) * k);
      const mat = mats[m];
      const x = Math.min(1, Math.max(0, v / 0.7));
      const mix = 0.12 + 0.88 * x * x * (3 - 2 * x);
      heatColor(v, tmp);
      mat.color.copy(base).lerp(tmp, mix);
      mat.emissive.copy(tmp).multiplyScalar(0.05 + 0.28 * Math.min(1, v));
      if (selected === m) mat.emissive.lerp(GLOW, 0.14 + 0.1 * pulse);
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
  const armSpecs = { upper: built.upper, fore: built.fore };
  return (
    <group scale={d.scale} position={[0, -0.9 * d.scale, 0]}>
      <mesh geometry={torso} material={skinMat} scale={[1.15 * w, 1, 0.68 * w]} />
      <mesh geometry={neck} material={skinMat} position={[0, 1.565, -0.005]} />
      <mesh geometry={SPHERE} material={skinMat} position={[0, 1.69, 0.005]} scale={[0.088, 0.108, 0.098]} />
      {[false, true].map((mirror) => (
        <group key={String(mirror)}>
          {built.front.map(([s, g], i) => <Muscle key={`f${i}`} id={s.id} geometry={g} mirror={mirror} {...mp} />)}
          {built.back.map(([s, g], i) => <Muscle key={`b${i}`} id={s.id} geometry={g} mirror={mirror} {...mp} />)}
          <group visible={electrodes}>
            {pads.filter((p) => p.region === 'front').map((p) => <Pad key={p.no} surf={front} pad={p} mirror={mirror} theme={theme} />)}
            {pads.filter((p) => p.region === 'back').map((p) => <Pad key={p.no} surf={back} pad={p} mirror={mirror} theme={theme} />)}
          </group>
        </group>
      ))}
      <group visible={electrodes}>
        <RefPad theme={theme} />
      </group>

      <Arm side={1} d={d} mats={mats} specs={armSpecs} refs={left} onSelect={onSelect} onHover={onHover} dumbbells={!!dumbbells} pads={armPads} electrodes={electrodes} theme={theme} />
      <Arm side={-1} d={d} mats={mats} specs={armSpecs} refs={right} onSelect={onSelect} onHover={onHover} dumbbells={!!dumbbells} pads={armPads} electrodes={electrodes} theme={theme} />

      <mesh position={[0, 0.885, 0]} rotation={[-Math.PI / 2, 0, 0]} geometry={FLOOR}>
        <meshStandardMaterial color={SCENE[theme].floor} roughness={1} />
      </mesh>
      <mesh position={[0, 0.887, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.48, 0.5, 64]} />
        <meshBasicMaterial color={SCENE[theme].ring} transparent opacity={0.55} />
      </mesh>
    </group>
  );
}

const FLOOR = new CircleGeometry(0.5, 48);

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
  const theme = useTheme();
  const electrodes = useElectrodes();
  const scene = SCENE[theme];
  return (
    <div className="body-canvas">
      <Canvas
        dpr={[1, 2]}
        camera={{ position: [0.9, 0.55 * h, 2.1], fov: 34 }}
        onPointerMissed={() => props.onSelect?.(null)}
        gl={{ preserveDrawingBuffer: true, antialias: true }}
      >
        <color attach="background" args={[scene.bg]} />
        <fog attach="fog" args={[scene.bg, 3.5, 7]} />
        <hemisphereLight args={['#FFF1E2', '#3a2a22', scene.hemi]} />
        <directionalLight position={[2, 3, 2.5]} intensity={1.5} color="#FFE9CF" />
        <directionalLight position={[-2.5, 1.8, -2.2]} intensity={0.85} color="#FFF0E2" />
        <directionalLight position={[2.6, 0.8, -1.6]} intensity={0.3} color="#FF8C42" />
        <directionalLight position={[-1.5, 2.5, 2]} intensity={0.35} color="#ffffff" />
        <pointLight position={[0, 0.6, 1.5]} intensity={0.4} color="#FFD9A0" />
        <Body {...props} onHover={setHover} theme={theme} electrodes={electrodes} />
        <ViewSnap facing={props.facing} />
        <OrbitControls
          makeDefault
          target={[0, 0.38 * h, 0]}
          enablePan={false}
          minDistance={0.7}
          maxDistance={3.6}
          autoRotate={props.autoRotate}
          autoRotateSpeed={1.2}
          minPolarAngle={0.5}
          maxPolarAngle={2.2}
        />
      </Canvas>
      {hover && (
        <div className="hover-tip">
          {muscleLabel(hover)}
          <span>
            {props.valueLabel ?? 'activation'} {Math.round((valueRef.current()[MUSCLE_INDEX[hover]] ?? 0) * 100)}%
          </span>
        </div>
      )}
      {electrodes && <div className="canvas-legend">Electrodes 01–14 · both sides · REF at C7</div>}
      <div className="canvas-hint">drag to orbit · scroll to zoom · click a muscle</div>
    </div>
  );
}
