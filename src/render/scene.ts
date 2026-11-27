import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
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

  // Competition lighting: a soft pool of light over the table, so the table, the
  // players and the ball are the brightest things in the room and the surroundings
  // fall off a little. No shadow of its own (the key light casts the ball's shadow).
  // Venues set its strength (none outdoors).
  const spot = new THREE.SpotLight(0xfff6e8, 0, 9, 1.05, 0.8, 1.4);
  spot.position.set(0, 3.1, 0);
  spot.target.position.set(0, 0, 0);
  spot.name = 'tableSpot';
  scene.add(spot, spot.target);

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
  // Slightly rounded edges catch a thin highlight along the rim.
  const topMat = new THREE.MeshPhysicalMaterial({ color: 0x173a75, roughness: 0.42, clearcoat: 0.3, clearcoatRoughness: 0.35, envMapIntensity: 0.6 });
  const top = new THREE.Mesh(new RoundedBoxGeometry(TABLE.width, TABLE.thickness, TABLE.length, 2, 0.005), topMat);
  top.position.y = TABLE.height - TABLE.thickness / 2;
  top.receiveShadow = true;
  top.castShadow = true;
  top.name = 'tableTop';
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

  // Undercarriage (hidden at venues with their own table): a steel apron under each
  // half, and per half a leg frame at the end and a wheeled frame near the middle,
  // joined by low side rails, like a real folding competition table.
  const steel = new THREE.MeshStandardMaterial({ color: 0x2c2f36, roughness: 0.55, metalness: 0.5 });
  const rubber = new THREE.MeshStandardMaterial({ color: 0x111215, roughness: 0.9 });
  const under = TABLE.height - TABLE.thickness;
  const part = (mesh: THREE.Mesh) => {
    mesh.castShadow = true;
    mesh.name = 'tableLeg';
    g.add(mesh);
    return mesh;
  };
  const bar = (w: number, h: number, d: number, x: number, yy: number, z: number, mat: THREE.Material = steel) => {
    const m = part(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat));
    m.position.set(x, yy, z);
    return m;
  };
  const legX = TABLE.halfWidth - 0.14;
  const legR = 0.022;
  for (const sz of [-1, 1]) {
    // Apron: a frame 5 cm deep, inset under the top.
    const inX = TABLE.halfWidth - 0.06;
    const zNear = sz * 0.03;
    const zFar = sz * (TABLE.halfLength - 0.06);
    const zMid = (zNear + zFar) / 2;
    const len = Math.abs(zFar - zNear);
    for (const sx of [-1, 1]) bar(0.03, 0.05, len, sx * inX, under - 0.025, zMid);
    bar(inX * 2, 0.05, 0.03, 0, under - 0.025, zFar);
    bar(inX * 2, 0.04, 0.03, 0, under - 0.02, zNear);
    // End legs, with a crossbar near the floor.
    const zEnd = sz * (TABLE.halfLength - 0.32);
    const zWheel = sz * 0.42;
    for (const sx of [-1, 1]) {
      const leg = part(new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, under - 0.05, 12), steel));
      leg.position.set(sx * legX, (under - 0.05) / 2 + 0.01, zEnd);
      const foot = part(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.034, 0.02, 14), rubber));
      foot.position.set(sx * legX, 0.01, zEnd);
      // Wheeled frame near the middle: shorter leg, a caster under it.
      const wl = part(new THREE.Mesh(new THREE.CylinderGeometry(legR, legR, under - 0.13, 12), steel));
      wl.position.set(sx * legX, (under - 0.13) / 2 + 0.08, zWheel);
      const wheel = part(new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 0.03, 18).rotateZ(Math.PI / 2), rubber));
      wheel.position.set(sx * legX, 0.04, zWheel);
      const fork = bar(0.04, 0.05, 0.02, sx * legX, 0.075, zWheel);
      fork.position.y = 0.085;
      // Side rail joining the two legs, low down.
      bar(0.025, 0.025, Math.abs(zEnd - zWheel), sx * legX, 0.14, (zEnd + zWheel) / 2);
      // A diagonal brace from the wheel leg up to the apron.
      const brace = part(new THREE.Mesh(new THREE.CylinderGeometry(0.011, 0.011, 0.62, 8), steel));
      brace.position.set(sx * legX, (under + 0.14) / 2, zWheel + sz * 0.18);
      brace.rotation.x = sz * 0.55;
    }
    bar(legX * 2, 0.03, 0.03, 0, 0.12, zEnd);
    bar(legX * 2, 0.03, 0.03, 0, 0.16, zWheel);
  }
  return g;
}

function createNet(): THREE.Group {
  const g = new THREE.Group();
  g.name = 'coreNet';
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
    // Screw clamp: a jaw round the table edge, under the top.
    const jaw = new THREE.Mesh(new THREE.BoxGeometry(0.022, 0.05, 0.04), postMat);
    jaw.position.set(sx * NET.halfLength, TABLE.height - 0.02, 0);
    jaw.castShadow = true;
    const arm = new THREE.Mesh(new THREE.BoxGeometry(Math.abs(NET.halfLength - TABLE.halfWidth) + 0.05, 0.012, 0.04), postMat);
    arm.position.set(sx * (NET.halfLength + TABLE.halfWidth - 0.05) / 2, TABLE.height - TABLE.thickness - 0.006 - 0.012, 0);
    arm.castShadow = true;
    const knob = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 12), postMat);
    knob.position.set(sx * (TABLE.halfWidth - 0.03), TABLE.height - TABLE.thickness - 0.035, 0);
    g.add(jaw, arm, knob);
  }
  return g;
}
