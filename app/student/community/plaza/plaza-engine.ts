import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import {
  BOARD_OBSTACLE_RADIUS, CLASSROOM_GATE_REACH, EYE_HEIGHT, PLAYER_RADIUS, PLAZA_RADIUS, RUN_SPEED, THIRD_DISTANCE, THIRD_TARGET_HEIGHT, WALK_SPEED,
  approachAngle, clampPitchFor, classroomGatePoint, findFacingBoard, headingOf, isNear, layoutBoards, moveVector, plazaReturnSpawn,
  resolveCollision, stickVector, thirdPersonCamera, toContentDelta, toContentPoint, wrapText,
  type BoardPlacement, type BoxObstacle, type Obstacle, type Vec2, type ViewMode, type WalkBounds,
} from '@/lib/community-plaza';
import {
  CLASSROOM, CLASSROOM_BOUNDS, CLASSROOM_DOOR, CLASSROOM_DOOR_REACH, CLASSROOM_SPAWN, NOTE_CENTER_Y, NOTE_COUNT, NOTE_SIZE, classroomObstacles, notePlacements,
} from '@/lib/community-classroom';
import { buildAvatar, buildPlazaWorld, type Quality, type StageWorld } from './plaza-world';
import { buildClassroomWorld } from './classroom-world';
import { PLAZA_FONT, disposeCachedTextures, seededRandom } from './plaza-textures';

/**
 * 交流広場の3D表示と操作（three.js）。React からは createPlazaEngine で作り、dispose で片付ける。
 *   ステージ：広場（看板が並ぶ）と教室（後ろの掲示板に貼り紙）。広場の「校舎・教室」の門と、教室の後ろの扉で行き来する。
 *   視点：三人称（自分のアバターを後ろから見る、標準）と一人称を切り替えられる（V キー・画面のボタン）。
 *   PC：クリックで視点をつかむ（Pointer Lock）→ マウスで見回し、WASD・矢印で移動、Shift で走る、E で看板を見る・門や扉を通る。
 *   スマホ・タブレット：画面の左側でスティック（移動）、右側をなぞって見回す。
 *   画質：high は影・高い解像度、low は影なし（古い端末向け）。
 * ほかの生徒は表示しない（位置などを送らない）。看板には承認済みの投稿だけを渡す。
 */

export type PlazaBoard = {
  id: string;
  title: string;
  type: 'thread' | 'vote';
  creatorName: string;
  likes: number;
  featured: boolean;
};

export type StageKey = 'plaza' | 'classroom';

export type PlazaEngineOptions = {
  onFacingChange: (index: number) => void;
  onInteract: (index: number) => void;
  onPointerLockChange?: (locked: boolean) => void;
  /** V キーで視点を切り替えたとき。 */
  onViewModeChange?: (mode: ViewMode) => void;
  /** 門・扉の前に来た／離れたとき（label は「教室に入る」など。離れたら null）。 */
  onPortalChange?: (label: string | null) => void;
  /** ステージの移動の暗転（true で暗くし、移り終わったら false）。 */
  onTransition?: (active: boolean) => void;
  onStageChange?: (stage: StageKey) => void;
  viewMode?: ViewMode;
  avatarColor?: string;
  quality?: Quality;
  /** はじめにいるステージ（標準は広場）。 */
  initialStage?: StageKey;
};

const BOARD_W = 2.4;
const BOARD_H = 1.8;
const BOARD_CENTER_Y = 1.95;
const STICK_RADIUS = 60;
const LOOK_SENSITIVITY_MOUSE = 0.0024;
const LOOK_SENSITIVITY_TOUCH = 0.0055;
const START = { x: 0, z: -5.5, yaw: 0 };
const START_PITCH: Record<ViewMode, number> = { third: -0.28, first: -0.05 };
const TRANSITION_MS = 360;

function drawBoardTexture(board: PlazaBoard, highlighted: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 640;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  const vote = board.type === 'vote';
  ctx.fillStyle = vote ? '#fff7e6' : '#eef7ff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = vote ? '#f59e0b' : '#0ea5e9';
  ctx.fillRect(0, 0, canvas.width, 72);
  ctx.fillStyle = '#ffffff';
  ctx.font = `bold 34px ${PLAZA_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(vote ? '📊 投票' : '💬 スレッド', 28, 38);
  if (board.featured) {
    ctx.textAlign = 'right';
    ctx.fillText('👑 殿堂入り', canvas.width - 28, 38);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#1e293b';
  ctx.font = `bold 44px ${PLAZA_FONT}`;
  ctx.textBaseline = 'top';
  wrapText(board.title, canvas.width - 64, 5, value => ctx.measureText(value).width).forEach((line, index) => ctx.fillText(line, 32, 100 + index * 60));
  ctx.fillStyle = '#64748b';
  ctx.font = `bold 28px ${PLAZA_FONT}`;
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(wrapText(board.creatorName || '', canvas.width / 2, 1, value => ctx.measureText(value).width)[0] || '', 32, canvas.height - 28);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e11d48';
  ctx.fillText(`♥ ${board.likes}`, canvas.width - 32, canvas.height - 28);
  ctx.textAlign = 'left';
  if (highlighted) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 16;
    ctx.strokeRect(8, 8, canvas.width - 16, canvas.height - 16);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

/** 教室の掲示板の貼り紙（色画用紙に手書き風）。 */
function drawNoteTexture(board: PlazaBoard, highlighted: boolean) {
  const canvas = document.createElement('canvas');
  canvas.width = 420;
  canvas.height = 306;
  const ctx = canvas.getContext('2d')!;
  const vote = board.type === 'vote';
  ctx.fillStyle = vote ? '#fff1c7' : '#fdfbf3';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = vote ? 'rgba(217,119,6,0.25)' : 'rgba(59,130,246,0.18)';
  ctx.lineWidth = 2;
  for (let y = 74; y < canvas.height - 40; y += 38) {
    ctx.beginPath(); ctx.moveTo(18, y); ctx.lineTo(canvas.width - 18, y); ctx.stroke();
  }
  ctx.fillStyle = vote ? '#b45309' : '#1d4ed8';
  ctx.font = `bold 26px ${PLAZA_FONT}`;
  ctx.textBaseline = 'middle';
  ctx.fillText(vote ? '📊 投票' : '💬 スレッド', 20, 30);
  if (board.featured) {
    ctx.textAlign = 'right';
    ctx.fillText('👑', canvas.width - 20, 30);
    ctx.textAlign = 'left';
  }
  ctx.fillStyle = '#1f2937';
  ctx.font = `bold 32px ${PLAZA_FONT}`;
  ctx.textBaseline = 'alphabetic';
  wrapText(board.title, canvas.width - 40, 5, value => ctx.measureText(value).width).forEach((line, index) => ctx.fillText(line, 20, 98 + index * 38));
  ctx.fillStyle = '#6b7280';
  ctx.font = `bold 22px ${PLAZA_FONT}`;
  ctx.fillText(wrapText(board.creatorName || '', canvas.width / 2, 1, value => ctx.measureText(value).width)[0] || '', 20, canvas.height - 16);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#e11d48';
  ctx.fillText(`♥ ${board.likes}`, canvas.width - 20, canvas.height - 16);
  ctx.textAlign = 'left';
  if (highlighted) {
    ctx.strokeStyle = '#facc15';
    ctx.lineWidth = 14;
    ctx.strokeRect(7, 7, canvas.width - 14, canvas.height - 14);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  return texture;
}

type Stage = {
  key: StageKey;
  root: THREE.Group;
  world: StageWorld;
  topicGroup: THREE.Group;
  placements: BoardPlacement[];
  faces: { material: THREE.MeshStandardMaterial; board: PlazaBoard }[];
  panels: THREE.Object3D[];
  staticObstacles: (Obstacle | BoxObstacle)[];
  obstacles: (Obstacle | BoxObstacle)[];
  bounds: WalkBounds;
  portal: { point: Vec2; reach: number; label: string; to: StageKey; spawn: Vec2 & { yaw: number } };
  cameraDistance: number;
  environment: THREE.Texture;
  exposure: number;
  draw: (board: PlazaBoard, highlighted: boolean) => THREE.Texture;
};

export function createPlazaEngine(container: HTMLElement, options: PlazaEngineOptions) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const quality: Quality = options.quality || 'high';
  const high = quality === 'high';
  const renderer = new THREE.WebGLRenderer({ antialias: !coarse || high, powerPreference: high ? 'high-performance' : 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, high ? (coarse ? 1.75 : 2) : 1));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.shadowMap.enabled = high;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.domElement.style.display = 'block';
  renderer.domElement.style.width = '100%';
  renderer.domElement.style.height = '100%';
  renderer.domElement.style.touchAction = 'none';
  renderer.domElement.setAttribute('aria-label', '交流広場の3D表示');
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xd6e6f2, 80, 300);
  const camera = new THREE.PerspectiveCamera(70, 1, 0.05, 1000);
  camera.rotation.order = 'YXZ';

  // 空（大気の散乱で色を出す。雲つき）。広場・教室の窓の外で共通。
  const sunDirection = new THREE.Vector3(30, 45, 18).normalize();
  const makeSky = () => {
    const sky = new Sky();
    sky.scale.setScalar(900);
    const uniforms = sky.material.uniforms;
    uniforms.turbidity.value = 2.2;
    uniforms.rayleigh.value = 1.1;
    uniforms.mieCoefficient.value = 0.004;
    uniforms.mieDirectionalG.value = 0.86;
    uniforms.sunPosition.value.copy(sunDirection);
    uniforms.cloudCoverage.value = 0.35;
    return sky;
  };
  const sky = makeSky();
  scene.add(sky);

  // 映り込み（環境光）。広場は空から、教室は室内向けのものから作る。
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = makeSky();
  envSky.material.uniforms.showSunDisc.value = 0;
  envScene.add(envSky);
  const plazaEnvironment = pmrem.fromScene(envScene).texture;
  const roomEnvironment = new RoomEnvironment();
  const classroomEnvironment = pmrem.fromScene(roomEnvironment, 0.04).texture;
  roomEnvironment.dispose();
  envSky.geometry.dispose();
  envSky.material.dispose();

  const plazaRoot = new THREE.Group();
  const classroomRoot = new THREE.Group();
  scene.add(plazaRoot, classroomRoot);
  const plazaWorld = buildPlazaWorld(plazaRoot, quality);
  const classroomWorld = buildClassroomWorld(classroomRoot, quality);

  const avatar = buildAvatar(options.avatarColor || '#3b82f6');
  scene.add(avatar.group);
  if (!high) {
    // 影を描かないときは、足元に丸い影を置く。
    const blob = new THREE.Mesh(new THREE.CircleGeometry(0.45, 24), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false }));
    blob.rotation.x = -Math.PI / 2;
    blob.position.y = 0.035;
    avatar.group.add(blob);
  }

  const gate = classroomGatePoint();
  const stages: Record<StageKey, Stage> = {
    plaza: {
      key: 'plaza',
      root: plazaRoot,
      world: plazaWorld,
      topicGroup: new THREE.Group(),
      placements: [],
      faces: [],
      panels: [],
      staticObstacles: plazaWorld.obstacles,
      obstacles: plazaWorld.obstacles,
      bounds: PLAZA_RADIUS,
      portal: { point: gate, reach: CLASSROOM_GATE_REACH, label: '教室に入る', to: 'classroom', spawn: CLASSROOM_SPAWN },
      cameraDistance: THIRD_DISTANCE,
      environment: plazaEnvironment,
      exposure: 0.7,
      draw: drawBoardTexture,
    },
    classroom: {
      key: 'classroom',
      root: classroomRoot,
      world: classroomWorld,
      topicGroup: new THREE.Group(),
      placements: [],
      faces: [],
      panels: [],
      staticObstacles: classroomObstacles(),
      obstacles: classroomObstacles(),
      bounds: CLASSROOM_BOUNDS,
      portal: { point: CLASSROOM_DOOR, reach: CLASSROOM_DOOR_REACH, label: '広場にもどる', to: 'plaza', spawn: plazaReturnSpawn() },
      cameraDistance: 2.6,
      environment: classroomEnvironment,
      exposure: 0.95,
      draw: drawNoteTexture,
    },
  };
  plazaRoot.add(stages.plaza.topicGroup);
  classroomRoot.add(stages.classroom.topicGroup);

  // 看板（広場）・貼り紙（教室）
  const postGeometry = new THREE.BoxGeometry(0.12, BOARD_CENTER_Y, 0.12);
  const panelGeometry = new THREE.BoxGeometry(BOARD_W, BOARD_H, 0.1);
  const roofGeometry = new THREE.BoxGeometry(BOARD_W + 0.3, 0.12, 0.4);
  const noteGeometry = new THREE.PlaneGeometry(NOTE_SIZE.width, NOTE_SIZE.height);
  const pinGeometry = new THREE.SphereGeometry(0.018, 10, 8);
  const woodMaterial = new THREE.MeshStandardMaterial({ color: 0x9a6b3f, roughness: 0.75 });
  const roofMaterial = new THREE.MeshStandardMaterial({ color: 0x6b3f22, roughness: 0.6 });
  const pinMaterial = new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3, metalness: 0.2 });
  let boards: PlazaBoard[] = [];

  let current: Stage = stages.plaza;
  let facing = -1;
  let portalNear = false;
  let transitioning = false;

  const setFaceTexture = (stage: Stage, index: number, highlighted: boolean) => {
    const face = stage.faces[index];
    if (!face) return;
    face.material.map?.dispose();
    face.material.map = stage.draw(face.board, highlighted);
    face.material.needsUpdate = true;
  };

  const clearTopics = (stage: Stage) => {
    for (const face of stage.faces) {
      face.material.map?.dispose();
      face.material.dispose();
    }
    stage.topicGroup.clear();
    stage.faces = [];
    stage.panels = [];
  };

  const setBoards = (next: PlazaBoard[]) => {
    const plaza = stages.plaza;
    const classroom = stages.classroom;
    clearTopics(plaza);
    clearTopics(classroom);
    plaza.placements = layoutBoards(next.length);
    boards = next.slice(0, plaza.placements.length);
    const highlightIndex = (stage: Stage) => (current === stage ? facing : -1);

    plaza.placements.forEach((placement, index) => {
      const group = new THREE.Group();
      group.position.set(placement.x, 0, placement.z);
      group.rotation.y = placement.rotY;
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(postGeometry, woodMaterial);
        post.position.set(side * (BOARD_W / 2 - 0.15), BOARD_CENTER_Y / 2, -0.08);
        post.castShadow = high;
        group.add(post);
      }
      const face = new THREE.MeshStandardMaterial({ map: drawBoardTexture(boards[index], index === highlightIndex(plaza)), roughness: 0.7 });
      // BoxGeometry の面の順：+x, -x, +y, -y, +z（表）, -z（裏）
      const panel = new THREE.Mesh(panelGeometry, [woodMaterial, woodMaterial, woodMaterial, woodMaterial, face, woodMaterial]);
      panel.position.y = BOARD_CENTER_Y;
      panel.castShadow = high;
      panel.receiveShadow = high;
      const roof = new THREE.Mesh(roofGeometry, roofMaterial);
      roof.position.set(0, BOARD_CENTER_Y + BOARD_H / 2 + 0.08, 0);
      roof.castShadow = high;
      group.add(panel, roof);
      plaza.topicGroup.add(group);
      plaza.faces.push({ material: face, board: boards[index] });
      plaza.panels.push(panel);
    });
    plaza.obstacles = [...plaza.staticObstacles, ...plaza.placements.map(item => ({ x: item.x, z: item.z, r: BOARD_OBSTACLE_RADIUS }))];

    classroom.placements = notePlacements(boards.length);
    classroom.placements.forEach((placement, index) => {
      const tilt = (seededRandom(index + 11)() - 0.5) * 0.08;
      const face = new THREE.MeshStandardMaterial({ map: drawNoteTexture(boards[index], index === highlightIndex(classroom)), roughness: 0.9 });
      const note = new THREE.Mesh(noteGeometry, face);
      note.position.set(placement.x, NOTE_CENTER_Y, placement.z - 0.005);
      note.rotation.set(0, placement.rotY, tilt);
      note.receiveShadow = high;
      const pin = new THREE.Mesh(pinGeometry, pinMaterial);
      pin.position.set(placement.x, NOTE_CENTER_Y + NOTE_SIZE.height / 2 - 0.05, placement.z - 0.02);
      classroom.topicGroup.add(note, pin);
      classroom.faces.push({ material: face, board: boards[index] });
      classroom.panels.push(note);
    });

    // 黒板の「今日の話題」は、いいねがいちばん多い投稿（同じなら新しい方）。
    const topTopic = boards.reduce<PlazaBoard | null>((best, board) => (!best || board.likes > best.likes ? board : best), null);
    classroomWorld.setBlackboard({ topicTitle: topTopic?.title || null, topicCount: boards.length });

    if (facing >= current.placements.length) {
      facing = -1;
      options.onFacingChange(-1);
    }
  };

  /** 看板の内容（いいねの数など）だけを描き直す。並びは変えない。 */
  const updateBoard = (index: number, board: PlazaBoard) => {
    boards[index] = board;
    for (const stage of [stages.plaza, stages.classroom]) {
      const face = stage.faces[index];
      if (!face) continue;
      face.board = board;
      setFaceTexture(stage, index, stage === current && index === facing);
    }
  };

  // プレイヤー
  let viewMode: ViewMode = options.viewMode || 'third';
  const player = { x: START.x, z: START.z, yaw: START.yaw, pitch: START_PITCH[viewMode], heading: START.yaw };
  const keys = new Set<string>();
  let stick = { x: 0, y: 0 };
  let rotated = false;
  let paused = false;
  let running = false;
  let frame = 0;
  let last = performance.now();
  let sensitivity = 1;
  let speedRatio = 0;
  let snapCamera = true;
  const cameraTarget = new THREE.Vector3();
  const desiredCamera = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  const applyStage = (stage: Stage) => {
    current = stage;
    plazaRoot.visible = stage.key === 'plaza';
    classroomRoot.visible = stage.key === 'classroom';
    scene.environment = stage.environment;
    scene.environmentIntensity = stage.key === 'plaza' ? 0.4 : 0.6;
    renderer.toneMappingExposure = stage.exposure;
  };
  applyStage(stages.plaza);

  // スティックの見た目
  const stickBase = document.createElement('div');
  const stickKnob = document.createElement('div');
  Object.assign(stickBase.style, {
    position: 'absolute', width: `${STICK_RADIUS * 2}px`, height: `${STICK_RADIUS * 2}px`, borderRadius: '9999px',
    border: '2px solid rgba(255,255,255,0.8)', background: 'rgba(15,23,42,0.18)', pointerEvents: 'none', display: 'none',
    transform: 'translate(-50%, -50%)',
  });
  Object.assign(stickKnob.style, {
    position: 'absolute', width: '52px', height: '52px', borderRadius: '9999px', background: 'rgba(255,255,255,0.85)',
    pointerEvents: 'none', display: 'none', transform: 'translate(-50%, -50%)', boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
  });
  container.append(stickBase, stickKnob);

  const placeCamera = (dt: number) => {
    if (viewMode === 'first') {
      avatar.group.visible = false;
      camera.position.set(player.x, EYE_HEIGHT, player.z);
      camera.rotation.set(player.pitch, player.yaw, 0);
      return;
    }
    avatar.group.visible = true;
    cameraTarget.set(player.x, THIRD_TARGET_HEIGHT, player.z);
    const ideal = thirdPersonCamera(cameraTarget, player.yaw, player.pitch, current.cameraDistance);
    desiredCamera.set(ideal.x, ideal.y, ideal.z);
    // 看板・噴水・門の柱・教室の壁があいだに入ったら、その手前までカメラを寄せる。
    const toCamera = desiredCamera.clone().sub(cameraTarget);
    const distance = toCamera.length();
    raycaster.set(cameraTarget, toCamera.normalize());
    raycaster.far = distance;
    const hit = raycaster.intersectObjects([...current.panels, ...current.world.occluders], false)[0];
    if (hit) desiredCamera.copy(cameraTarget).addScaledVector(toCamera, Math.max(0.5, hit.distance - 0.2));
    // 教室では、カメラを部屋の中に収める（扉の開いた所などから外へ出ないように）。
    if (typeof current.bounds !== 'number') {
      const margin = 0.15;
      desiredCamera.x = Math.max(current.bounds.minX + margin, Math.min(current.bounds.maxX - margin, desiredCamera.x));
      desiredCamera.z = Math.max(current.bounds.minZ + margin, Math.min(current.bounds.maxZ - margin, desiredCamera.z));
      desiredCamera.y = Math.min(desiredCamera.y, CLASSROOM.height - 0.2);
    }
    if (snapCamera) {
      camera.position.copy(desiredCamera);
      snapCamera = false;
    } else {
      camera.position.lerp(desiredCamera, 1 - Math.exp(-dt * 14));
    }
    camera.lookAt(cameraTarget);
    // カメラがアバターに近づきすぎたら（壁ぎわなど）、アバターを隠して視界をあける。
    avatar.group.visible = camera.position.distanceTo(cameraTarget) > 1.1;
  };

  const renderOnce = () => {
    avatar.group.position.set(player.x, 0, player.z);
    avatar.group.rotation.y = player.heading;
    placeCamera(0);
    focus.set(player.x, 0, player.z);
    current.world.update(performance.now(), 0, focus);
    renderer.render(scene, camera);
  };

  const resize = () => {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    if (!running) renderOnce();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  const isTyping = (target: EventTarget | null) => {
    const element = target as HTMLElement | null;
    return Boolean(element && (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.isContentEditable));
  };

  const setViewMode = (mode: ViewMode) => {
    if (mode === viewMode) return;
    viewMode = mode;
    player.pitch = clampPitchFor(mode, mode === 'third' ? Math.min(player.pitch, -0.1) : player.pitch * 0.4);
    // 三人称に戻すときは、アバターを今見ている向きにそろえる。
    if (mode === 'third') player.heading = player.yaw;
    snapCamera = true;
    if (!running) renderOnce();
  };

  const setFacing = (next: number) => {
    if (next === facing) return;
    const previous = facing;
    facing = next;
    if (previous >= 0) setFaceTexture(current, previous, false);
    if (facing >= 0) setFaceTexture(current, facing, true);
    options.onFacingChange(facing);
  };

  /** 門・扉を通って、もう一方のステージへ移る（暗転をはさむ）。 */
  const enterPortal = () => {
    if (transitioning || !portalNear) return;
    transitioning = true;
    keys.clear();
    stick = { x: 0, y: 0 };
    options.onTransition?.(true);
    window.setTimeout(() => {
      const { to, spawn } = current.portal;
      setFacing(-1);
      applyStage(stages[to]);
      Object.assign(player, { x: spawn.x, z: spawn.z, yaw: spawn.yaw, heading: spawn.yaw, pitch: START_PITCH[viewMode] });
      portalNear = false;
      options.onPortalChange?.(null);
      snapCamera = true;
      options.onStageChange?.(to);
      if (!running) renderOnce();
      window.setTimeout(() => {
        transitioning = false;
        options.onTransition?.(false);
      }, 60);
    }, TRANSITION_MS);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (paused || transitioning || isTyping(event.target)) return;
    const key = event.key.toLowerCase();
    if (['w', 'a', 's', 'd', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright', 'shift'].includes(key)) {
      keys.add(key);
      if (key.startsWith('arrow')) event.preventDefault();
    }
    if (key === 'e' || key === 'enter') {
      if (portalNear) {
        event.preventDefault();
        enterPortal();
      } else if (facing >= 0) {
        event.preventDefault();
        options.onInteract(facing);
      }
    }
    if (key === 'v' && !event.repeat) {
      setViewMode(viewMode === 'third' ? 'first' : 'third');
      options.onViewModeChange?.(viewMode);
    }
  };
  const onKeyUp = (event: KeyboardEvent) => keys.delete(event.key.toLowerCase());
  const onBlur = () => { keys.clear(); stick = { x: 0, y: 0 }; };

  const pointers = new Map<number, { role: 'move' | 'look'; originX: number; originY: number; lastX: number; lastY: number }>();
  const contentPoint = (event: PointerEvent) => {
    const rect = container.getBoundingClientRect();
    // 回していないときは、画面の位置を container の中の位置に直す（回しているときは container が画面いっぱい）。
    const point = toContentPoint(event.clientX, event.clientY, rotated, window.innerWidth);
    return rotated ? point : { x: point.x - rect.left, y: point.y - rect.top };
  };
  const look = (dx: number, dy: number, scale: number) => {
    player.yaw -= dx * scale * sensitivity;
    player.pitch = clampPitchFor(viewMode, player.pitch - dy * scale * sensitivity);
  };
  const showStick = (originX: number, originY: number, x: number, y: number) => {
    stickBase.style.display = 'block';
    stickKnob.style.display = 'block';
    stickBase.style.left = `${originX}px`;
    stickBase.style.top = `${originY}px`;
    stickKnob.style.left = `${x}px`;
    stickKnob.style.top = `${y}px`;
  };
  const hideStick = () => {
    stickBase.style.display = 'none';
    stickKnob.style.display = 'none';
  };

  const onPointerDown = (event: PointerEvent) => {
    if (paused) return;
    if (event.pointerType === 'mouse') {
      if (document.pointerLockElement !== renderer.domElement) {
        // 古いブラウザでは Promise を返さないので、両方に備える。
        try { void (renderer.domElement.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => undefined); } catch { /* ドラッグで見回す */ }
      }
      pointers.set(event.pointerId, { role: 'look', originX: event.clientX, originY: event.clientY, lastX: event.clientX, lastY: event.clientY });
      return;
    }
    const point = contentPoint(event);
    const role = point.x < container.clientWidth * 0.42 ? 'move' : 'look';
    if (role === 'move' && [...pointers.values()].some(item => item.role === 'move')) return;
    renderer.domElement.setPointerCapture?.(event.pointerId);
    pointers.set(event.pointerId, { role, originX: point.x, originY: point.y, lastX: event.clientX, lastY: event.clientY });
    if (role === 'move') showStick(point.x, point.y, point.x, point.y);
    event.preventDefault();
  };
  const onPointerMove = (event: PointerEvent) => {
    const state = pointers.get(event.pointerId);
    if (event.pointerType === 'mouse') {
      if (document.pointerLockElement === renderer.domElement) {
        if (!paused) look(event.movementX, event.movementY, LOOK_SENSITIVITY_MOUSE);
      } else if (state && event.buttons) {
        look(event.clientX - state.lastX, event.clientY - state.lastY, LOOK_SENSITIVITY_MOUSE);
        state.lastX = event.clientX;
        state.lastY = event.clientY;
      }
      return;
    }
    if (!state || paused) return;
    if (state.role === 'move') {
      const point = contentPoint(event);
      const dx = point.x - state.originX;
      const dy = point.y - state.originY;
      stick = transitioning ? { x: 0, y: 0 } : stickVector(dx, dy, STICK_RADIUS);
      const length = Math.hypot(dx, dy);
      const clamp = length > STICK_RADIUS ? STICK_RADIUS / length : 1;
      showStick(state.originX, state.originY, state.originX + dx * clamp, state.originY + dy * clamp);
    } else {
      const delta = toContentDelta(event.clientX - state.lastX, event.clientY - state.lastY, rotated);
      look(delta.x, delta.y, LOOK_SENSITIVITY_TOUCH);
    }
    state.lastX = event.clientX;
    state.lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    const state = pointers.get(event.pointerId);
    pointers.delete(event.pointerId);
    if (state?.role === 'move' && event.pointerType !== 'mouse') {
      stick = { x: 0, y: 0 };
      hideStick();
    }
  };
  const onPointerLockChange = () => options.onPointerLockChange?.(document.pointerLockElement === renderer.domElement);
  const onContextMenu = (event: Event) => event.preventDefault();

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('pointerlockchange', onPointerLockChange);
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.domElement.addEventListener('pointermove', onPointerMove);
  renderer.domElement.addEventListener('pointerup', onPointerUp);
  renderer.domElement.addEventListener('pointercancel', onPointerUp);
  renderer.domElement.addEventListener('contextmenu', onContextMenu);

  const step = (dt: number) => {
    let forward = stick.y ? -stick.y : 0;
    let right = stick.x;
    if (!transitioning) {
      if (keys.has('w') || keys.has('arrowup')) forward += 1;
      if (keys.has('s') || keys.has('arrowdown')) forward -= 1;
      if (keys.has('d')) right += 1;
      if (keys.has('a')) right -= 1;
      // 矢印の左右は向きを変える（キーボードだけでも見回せるように）。
      if (keys.has('arrowleft')) player.yaw += 2.2 * dt;
      if (keys.has('arrowright')) player.yaw -= 2.2 * dt;
    } else {
      forward = 0;
      right = 0;
    }
    const runningNow = keys.has('shift') || Math.hypot(stick.x, stick.y) > 0.95;
    // 教室の中は少しゆっくり歩く。
    const speed = (runningNow ? RUN_SPEED : WALK_SPEED) * (current.key === 'classroom' ? 0.75 : 1);
    const move = moveVector(forward, right, player.yaw);
    const amount = Math.hypot(move.x, move.z);
    const next = resolveCollision({ x: player.x + move.x * speed * dt, z: player.z + move.z * speed * dt }, current.obstacles, PLAYER_RADIUS, current.bounds);
    const moved = Math.hypot(next.x - player.x, next.z - player.z) / Math.max(dt, 1e-6);
    player.x = next.x;
    player.z = next.z;
    // アバターは進む方へ向きを変える。
    if (amount > 0.05) player.heading = approachAngle(player.heading, headingOf(move), dt * 12);
    speedRatio = Math.min(1, moved / RUN_SPEED) * (amount > 0.05 ? 1 : 0);
    if (runningNow && speedRatio > 0) speedRatio = Math.max(speedRatio, 0.9);

    setFacing(findFacingBoard(player, player.yaw, current.placements));
    const near = !transitioning && isNear(player, current.portal.point, current.portal.reach);
    if (near !== portalNear) {
      portalNear = near;
      options.onPortalChange?.(near ? current.portal.label : null);
    }
  };

  const loop = (now: number) => {
    if (!running) return;
    // requestAnimationFrame の時刻は、直前に測った時刻より少し前のことがある。マイナスにすると
    // カメラを寄せる計算が発散するので、0〜0.1秒に収める。
    const dt = Math.max(0, Math.min(0.1, (now - last) / 1000));
    last = now;
    step(dt);
    avatar.group.position.set(player.x, 0, player.z);
    avatar.group.rotation.y = player.heading;
    avatar.update(dt, speedRatio);
    placeCamera(dt);
    if (viewMode === 'first' && speedRatio > 0) {
      // 一人称で歩いているときは少し上下に揺らす（控えめ。酔いにくいように）。
      camera.position.y += Math.sin(now / 160) * 0.02;
    }
    focus.set(player.x, 0, player.z);
    current.world.update(now, dt, focus);
    sky.material.uniforms.time.value = now / 1000;
    renderer.render(scene, camera);
    frame = requestAnimationFrame(loop);
  };

  const start = () => {
    if (running || paused || document.hidden) return;
    running = true;
    last = performance.now();
    frame = requestAnimationFrame(loop);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(frame);
  };
  // 画面が見えていない間は描かない（電池と端末の熱のため）。
  const onVisibility = () => (document.hidden ? stop() : start());
  document.addEventListener('visibilitychange', onVisibility);

  if (options.initialStage === 'classroom') {
    applyStage(stages.classroom);
    Object.assign(player, { x: CLASSROOM_SPAWN.x, z: CLASSROOM_SPAWN.z, yaw: CLASSROOM_SPAWN.yaw, heading: CLASSROOM_SPAWN.yaw });
  }
  resize();
  renderOnce();
  start();

  return {
    setBoards,
    updateBoard,
    setViewMode,
    enterPortal,
    setRotated(value: boolean) {
      rotated = value;
      pointers.clear();
      stick = { x: 0, y: 0 };
      hideStick();
    },
    setSensitivity(value: number) {
      sensitivity = Math.max(0.3, Math.min(3, value));
    },
    /** 投稿を開いている間は止める（操作も描画も）。 */
    setPaused(value: boolean) {
      paused = value;
      keys.clear();
      pointers.clear();
      stick = { x: 0, y: 0 };
      hideStick();
      if (value) {
        if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
        stop();
      } else {
        start();
      }
    },
    /** 今いるステージの入口にもどる。 */
    resetPosition() {
      const spawn = current.key === 'plaza' ? START : CLASSROOM_SPAWN;
      Object.assign(player, { x: spawn.x, z: spawn.z, yaw: spawn.yaw, pitch: START_PITCH[viewMode], heading: spawn.yaw });
      snapCamera = true;
    },
    dispose() {
      stop();
      resizeObserver.disconnect();
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('pointerlockchange', onPointerLockChange);
      document.removeEventListener('visibilitychange', onVisibility);
      if (document.pointerLockElement === renderer.domElement) document.exitPointerLock();
      clearTopics(stages.plaza);
      clearTopics(stages.classroom);
      // 景色・アバターの形・色・画像をまとめて片付ける。
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        const mesh = object as THREE.Mesh;
        if (mesh.geometry) geometries.add(mesh.geometry);
        const material = mesh.material as THREE.Material | THREE.Material[] | undefined;
        if (Array.isArray(material)) material.forEach(item => materials.add(item));
        else if (material) materials.add(material);
        if ((object as THREE.InstancedMesh).isInstancedMesh) (object as THREE.InstancedMesh).dispose();
        if ((object as THREE.DirectionalLight).isDirectionalLight) (object as THREE.DirectionalLight).shadow.dispose();
      });
      [postGeometry, panelGeometry, roofGeometry, noteGeometry, pinGeometry].forEach(item => geometries.add(item));
      [woodMaterial, roofMaterial, pinMaterial].forEach(item => materials.add(item));
      geometries.forEach(item => item.dispose());
      materials.forEach(item => {
        (item as THREE.MeshStandardMaterial).map?.dispose();
        item.dispose();
      });
      plazaEnvironment.dispose();
      classroomEnvironment.dispose();
      pmrem.dispose();
      disposeCachedTextures();
      renderer.dispose();
      renderer.domElement.remove();
      stickBase.remove();
      stickKnob.remove();
    },
  };
}

export type PlazaEngine = ReturnType<typeof createPlazaEngine>;
export const PLAZA_NOTE_COUNT = NOTE_COUNT;
