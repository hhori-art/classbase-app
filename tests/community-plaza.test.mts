import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AVENUE_HALF_WIDTH, BOARD_LIMIT, FOUNTAIN_AREA_RADIUS, FOUNTAIN_RADIUS, PLAZA_RADIUS, PLAYER_RADIUS, THIRD_PITCH_MAX,
  approachAngle, avenueDistance, clampPitchFor, findFacingBoard, headingOf, layoutBenches, layoutBoards, layoutGates, layoutLamps,
  layoutTrees, moveVector, resolveCollision, stickVector, thirdPersonCamera, toContentDelta, toContentPoint, wrapText,
  CLASSROOM_GATE_REACH, classroomGatePoint, isNear, plazaReturnSpawn,
} from '../lib/community-plaza.ts';
import {
  CLASSROOM, CLASSROOM_BOUNDS, CLASSROOM_DOOR, CLASSROOM_DOOR_REACH, CLASSROOM_SPAWN, DESK_COLUMNS, classroomObstacles, notePlacements,
} from '../lib/community-classroom.ts';

const near = (a: number, b: number, eps = 1e-9) => Math.abs(a - b) < eps;

test('看板は上限の50件まで広場の中に並び、重ならず、中心を向く', () => {
  const boards = layoutBoards(BOARD_LIMIT);
  assert.equal(boards.length, BOARD_LIMIT);
  for (const board of boards) {
    const radius = Math.hypot(board.x, board.z);
    assert.ok(radius > FOUNTAIN_RADIUS + 3 && radius < PLAZA_RADIUS - 2, `radius ${radius}`);
    // 表（rotY の +z 方向）が中心を向いている。
    assert.ok(near(Math.sin(board.rotY), -board.x / radius, 1e-6));
    assert.ok(near(Math.cos(board.rotY), -board.z / radius, 1e-6));
  }
  for (let i = 0; i < boards.length; i += 1) {
    for (let j = i + 1; j < boards.length; j += 1) {
      assert.ok(Math.hypot(boards[i].x - boards[j].x, boards[i].z - boards[j].z) > 3, `${i}-${j}`);
    }
  }
  assert.equal(layoutBoards(0).length, 0);
});

test('木は看板の輪より外にある', () => {
  for (const tree of layoutTrees()) assert.ok(Math.hypot(tree.x, tree.z) > PLAZA_RADIUS);
  assert.ok(FOUNTAIN_AREA_RADIUS > FOUNTAIN_RADIUS);
});

test('移動の向き：yaw 0 で前は -z、右は +x。斜めでも速くならない', () => {
  const forward = moveVector(1, 0, 0);
  assert.ok(near(forward.x, 0) && near(forward.z, -1));
  const right = moveVector(0, 1, 0);
  assert.ok(near(right.x, 1) && near(right.z, 0));
  // 左に90度回ると、前は -x。
  const turned = moveVector(1, 0, Math.PI / 2);
  assert.ok(near(turned.x, -1) && near(turned.z, 0));
  const diagonal = moveVector(1, 1, 0);
  assert.ok(near(Math.hypot(diagonal.x, diagonal.z), 1));
});

test('障害物と外周から押し戻す', () => {
  const pushed = resolveCollision({ x: 0.5, z: 0 }, [{ x: 0, z: 0, r: FOUNTAIN_RADIUS }]);
  assert.ok(near(Math.hypot(pushed.x, pushed.z), FOUNTAIN_RADIUS + PLAYER_RADIUS));
  const outside = resolveCollision({ x: 100, z: 0 }, []);
  assert.ok(near(outside.x, PLAZA_RADIUS - PLAYER_RADIUS) && near(outside.z, 0));
  const free = resolveCollision({ x: 10, z: 10 }, [{ x: 0, z: 0, r: 1 }]);
  assert.deepEqual(free, { x: 10, z: 10 });
});

test('看板の表側で、看板の方を向いているときだけ「見る」が出る', () => {
  const boards = layoutBoards(1); // 中心の真北（z が負）に置かれ、+z（中心側）を向く。
  const board = boards[0];
  // 看板の2m手前（中心側）から、看板の方（-z）を向く。
  assert.equal(findFacingBoard({ x: board.x, z: board.z + 2 }, 0, boards), 0);
  // 後ろを向いていると出ない。
  assert.equal(findFacingBoard({ x: board.x, z: board.z + 2 }, Math.PI, boards), -1);
  // 遠いと出ない。
  assert.equal(findFacingBoard({ x: board.x, z: board.z + 6 }, 0, boards), -1);
  // 看板の裏側からは出ない。
  assert.equal(findFacingBoard({ x: board.x, z: board.z - 2 }, Math.PI, boards), -1);
});

test('スティック：遊びの中は0、端で長さ1', () => {
  assert.deepEqual(stickVector(2, 0, 60), { x: 0, y: 0 });
  const full = stickVector(0, -200, 60);
  assert.ok(near(full.x, 0) && near(full.y, -1));
});

test('縦持ちで90度回しているときの指の位置と動き', () => {
  // 画面幅 390 の縦持ち。画面の右上（x=390, y=0）は、回した中身の左上（0, 0）。
  assert.deepEqual(toContentPoint(390, 0, true, 390), { x: 0, y: 0 });
  // 指を画面の下へ動かすと、中身では右へ動く。
  assert.deepEqual(toContentDelta(0, 10, true), { x: 10, y: -0 });
  assert.deepEqual(toContentDelta(10, 0, true), { x: 0, y: -10 });
  assert.deepEqual(toContentPoint(5, 6, false, 390), { x: 5, y: 6 });
});

test('看板の文字の折り返しと省略', () => {
  const measure = (value: string) => Array.from(value).length;
  assert.deepEqual(wrapText('あいうえおかきくけこ', 4, 3, measure), ['あいうえ', 'おかきく', 'けこ']);
  assert.deepEqual(wrapText('あいうえおかきくけこさしすせそ', 4, 2, measure), ['あいうえ', 'おかき…']);
  assert.deepEqual(wrapText('', 4, 2, measure), []);
});

test('看板は通りの上に置かない。街灯・ベンチ・門の柱は看板と重ならない', () => {
  const boards = layoutBoards(BOARD_LIMIT);
  for (const board of boards) {
    const angle = Math.atan2(board.x, -board.z);
    assert.ok(avenueDistance(angle, Math.hypot(board.x, board.z)) >= 3.5, `board ${board.x},${board.z}`);
  }
  const props = [...layoutLamps(), ...layoutBenches(), ...layoutGates().flatMap(gate => gate.pillars)];
  for (const prop of props) {
    const fromCenter = Math.hypot(prop.x, prop.z);
    assert.ok(fromCenter > FOUNTAIN_AREA_RADIUS + 1 && fromCenter < PLAZA_RADIUS + 0.5, `prop radius ${fromCenter}`);
    for (const board of boards) assert.ok(Math.hypot(prop.x - board.x, prop.z - board.z) > 1.5, `prop ${prop.x},${prop.z}`);
  }
  // 通りの中央は歩ける（街灯の間が通れる）。
  for (const lamp of layoutLamps()) {
    const angle = Math.atan2(lamp.x, -lamp.z);
    assert.ok(near(avenueDistance(angle, Math.hypot(lamp.x, lamp.z)), AVENUE_HALF_WIDTH, 0.3));
  }
});

test('ベンチは通りの方を向く', () => {
  for (const bench of layoutBenches()) {
    const angle = Math.atan2(bench.x, -bench.z);
    const ahead = { x: bench.x + Math.sin(bench.rotY) * 0.5, z: bench.z + Math.cos(bench.rotY) * 0.5 };
    const aheadAngle = Math.atan2(ahead.x, -ahead.z);
    assert.ok(avenueDistance(aheadAngle, Math.hypot(ahead.x, ahead.z)) < avenueDistance(angle, Math.hypot(bench.x, bench.z)));
  }
});

test('三人称のカメラはアバターの後ろ上にあり、地面にもぐらない', () => {
  const target = { x: 0, y: 1.45, z: 0 };
  // 前（-z）を見ているとき、カメラは後ろ（+z）。
  const level = thirdPersonCamera(target, 0, 0, 4);
  assert.ok(near(level.x, 0) && near(level.z, 4) && near(level.y, 1.45));
  // 見下ろすとカメラは上がる。
  assert.ok(thirdPersonCamera(target, 0, -0.8, 4).y > 3);
  // 見上げても地面より下には行かない。
  assert.ok(thirdPersonCamera(target, 0, 1.2, 4).y >= 0.4);
  assert.equal(clampPitchFor('third', 1), THIRD_PITCH_MAX);
  assert.equal(clampPitchFor('first', 1), 1);
});

test('アバターの向き：進む方を向き、最短の回り方で近づく', () => {
  assert.ok(near(headingOf({ x: 0, z: -1 }), 0));
  assert.ok(near(headingOf({ x: -1, z: 0 }), Math.PI / 2));
  // 170度 → -170度 は、遠回り（340度）ではなく20度だけ回る。
  const from = (170 / 180) * Math.PI;
  const to = (-170 / 180) * Math.PI;
  const half = approachAngle(from, to, 0.5);
  assert.ok(near(Math.cos(half), Math.cos(Math.PI), 1e-9));
});

test('四角い障害物と部屋の壁から押し戻す', () => {
  const box = { x: 0, z: 0, hw: 1, hd: 0.5 };
  // 右の辺に近づきすぎたら、半径分はなす。
  const side = resolveCollision({ x: 1.1, z: 0 }, [box], 0.35, 100);
  assert.ok(near(side.x, 1.35) && near(side.z, 0));
  // 中に入り込んだら、近い辺（上の辺）から出す。
  const inside = resolveCollision({ x: 0.2, z: 0.45 }, [box], 0.35, 100);
  assert.ok(near(inside.z, 0.85));
  const room = resolveCollision({ x: 9, z: -9 }, [], 0.35, CLASSROOM_BOUNDS);
  assert.ok(near(room.x, CLASSROOM.maxX - 0.35) && near(room.z, CLASSROOM.minZ + 0.35));
});

test('教室：机の間の通路は通れ、入口・貼り紙の前に立てる', () => {
  const obstacles = classroomObstacles();
  // 列の間の通路の真ん中は、押し戻されない。
  for (const z of [-1.5, 0, 1.2, 2.3]) {
    const aisle = { x: (DESK_COLUMNS[1] + DESK_COLUMNS[2]) / 2, z };
    assert.deepEqual(resolveCollision(aisle, obstacles, PLAYER_RADIUS, CLASSROOM_BOUNDS), aisle, `aisle z=${z}`);
  }
  // 入ったときの位置は、机にも壁にもめり込まない。
  const spawn = { x: CLASSROOM_SPAWN.x, z: CLASSROOM_SPAWN.z };
  assert.deepEqual(resolveCollision(spawn, obstacles, PLAYER_RADIUS, CLASSROOM_BOUNDS), spawn);
  // 入ってすぐ「広場にもどる」が出ないよう、扉からははなれている。
  assert.ok(!isNear(spawn, CLASSROOM_DOOR, CLASSROOM_DOOR_REACH));
  // 三人称のカメラ（後ろ2.6m）が部屋の中に収まる。
  assert.ok(spawn.z + 2.6 * Math.cos(CLASSROOM_SPAWN.yaw) < CLASSROOM.maxZ);
  // 後ろの通路から、後ろを向くと貼り紙を開ける。
  const notes = notePlacements();
  assert.equal(notes.length, 8);
  const standing = resolveCollision({ x: notes[2].x, z: 3.5 }, obstacles, PLAYER_RADIUS, CLASSROOM_BOUNDS);
  assert.equal(findFacingBoard(standing, Math.PI, notes), 2);
  assert.equal(findFacingBoard(standing, 0, notes), -1);
});

test('広場の教室への門：外周から届き、戻ったときは門の近くで中心を向く', () => {
  const gate = classroomGatePoint();
  const edge = resolveCollision({ x: gate.x * 2, z: gate.z * 2 }, [], PLAYER_RADIUS, PLAZA_RADIUS);
  assert.ok(isNear(edge, gate, CLASSROOM_GATE_REACH));
  const spawn = plazaReturnSpawn();
  assert.ok(!isNear(spawn, gate, CLASSROOM_GATE_REACH), '戻ってすぐまた門に入らない');
  const forward = moveVector(1, 0, spawn.yaw);
  assert.ok(forward.x * -spawn.x + forward.z * -spawn.z > 0.99 * Math.hypot(spawn.x, spawn.z));
  // 門のまわりの通りの上で、看板・街灯にぶつからない。
  const props = [...layoutLamps(), ...layoutBenches()];
  assert.ok(props.every(prop => Math.hypot(prop.x - spawn.x, prop.z - spawn.z) > 1));
});
