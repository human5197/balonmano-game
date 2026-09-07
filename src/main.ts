import * as THREE from 'three'
import { buildCourt, buildGoal, GOAL_LINE_X, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './game/court'
import { loadCharacter } from './game/loadCharacter'

const app = document.getElementById('app')!
const scoreEl = document.getElementById('score')!
const messageEl = document.getElementById('message')!

const PLAYER_SPEED = 6.5
const TEAMMATE_SPEED = 5
const BALL_RADIUS = 0.1
const GRAVITY = -9.8
const KEEPER_SPEED = 4.5
const SHOOT_ARC = 3.2
const PASS_SPEED = 11
const PASS_HEIGHT = 0.95
const CATCH_RADIUS = 1.1
const FIELD_X_LIMIT = 19
const FIELD_Z_LIMIT = 9.5

const DEFENDER_SPEED = 4.2
const DEFENDER_MARK_DISTANCE = 1.4 // se colocan entre su atacante y la portería
const DEFENDER_MIN_FROM_GOAL = 6.5 // no invaden el área de 6m
const DEFENDER_MAX_FROM_GOAL = 18
const DEFENDER_INTERCEPT_RADIUS = 0.85

// --- Escena base ---
const scene = new THREE.Scene()
scene.background = new THREE.Color(0x87ceeb)
scene.fog = new THREE.Fog(0x87ceeb, 30, 70)

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 200)

const renderer = new THREE.WebGLRenderer({ antialias: true })
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
renderer.shadowMap.enabled = true
app.prepend(renderer.domElement)

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
})

// --- Luces ---
scene.add(new THREE.HemisphereLight(0xffffff, 0x2f7d43, 0.9))
const sun = new THREE.DirectionalLight(0xffffff, 1.4)
sun.position.set(15, 25, 10)
sun.castShadow = true
sun.shadow.camera.left = -25
sun.shadow.camera.right = 25
sun.shadow.camera.top = 25
sun.shadow.camera.bottom = -25
sun.shadow.mapSize.set(2048, 2048)
scene.add(sun)

// --- Campo y porterías ---
scene.add(buildCourt())
scene.add(buildGoal(GOAL_LINE_X, -1))
scene.add(buildGoal(-GOAL_LINE_X, 1))

// --- Balón ---
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_RADIUS, 20, 20),
  new THREE.MeshStandardMaterial({ color: 0xdb6a1f, roughness: 0.6 }),
)
ball.castShadow = true
scene.add(ball)

let ballVelocity = new THREE.Vector3()
let possession = 0 // índice del compañero que tiene el balón, -1 si está suelto
let lastHolder = -1
let possessionCooldown = 0
let passTargetIdx: number | null = null // si hay pase en curso, va "homing" hacia este compañero

// --- Equipo ---
interface Teammate {
  group: THREE.Group
  ring: THREE.Mesh
  marker: THREE.Mesh
  facing: THREE.Vector3
  target: THREE.Vector3 | null
}

function createRing(color: number): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.35, 0.5, 24),
    new THREE.MeshBasicMaterial({ color, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }),
  )
  ring.rotation.x = -Math.PI / 2
  ring.position.y = 0.03
  ring.visible = false
  return ring
}

function createMarker(): THREE.Mesh {
  const marker = new THREE.Mesh(
    new THREE.RingGeometry(0.18, 0.28, 20),
    new THREE.MeshBasicMaterial({ color: 0xffdd33, side: THREE.DoubleSide }),
  )
  marker.rotation.x = -Math.PI / 2
  marker.position.y = 0.02
  marker.visible = false
  scene.add(marker)
  return marker
}

const startPositions = [
  new THREE.Vector3(-10, 0, 0),
  new THREE.Vector3(-14, 0, -6),
  new THREE.Vector3(-14, 0, 6),
]
const tints = [0x2b6cff, 0x22c1ff, 0x22ffb0]

const passIconsEl = document.getElementById('pass-icons')!
const passIcons: HTMLDivElement[] = []
const teammates: Teammate[] = []
for (let i = 0; i < 3; i++) {
  const group = await loadCharacter('/models/player.glb', tints[i])
  group.position.copy(startPositions[i])
  const ring = createRing(0x22ff88)
  group.add(ring)
  scene.add(group)
  teammates.push({ group, ring, marker: createMarker(), facing: new THREE.Vector3(1, 0, 0), target: null })

  const icon = document.createElement('div')
  icon.className = 'pass-icon'
  icon.textContent = String(i + 1)
  icon.addEventListener('click', () => choosePlayer(i))
  passIconsEl.appendChild(icon)
  passIcons.push(icon)
}

let activeIndex = 0
let tacticalSelected: number | null = null

function setActive(idx: number) {
  if (idx === activeIndex) return
  activeIndex = idx
  teammates[activeIndex].target = null
  if (tacticalSelected === idx) tacticalSelected = null
  messageEl.textContent = `Controlas al jugador ${idx + 1}`
}

// Si tienes el balón, elegir a un compañero se lo pasa (como en FIFA: botón/click
// sobre el receptor). Si no lo tienes, simplemente cambia el control a él.
function choosePlayer(idx: number) {
  if (idx === activeIndex || idx < 0 || idx >= teammates.length) return
  if (possession === activeIndex) passTo(idx)
  else setActive(idx)
}

const keeper = await loadCharacter('/models/keeper.glb', 0xff3b3b)
keeper.position.set(GOAL_LINE_X - 0.8, 0, 0)
keeper.rotation.y = -Math.PI / 2
scene.add(keeper)

// --- Defensores rivales: marcaje individual, uno por cada atacante ---
interface Defender {
  group: THREE.Group
  marks: number // índice del compañero al que marca
}

const defenderStarts = [
  new THREE.Vector3(12, 0, 0),
  new THREE.Vector3(14, 0, -6),
  new THREE.Vector3(14, 0, 6),
]

const defenders: Defender[] = []
for (let i = 0; i < 3; i++) {
  const group = await loadCharacter('/models/keeper.glb', 0x7a1414)
  group.position.copy(defenderStarts[i])
  group.rotation.y = -Math.PI / 2
  scene.add(group)
  defenders.push({ group, marks: i })
}

let score = 0

// --- Entrada de teclado ---
const keys = new Set<string>()
window.addEventListener('keydown', (e) => {
  keys.add(e.key.toLowerCase())
  if (e.key === ' ') {
    e.preventDefault()
    shoot()
  }
  if (e.key.toLowerCase() === 'e') pass()
  if (e.key === 'Tab') {
    e.preventDefault()
    setActive((activeIndex + 1) % teammates.length)
  }
  if (['1', '2', '3'].includes(e.key)) choosePlayer(Number(e.key) - 1)
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

// --- Selección y órdenes con el ratón ---
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)
const hitboxes = teammates.map((t, idx) => {
  const box = new THREE.Mesh(
    new THREE.CylinderGeometry(1.3, 1.3, 2.4, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
  )
  box.position.y = 1.1
  box.userData.idx = idx
  t.group.add(box)
  return box
})

function pointerNdc(event: MouseEvent): THREE.Vector2 {
  const rect = renderer.domElement.getBoundingClientRect()
  return new THREE.Vector2(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  )
}

// Click izquierdo: si tienes el balón, elige a quién pasar; si no, cambia
// el control directamente al jugador clicado (forma rápida de cambiar de jugador).
renderer.domElement.addEventListener('click', (event) => {
  raycaster.setFromCamera(pointerNdc(event), camera)

  const hit = raycaster.intersectObjects(hitboxes, false)[0]
  if (hit) {
    choosePlayer(hit.object.userData.idx as number)
    return
  }

  if (possession !== activeIndex) return
  const point = new THREE.Vector3()
  if (raycaster.ray.intersectPlane(groundPlane, point)) {
    shootAt(point)
  }
})

// Click derecho: selecciona a un compañero y le asigna una posición en el campo.
renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  raycaster.setFromCamera(pointerNdc(event), camera)

  const hit = raycaster.intersectObjects(hitboxes, false)[0]
  if (hit) {
    const idx = hit.object.userData.idx as number
    if (idx !== activeIndex) {
      tacticalSelected = idx
      messageEl.textContent = `Jugador ${idx + 1} seleccionado. Click derecho en el campo para moverlo.`
    }
    return
  }

  if (tacticalSelected !== null) {
    const point = new THREE.Vector3()
    if (raycaster.ray.intersectPlane(groundPlane, point)) {
      point.x = THREE.MathUtils.clamp(point.x, -FIELD_X_LIMIT, FIELD_X_LIMIT)
      point.z = THREE.MathUtils.clamp(point.z, -FIELD_Z_LIMIT, FIELD_Z_LIMIT)
      teammates[tacticalSelected].target = point.clone()
      const marker = teammates[tacticalSelected].marker
      marker.position.set(point.x, 0.02, point.z)
      marker.visible = true
    }
  }
})

function releaseBall() {
  lastHolder = possession
  possession = -1
  possessionCooldown = 0.35
}

function shootAt(groundPoint: THREE.Vector3) {
  if (possession !== activeIndex) return
  const target = new THREE.Vector3(
    THREE.MathUtils.clamp(groundPoint.x, -FIELD_X_LIMIT, FIELD_X_LIMIT),
    0.9,
    THREE.MathUtils.clamp(groundPoint.z, -FIELD_Z_LIMIT, FIELD_Z_LIMIT),
  )
  const from = ball.position.clone()
  const flat = new THREE.Vector2(target.x - from.x, target.z - from.z)
  const dist = Math.max(flat.length(), 0.01)
  const dir = new THREE.Vector3(flat.x / dist, 0, flat.y / dist)
  const speed = THREE.MathUtils.clamp(dist * 1.6, 8, 18)
  ballVelocity = dir.multiplyScalar(speed)
  ballVelocity.y = SHOOT_ARC
  releaseBall()
  messageEl.textContent = '¡Lanzamiento!'
}

function shoot() {
  shootAt(new THREE.Vector3(GOAL_LINE_X, 0, (Math.random() - 0.5) * GOAL_HALF_WIDTH * 1.6))
}

function passTo(bestIdx: number) {
  if (possession !== activeIndex || bestIdx === activeIndex) return
  passTargetIdx = bestIdx
  releaseBall()
  messageEl.textContent = `Pase al jugador ${bestIdx + 1}`
}

function pass() {
  if (possession !== activeIndex) return
  let bestIdx = -1
  let bestDist = Infinity
  teammates.forEach((t, idx) => {
    if (idx === activeIndex) return
    const d = t.group.position.distanceTo(ball.position)
    if (d < bestDist) {
      bestDist = d
      bestIdx = idx
    }
  })
  if (bestIdx !== -1) passTo(bestIdx)
}

function resetBall() {
  teammates.forEach((t, idx) => {
    t.group.position.copy(startPositions[idx])
    t.target = null
    t.marker.visible = false
  })
  defenders.forEach((d, idx) => d.group.position.copy(defenderStarts[idx]))
  setActive(0)
  ballVelocity.set(0, 0, 0)
  passTargetIdx = null
  possession = 0
}

function updateActivePlayer(dt: number) {
  const active = teammates[activeIndex]
  const move = new THREE.Vector3()
  if (keys.has('w') || keys.has('arrowup')) move.x += 1
  if (keys.has('s') || keys.has('arrowdown')) move.x -= 1
  if (keys.has('a') || keys.has('arrowleft')) move.z -= 1
  if (keys.has('d') || keys.has('arrowright')) move.z += 1

  if (move.lengthSq() > 0) {
    move.normalize()
    active.group.position.addScaledVector(move, PLAYER_SPEED * dt)
    active.group.position.x = THREE.MathUtils.clamp(active.group.position.x, -FIELD_X_LIMIT, FIELD_X_LIMIT)
    active.group.position.z = THREE.MathUtils.clamp(active.group.position.z, -FIELD_Z_LIMIT, FIELD_Z_LIMIT)
    active.facing = move.clone()
    active.group.rotation.y = Math.atan2(active.facing.x, active.facing.z) + Math.PI / 2
  }
}

function updateTeammateAI(t: Teammate, dt: number) {
  if (!t.target) return
  const pos = t.group.position
  const dx = t.target.x - pos.x
  const dz = t.target.z - pos.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.15) {
    t.marker.visible = false
    return
  }
  const dir = new THREE.Vector3(dx / dist, 0, dz / dist)
  pos.addScaledVector(dir, Math.min(TEAMMATE_SPEED * dt, dist))
  t.facing = dir
  t.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2
}

function updateBallHeld() {
  const holder = teammates[possession]
  const holdOffset = holder.facing.clone().multiplyScalar(0.55)
  ball.position.set(holder.group.position.x + holdOffset.x, 0.95, holder.group.position.z + holdOffset.z)
}

function updateBallPass(dt: number) {
  const idx = passTargetIdx!
  const targetPos = teammates[idx].group.position
  const dx = targetPos.x - ball.position.x
  const dz = targetPos.z - ball.position.z
  const dist = Math.hypot(dx, dz)
  ball.position.y = THREE.MathUtils.lerp(ball.position.y, PASS_HEIGHT, Math.min(1, dt * 10))

  const dKeeper = ball.position.distanceTo(keeper.position.clone().setY(ball.position.y))
  if (dKeeper < 0.8) {
    passTargetIdx = null
    ballVelocity.set((Math.random() - 0.5) * 4, 3, (Math.random() - 0.5) * 6)
    messageEl.textContent = '¡Pase interceptado por el portero!'
    return
  }

  for (const defender of defenders) {
    if (defender.group.position.distanceTo(ball.position) < DEFENDER_INTERCEPT_RADIUS) {
      passTargetIdx = null
      ballVelocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 6)
      messageEl.textContent = '¡Pase interceptado por el defensor!'
      return
    }
  }

  if (dist < CATCH_RADIUS) {
    possession = idx
    passTargetIdx = null
    ballVelocity.set(0, 0, 0)
    if (idx !== activeIndex) setActive(idx)
    return
  }

  const step = Math.min(PASS_SPEED * dt, dist)
  ball.position.x += (dx / dist) * step
  ball.position.z += (dz / dist) * step
}

function updateBallFree(dt: number) {
  possessionCooldown = Math.max(0, possessionCooldown - dt)

  if (passTargetIdx !== null) {
    updateBallPass(dt)
    return
  }

  ballVelocity.y += GRAVITY * dt
  ball.position.addScaledVector(ballVelocity, dt)

  if (ball.position.y - BALL_RADIUS <= 0) {
    ball.position.y = BALL_RADIUS
    ballVelocity.y *= -0.35
    ballVelocity.x *= 0.7
    ballVelocity.z *= 0.7
    if (Math.abs(ballVelocity.y) < 0.5) ballVelocity.y = 0
  }

  const inGoalMouth =
    ball.position.x > GOAL_LINE_X - 0.2 &&
    Math.abs(ball.position.z) < GOAL_HALF_WIDTH &&
    ball.position.y < GOAL_HEIGHT
  if (inGoalMouth) {
    score += 1
    scoreEl.textContent = `Goles: ${score}`
    messageEl.textContent = '¡GOL! 🤾'
    resetBall()
    return
  }

  const dKeeper = ball.position.distanceTo(keeper.position.clone().setY(ball.position.y))
  if (dKeeper < 0.9 && ball.position.x > GOAL_LINE_X - 4) {
    ballVelocity.x *= -0.5
    ballVelocity.z += (Math.random() - 0.5) * 4
    messageEl.textContent = '¡Parada del portero!'
  }

  for (const defender of defenders) {
    const dDef = defender.group.position.distanceTo(ball.position)
    if (dDef < DEFENDER_INTERCEPT_RADIUS && ball.position.y < 1.4) {
      ballVelocity.x *= -0.5
      ballVelocity.z += (Math.random() - 0.5) * 5
      ballVelocity.y = Math.max(ballVelocity.y, 1.5)
      messageEl.textContent = '¡Balón interceptado por el defensor!'
      break
    }
  }

  for (let idx = 0; idx < teammates.length; idx++) {
    if (idx === lastHolder && possessionCooldown > 0) continue
    const d = teammates[idx].group.position.distanceTo(ball.position)
    if (d < CATCH_RADIUS && ball.position.y < 1.3) {
      possession = idx
      ballVelocity.set(0, 0, 0)
      if (idx !== activeIndex) setActive(idx)
      return
    }
  }

  const outOfBounds = ball.position.x < -20.5 || ball.position.x > 20.5 || Math.abs(ball.position.z) > 10.5
  if (outOfBounds) {
    messageEl.textContent = 'Balón fuera.'
    ballVelocity.set(0, 0, 0)
  }
}

function updateKeeper(dt: number) {
  const targetZ = THREE.MathUtils.clamp(ball.position.z, -GOAL_HALF_WIDTH + 0.2, GOAL_HALF_WIDTH - 0.2)
  const dz = targetZ - keeper.position.z
  keeper.position.z += THREE.MathUtils.clamp(dz, -KEEPER_SPEED * dt, KEEPER_SPEED * dt)
}

const goalCenter = new THREE.Vector2(GOAL_LINE_X, 0)

function updateDefenders(dt: number) {
  for (const defender of defenders) {
    const attacker = teammates[defender.marks].group.position

    // Se colocan entre su atacante marcado y la portería (marcaje "goal-side").
    const toGoal = new THREE.Vector2(goalCenter.x - attacker.x, goalCenter.y - attacker.z)
    toGoal.normalize()

    let markX = attacker.x + toGoal.x * DEFENDER_MARK_DISTANCE
    let markZ = attacker.z + toGoal.y * DEFENDER_MARK_DISTANCE

    // No dejan su zona defensiva: ni se meten en el área de 6m ni suben demasiado.
    const fromGoal = new THREE.Vector2(markX - goalCenter.x, markZ - goalCenter.y)
    const distFromGoal = THREE.MathUtils.clamp(fromGoal.length(), DEFENDER_MIN_FROM_GOAL, DEFENDER_MAX_FROM_GOAL)
    fromGoal.normalize().multiplyScalar(distFromGoal)
    markX = goalCenter.x + fromGoal.x
    markZ = THREE.MathUtils.clamp(goalCenter.y + fromGoal.y, -FIELD_Z_LIMIT, FIELD_Z_LIMIT)

    const pos = defender.group.position
    const dx = markX - pos.x
    const dz = markZ - pos.z
    const dist = Math.hypot(dx, dz)
    if (dist > 0.05) {
      const step = Math.min(DEFENDER_SPEED * dt, dist)
      pos.x += (dx / dist) * step
      pos.z += (dz / dist) * step
      defender.group.rotation.y = Math.atan2(dx, dz) + Math.PI / 2
    }
  }
}

function updateRings() {
  teammates.forEach((t, idx) => {
    if (idx === activeIndex) {
      t.ring.visible = true
      ;(t.ring.material as THREE.MeshBasicMaterial).color.setHex(0x22ff88)
    } else if (idx === tacticalSelected) {
      t.ring.visible = true
      ;(t.ring.material as THREE.MeshBasicMaterial).color.setHex(0xffdd33)
    } else {
      t.ring.visible = false
    }
  })
}

const CAMERA_HEIGHT = 15
const CAMERA_BACK = 24

function updateCamera(dt: number) {
  // Cámara panorámica tipo retransmisión: sigue el juego a lo largo del campo
  // (eje X) pero mantiene siempre visible todo el ancho (eje Z) y a los 3 jugadores.
  let focusX = 0
  teammates.forEach((t) => (focusX += t.group.position.x))
  focusX = THREE.MathUtils.clamp(focusX / teammates.length, -FIELD_X_LIMIT, FIELD_X_LIMIT)

  const desired = new THREE.Vector3(focusX, CAMERA_HEIGHT, -CAMERA_BACK)
  camera.position.lerp(desired, 1 - Math.pow(0.0005, dt))
  camera.lookAt(focusX, 0.5, 0)
}

// Iconos "estilo FIFA" sobre los compañeros a los que puedes pasar ahora mismo.
const projectVec = new THREE.Vector3()
function updatePassIcons() {
  const canPass = possession === activeIndex
  teammates.forEach((t, idx) => {
    const icon = passIcons[idx]
    if (idx === activeIndex || !canPass) {
      icon.style.visibility = 'hidden'
      return
    }
    projectVec.set(t.group.position.x, 2.1, t.group.position.z).project(camera)
    if (projectVec.z > 1) {
      icon.style.visibility = 'hidden'
      return
    }
    icon.style.left = `${(projectVec.x * 0.5 + 0.5) * window.innerWidth}px`
    icon.style.top = `${(-projectVec.y * 0.5 + 0.5) * window.innerHeight}px`
    icon.style.visibility = 'visible'
  })
}

const clock = new THREE.Clock()
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05)

  updateActivePlayer(dt)
  teammates.forEach((t, idx) => {
    if (idx !== activeIndex) updateTeammateAI(t, dt)
  })

  if (possession >= 0) updateBallHeld()
  else updateBallFree(dt)

  updateKeeper(dt)
  updateDefenders(dt)
  updateRings()
  updateCamera(dt)
  updatePassIcons()

  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
