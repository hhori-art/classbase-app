import * as THREE from 'three';
import {
  CHAIR_OFFSET, CLASSROOM, CLASSROOM_DOOR, DESK, LOCKER, TEACHER_DESK, deskPositions,
} from '@/lib/community-classroom';
import {
  PLAZA_FONT, canvasTexture, ceilingTexture, corkTexture, createClockFace, drawBlackboard, grassTexture, lockerTexture,
  plasterTexture, posterTexture, seededRandom, woodFloorTexture, woodGrainTexture,
} from './plaza-textures';
import { placeMatrix, type Quality, type StageWorld } from './plaza-world';

/**
 * 交流広場の「教室」ステージ。黒板・教卓・机と椅子・窓・ロッカー・後ろの掲示板・時計・掲示物。
 * 左の壁は窓の形に抜いてあり、外の光（日差し）が机や床に窓の形の影を落とす。窓の外には校庭と木がある。
 * 配置の数値は lib/community-classroom.ts（当たり判定と同じ値を使う）。
 */

const standard = (color: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0, ...extra });

const shadowed = <T extends THREE.Mesh>(mesh: T, cast = true, receive = true) => {
  mesh.castShadow = cast;
  mesh.receiveShadow = receive;
  return mesh;
};

function instanced(geometry: THREE.BufferGeometry, material: THREE.Material, matrices: THREE.Matrix4[]) {
  const mesh = new THREE.InstancedMesh(geometry, material, matrices.length);
  matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

export type ClassroomWorld = StageWorld & {
  setBlackboard: (data: { topicTitle: string | null; topicCount: number }) => void;
};

const WALL = 0.15;
const { minX, maxX, minZ, maxZ, height: H } = CLASSROOM;
const WIDTH = maxX - minX;
const DEPTH = maxZ - minZ;
/** 窓（左の壁）。下の腰壁の高さ・上の壁の下端・窓の中心と幅。 */
const SILL = 0.85;
const HEAD = 2.45;
const WINDOWS = [-2.9, -1.0, 0.9, 2.8];
const WINDOW_WIDTH = 1.6;
/** 扉（右の壁）。 */
const DOORS = [{ z: -3.25, rear: false }, { z: CLASSROOM_DOOR.z, rear: true }];
const DOOR_WIDTH = 0.9;
const DOOR_HEIGHT = 2.1;

export function buildClassroomWorld(root: THREE.Group, quality: Quality): ClassroomWorld {
  const high = quality === 'high';
  const random = seededRandom(1106);
  const occluders: THREE.Object3D[] = [];

  // 光：天井の蛍光灯（やわらかい光）と、窓からの日差し（影を落とす）。
  root.add(new THREE.HemisphereLight(0xfffaf0, 0xb59a78, 0.55));
  const sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
  sun.position.set(-14, 9, 4);
  sun.target.position.set(0, 0, 0);
  sun.castShadow = high;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 1, far: 40 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  root.add(sun, sun.target);
  for (const z of [-2.2, 0.3, 2.6]) {
    const light = new THREE.PointLight(0xfff6e8, 3.2, 10, 1.6);
    light.position.set(0, 2.75, z);
    root.add(light);
  }

  // 床・天井
  const floor = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), standard(0xffffff, { map: woodFloorTexture(4, 2), roughness: 0.55 })), false, true);
  floor.rotation.x = -Math.PI / 2;
  const ceiling = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(WIDTH, DEPTH), standard(0xffffff, { map: ceilingTexture(15, 13), roughness: 0.95 })), false, true);
  ceiling.rotation.x = Math.PI / 2;
  ceiling.position.y = H;
  root.add(floor, ceiling);
  occluders.push(ceiling);

  // 壁（しっくい）。box(幅, 高さ, 奥行き) を中心の位置に置く。
  const wallMaterial = standard(0xffffff, { map: plasterTexture(3), roughness: 0.95 });
  const wallBox = (w: number, h: number, d: number, x: number, y: number, z: number) => {
    const mesh = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, d), wallMaterial));
    mesh.position.set(x, y, z);
    root.add(mesh);
    occluders.push(mesh);
    return mesh;
  };
  wallBox(WIDTH + WALL * 2, H, WALL, 0, H / 2, minZ - WALL / 2);
  wallBox(WIDTH + WALL * 2, H, WALL, 0, H / 2, maxZ + WALL / 2);
  // 右の壁（廊下側）：扉のところを抜く。
  const doorSpans = DOORS.map(door => [door.z - DOOR_WIDTH / 2, door.z + DOOR_WIDTH / 2]).sort((a, b) => a[0] - b[0]);
  let cursor: number = minZ;
  for (const [from, to] of doorSpans) {
    wallBox(WALL, H, from - cursor, maxX + WALL / 2, H / 2, (cursor + from) / 2);
    wallBox(WALL, H - DOOR_HEIGHT, to - from, maxX + WALL / 2, (H + DOOR_HEIGHT) / 2, (from + to) / 2);
    cursor = to;
  }
  wallBox(WALL, H, maxZ - cursor, maxX + WALL / 2, H / 2, (cursor + maxZ) / 2);
  // 左の壁（窓側）：腰壁・上の壁・窓の間の柱。
  wallBox(WALL, SILL, DEPTH, minX - WALL / 2, SILL / 2, 0);
  wallBox(WALL, H - HEAD, DEPTH, minX - WALL / 2, (H + HEAD) / 2, 0);
  const windowEdges = WINDOWS.flatMap(center => [center - WINDOW_WIDTH / 2, center + WINDOW_WIDTH / 2]);
  const pillarSpans = [[minZ, windowEdges[0]], ...WINDOWS.slice(1).map((_, i) => [windowEdges[i * 2 + 1], windowEdges[i * 2 + 2]]), [windowEdges[windowEdges.length - 1], maxZ]];
  for (const [from, to] of pillarSpans) wallBox(WALL, HEAD - SILL, to - from, minX - WALL / 2, (SILL + HEAD) / 2, (from + to) / 2);

  // 幅木
  const baseboard = standard(0x5b4636, { roughness: 0.6 });
  for (const [w, d, x, z] of [[WIDTH, 0.02, 0, minZ + 0.01], [WIDTH, 0.02, 0, maxZ - 0.01], [0.02, DEPTH, minX + 0.01, 0]] as const) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, 0.1, d), baseboard);
    mesh.position.set(x, 0.05, z);
    root.add(mesh);
  }

  // 窓（アルミの枠・ガラス）とカーテン
  const aluminum = standard(0xc9ced6, { roughness: 0.35, metalness: 0.7 });
  const glass = new THREE.MeshStandardMaterial({ color: 0xe6f2ff, roughness: 0.05, metalness: 0, transparent: true, opacity: 0.12, depthWrite: false });
  const curtain = standard(0xf1e7cf, { roughness: 1, side: THREE.DoubleSide });
  for (const center of WINDOWS) {
    const frameParts: [number, number, number, number, number][] = [
      [0.06, WINDOW_WIDTH, 0, SILL + 0.03, center],
      [0.06, WINDOW_WIDTH, 0, HEAD - 0.03, center],
      [HEAD - SILL, 0.05, 0, (SILL + HEAD) / 2, center - WINDOW_WIDTH / 2 + 0.025],
      [HEAD - SILL, 0.05, 0, (SILL + HEAD) / 2, center + WINDOW_WIDTH / 2 - 0.025],
      [HEAD - SILL, 0.06, 0.03, (SILL + HEAD) / 2, center],
    ];
    for (const [h, w, offsetX, y, z] of frameParts) {
      const part = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.06, h, w), aluminum));
      part.position.set(minX - 0.04 + offsetX, y, z);
      root.add(part);
    }
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(WINDOW_WIDTH, HEAD - SILL), glass);
    pane.rotation.y = Math.PI / 2;
    pane.position.set(minX - 0.05, (SILL + HEAD) / 2, center);
    root.add(pane);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.04, DEPTH - 0.2), aluminum);
  rail.position.set(minX + 0.12, HEAD + 0.08, 0);
  root.add(rail);
  // カーテンは柱のところに寄せてある（ひだを細い板の並びで表す）。
  for (const [from, to] of pillarSpans) {
    const z = (from + to) / 2;
    for (let i = 0; i < 5; i += 1) {
      const fold = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(0.1, HEAD - 0.25 + 0.05), curtain));
      fold.rotation.y = Math.PI / 2 + (i % 2 ? 0.5 : -0.5);
      fold.position.set(minX + 0.14, (HEAD + 0.3) / 2 + 0.05, z - 0.2 + i * 0.1);
      root.add(fold);
    }
  }

  // 窓の外（芝・校庭・木・フェンス）
  const outside = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(320, 320), standard(0xffffff, { map: grassTexture(120), roughness: 1 })), false, true);
  outside.rotation.x = -Math.PI / 2;
  outside.position.y = -0.03;
  const ground = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(40, 70), standard(0xcdb28a, { roughness: 1 })), false, true);
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(-32, -0.02, 0);
  root.add(outside, ground);
  const fencePosts: THREE.Matrix4[] = [];
  for (let z = -34; z <= 34; z += 2) fencePosts.push(placeMatrix(-11, 0.6, z));
  root.add(instanced(new THREE.BoxGeometry(0.08, 1.2, 0.08), standard(0x6b7280, { metalness: 0.5, roughness: 0.5 }), fencePosts));
  const fenceNet = new THREE.Mesh(new THREE.PlaneGeometry(68, 1.1), standard(0x9ca3af, { transparent: true, opacity: 0.35, side: THREE.DoubleSide }));
  fenceNet.rotation.y = Math.PI / 2;
  fenceNet.position.set(-11, 0.6, 0);
  root.add(fenceNet);
  const trunks: THREE.Matrix4[] = [];
  const leaves: THREE.Matrix4[] = [];
  for (let i = 0; i < 40; i += 1) {
    const x = -8 - random() * 3 - (i % 2 ? 50 : 0) - random() * 20;
    const z = -40 + random() * 80;
    const s = 1 + random() * 0.6;
    trunks.push(placeMatrix(x, 1.2 * s, z, 0, new THREE.Vector3(s, s * 1.2, s)));
    for (let k = 0; k < 3; k += 1) leaves.push(placeMatrix(x + (random() - 0.5) * 1.4, (3 + k * 0.6) * s, z + (random() - 0.5) * 1.4, random() * 3, s * (1.2 - k * 0.2)));
  }
  root.add(instanced(new THREE.CylinderGeometry(0.16, 0.26, 2, 8), standard(0x7a5536), trunks));
  root.add(instanced(new THREE.IcosahedronGeometry(1.3, 1), standard(0x4f9a3f, { flatShading: true }), leaves));

  // 教壇・教卓
  const darkWood = standard(0xffffff, { map: woodGrainTexture(), color: 0x9a6a3e, roughness: 0.6 });
  const platform = shadowed(new THREE.Mesh(new THREE.BoxGeometry(7, 0.06, 1.6), darkWood), false, true);
  platform.position.set(0, 0.03, minZ + 0.8);
  const teacherDesk = shadowed(new THREE.Mesh(new THREE.BoxGeometry(TEACHER_DESK.hw * 2, 0.92, TEACHER_DESK.hd * 2), darkWood));
  teacherDesk.position.set(TEACHER_DESK.x, 0.52, TEACHER_DESK.z);
  root.add(platform, teacherDesk);

  // 黒板（チョークの字は setBlackboard で書く）・粉受け・チョーク・黒板消し
  const boardCanvas = document.createElement('canvas');
  boardCanvas.width = 2048;
  boardCanvas.height = 420;
  const boardTexture = new THREE.CanvasTexture(boardCanvas);
  boardTexture.colorSpace = THREE.SRGBColorSpace;
  boardTexture.anisotropy = 8;
  const board = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(6, 1.23), standard(0xffffff, { map: boardTexture, roughness: 0.92 })), false, true);
  board.position.set(0, 1.55, minZ + 0.02);
  root.add(board);
  for (const [w, h, x, y] of [[6.12, 0.06, 0, 2.19], [6.12, 0.06, 0, 0.91], [0.06, 1.3, -3.03, 1.55], [0.06, 1.3, 3.03, 1.55]] as const) {
    const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.05), aluminum));
    frame.position.set(x, y, minZ + 0.03);
    root.add(frame);
  }
  const tray = shadowed(new THREE.Mesh(new THREE.BoxGeometry(6, 0.03, 0.1), aluminum));
  tray.position.set(0, 0.9, minZ + 0.08);
  root.add(tray);
  [0xffffff, 0xfde047, 0xf87171, 0x93c5fd].forEach((color, index) => {
    const chalk = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.08, 6), standard(color));
    chalk.rotation.z = Math.PI / 2;
    chalk.position.set(-1.2 + index * 0.14, 0.925, minZ + 0.08);
    root.add(chalk);
  });
  const eraser = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.13, 0.05, 0.05), standard(0x334155)));
  eraser.position.set(1.4, 0.94, minZ + 0.08);
  root.add(eraser);
  const setBlackboard = (data: { topicTitle: string | null; topicCount: number }) => {
    drawBlackboard(boardCanvas.getContext('2d')!, data);
    boardTexture.needsUpdate = true;
  };
  setBlackboard({ topicTitle: null, topicCount: 0 });

  // 時計（黒板の上）・掲示物
  const clockFace = createClockFace();
  const clockRim = shadowed(new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 32), standard(0x334155, { metalness: 0.3, roughness: 0.4 })));
  clockRim.rotation.x = Math.PI / 2;
  clockRim.position.set(0, 2.62, minZ + 0.03);
  const clock = new THREE.Mesh(new THREE.CircleGeometry(0.18, 32), new THREE.MeshBasicMaterial({ map: clockFace.texture, transparent: true }));
  clock.position.set(0, 2.62, minZ + 0.06);
  root.add(clockRim, clock);
  const poster = (texture: THREE.Texture, x: number, y: number, z: number, rotY: number, w = 0.55, h = 0.77) => {
    const mesh = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(w, h), standard(0xffffff, { map: texture, roughness: 0.9 })), false, true);
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotY;
    root.add(mesh);
  };
  poster(posterTexture('時間割', ['1 国語', '2 数学', '3 理科', '4 社会', '5 英語', '6 学活'], '#2563eb'), -3.85, 1.55, minZ + 0.02, 0);
  poster(posterTexture('学級目標', ['話そう', '聞き合おう', 'みとめ合おう'], '#16a34a'), 3.85, 1.55, minZ + 0.02, 0);
  poster(posterTexture('教室のきまり', ['あいさつをする', '人の話を聞く', 'ていねいな言葉', 'こまったら相談'], '#ea580c'), maxX - 0.02, 1.6, 0.2, -Math.PI / 2);
  poster(posterTexture('交流広場', ['掲示板の投稿は', '後ろの掲示板に', 'はってあるよ', '', '出口は後ろの扉'], '#7c3aed'), maxX - 0.02, 1.6, 1.4, -Math.PI / 2);

  // 天井の蛍光灯
  const fixture = standard(0xf8fafc, { emissive: 0xfffbf2, emissiveIntensity: 1.6, roughness: 0.3 });
  for (const x of [-2.2, 2.2]) {
    for (const z of [-2.4, 0, 2.4]) {
      const tube = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.05, 1.25), fixture);
      tube.position.set(x, H - 0.03, z);
      root.add(tube);
    }
  }
  // スピーカー
  const speaker = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.3, 0.15), standard(0xe5e7eb)));
  speaker.position.set(2.6, 2.6, minZ + 0.08);
  root.add(speaker);

  // 扉（引き戸）と、後ろの扉の上の出口の案内
  const doorMaterial = standard(0xffffff, { map: woodGrainTexture(), color: 0xc9a172, roughness: 0.6 });
  for (const door of DOORS) {
    const panel = shadowed(new THREE.Mesh(new THREE.BoxGeometry(0.05, DOOR_HEIGHT - 0.02, DOOR_WIDTH), doorMaterial));
    panel.position.set(maxX + 0.04, DOOR_HEIGHT / 2, door.z);
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.5), standard(0xbcd7ee, { roughness: 0.1, metalness: 0.2 }));
    pane.rotation.y = -Math.PI / 2;
    pane.position.set(maxX + 0.01, 1.5, door.z);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.15, 0.04), aluminum);
    handle.position.set(maxX + 0.005, 1, door.z + DOOR_WIDTH / 2 - 0.1);
    root.add(panel, pane, handle);
    occluders.push(panel);
  }
  const exitSign = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.28), new THREE.MeshBasicMaterial({
    map: canvasTexture(384, 120, ctx => {
      ctx.fillStyle = '#15803d';
      ctx.fillRect(0, 0, 384, 120);
      ctx.fillStyle = '#ffffff';
      ctx.font = `bold 52px ${PLAZA_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('広場へ →', 192, 64);
    }),
  }));
  exitSign.rotation.y = -Math.PI / 2;
  exitSign.position.set(maxX - 0.02, DOOR_HEIGHT + 0.3, CLASSROOM_DOOR.z);
  root.add(exitSign);

  // 机と椅子（20組）。椅子は少しずつ向きや位置をずらす。
  const desks = deskPositions();
  const deskTop = standard(0xffffff, { map: woodGrainTexture(), color: 0xe8c79a, roughness: 0.55 });
  const steel = standard(0x9aa3ad, { metalness: 0.6, roughness: 0.4 });
  const shelf = standard(0x7d8794, { metalness: 0.4, roughness: 0.5 });
  const part = (geometry: THREE.BufferGeometry, material: THREE.Material, locals: THREE.Matrix4[], chair = false) =>
    root.add(instanced(geometry, material, desks.flatMap((desk, index) => {
      const base = chair
        ? placeMatrix(desk.x + (seededRandom(index + 3)() - 0.5) * 0.08, 0, desk.z + CHAIR_OFFSET + (seededRandom(index + 9)() - 0.5) * 0.1, (seededRandom(index + 5)() - 0.5) * 0.16)
        : placeMatrix(desk.x, 0, desk.z);
      return locals.map(local => base.clone().multiply(local));
    })));
  const at = (x: number, y: number, z: number) => new THREE.Matrix4().makeTranslation(x, y, z);
  part(new THREE.BoxGeometry(DESK.width, 0.025, DESK.depth), deskTop, [at(0, DESK.height, 0)]);
  part(new THREE.BoxGeometry(DESK.width - 0.05, 0.12, DESK.depth - 0.07), shelf, [at(0, DESK.height - 0.1, -0.02)]);
  part(new THREE.BoxGeometry(0.025, DESK.height, 0.025), steel, [-1, 1].flatMap(sx => [-1, 1].map(sz => at(sx * 0.3, DESK.height / 2, sz * 0.2))));
  part(new THREE.BoxGeometry(0.4, 0.025, 0.38), deskTop, [at(0, 0.42, 0)], true);
  part(new THREE.BoxGeometry(0.38, 0.2, 0.02), deskTop, [at(0, 0.74, 0.19)], true);
  part(new THREE.BoxGeometry(0.022, 0.42, 0.022), steel, [-1, 1].flatMap(sx => [-1, 1].map(sz => at(sx * 0.18, 0.21, sz * 0.17))), true);
  part(new THREE.BoxGeometry(0.022, 0.36, 0.022), steel, [-1, 1].map(sx => at(sx * 0.18, 0.6, 0.19)), true);
  // 机の横にかけたかばん（いくつか）
  const bagMatrices = desks.filter((_, index) => index % 3 === 0).map(desk => placeMatrix(desk.x + DESK.width / 2 + 0.03, 0.5, desk.z, Math.PI / 2));
  root.add(instanced(new THREE.BoxGeometry(0.3, 0.26, 0.08), standard(0x1e3a5f, { roughness: 0.6 }), bagMatrices));

  // ロッカー（後ろの壁）と掲示板
  const lockerFront = standard(0xffffff, { map: lockerTexture(), roughness: 0.7 });
  const lockerTop = standard(0xffffff, { map: woodGrainTexture(), color: 0xd9b88c, roughness: 0.6 });
  const lockerSide = standard(0xe2dccb, { roughness: 0.7 });
  const lockers = shadowed(new THREE.Mesh(new THREE.BoxGeometry(WIDTH, LOCKER.height, LOCKER.depth), [lockerSide, lockerSide, lockerTop, lockerSide, lockerSide, lockerFront]));
  lockers.position.set(0, LOCKER.height / 2, maxZ - LOCKER.depth / 2);
  root.add(lockers);
  const cork = shadowed(new THREE.Mesh(new THREE.PlaneGeometry(WIDTH - 0.4, 1.05), standard(0xffffff, { map: corkTexture(), roughness: 1 })), false, true);
  cork.rotation.y = Math.PI;
  cork.position.set(0, 1.75, maxZ - 0.015);
  root.add(cork);
  for (const [w, h, x, y] of [[WIDTH - 0.3, 0.05, 0, 2.3], [WIDTH - 0.3, 0.05, 0, 1.2], [0.05, 1.15, -(WIDTH - 0.35) / 2, 1.75], [0.05, 1.15, (WIDTH - 0.35) / 2, 1.75]] as const) {
    const frame = shadowed(new THREE.Mesh(new THREE.BoxGeometry(w, h, 0.03), darkWood));
    frame.position.set(x, y, maxZ - 0.02);
    root.add(frame);
  }

  let clockTimer = 1;
  const update = (_time: number, dt: number) => {
    clockTimer += dt;
    if (clockTimer >= 1) {
      clockTimer = 0;
      clockFace.redraw();
    }
  };

  return { obstacles: [], occluders, sun, update, setBlackboard };
}
