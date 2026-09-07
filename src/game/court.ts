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

function edgeBar(a: THREE.Vector3, b: THREE.Vector3, radius: number, material: THREE.Material): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a)
  const length = dir.length()
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 10), material)
  bar.position.copy(a).addScaledVector(dir, 0.5)
  bar.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize())
  bar.castShadow = true
  return bar
}

let netTexture: THREE.Texture | null = null
function getNetTexture(): THREE.Texture {
  if (netTexture) return netTexture
  const size = 64
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  ctx.strokeStyle = 'rgba(255,255,255,0.85)'
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(size, size)
  ctx.moveTo(size, 0)
  ctx.lineTo(0, size)
  ctx.stroke()
  netTexture = new THREE.CanvasTexture(canvas)
  netTexture.wrapS = THREE.RepeatWrapping
  netTexture.wrapT = THREE.RepeatWrapping
  return netTexture
}

function netPanel(width: number, height: number): THREE.Mesh {
  const texture = getNetTexture().clone()
  texture.needsUpdate = true
  texture.repeat.set(width / 0.22, height / 0.22)
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
  })
  return new THREE.Mesh(new THREE.PlaneGeometry(width, height), material)
}

export function buildGoal(x: number, facing: 1 | -1): THREE.Group {
  const group = new THREE.Group()
  const postMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.1 })
  const postRadius = 0.055
  const depth = 1 // profundidad real de una portería de balonmano (~1m)
  const w = GOAL_HALF_WIDTH
  const H = GOAL_HEIGHT
  const backX = x + facing * depth

  const frontTopLeft = new THREE.Vector3(x, H, -w)
  const frontTopRight = new THREE.Vector3(x, H, w)
  const frontBotLeft = new THREE.Vector3(x, 0, -w)
  const frontBotRight = new THREE.Vector3(x, 0, w)
  const backTopLeft = new THREE.Vector3(backX, H, -w)
  const backTopRight = new THREE.Vector3(backX, H, w)
  const backBotLeft = new THREE.Vector3(backX, 0, -w)
  const backBotRight = new THREE.Vector3(backX, 0, w)

  const edges: [THREE.Vector3, THREE.Vector3][] = [
    [frontBotLeft, frontTopLeft], // poste frontal izq.
    [frontBotRight, frontTopRight], // poste frontal der.
    [frontTopLeft, frontTopRight], // larguero
    [backBotLeft, backTopLeft], // poste trasero izq.
    [backBotRight, backTopRight], // poste trasero der.
    [backTopLeft, backTopRight], // barra trasera superior
    [frontTopLeft, backTopLeft], // lateral superior izq.
    [frontTopRight, backTopRight], // lateral superior der.
    [frontBotLeft, backBotLeft], // lateral inferior izq. (a ras de suelo)
    [frontBotRight, backBotRight], // lateral inferior der. (a ras de suelo)
  ]
  for (const [a, b] of edges) group.add(edgeBar(a, b, postRadius, postMat))

  const back = netPanel(w * 2, H)
  back.position.set(backX, H / 2, 0)
  back.rotation.y = Math.PI / 2
  group.add(back)

  const top = netPanel(depth, w * 2)
  top.position.set(x + (facing * depth) / 2, H - 0.01, 0)
  top.rotation.x = -Math.PI / 2
  group.add(top)

  const left = netPanel(depth, H)
  left.position.set(x + (facing * depth) / 2, H / 2, -w)
  group.add(left)

  const right = left.clone()
  right.material = (left.material as THREE.MeshBasicMaterial).clone()
  right.position.z = w
  group.add(right)

  return group
}
