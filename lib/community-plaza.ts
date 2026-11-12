/**
 * 交流広場（交流掲示板の3D版）の計算。
 *   承認済みの投稿を看板として広場に並べ、一人称視点で歩いて見て回る。
 *   ここは配置・当たり判定・操作の計算だけ（three.js や画面には触れない。テストしやすいように分けている）。
 *
 * 座標は three.js と同じ（y が上、地面は x-z 平面、単位はメートル）。
 * 向き（yaw）は 0 で -z 方向を向き、正の値で左に回る。
 */

export type Vec2 = { x: number; z: number };
export type BoardPlacement = Vec2 & { rotY: number };
export type Obstacle = Vec2 & { r: number };
/** 四角い障害物（机・ロッカーなど）。hw・hd は x・z 方向の半分の大きさ。 */
export type BoxObstacle = Vec2 & { hw: number; hd: number };
/** 歩ける範囲。数値は中心からの半径（広場）、四角は部屋の内側（教室）。 */
export type WalkBounds = number | { minX: number; maxX: number; minZ: number; maxZ: number };

/** 歩ける範囲（広場の中心からの半径）。 */
export const PLAZA_RADIUS = 34;
/** 中央の噴水の半径。 */
export const FOUNTAIN_RADIUS = 2.6;
/** 噴水のまわりの花壇まで含めた、入れない範囲の半径。 */
export const FOUNTAIN_AREA_RADIUS = 3.7;
/** 看板の前で「見る」が出る距離。 */
export const BOARD_REACH = 3.4;
export const PLAYER_RADIUS = 0.35;
export const EYE_HEIGHT = 1.6;
export const WALK_SPEED = 3.6;
export const RUN_SPEED = 6.5;
/** 看板の柱の当たり判定の半径。 */
export const BOARD_OBSTACLE_RADIUS = 0.9;
export const BOARD_LIMIT = 50;

const FIRST_RING = 8;
const RING_GAP = 6;
const BOARD_SPACING = 5;

/** 噴水から外へのびる4本の通り（斜め4方向）。看板は置かず、街灯・ベンチを並べる。 */
export const AVENUE_ANGLES = [Math.PI / 4, (Math.PI * 3) / 4, (Math.PI * 5) / 4, (Math.PI * 7) / 4];
/** 通りの中心から街灯までの距離（m）。看板は通りの中心から AVENUE_CLEARANCE 以上はなす。 */
export const AVENUE_HALF_WIDTH = 2.4;
const AVENUE_CLEARANCE = 3.6;

/** 角度（0 が -z、時計回り）の点の座標。 */
export const pointAt = (angle: number, radius: number): Vec2 => ({ x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius });

const angleGap = (a: number, b: number) => {
  const diff = Math.abs(a - b) % (Math.PI * 2);
  return diff > Math.PI ? Math.PI * 2 - diff : diff;
};

/** その位置が通りの上か（通りの中心線からの横の距離で見る）。 */
export function avenueDistance(angle: number, radius: number) {
  return Math.min(...AVENUE_ANGLES.map(avenue => Math.sin(Math.min(Math.PI / 2, angleGap(angle, avenue))) * radius));
}

/**
 * 看板の置き場所。噴水を囲む輪に、内側から順に並べる（新しい投稿ほど中央の近く）。
 * 看板は中心（噴水）の方を向く。輪ごとに半分ずらして、奥の看板が手前に隠れにくくする。
 */
export function layoutBoards(count: number): BoardPlacement[] {
  const placements: BoardPlacement[] = [];
  let ring = 0;
  while (placements.length < count) {
    const radius = FIRST_RING + ring * RING_GAP;
    if (radius > PLAZA_RADIUS - 3) break;
    const slots = Math.max(6, Math.floor((2 * Math.PI * radius) / BOARD_SPACING));
    const offset = ring % 2 === 0 ? 0 : Math.PI / slots;
    for (let i = 0; i < slots && placements.length < count; i += 1) {
      const angle = offset + (i / slots) * Math.PI * 2;
      if (avenueDistance(angle, radius) < AVENUE_CLEARANCE) continue;
      const { x, z } = pointAt(angle, radius);
      // 看板の表（+z 側）が中心を向くように回す。
      placements.push({ x, z, rotY: Math.atan2(-x, -z) });
    }
    ring += 1;
  }
  return placements;
}

/** 通りの両側の街灯。 */
export function layoutLamps(): Obstacle[] {
  const lamps: Obstacle[] = [];
  for (const angle of AVENUE_ANGLES) {
    for (const radius of [5, 11, 17, 23, 29]) {
      for (const side of [-1, 1]) lamps.push({ ...offsetFromAvenue(angle, radius, side * AVENUE_HALF_WIDTH), r: 0.25 });
    }
  }
  return lamps;
}

/** 通りの両側のベンチ（通りの方を向く）。rotY はベンチの正面の向き。 */
export function layoutBenches(): (Obstacle & { rotY: number })[] {
  const benches: (Obstacle & { rotY: number })[] = [];
  for (const angle of AVENUE_ANGLES) {
    for (const radius of [14, 20, 26]) {
      for (const side of [-1, 1]) {
        const position = offsetFromAvenue(angle, radius, side * (AVENUE_HALF_WIDTH + 0.3));
        // 正面（+z）が通りの中心線を向くように回す。
        const toward = offsetFromAvenue(angle, radius, 0);
        benches.push({ ...position, r: 0.75, rotY: Math.atan2(toward.x - position.x, toward.z - position.z) });
      }
    }
  }
  return benches;
}

/** 通りの突き当たり（広場の外周）の門。柱の位置と、門の向き。 */
export function layoutGates(): { center: Vec2; rotY: number; pillars: Obstacle[] }[] {
  return AVENUE_ANGLES.map(angle => {
    const center = pointAt(angle, PLAZA_RADIUS - 0.6);
    return {
      center,
      rotY: Math.atan2(-center.x, -center.z),
      pillars: [-1, 1].map(side => ({ ...offsetFromAvenue(angle, PLAZA_RADIUS - 0.6, side * (AVENUE_HALF_WIDTH + 0.4)), r: 0.45 })),
    };
  });
}

/** 通りの中心線から横に lateral だけずらした点。 */
function offsetFromAvenue(angle: number, radius: number, lateral: number): Vec2 {
  const center = pointAt(angle, radius);
  // 通りに直交する向き（時計回り側が +）。
  return { x: center.x + Math.cos(angle) * lateral, z: center.z + Math.sin(angle) * lateral };
}

/** 木の位置。看板の輪とぶつからない外周に、決まった並びで置く（毎回同じ景色にする）。 */
export function layoutTrees(): Obstacle[] {
  const trees: Obstacle[] = [];
  const count = 28;
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (i % 2) * 0.07;
    const radius = PLAZA_RADIUS + 2 + (i % 3) * 1.4;
    trees.push({ x: Math.sin(angle) * radius, z: -Math.cos(angle) * radius, r: 0.6 });
  }
  return trees;
}

/**
 * 移動の向き。input は「前へ」「右へ」の量（-1〜1）。yaw の向きを基準に、地面の上の移動量に直す。
 */
export function moveVector(forward: number, right: number, yaw: number): Vec2 {
  const length = Math.hypot(forward, right);
  if (length < 1e-6) return { x: 0, z: 0 };
  const scale = Math.min(1, length) / length;
  const f = forward * scale;
  const r = right * scale;
  const sin = Math.sin(yaw);
  const cos = Math.cos(yaw);
  // 前は (-sin, -cos)、右は (cos, -sin)。
  return { x: -sin * f + cos * r, z: -cos * f - sin * r };
}

/** 障害物と広場の外周から押し戻した位置。 */
export function resolveCollision(position: Vec2, obstacles: (Obstacle | BoxObstacle)[], radius = PLAYER_RADIUS, boundary: WalkBounds = PLAZA_RADIUS): Vec2 {
  let { x, z } = position;
  for (const obstacle of obstacles) {
    if ('hw' in obstacle) {
      // 四角の一番近い点から、半径分だけ押し出す。
      const nearX = Math.max(obstacle.x - obstacle.hw, Math.min(x, obstacle.x + obstacle.hw));
      const nearZ = Math.max(obstacle.z - obstacle.hd, Math.min(z, obstacle.z + obstacle.hd));
      const dx = x - nearX;
      const dz = z - nearZ;
      const distance = Math.hypot(dx, dz);
      if (distance >= radius) continue;
      if (distance > 1e-6) {
        x = nearX + (dx / distance) * radius;
        z = nearZ + (dz / distance) * radius;
        continue;
      }
      // 中に入り込んでいたら、いちばん近い辺から外へ出す。
      const exits = [
        { d: x - (obstacle.x - obstacle.hw), x: obstacle.x - obstacle.hw - radius, z },
        { d: obstacle.x + obstacle.hw - x, x: obstacle.x + obstacle.hw + radius, z },
        { d: z - (obstacle.z - obstacle.hd), x, z: obstacle.z - obstacle.hd - radius },
        { d: obstacle.z + obstacle.hd - z, x, z: obstacle.z + obstacle.hd + radius },
      ].sort((a, b) => a.d - b.d);
      x = exits[0].x;
      z = exits[0].z;
      continue;
    }
    const dx = x - obstacle.x;
    const dz = z - obstacle.z;
    const min = obstacle.r + radius;
    const distance = Math.hypot(dx, dz);
    if (distance >= min) continue;
    if (distance < 1e-6) {
      x = obstacle.x + min;
      continue;
    }
    x = obstacle.x + (dx / distance) * min;
    z = obstacle.z + (dz / distance) * min;
  }
  if (typeof boundary !== 'number') {
    return {
      x: Math.max(boundary.minX + radius, Math.min(boundary.maxX - radius, x)),
      z: Math.max(boundary.minZ + radius, Math.min(boundary.maxZ - radius, z)),
    };
  }
  const fromCenter = Math.hypot(x, z);
  const limit = boundary - radius;
  if (fromCenter > limit) {
    x = (x / fromCenter) * limit;
    z = (z / fromCenter) * limit;
  }
  return { x, z };
}

/** 出入口（門・扉）の近くにいるか。 */
export const isNear = (position: Vec2, point: Vec2, reach: number) => Math.hypot(position.x - point.x, position.z - point.z) <= reach;

/** 教室へつながる門（北西の通りの先）。 */
export const CLASSROOM_GATE_ANGLE = (Math.PI * 7) / 4;
export const CLASSROOM_GATE_REACH = 2.6;
export const classroomGatePoint = () => pointAt(CLASSROOM_GATE_ANGLE, PLAZA_RADIUS - 0.8);
/** 教室から広場に戻ったときに立つ所（門の手前で、広場の中心を向く）。 */
export function plazaReturnSpawn() {
  const point = pointAt(CLASSROOM_GATE_ANGLE, PLAZA_RADIUS - 4.5);
  return { ...point, yaw: Math.atan2(point.x, point.z) };
}

/**
 * いちばん近くて、前を向いている看板。看板の表側に立っていて、その看板の方を向いているときだけ返す。
 */
export function findFacingBoard(position: Vec2, yaw: number, boards: BoardPlacement[], reach = BOARD_REACH): number {
  const lookX = -Math.sin(yaw);
  const lookZ = -Math.cos(yaw);
  let best = -1;
  let bestDistance = Infinity;
  boards.forEach((board, index) => {
    const dx = board.x - position.x;
    const dz = board.z - position.z;
    const distance = Math.hypot(dx, dz);
    if (distance > reach || distance < 1e-6) return;
    // 看板の方を向いているか（視線と看板への向きのずれが約60度以内）。
    if ((dx * lookX + dz * lookZ) / distance < 0.5) return;
    // 看板の表側（表の向きは rotY の +z 方向）にいるか。
    const normalX = Math.sin(board.rotY);
    const normalZ = Math.cos(board.rotY);
    if (-dx * normalX + -dz * normalZ <= 0) return;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** 見上げ・見下ろしの角度の上限（ラジアン）。 */
export const PITCH_LIMIT = (Math.PI / 2) * 0.85;
export const clampPitch = (pitch: number) => Math.max(-PITCH_LIMIT, Math.min(PITCH_LIMIT, pitch));

export type ViewMode = 'third' | 'first';
/** 三人称のとき、カメラが見下ろせる・見上げられる範囲（地面にもぐらないように見上げは浅く）。 */
export const THIRD_PITCH_MIN = -1.1;
export const THIRD_PITCH_MAX = 0.3;
export const clampPitchFor = (mode: ViewMode, pitch: number) =>
  mode === 'third' ? Math.max(THIRD_PITCH_MIN, Math.min(THIRD_PITCH_MAX, pitch)) : clampPitch(pitch);
/** 三人称のカメラとアバターの距離（m）と、カメラが見る高さ。 */
export const THIRD_DISTANCE = 4.2;
export const THIRD_TARGET_HEIGHT = 1.45;

/**
 * 三人称のカメラの位置。アバターの頭のあたり（target）から、視線と逆向きに distance だけ下がった所。
 * 見下ろすとき（pitch が負）はカメラが上がる。地面より下には行かない。
 */
export function thirdPersonCamera(target: { x: number; y: number; z: number }, yaw: number, pitch: number, distance = THIRD_DISTANCE) {
  const cosPitch = Math.cos(pitch);
  const look = { x: -Math.sin(yaw) * cosPitch, y: Math.sin(pitch), z: -Math.cos(yaw) * cosPitch };
  return {
    x: target.x - look.x * distance,
    y: Math.max(0.4, target.y - look.y * distance),
    z: target.z - look.z * distance,
  };
}

/** 角度を少しずつ目標に近づける（最短の回り方で）。 */
export function approachAngle(current: number, target: number, amount: number) {
  let diff = (target - current) % (Math.PI * 2);
  if (diff > Math.PI) diff -= Math.PI * 2;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return current + diff * Math.max(0, Math.min(1, amount));
}

/** 移動の向き（地面の上）から、アバターが向く角度（yaw と同じ決まり：0 で -z）。 */
export const headingOf = (move: Vec2) => Math.atan2(-move.x, -move.z);

/** スティックの量（-1〜1）。中心からのずれを半径で割り、遊び（デッドゾーン）を除く。 */
export function stickVector(dx: number, dy: number, radius: number, deadZone = 0.12): { x: number; y: number } {
  const length = Math.hypot(dx, dy);
  if (radius <= 0 || length < 1e-6) return { x: 0, y: 0 };
  const amount = Math.min(1, length / radius);
  if (amount < deadZone) return { x: 0, y: 0 };
  const scaled = (amount - deadZone) / (1 - deadZone);
  return { x: (dx / length) * scaled, y: (dy / length) * scaled };
}

/**
 * スマホを縦に持っているときは、画面を90度回して横向きに見せる（iPhone の Safari は向きを固定できないため）。
 * そのときの、画面上の指の位置・動きを、回した画面の中の位置・動きに直す。
 *   回し方：中身を時計回りに90度（中身の上が画面の右に来る）。
 */
export function toContentPoint(clientX: number, clientY: number, rotated: boolean, viewportWidth: number) {
  return rotated ? { x: clientY, y: viewportWidth - clientX } : { x: clientX, y: clientY };
}

export function toContentDelta(dx: number, dy: number, rotated: boolean) {
  return rotated ? { x: dy, y: -dx } : { x: dx, y: dy };
}

/** 看板に書く文字を、決まった幅で折り返す（日本語は1文字ずつ測る）。入りきらない分は「…」にする。 */
export function wrapText(text: string, maxWidth: number, maxLines: number, measure: (value: string) => number): string[] {
  const lines: string[] = [];
  let current = '';
  let truncated = false;
  const chars = Array.from(text.replace(/\s+/g, ' ').trim());
  for (let i = 0; i < chars.length; i += 1) {
    const next = current + chars[i];
    if (measure(next) <= maxWidth || !current) {
      current = next;
      continue;
    }
    lines.push(current);
    current = chars[i] === ' ' ? '' : chars[i];
    if (lines.length === maxLines) {
      truncated = true;
      current = '';
      break;
    }
  }
  if (current) lines.push(current);
  const result = lines.slice(0, maxLines);
  if (truncated && result.length) {
    let last = result[result.length - 1];
    while (last && measure(`${last}…`) > maxWidth) last = Array.from(last).slice(0, -1).join('');
    result[result.length - 1] = `${last}…`;
  }
  return result;
}
