import * as THREE from 'three';
import {
  AVENUE_ANGLES, AVENUE_HALF_WIDTH, CLASSROOM_GATE_ANGLE, FOUNTAIN_AREA_RADIUS, FOUNTAIN_RADIUS, PLAZA_RADIUS,
  avenueDistance, layoutBenches, layoutGates, layoutLamps, layoutTrees, pointAt,
  type Obstacle,
} from '@/lib/community-plaza';
import {
  PLAZA_FONT, brickTexture, canvasTexture, createClockFace, grassTexture, plasterTexture, seededRandom, stoneTileTexture, woodGrainTexture,
} from './plaza-textures';

/**
 * 交流広場の景色（地面・通り・噴水・花壇・街灯・ベンチ・門・生け垣・木・校舎・山）と、生徒のアバター。
 * 3Dモデルや画像は外部から読まず、すべてここで作る（著作権の確認が要らないように）。
 * 光の当たり方は物理に近い材質（MeshStandardMaterial）と影で表す。
 * 同じ形がたくさんあるもの（木・街灯・ベンチ・花など）はまとめて描く（InstancedMesh）。
 */

export type Quality = 'high' | 'low';

const standard = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

/** 同じ形を、位置・向き・大きさを変えてたくさん置く。 */
function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[], options: { colors?: THREE.Color[]; cast?: boolean; receive?: boolean } = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, Math.max(1, matrices.length));
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  options.colors?.forEach((color, index) => mesh.setColorAt(index, color));
  mesh.count = matrices.length;
  mesh.castShadow = options.cast ?? true;
  mesh.receiveShadow = options.receive ?? false;
  mesh.instanceMatrix.needsUpdate = true;
  return mesh;
}

export const placeMatrix = (x: number, y: number, z: number, rotY = 0, scale: number | THREE.Vector3 = 1) => {
  const s = typeof scale === 'number' ? new THREE.Vector3(scale, scale, scale) : scale;
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, rotY, 0)), s);
};

const shadowed = <T extends THREE.Mesh>(mesh: T, cast = true, receive = true) => {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
};

export type StageWorld = {
  /** 歩けない所。看板の分は別に足す。 */
  obstacles: Obstacle[];
  /** 三人称のカメラがめり込まないように調べる物。 */
  occluders: THREE.Object3D[];
  /** 影を落とす光（プレイヤーのまわりだけ影を細かく描くため、位置を動かす）。 */
  sun: THREE.DirectionalLight;
  update: (time: number, dt: number, focus: THREE.Vector3) => void;
};

export function buildPlazaWorld(root: THREE.Group, quality: Quality): StageWorld {
  const occluders: THREE.Object3D[] = [];
  const obstacles: Obstacle[] = [{ x: 0, z: 0, r: FOUNTAIN_AREA_RADIUS }];
  const random = seededRandom(20261106);
  const high = quality === 'high';

  root.add(new THREE.HemisphereLight(0xdcecff, 0x5f7f43, 0.45));
  const sun = new THREE.DirectionalLight(0xfff1d6, 2.6);
  sun.castShadow = high;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  root.add(sun, sun.target);

  // 地面（芝）
  const grass = shadowed(new THREE.Mesh(new THREE.CircleGeometry(220, 64), standard(0xffffff, { map: grassTexture(90), roughness: 1 })), false, true);
  grass.rotation.x = -Math.PI / 2;
  root.add(grass);

  // 広場の石畳
  const tiles = shadowed(new THREE.Mesh(new THREE.CircleGeometry(PLAZA_RADIUS + 0.4, 96), standard(0xffffff, { map: stoneTileTexture(PLAZA_RADIUS / 2.5), roughness: 0.92 })), false, true);
  tiles.rotation.x = -Math.PI / 2;
  tiles.position.y = 0.01;
  root.add(tiles);

  // 看板の輪の間の歩道（少し濃い石）と、噴水のまわりの石畳。
  const pathMaterial = standard(0xd2bd98, { roughness: 0.95 });
  for (const radius of [11, 17, 23, 29]) {
    const ring = shadowed(new THREE.Mesh(new THREE.RingGeometry(radius - 0.7, radius + 0.7, 128), pathMaterial), false, true);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.02;
    root.add(ring);
  }
  const centerStone = shadowed(new THREE.Mesh(new THREE.CircleGeometry(5.8, 64), standard(0xb9c2cd, { roughness: 0.8 })), false, true);
  centerStone.rotation.x = -Math.PI / 2;
  centerStone.position.y = 0.025;
  root.add(centerStone);

  // 4本の通り（れんが）。教室への通りは門の外の校舎まで続く。
  const avenueLength = PLAZA_RADIUS - 5;
  for (const angle of AVENUE_ANGLES) {
    const toSchool = angle === CLASSROOM_GATE_ANGLE;
    const length = toSchool ? avenueLength + 26 : avenueLength;
    const group = new THREE.Group();
    group.rotation.y = -angle;
    const material = standard(0xffffff, { map: brickTexture(2, length / 2.4), roughness: 0.9 });
    const strip = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(AVENUE_HALF_WIDTH * 2 - 0.4, length), material), false, true);
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.03, -(5 + length / 2));
    group.add(strip);
    root.add(group);
  }

  // 噴水
  const stone = standard(0xd3d9e1, { roughness: 0.7 });
  const stoneDark = standard(0x9aa6b6, { roughness: 0.6 });
  const basin = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(FOUNTAIN_RADIUS, FOUNTAIN_RADIUS + 0.2, 0.6, 48), stone));
  basin.position.y = 0.3;
  const rim = shadowed(new THREE.Mesh(new THREE.TorusGeometry(FOUNTAIN_RADIUS, 0.13, 10, 64), stoneDark));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.6;
  const waterMaterial = new THREE.MeshStandardMaterial({ color: 0x3f86c9, roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.88, envMapIntensity: 1.4 });
  const water = shadowed(new THREE.Mesh(new THREE.CircleGeometry(FOUNTAIN_RADIUS - 0.15, 48), waterMaterial), false, true);
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.52;
  const pillar = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.25, 0.4, 2.2, 20), stone));
  pillar.position.y = 1.1;
  const bowl = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(1, 0.35, 0.35, 32), stone));
  bowl.position.y = 2.2;
  const bowlWater = new THREE.Mesh(new THREE.CircleGeometry(0.88, 32), waterMaterial);
  bowlWater.rotation.x = -Math.PI / 2;
  bowlWater.position.y = 2.36;
  const top = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 12), stoneDark));
  top.position.y = 2.55;
  root.add(basin, rim, water, pillar, bowl, bowlWater, top);
  occluders.push(basin, pillar, bowl);

  // 水面の波紋
  const ripples = [0, 1, 2].map(index => {
    const mesh = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1, 48),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.535;
    root.add(mesh);
    return { mesh, offset: index / 3 };
  });

  // 水しぶき（上の皿から外へ放物線を描いて落ちる）
  const dropCount = high ? 260 : 140;
  const dropPositions = new Float32Array(dropCount * 3);
  const drops = Array.from({ length: dropCount }, () => ({
    angle: random() * Math.PI * 2,
    speed: 0.9 + random() * 0.7,
    lift: 2.2 + random() * 1.2,
    age: random() * 1.2,
  }));
  const dropGeometry = new THREE.BufferGeometry();
  dropGeometry.setAttribute('position', new THREE.BufferAttribute(dropPositions, 3));
  const dropPoints = new THREE.Points(dropGeometry, new THREE.PointsMaterial({ color: 0xe6f6ff, size: 0.07, transparent: true, opacity: 0.85, depthWrite: false }));
  dropPoints.frustumCulled = false;
  root.add(dropPoints);

  // 噴水のまわりの花壇
  const bed = shadowed(new THREE.Mesh(new THREE.RingGeometry(FOUNTAIN_RADIUS + 0.25, FOUNTAIN_AREA_RADIUS - 0.1, 64), standard(0x4a3424, { roughness: 1 })), false, true);
  bed.rotation.x = -Math.PI / 2;
  bed.position.y = 0.05;
  const curb = shadowed(new THREE.Mesh(new THREE.TorusGeometry(FOUNTAIN_AREA_RADIUS - 0.05, 0.1, 8, 96), stone));
  curb.rotation.x = Math.PI / 2;
  curb.position.y = 0.09;
  root.add(bed, curb);
  const flowerColors = [0xf472b6, 0xfacc15, 0xffffff, 0xef4444, 0xa78bfa, 0xfb923c].map(color => new THREE.Color(color));
  const flowerMatrices: THREE.Matrix4[] = [];
  const flowerTint: THREE.Color[] = [];
  const leafMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < 260; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = FOUNTAIN_RADIUS + 0.4 + random() * (FOUNTAIN_AREA_RADIUS - FOUNTAIN_RADIUS - 0.6);
    const { x, z } = pointAt(angle, radius);
    flowerMatrices.push(placeMatrix(x, 0.26 + random() * 0.1, z, 0, 0.7 + random() * 0.5));
    flowerTint.push(flowerColors[Math.floor(random() * flowerColors.length)]);
    leafMatrices.push(placeMatrix(x + (random() - 0.5) * 0.1, 0.13, z + (random() - 0.5) * 0.1, random() * 3, 0.8 + random() * 0.6));
  }
  root.add(instanced(new THREE.IcosahedronGeometry(0.08, 1), standard(0xffffff, { roughness: 0.6 }), flowerMatrices, { colors: flowerTint, cast: false }));
  root.add(instanced(new THREE.ConeGeometry(0.12, 0.28, 5), standard(0x3f7f35), leafMatrices, { cast: false }));

  // 街灯（黒い鋳物風）
  const lamps = layoutLamps();
  obstacles.push(...lamps);
  const iron = standard(0x2b3440, { roughness: 0.45, metalness: 0.6 });
  root.add(instanced(new THREE.CylinderGeometry(0.05, 0.08, 3.2, 10), iron, lamps.map(lamp => placeMatrix(lamp.x, 1.6, lamp.z))));
  root.add(instanced(new THREE.CylinderGeometry(0.15, 0.2, 0.3, 10), iron, lamps.map(lamp => placeMatrix(lamp.x, 0.15, lamp.z))));
  root.add(instanced(new THREE.SphereGeometry(0.22, 16, 12), standard(0xfff6d8, { emissive: 0xfff0c2, emissiveIntensity: 0.9, roughness: 0.3 }), lamps.map(lamp => placeMatrix(lamp.x, 3.32, lamp.z)), { cast: false }));
  root.add(instanced(new THREE.ConeGeometry(0.32, 0.22, 10), iron, lamps.map(lamp => placeMatrix(lamp.x, 3.62, lamp.z))));

  // ベンチ（木の座面・背もたれ、鉄の脚）。ベンチの正面は +z。
  const benches = layoutBenches();
  obstacles.push(...benches.map(({ x, z, r }) => ({ x, z, r })));
  const benchPart = (local: THREE.Matrix4) => benches.map(bench => placeMatrix(bench.x, 0, bench.z, bench.rotY).multiply(local));
  const benchWood = standard(0xffffff, { map: woodGrainTexture(), roughness: 0.7, color: 0xb98a5a });
  for (const offset of [-0.15, 0, 0.15]) {
    root.add(instanced(new THREE.BoxGeometry(1.6, 0.05, 0.13), benchWood, benchPart(new THREE.Matrix4().makeTranslation(0, 0.46, offset))));
  }
  for (const height of [0.68, 0.84]) {
    root.add(instanced(new THREE.BoxGeometry(1.6, 0.12, 0.04), benchWood, benchPart(new THREE.Matrix4().makeRotationX(-0.15).setPosition(0, height, -0.25))));
  }
  for (const side of [-0.7, 0.7]) {
    root.add(instanced(new THREE.BoxGeometry(0.06, 0.46, 0.44), iron, benchPart(new THREE.Matrix4().makeTranslation(side, 0.23, 0))));
    root.add(instanced(new THREE.BoxGeometry(0.06, 0.5, 0.05), iron, benchPart(new THREE.Matrix4().makeRotationX(-0.15).setPosition(side, 0.7, -0.24))));
  }

  // 門（通りの突き当たり）。教室への門だけ看板を「校舎・教室」にする。
  const signTexture = (text: string, color: string) => canvasTexture(512, 128, ctx => {
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 512, 128);
    ctx.strokeStyle = '#f7d774';
    ctx.lineWidth = 8;
    ctx.strokeRect(6, 6, 500, 116);
    ctx.fillStyle = '#ffffff';
    ctx.font = `bold 60px ${PLAZA_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, 256, 68);
  });
  const plazaSign = signTexture('交流広場', '#1f6f4a');
  const schoolSign = signTexture('校舎・教室 →', '#7c2d12');
  const gateMaterial = standard(0xffffff, { map: plasterTexture(1), roughness: 0.8 });
  const gateRoof = standard(0x2f5f86, { roughness: 0.5, metalness: 0.2 });
  const gateWidth = (AVENUE_HALF_WIDTH + 0.4) * 2;
  layoutGates().forEach((gate, index) => {
    obstacles.push(...gate.pillars);
    const toSchool = AVENUE_ANGLES[index] === CLASSROOM_GATE_ANGLE;
    const group = new THREE.Group();
    group.position.set(gate.center.x, 0, gate.center.z);
    group.rotation.y = gate.rotY;
    for (const side of [-1, 1]) {
      const post = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.6, 3.8, 0.6), gateMaterial));
      post.position.set(side * gateWidth / 2, 1.9, 0);
      const cap = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.2, 0.8), gateRoof));
      cap.position.set(side * gateWidth / 2, 0.1, 0);
      group.add(post, cap);
      occluders.push(post);
    }
    const beam = shadowed(new THREE.Mesh(new THREE.BoxGeometry(gateWidth + 1.2, 0.45, 0.8), gateRoof));
    beam.position.y = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.8), standard(0xffffff, { map: toSchool ? schoolSign : plazaSign, roughness: 0.6 }));
    sign.position.set(0, 3.35, 0.31);
    const signBack = sign.clone();
    signBack.rotation.y = Math.PI;
    signBack.position.z = -0.31;
    group.add(beam, sign, signBack);
    root.add(group);
  });

  // 生け垣（広場の外周。門のところはあける）
  const hedgeMatrices: THREE.Matrix4[] = [];
  const hedgeRadius = PLAZA_RADIUS + 0.9;
  const hedgeCount = Math.floor((2 * Math.PI * hedgeRadius) / 1.5);
  for (let i = 0; i < hedgeCount; i += 1) {
    const angle = (i / hedgeCount) * Math.PI * 2;
    if (avenueDistance(angle, hedgeRadius) < AVENUE_HALF_WIDTH + 1.2) continue;
    const { x, z } = pointAt(angle, hedgeRadius);
    hedgeMatrices.push(placeMatrix(x, 0.5, z, -angle, new THREE.Vector3(1, 0.9 + (i % 3) * 0.06, 1)));
  }
  root.add(instanced(new THREE.BoxGeometry(1.55, 1, 0.9, 2, 2, 2), standard(0x3f7d34, { roughness: 1 }), hedgeMatrices, { receive: true }));

  // 木（幹＋葉のかたまりを3つ重ねる。外周すぐの木と、遠くの林）
  const school = pointAt(CLASSROOM_GATE_ANGLE, 66);
  const pineMatrices: THREE.Matrix4[] = [];
  const leafClusters: THREE.Matrix4[] = [];
  const trunkMatrices: THREE.Matrix4[] = [];
  const addTree = (x: number, z: number, scale: number, round: boolean) => {
    trunkMatrices.push(placeMatrix(x, 1 * scale, z, 0, new THREE.Vector3(scale, scale * 1.25, scale)));
    if (!round) {
      pineMatrices.push(placeMatrix(x, 3 * scale, z, random() * 3, scale));
      pineMatrices.push(placeMatrix(x, 4.3 * scale, z, random() * 3, scale * 0.72));
      return;
    }
    for (let i = 0; i < 3; i += 1) {
      leafClusters.push(placeMatrix(x + (random() - 0.5) * 1.2 * scale, (2.7 + i * 0.55 + random() * 0.3) * scale, z + (random() - 0.5) * 1.2 * scale, random() * 3, scale * (1.15 - i * 0.18)));
    }
  };
  layoutTrees().forEach((tree, index) => addTree(tree.x, tree.z, 0.9 + (index % 4) * 0.12, index % 3 !== 1));
  for (let i = 0; i < 110; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 44 + random() * 50;
    const { x, z } = pointAt(angle, radius);
    // 校舎とその前の道はあける。
    if (Math.hypot(x - school.x, z - school.z) < 30 || avenueDistance(angle, radius) < 5 && Math.abs(angle - CLASSROOM_GATE_ANGLE) < 0.5) continue;
    addTree(x, z, 1 + random() * 0.8, random() < 0.6);
  }
  const bark = standard(0x7a5536, { roughness: 1 });
  root.add(instanced(new THREE.CylinderGeometry(0.16, 0.26, 2, 8), bark, trunkMatrices));
  root.add(instanced(new THREE.ConeGeometry(1.5, 3, 9), standard(0x2f6f3c, { flatShading: true, roughness: 0.9 }), pineMatrices));
  root.add(instanced(new THREE.IcosahedronGeometry(1.3, 1), standard(0x4f9a3f, { flatShading: true, roughness: 0.9 }), leafClusters));

  // 草むら
  const tuftMatrices: THREE.Matrix4[] = [];
  for (let i = 0; i < (high ? 420 : 200); i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = PLAZA_RADIUS + 3 + random() * 50;
    const { x, z } = pointAt(angle, radius);
    tuftMatrices.push(placeMatrix(x, 0.15, z, random() * 3, 0.6 + random() * 0.8));
  }
  root.add(instanced(new THREE.ConeGeometry(0.18, 0.4, 4), standard(0x5f9b45), tuftMatrices, { cast: false }));

  // 校舎と時計台（教室への門の先）。正面が広場の中心を向く。
  const schoolGroup = new THREE.Group();
  schoolGroup.position.set(school.x, 0, school.z);
  schoolGroup.rotation.y = Math.atan2(-school.x, -school.z);
  const windowTexture = canvasTexture(128, 128, ctx => {
    ctx.fillStyle = '#efe7d6';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#4f7fa6';
    ctx.fillRect(18, 26, 92, 66);
    const glass = ctx.createLinearGradient(18, 26, 110, 92);
    glass.addColorStop(0, 'rgba(255,255,255,0.55)');
    glass.addColorStop(0.5, 'rgba(255,255,255,0)');
    ctx.fillStyle = glass;
    ctx.fillRect(18, 26, 92, 66);
    ctx.strokeStyle = '#f8f8f8';
    ctx.lineWidth = 5;
    ctx.strokeRect(18, 26, 92, 66);
    ctx.beginPath(); ctx.moveTo(64, 26); ctx.lineTo(64, 92); ctx.stroke();
    ctx.fillStyle = '#d6cdb9';
    ctx.fillRect(12, 94, 104, 6);
  }, { repeat: [14, 3] });
  const sideWindows = windowTexture.clone();
  sideWindows.repeat.set(4, 3);
  sideWindows.needsUpdate = true;
  const roof = standard(0x8f3f32, { roughness: 0.6 });
  const wallFront = standard(0xffffff, { map: windowTexture, roughness: 0.85 });
  const wallSide = standard(0xffffff, { map: sideWindows, roughness: 0.85 });
  const building = shadowed(new THREE.Mesh(new THREE.BoxGeometry(44, 12, 12), [wallSide, wallSide, roof, roof, wallFront, wallFront]));
  building.position.set(0, 6, -6);
  const buildingRoof = shadowed(new THREE.Mesh(new THREE.BoxGeometry(45, 0.8, 13), roof));
  buildingRoof.position.set(0, 12.4, -6);
  const towerMaterial = standard(0xffffff, { map: plasterTexture(2), roughness: 0.85 });
  const tower = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6, 22, 6), towerMaterial));
  tower.position.set(0, 11, 1.5);
  const towerRoof = shadowed(new THREE.Mesh(new THREE.ConeGeometry(4.6, 4, 4), roof));
  towerRoof.position.set(0, 24, 1.5);
  towerRoof.rotation.y = Math.PI / 4;
  const entrance = shadowed(new THREE.Mesh(new THREE.BoxGeometry(5, 3.2, 1), standard(0x3b4a5a, { roughness: 0.3, metalness: 0.4 })));
  entrance.position.set(0, 1.6, 4.3);
  const canopy = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7, 0.3, 3), standard(0xe5e7eb)));
  canopy.position.set(0, 3.5, 5.6);
  const clockFace = createClockFace();
  const clock = new THREE.Mesh(new THREE.CircleGeometry(2.2, 40), new THREE.MeshBasicMaterial({ map: clockFace.texture, transparent: true }));
  clock.position.set(0, 17.5, 4.52);
  schoolGroup.add(building, buildingRoof, tower, towerRoof, entrance, canopy, clock);
  root.add(schoolGroup);

  // 遠くの山
  const hillMaterials = [standard(0x6f9f5f, { roughness: 1 }), standard(0x6a8f86, { roughness: 1 }), standard(0x7ea65a, { roughness: 1 })];
  for (let i = 0; i < 10; i += 1) {
    const angle = (i / 10) * Math.PI * 2 + 0.3;
    const { x, z } = pointAt(angle, 150 + (i % 3) * 14);
    const hill = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 12), hillMaterials[i % 3]);
    hill.scale.set(34 + (i % 4) * 8, 18 + (i % 3) * 8, 26);
    hill.position.set(x, -4, z);
    root.add(hill);
  }

  let clockTimer = 0;
  const sunOffset = new THREE.Vector3(30, 45, 18).normalize().multiplyScalar(60);
  const update = (time: number, dt: number, focus: THREE.Vector3) => {
    // 影はプレイヤーのまわり（約50m四方）だけ細かく描く。
    sun.position.copy(focus).add(sunOffset);
    sun.target.position.copy(focus);
    // 水しぶき
    for (let i = 0; i < dropCount; i += 1) {
      const drop = drops[i];
      drop.age += dt;
      const spread = drop.speed * drop.age;
      const y = 2.5 + drop.lift * drop.age - 4.9 * drop.age * drop.age;
      if (y < 0.55 || spread > FOUNTAIN_RADIUS - 0.2) drop.age = 0;
      const age = drop.age;
      dropPositions[i * 3] = Math.cos(drop.angle) * drop.speed * age;
      dropPositions[i * 3 + 1] = 2.5 + drop.lift * age - 4.9 * age * age;
      dropPositions[i * 3 + 2] = Math.sin(drop.angle) * drop.speed * age;
    }
    dropGeometry.attributes.position.needsUpdate = true;
    // 波紋
    for (const ripple of ripples) {
      const phase = (time / 2600 + ripple.offset) % 1;
      ripple.mesh.scale.setScalar(0.5 + phase * 1.8);
      (ripple.mesh.material as THREE.MeshBasicMaterial).opacity = 0.4 * (1 - phase);
    }
    clockTimer += dt;
    if (clockTimer > 15) {
      clockTimer = 0;
      clockFace.redraw();
    }
  };

  return { obstacles, occluders, sun, update };
}

/** 生徒のアバター（丸みのある人形）。正面は -z（yaw と同じ決まり）。 */
export function buildAvatar(color: string) {
  const group = new THREE.Group();
  const body = standard(new THREE.Color(color).getHex(), { roughness: 0.75 });
  const skin = standard(0xf6d2b0, { roughness: 0.6 });
  const pants = standard(0x2f3b4f, { roughness: 0.8 });
  const hair = standard(0x2e2018, { roughness: 0.55 });
  const shoe = standard(0xf8fafc, { roughness: 0.5 });
  const dark = new THREE.MeshBasicMaterial({ color: 0x1e293b });

  const torso = shadowed(new THREE.Mesh(new THREE.CapsuleGeometry(0.27, 0.42, 6, 16), body), true, false);
  torso.position.y = 1.08;
  const collar = shadowed(new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.04, 8, 20), standard(0xffffff)), true, false);
  collar.rotation.x = Math.PI / 2;
  collar.position.y = 1.4;
  const head = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.27, 28, 20), skin), true, false);
  head.position.y = 1.64;
  const hairCap = shadowed(new THREE.Mesh(new THREE.SphereGeometry(0.29, 28, 20, 0, Math.PI * 2, 0, Math.PI * 0.55), hair), true, false);
  hairCap.position.y = 1.66;
  hairCap.rotation.x = 0.25;
  const eyes = [-0.09, 0.09].map(x => {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), dark);
    eye.position.set(x, 1.66, -0.245);
    return eye;
  });
  const backpack = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.46, 0.2), standard(0x1f2937, { roughness: 0.6 })), true, false);
  backpack.position.set(0, 1.12, 0.3);
  group.add(torso, collar, head, hairCap, backpack, ...eyes);

  const limb = (geometry: THREE.BufferGeometry, material: THREE.Material, pivot: [number, number, number], offsetY: number, foot?: THREE.Mesh) => {
    const joint = new THREE.Group();
    joint.position.set(...pivot);
    const mesh = shadowed(new THREE.Mesh(geometry, material), true, false);
    mesh.position.y = offsetY;
    joint.add(mesh);
    if (foot) joint.add(foot);
    group.add(joint);
    return joint;
  };
  const armGeometry = new THREE.CapsuleGeometry(0.075, 0.42, 4, 10);
  const legGeometry = new THREE.CapsuleGeometry(0.1, 0.48, 4, 10);
  const shoeGeometry = new THREE.BoxGeometry(0.16, 0.09, 0.3);
  const arms = [-1, 1].map(side => limb(armGeometry, body, [side * 0.36, 1.33, 0], -0.27));
  const legs = [-1, 1].map(side => {
    const foot = shadowed(new THREE.Mesh(shoeGeometry, shoe), true, false);
    foot.position.set(0, -0.74, -0.05);
    return limb(legGeometry, pants, [side * 0.13, 0.8, 0], -0.36, foot);
  });

  const bouncing = [torso, head, hairCap, collar, backpack, ...eyes];
  for (const part of bouncing) part.userData.baseY = part.position.y;

  let phase = 0;
  let amount = 0;
  return {
    group,
    /** speed は 0（止まっている）〜1（走っている）。 */
    update(dt: number, speed: number) {
      amount += (Math.min(1, speed) - amount) * Math.min(1, dt * 10);
      phase += dt * (6 + speed * 6) * (amount > 0.02 ? 1 : 0);
      const swing = Math.sin(phase) * 0.65 * amount;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.8;
      arms[1].rotation.x = swing * 0.8;
      const bounce = Math.abs(Math.sin(phase)) * 0.05 * amount;
      for (const part of bouncing) part.position.y = part.userData.baseY + bounce;
    },
  };
}
