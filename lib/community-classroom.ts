import type { BoardPlacement, BoxObstacle, Vec2 } from './community-plaza';

/**
 * 交流広場の「教室」ステージの配置（three.js や画面には触れない。テストしやすいように分けている）。
 * 広さはふつうの教室（約9m×8m、天井3m）。前（-z）に黒板と教卓、左（-x）に窓、右（+x）に廊下側の扉、
 * 後ろ（+z）にロッカーと掲示板。掲示板には投稿が貼り紙として並ぶ（新しい順に NOTE_COUNT 件）。
 */

export const CLASSROOM = { minX: -4.5, maxX: 4.5, minZ: -4, maxZ: 4, height: 3 } as const;
export const CLASSROOM_BOUNDS = { minX: CLASSROOM.minX, maxX: CLASSROOM.maxX, minZ: CLASSROOM.minZ, maxZ: CLASSROOM.maxZ };

export const DESK_COLUMNS = [-3.2, -1.6, 0, 1.6, 3.2];
export const DESK_ROWS = [-1.5, -0.3, 0.9, 2.1];
export const DESK = { width: 0.65, depth: 0.45, height: 0.7 } as const;
/** 椅子は机の後ろ（+z）。 */
export const CHAIR_OFFSET = 0.5;
export const TEACHER_DESK = { x: 0, z: -2.7, hw: 0.6, hd: 0.3 } as const;
export const LOCKER = { depth: 0.45, height: 0.9 } as const;

export const NOTE_COUNT = 8;
export const NOTE_SIZE = { width: 0.85, height: 0.62 } as const;
export const NOTE_CENTER_Y = 1.75;

/** 後ろの扉（広場へ戻る出口）。 */
export const CLASSROOM_DOOR = { x: CLASSROOM.maxX - 0.2, z: 2.9 } as const;
export const CLASSROOM_DOOR_REACH = 1.5;
/** 教室に入ったときに立つ所（窓と反対側の通路の真ん中で、黒板の方を向く）。三人称のカメラが壁に当たらない広さがある。 */
export const CLASSROOM_SPAWN = { x: 4.0, z: 0.4, yaw: 0.25 } as const;

export const deskPositions = (): Vec2[] => DESK_ROWS.flatMap(z => DESK_COLUMNS.map(x => ({ x, z })));

/** 机と椅子・教卓・ロッカーの当たり判定。 */
export function classroomObstacles(): BoxObstacle[] {
  return [
    // 机と椅子をひとまとめにした四角（机の前の端から椅子の後ろの端まで）。
    ...deskPositions().map(({ x, z }) => ({ x, z: z + 0.2, hw: 0.34, hd: 0.5 })),
    { ...TEACHER_DESK },
    { x: 0, z: CLASSROOM.maxZ - LOCKER.depth / 2, hw: (CLASSROOM.maxX - CLASSROOM.minX) / 2, hd: LOCKER.depth / 2 },
  ];
}

/** 後ろの掲示板の貼り紙の位置。前（-z、部屋の中）を向く。 */
export function notePlacements(count = NOTE_COUNT): BoardPlacement[] {
  const total = Math.min(count, NOTE_COUNT);
  const gap = 1.05;
  return Array.from({ length: total }, (_, index) => ({
    x: (index - (NOTE_COUNT - 1) / 2) * gap,
    z: CLASSROOM.maxZ - 0.03,
    rotY: Math.PI,
  }));
}
