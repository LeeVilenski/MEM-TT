import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { NET, TABLE } from '../physics';

/**
 * Core scene: table, net, a default floor and lighting with shadows. Venues
 * (venues.ts) restyle the lights, floor and background and add their own props;
 * the ball's shadow on the table stays the priority for depth perception.
 */
export function createScene(renderer: THREE.WebGLRenderer) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x14161c);
  scene.fog = new THREE.Fog(0x14161c, 12, 30);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  // Filmic-but-faithful tone mapping: highlights roll off instead of clipping,
  // without the colour shift of ACES (the table stays table-blue).
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  // Soft image-based light: gives the table, paddles and props real reflections
  // and shading on the sides facing away from the key light. Venues set its strength.
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.35;
  pmrem.dispose();

  // Lighting: soft fill plus a high key light casting the ball's shadow straight down.
  const hemi = new THREE.HemisphereLight(0xdfe8ff, 0x22252c, 1.1);
  hemi.name = 'hemi';
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(0.6, 6, 0.8);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  const sc = key.shadow.camera;
  sc.left = -2.5;
  sc.right = 2.5;
  sc.top = 3;
  sc.bottom = -3;
  sc.near = 1;
  sc.far = 10;
  key.shadow.bias = -0.0005;
  key.shadow.normalBias = 0.01;
  // Softer shadow edges (PCF filtering radius, in shadow-map texels).
  key.shadow.radius = 3;
  key.name = 'key';
  scene.add(key);

  // Floor with a subtle tile grid.
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.95 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.name = 'floor';
  scene.add(floor);
  const grid = new THREE.GridHelper(40, 66, 0x2e323c, 0x2e323c);
  grid.position.y = 0.001;
  grid.name = 'grid';
  scene.add(grid);

  scene.add(createTable());
  scene.add(createNet());

  return scene;
}

function createTable(): THREE.Group {
  const g = new THREE.Group();
  // Satin top: a broad, soft sheen from the lights and environment, like a real table.
  const topMat = new THREE.MeshPhysicalMaterial({ color: 0x173a75, roughness: 0.5, clearcoat: 0.12, clearcoatRoughness: 0.45, envMapIntensity: 0.6 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.width, TABLE.thickness, TABLE.length), topMat);
  top.position.y = TABLE.height - TABLE.thickness / 2;
  top.receiveShadow = true;
  top.castShadow = true;
  g.add(top);

  // White lines: 2 cm edges and a 3 mm centre line (for doubles).
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const y = TABLE.height + 0.0005;
  const addLine = (w: number, l: number, x: number, z: number) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, l), lineMat);
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, y, z);
    m.receiveShadow = true;
    g.add(m);
  };
  addLine(0.02, TABLE.length, -TABLE.halfWidth + 0.01, 0);
  addLine(0.02, TABLE.length, TABLE.halfWidth - 0.01, 0);
  addLine(TABLE.width, 0.02, 0, -TABLE.halfLength + 0.01);
  addLine(TABLE.width, 0.02, 0, TABLE.halfLength - 0.01);
  addLine(0.003, TABLE.length, 0, 0);

  // Legs / undercarriage.
  const legMat = new THREE.MeshStandardMaterial({ color: 0x3a3d45, roughness: 0.7, metalness: 0.3 });
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.05, TABLE.height - TABLE.thickness, 0.05), legMat);
      leg.position.set(sx * (TABLE.halfWidth - 0.15), (TABLE.height - TABLE.thickness) / 2, sz * (TABLE.halfLength - 0.3));
      leg.castShadow = true;
      g.add(leg);
    }
  }
  return g;
}

function createNet(): THREE.Group {
  const g = new THREE.Group();
  const width = NET.halfLength * 2;

  // Mesh: a fine grid texture on a transparent plane.
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  ctx.strokeStyle = 'rgba(20,20,26,0.85)';
  ctx.lineWidth = 3;
  ctx.strokeRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(width / 0.012, NET.height / 0.012);
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(width, NET.height - 0.012),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
  );
  mesh.position.set(0, TABLE.height + (NET.height - 0.012) / 2, 0);
  g.add(mesh);

  // White tape along the top.
  const tape = new THREE.Mesh(new THREE.BoxGeometry(width, 0.015, 0.004), new THREE.MeshStandardMaterial({ color: 0xffffff }));
  tape.position.set(0, NET.top - 0.0075, 0);
  tape.castShadow = true;
  g.add(tape);

  // Posts.
  const postMat = new THREE.MeshStandardMaterial({ color: 0x2b2e35, metalness: 0.4, roughness: 0.5 });
  for (const sx of [-1, 1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.02, NET.height + 0.03, 0.03), postMat);
    post.position.set(sx * NET.halfLength, TABLE.height + (NET.height - 0.03) / 2, 0);
    post.castShadow = true;
    g.add(post);
  }
  return g;
}
