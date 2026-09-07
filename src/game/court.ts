import * as THREE from 'three'

export const COURT_LENGTH = 40 // eje X (largo real de una pista de balonmano)
export const COURT_WIDTH = 20 // eje Z
export const GOAL_LINE_X = COURT_LENGTH / 2
export const GOAL_HALF_WIDTH = 1.5 // portería de 3m
export const GOAL_HEIGHT = 2

function dashedArc(centerX: number, radius: number, sign: 1 | -1, y: number): THREE.Line {
  const points: THREE.Vector3[] = []
  const segments = 48
  for (let i = 0; i <= segments; i++) {
    const angle = angleAt(-90, 90, i, segments)
    const x = centerX - sign * radius * Math.cos(angle)
    const z = radius * Math.sin(angle)
    points.push(new THREE.Vector3(x, y, z))
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points)
  const material = new THREE.LineDashedMaterial({ color: 0xffffff, dashSize: 0.4, gapSize: 0.3 })
  const line = new THREE.Line(geometry, material)
  line.computeLineDistances()
  return line
}

function angleAt(fromDeg: number, toDeg: number, i: number, segments: number): number {
  const from = THREE.MathUtils.degToRad(fromDeg)
  const to = THREE.MathUtils.degToRad(toDeg)
  return THREE.MathUtils.lerp(from, to, i / segments)
}

export function buildCourt(): THREE.Group {
  const group = new THREE.Group()

  const floorGeo = new THREE.PlaneGeometry(COURT_LENGTH + 6, COURT_WIDTH + 6)
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x2f7d43, roughness: 0.9 })
  const floor = new THREE.Mesh(floorGeo, floorMat)
  floor.rotation.x = -Math.PI / 2
  floor.receiveShadow = true
  group.add(floor)

  const lineY = 0.01
  const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff })

  const outline = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-COURT_LENGTH / 2, lineY, -COURT_WIDTH / 2),
    new THREE.Vector3(COURT_LENGTH / 2, lineY, -COURT_WIDTH / 2),
    new THREE.Vector3(COURT_LENGTH / 2, lineY, COURT_WIDTH / 2),
    new THREE.Vector3(-COURT_LENGTH / 2, lineY, COURT_WIDTH / 2),
    new THREE.Vector3(-COURT_LENGTH / 2, lineY, -COURT_WIDTH / 2),
  ])
  group.add(new THREE.LineLoop(outline, lineMat))

  const centerLine = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, lineY, -COURT_WIDTH / 2),
    new THREE.Vector3(0, lineY, COURT_WIDTH / 2),
  ])
  group.add(new THREE.Line(centerLine, lineMat))

  for (const sign of [1, -1] as const) {
    group.add(dashedArc(sign * GOAL_LINE_X, 6, sign, lineY))
    group.add(dashedArc(sign * GOAL_LINE_X, 9, sign, lineY))
  }

  return group
}

export function buildGoal(x: number, facing: 1 | -1): THREE.Group {
  const group = new THREE.Group()
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4 })
  const postRadius = 0.06

  const leftPost = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HEIGHT, 12), postMat)
  leftPost.position.set(x, GOAL_HEIGHT / 2, -GOAL_HALF_WIDTH)
  leftPost.castShadow = true
  group.add(leftPost)

  const rightPost = leftPost.clone()
  rightPost.position.z = GOAL_HALF_WIDTH
  group.add(rightPost)

  const crossbar = new THREE.Mesh(new THREE.CylinderGeometry(postRadius, postRadius, GOAL_HALF_WIDTH * 2, 12), postMat)
  crossbar.rotation.z = Math.PI / 2
  crossbar.position.set(x, GOAL_HEIGHT, 0)
  crossbar.castShadow = true
  group.add(crossbar)

  const netMat = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
    side: THREE.DoubleSide,
  })
  const backNet = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, GOAL_HEIGHT, 10, 8), netMat)
  backNet.position.set(x + facing * 0.7, GOAL_HEIGHT / 2, 0)
  backNet.rotation.y = Math.PI / 2
  group.add(backNet)

  const topNet = new THREE.Mesh(new THREE.PlaneGeometry(GOAL_HALF_WIDTH * 2, 0.7, 10, 4), netMat)
  topNet.position.set(x + (facing * 0.7) / 2, GOAL_HEIGHT - 0.02, 0)
  topNet.rotation.x = Math.PI / 2
  topNet.rotation.z = Math.PI / 2
  group.add(topNet)

  return group
}
