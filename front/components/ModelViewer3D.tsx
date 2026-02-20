import React, { Suspense, useRef, useEffect, useCallback, useState, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, useGLTF, Environment, useEnvironment } from '@react-three/drei';
import * as THREE from 'three';

const GLB_PATH = '/card-pack.glb';

interface PackModelProps {
    mode: 'gentle' | 'auto' | 'static';
    scale?: number;
}

function PackModel({ mode, scale = 1 }: PackModelProps) {
    const { scene } = useGLTF(GLB_PATH, false, true);
    // Deep-clone so each instance owns its own scene (prevents steal on mount/unmount)
    const cloned = useMemo(() => scene.clone(true), [scene]);
    const ref = useRef<THREE.Group>(null!);
    const time = useRef(0);

    useFrame((_, delta) => {
        if (!ref.current) return;
        if (mode === 'auto') {
            ref.current.rotation.y += delta * 0.5;
        } else if (mode === 'gentle') {
            time.current += delta;
            ref.current.rotation.y = Math.sin(time.current * 0.6) * 0.26;
        }
    });

    return (
        <group ref={ref}>
            <primitive object={cloned} scale={scale} />
        </group>
    );
}

// Handle WebGL context loss/restore
function ContextGuard({ onLost }: { onLost: () => void }) {
    const { gl } = useThree();
    useEffect(() => {
        const canvas = gl.domElement;
        const handleLost = (e: Event) => {
            e.preventDefault();
            onLost();
        };
        canvas.addEventListener('webglcontextlost', handleLost);
        return () => canvas.removeEventListener('webglcontextlost', handleLost);
    }, [gl, onLost]);
    return null;
}

// GLB preload happens in preload.ts (single request) — no duplicate here

const ENV_HDR = '/env-city.hdr';

// Preload environment HDR so modal doesn't wait for it
let _envPreloaded = false;
function EnvPreloader() {
    useEnvironment({ files: ENV_HDR });
    _envPreloaded = true;
    return null;
}

interface ModelViewer3DProps {
    /** 'interactive' = orbit controls, 'gentle' = subtle oscillation, 'auto' = full spin */
    mode?: 'interactive' | 'gentle' | 'auto';
    /** Model scale override (default 1) */
    modelScale?: number;
    /** Camera distance (default 2.5) */
    cameraZ?: number;
    /** Camera vertical position (default 0.5) */
    cameraY?: number;
    /** Camera field of view (default 35) */
    fov?: number;
    /** CSS class for the outer container */
    className?: string;
    /** Inline style override */
    style?: React.CSSProperties;
    /** Pause rendering (frameloop='never') to save GPU when hidden */
    paused?: boolean;
}

const ModelViewer3D: React.FC<ModelViewer3DProps> = ({
    mode = 'auto',
    modelScale = 1,
    cameraZ = 2.5,
    cameraY = 0.5,
    fov = 35,
    className = '',
    style,
    paused = false,
}) => {
    const isInteractive = mode === 'interactive';
    const packMode = isInteractive ? 'static' : mode as 'gentle' | 'auto';
    const [canvasKey, setCanvasKey] = useState(0);

    const handleContextLost = useCallback(() => {
        setTimeout(() => setCanvasKey(k => k + 1), 500);
    }, []);

    return (
        <div className={className} style={{ width: '100%', height: '100%', ...style }}>
            <Canvas
                key={canvasKey}
                camera={{ position: [0, cameraY, cameraZ], fov }}
                gl={{
                    alpha: true,
                    antialias: mode !== 'gentle',
                    powerPreference: mode === 'gentle' ? 'low-power' : 'default',
                    ...(mode === 'gentle' ? { pixelRatio: 1 } : {}),
                }}
                frameloop={paused ? 'never' : (mode === 'gentle' ? 'demand' : 'always')}
                style={{ background: 'transparent' }}
            >
                <ContextGuard onLost={handleContextLost} />
                <ambientLight intensity={0.6} />
                <directionalLight position={[5, 5, 5]} intensity={1} />
                <directionalLight position={[-3, 2, -3]} intensity={0.3} />
                <Suspense fallback={null}>
                    <PackModel mode={packMode} scale={modelScale} />
                    {isInteractive && <Environment files={ENV_HDR} />}
                    {!isInteractive && !_envPreloaded && <EnvPreloader />}
                </Suspense>
                {mode === 'gentle' && <GentleInvalidator />}
                {isInteractive && (
                    <OrbitControls
                        enableZoom={false}
                        enablePan={false}
                        autoRotate
                        autoRotateSpeed={2}
                        minPolarAngle={Math.PI / 4}
                        maxPolarAngle={Math.PI / 1.5}
                    />
                )}
            </Canvas>
        </div>
    );
};

// For 'demand' frameloop: invalidates at ~20fps instead of 60fps to save GPU
function GentleInvalidator() {
    const { invalidate } = useThree();
    useEffect(() => {
        const id = setInterval(() => invalidate(), 50);
        return () => clearInterval(id);
    }, [invalidate]);
    return null;
}

export default ModelViewer3D;
