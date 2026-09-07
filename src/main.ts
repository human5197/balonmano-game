import * as THREE from 'three'
import { buildCourt, buildGoal, GOAL_LINE_X, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './game/court'
import { loadCharacter } from './game/loadCharacter'
import { playPass, playShoot, playGoal, playWhistle, playTurnover, playCatch } from './game/sound'

const app = document.getElementById('app')!
const scoreEl = document.getElementById('score')!
const messageEl = document.getElementById('message')!
const goalFlashEl = document.getElementById('goal-flash')!

function triggerGoalFlash() {
  goalFlashEl.classList.remove('active')
  // Forzar reflow para poder relanzar la animación aunque se marquen goles seguidos.
  void goalFlashEl.offsetWidth
  goalFlashEl.classList.add('active')
  messageEl.classList.add('goal')
  setTimeout(() => messageEl.classList.remove('goal'), 1600)
}

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

// Área de 6 metros: solo el portero puede pisarla. Un poco más ancha que la
// línea dibujada (6m) para que el jugador se quede claramente fuera de ella,
// no pegado al trazo.
const GOAL_AREA_RADIUS = 6.5

const DEFENDER_SPEED = 4.2
const DEFENDER_MARK_DISTANCE = 1.4 // se colocan entre su atacante y la portería
const DEFENDER_MIN_FROM_GOAL = GOAL_AREA_RADIUS
const DEFENDER_MAX_FROM_GOAL = 18
const DEFENDER_INTERCEPT_RADIUS = 0.85

// El portero tarda un poco en reaccionar a un lanzamiento (como una persona
// real, no puede leer el futuro): durante ese instante se queda centrado, lo
// que da una ventana real para marcar a las esquinas si el disparo es rápido.
const KEEPER_REACTION_DELAY = 0.22
const GOAL_SLOWMO_DURATION = 0.9
const GOAL_SLOWMO_SCALE = 0.25

const AUTO_SUPPORT_OFFSET_X = -3 // los atacantes sin balón se quedan algo por detrás, en apoyo
const AUTO_SUPPORT_LERP = 0.35 // cuánto tiran hacia el balón en profundidad, sin perder del todo su carril

const MAX_CARRY_DISTANCE = 3 // "3 pasos" simplificados: metros que puedes correr con el balón sin botar/pasar
const DRIBBLE_MIN_Y = 0.15
const DRIBBLE_MAX_Y = 0.95
const DRIBBLE_BOUNCE_SPEED = 6

const ATTACKER_COLOR = 0x1f5fff
const DEFENDER_COLOR = 0xe02020
const KEEPER_COLOR = 0xffcc00
const MIN_ROSTER = 1
const MAX_ROSTER = 6

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
let autoAdvance = true // los atacantes sin orden manual avanzan/retroceden siguiendo al balón
let carryDistance = 0 // distancia recorrida por el portador activo sin pasar/lanzar ("pasos")
let isDribbling = false // true mientras el balón bota (solo visual + no cuenta pasos)
let hasDribbled = false // ya gastaste tu único bote permitido en esta posesión
let elapsedTime = 0
let shotTargetZ: number | null = null // punto de la portería al que apunta el disparo en curso
let shotTime = 0 // cuándo se lanzó, para simular el tiempo de reacción del portero
let goalSlowMoUntil = 0 // ralentí breve al marcar, estilo videojuego
let pendingReset: number | null = null // celebración: el balón se queda quieto en la red antes de reiniciar

// --- Equipo ---
interface Teammate {
  group: THREE.Group
  ring: THREE.Mesh
  marker: THREE.Mesh
  facing: THREE.Vector3
  target: THREE.Vector3 | null
  startPos: THREE.Vector3
}

interface Defender {
  group: THREE.Group
  marks: number // índice del compañero al que marca
  startPos: THREE.Vector3
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

// Disco de color permanente bajo los pies: distingue de un vistazo equipo
// atacante (azul) de equipo defensor (rojo), independientemente de cómo
// se vea el modelo/textura del personaje.
function createTeamDisc(color: number): THREE.Mesh {
  const disc = new THREE.Mesh(
    new THREE.CircleGeometry(0.55, 24),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 }),
  )
  disc.rotation.x = -Math.PI / 2
  disc.position.y = 0.015
  return disc
}

// Reparte `count` posiciones a lo ancho del campo (eje Z), centradas en 0.
function layoutZ(count: number, spread: number): number[] {
  if (count <= 1) return [0]
  return Array.from({ length: count }, (_, i) => THREE.MathUtils.lerp(-spread, spread, i / (count - 1)))
}

// Empuja `pos` fuera de cualquiera de las dos áreas de 6m (solo el portero
// puede pisarlas): si cae dentro del radio, lo desplaza radialmente hasta
// el borde.
function keepOutOfGoalArea(pos: THREE.Vector3) {
  for (const goalX of [GOAL_LINE_X, -GOAL_LINE_X]) {
    const dx = pos.x - goalX
    const dz = pos.z
    const dist = Math.hypot(dx, dz)
    if (dist < GOAL_AREA_RADIUS && dist > 0.0001) {
      const scale = GOAL_AREA_RADIUS / dist
      pos.x = goalX + dx * scale
      pos.z = dz * scale
    }
  }
}

const passIconsEl = document.getElementById('pass-icons')!
const passIcons: HTMLDivElement[] = []
const teammates: Teammate[] = []
const defenders: Defender[] = []
const hitboxes: THREE.Mesh[] = []

let activeIndex = 0
let tacticalSelected: number | null = null

async function buildTeams(attackerCount: number, defenderCount: number) {
  // Se carga todo en paralelo en arrays temporales primero (los del equipo en
  // juego no se tocan mientras tanto, así el frame en curso sigue viendo el
  // equipo anterior completo) y solo al final se sustituye todo de golpe, sin
  // ningún `await` de por medio, para no dejar el equipo a medias en ningún
  // frame renderizado.
  const attackerZ = layoutZ(attackerCount, 8)
  const attackerLoads = Array.from({ length: attackerCount }, async (_, i) => {
    const group = await loadCharacter('/models/player.glb', ATTACKER_COLOR)
    const startPos = new THREE.Vector3(-10 - (i % 2) * 3, 0, attackerZ[i])
    group.position.copy(startPos)
    group.add(createTeamDisc(ATTACKER_COLOR))
    const ring = createRing(0x22ff88)
    group.add(ring)
    const teammate: Teammate = { group, ring, marker: createMarker(), facing: new THREE.Vector3(1, 0, 0), target: null, startPos }

    const box = new THREE.Mesh(
      new THREE.CylinderGeometry(1.3, 1.3, 2.4, 12),
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0 }),
    )
    box.position.y = 1.1
    box.userData.idx = i
    group.add(box)

    const icon = document.createElement('div')
    icon.className = 'pass-icon'
    icon.textContent = String(i + 1)
    icon.addEventListener('click', () => choosePlayer(i))

    return { teammate, box, icon }
  })

  const defenderZ = layoutZ(defenderCount, 8)
  const defenderLoads = Array.from({ length: defenderCount }, async (_, i) => {
    const group = await loadCharacter('/models/keeper.glb', DEFENDER_COLOR)
    const startPos = new THREE.Vector3(12 + (i % 2) * 3, 0, defenderZ[i])
    group.position.copy(startPos)
    group.rotation.y = -Math.PI / 2
    group.add(createTeamDisc(DEFENDER_COLOR))
    const defender: Defender = { group, marks: i % attackerCount, startPos }
    return defender
  })

  const [attackerResults, newDefenders] = await Promise.all([Promise.all(attackerLoads), Promise.all(defenderLoads)])
  const newTeammates = attackerResults.map((r) => r.teammate)
  const newHitboxes = attackerResults.map((r) => r.box)
  const newIcons = attackerResults.map((r) => r.icon)

  // --- swap atómico ---
  teammates.forEach((t) => {
    scene.remove(t.group)
    scene.remove(t.marker)
  })
  defenders.forEach((d) => scene.remove(d.group))

  teammates.length = 0
  teammates.push(...newTeammates)
  defenders.length = 0
  defenders.push(...newDefenders)
  hitboxes.length = 0
  hitboxes.push(...newHitboxes)
  passIconsEl.innerHTML = ''
  passIcons.length = 0
  newIcons.forEach((icon) => {
    passIconsEl.appendChild(icon)
    passIcons.push(icon)
  })

  newTeammates.forEach((t) => scene.add(t.group))
  newDefenders.forEach((d) => scene.add(d.group))

  activeIndex = 0
  tacticalSelected = null
  possession = 0
  passTargetIdx = null
  ballVelocity.set(0, 0, 0)
  carryDistance = 0
  hasDribbled = false
}

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

const keeper = await loadCharacter('/models/keeper.glb', KEEPER_COLOR)
keeper.position.set(GOAL_LINE_X - 0.8, 0, 0)
keeper.rotation.y = -Math.PI / 2
keeper.add(createTeamDisc(KEEPER_COLOR))
scene.add(keeper)

await buildTeams(3, 3)

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
  const n = Number(e.key)
  if (Number.isInteger(n) && n >= 1 && n <= teammates.length) choosePlayer(n - 1)
})
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))

// --- Selección y órdenes con el ratón ---
const raycaster = new THREE.Raycaster()
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0)

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
      keepOutOfGoalArea(point)
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

// Regla de pasos simplificada: si corres más de MAX_CARRY_DISTANCE con el
// balón sin pasar ni lanzar, lo pierdes (se te cae, queda suelto).
function forceTurnover() {
  lastHolder = activeIndex
  possession = -1
  possessionCooldown = 0.35
  carryDistance = 0
  ballVelocity.set((Math.random() - 0.5) * 1.5, 1.2, (Math.random() - 0.5) * 1.5)
  messageEl.textContent = '¡Pasos! Pierdes el balón.'
  playTurnover()
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
  shotTargetZ = target.z
  shotTime = elapsedTime
  messageEl.textContent = '¡Lanzamiento!'
  playShoot()
}

function shoot() {
  shootAt(new THREE.Vector3(GOAL_LINE_X, 0, (Math.random() - 0.5) * GOAL_HALF_WIDTH * 1.6))
}

function passTo(bestIdx: number) {
  if (possession !== activeIndex || bestIdx === activeIndex) return
  passTargetIdx = bestIdx
  releaseBall()
  messageEl.textContent = `Pase al jugador ${bestIdx + 1}`
  playPass()
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
  teammates.forEach((t) => {
    t.group.position.copy(t.startPos)
    t.target = null
    t.marker.visible = false
  })
  defenders.forEach((d) => d.group.position.copy(d.startPos))
  setActive(0)
  ballVelocity.set(0, 0, 0)
  passTargetIdx = null
  possession = 0
  carryDistance = 0
  hasDribbled = false
  shotTargetZ = null
}

// Saque tras balón fuera: siempre se lo queda el ataque, el compañero más
// cercano al punto donde salió (sin reposicionar a nadie más).
function giveBallToNearestAttacker(atPoint: THREE.Vector3) {
  let nearestIdx = 0
  let nearestDist = Infinity
  teammates.forEach((t, idx) => {
    const d = t.group.position.distanceTo(atPoint)
    if (d < nearestDist) {
      nearestDist = d
      nearestIdx = idx
    }
  })
  possession = nearestIdx
  passTargetIdx = null
  ballVelocity.set(0, 0, 0)
  carryDistance = 0
  hasDribbled = false
  shotTargetZ = null
  if (nearestIdx !== activeIndex) setActive(nearestIdx)
}

function updateActivePlayer(dt: number) {
  const active = teammates[activeIndex]

  const move = new THREE.Vector3()
  if (keys.has('w') || keys.has('arrowup')) move.x += 1
  if (keys.has('s') || keys.has('arrowdown')) move.x -= 1
  if (keys.has('a') || keys.has('arrowleft')) move.z -= 1
  if (keys.has('d') || keys.has('arrowright')) move.z += 1
  const isMoving = move.lengthSq() > 0

  // Regla real, automática y sin tecla: primero tienes ~3 pasos; si los
  // agotas sin haber botado todavía, se te permite empezar a botar para
  // seguir avanzando (bote libre e ilimitado). En cuanto te paras mientras
  // botas, es coger el balón con las dos manos: tienes otros ~3 pasos
  // frescos, pero ya no puedes volver a botar (doble bote no permitido) —
  // si los agotas también, lo pierdes.
  if (possession !== activeIndex) {
    isDribbling = false
  } else if (!isMoving && isDribbling) {
    isDribbling = false
    carryDistance = 0
  }

  if (isMoving) {
    move.normalize()
    active.group.position.addScaledVector(move, PLAYER_SPEED * dt)
    active.group.position.x = THREE.MathUtils.clamp(active.group.position.x, -FIELD_X_LIMIT, FIELD_X_LIMIT)
    active.group.position.z = THREE.MathUtils.clamp(active.group.position.z, -FIELD_Z_LIMIT, FIELD_Z_LIMIT)
    keepOutOfGoalArea(active.group.position)
    active.facing = move.clone()
    active.group.rotation.y = Math.atan2(active.facing.x, active.facing.z) + Math.PI / 2

    if (possession === activeIndex && !isDribbling) {
      carryDistance += PLAYER_SPEED * dt
      if (carryDistance > MAX_CARRY_DISTANCE) {
        if (!hasDribbled) {
          isDribbling = true
          hasDribbled = true
          carryDistance = 0
        } else {
          forceTurnover()
        }
      }
    }
  }
}

function updateTeammateAI(t: Teammate, dt: number) {
  let targetX: number
  let targetZ: number

  if (t.target) {
    targetX = t.target.x
    targetZ = t.target.z
  } else if (autoAdvance) {
    // Sin orden manual: se mantienen en su carril (startPos.z) pero avanzan o
    // retroceden en profundidad siguiendo el progreso del balón por el campo.
    targetX = THREE.MathUtils.clamp(ball.position.x + AUTO_SUPPORT_OFFSET_X, -FIELD_X_LIMIT, FIELD_X_LIMIT)
    targetZ = THREE.MathUtils.lerp(t.startPos.z, ball.position.z, AUTO_SUPPORT_LERP)
  } else {
    return
  }

  const pos = t.group.position
  const dx = targetX - pos.x
  const dz = targetZ - pos.z
  const dist = Math.hypot(dx, dz)
  if (dist < 0.15) {
    if (t.target) t.marker.visible = false
    return
  }
  const dir = new THREE.Vector3(dx / dist, 0, dz / dist)
  pos.addScaledVector(dir, Math.min(TEAMMATE_SPEED * dt, dist))
  keepOutOfGoalArea(pos)
  t.facing = dir
  t.group.rotation.y = Math.atan2(dir.x, dir.z) + Math.PI / 2
}

function updateBallHeld() {
  const holder = teammates[possession]
  const holdOffset = holder.facing.clone().multiplyScalar(0.55)
  const y =
    isDribbling && possession === activeIndex
      ? THREE.MathUtils.lerp(DRIBBLE_MIN_Y, DRIBBLE_MAX_Y, Math.abs(Math.sin(elapsedTime * DRIBBLE_BOUNCE_SPEED)))
      : PASS_HEIGHT
  ball.position.set(holder.group.position.x + holdOffset.x, y, holder.group.position.z + holdOffset.z)
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
    playWhistle()
    return
  }

  for (const defender of defenders) {
    if (defender.group.position.distanceTo(ball.position) < DEFENDER_INTERCEPT_RADIUS) {
      passTargetIdx = null
      ballVelocity.set((Math.random() - 0.5) * 4, 2, (Math.random() - 0.5) * 6)
      messageEl.textContent = '¡Pase interceptado por el defensor!'
      playWhistle()
      return
    }
  }

  if (dist < CATCH_RADIUS) {
    possession = idx
    passTargetIdx = null
    ballVelocity.set(0, 0, 0)
    carryDistance = 0
    hasDribbled = false
    playCatch()
    if (idx !== activeIndex) setActive(idx)
    return
  }

  const step = Math.min(PASS_SPEED * dt, dist)
  ball.position.x += (dx / dist) * step
  ball.position.z += (dz / dist) * step
}

function updateBallFree(dt: number) {
  if (pendingReset !== null) {
    if (elapsedTime >= pendingReset) {
      pendingReset = null
      resetBall()
    }
    return
  }

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
    playGoal()
    triggerGoalFlash()
    goalSlowMoUntil = elapsedTime + GOAL_SLOWMO_DURATION
    ballVelocity.set(0, 0, 0)
    pendingReset = elapsedTime + GOAL_SLOWMO_DURATION + 0.5
    return
  }

  const dKeeper = ball.position.distanceTo(keeper.position.clone().setY(ball.position.y))
  if (dKeeper < 0.9 && ball.position.x > GOAL_LINE_X - 4) {
    ballVelocity.x *= -0.5
    ballVelocity.z += (Math.random() - 0.5) * 4
    messageEl.textContent = '¡Parada del portero!'
    playWhistle()
    shotTargetZ = null
  }

  for (const defender of defenders) {
    const dDef = defender.group.position.distanceTo(ball.position)
    if (dDef < DEFENDER_INTERCEPT_RADIUS && ball.position.y < 1.4) {
      ballVelocity.x *= -0.5
      ballVelocity.z += (Math.random() - 0.5) * 5
      ballVelocity.y = Math.max(ballVelocity.y, 1.5)
      messageEl.textContent = '¡Balón interceptado por el defensor!'
      playWhistle()
      break
    }
  }

  for (let idx = 0; idx < teammates.length; idx++) {
    if (idx === lastHolder && possessionCooldown > 0) continue
    const d = teammates[idx].group.position.distanceTo(ball.position)
    if (d < CATCH_RADIUS && ball.position.y < 1.3) {
      possession = idx
      ballVelocity.set(0, 0, 0)
      carryDistance = 0
      hasDribbled = false
      shotTargetZ = null
      playCatch()
      if (idx !== activeIndex) setActive(idx)
      return
    }
  }

  const outOfBounds = ball.position.x < -20.5 || ball.position.x > 20.5 || Math.abs(ball.position.z) > 10.5
  if (outOfBounds) {
    messageEl.textContent = 'Balón fuera. Saque para el ataque.'
    playWhistle()
    giveBallToNearestAttacker(ball.position)
  }
}

function updateKeeper(dt: number) {
  const reacting = shotTargetZ !== null && elapsedTime - shotTime < KEEPER_REACTION_DELAY
  const aimZ = shotTargetZ ?? ball.position.z
  const targetZ = reacting ? 0 : THREE.MathUtils.clamp(aimZ, -GOAL_HALF_WIDTH + 0.2, GOAL_HALF_WIDTH - 0.2)
  const dz = targetZ - keeper.position.z
  const step = THREE.MathUtils.clamp(dz, -KEEPER_SPEED * dt, KEEPER_SPEED * dt)
  keeper.position.z += step

  // Toque de "estirada": se inclina hacia el lado al que se mueve rápido.
  const lean = THREE.MathUtils.clamp(-step * 6, -0.6, 0.6)
  keeper.rotation.z = THREE.MathUtils.lerp(keeper.rotation.z, lean, 0.3)
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

const carryColorGreen = new THREE.Color(0x22ff88)
const carryColorRed = new THREE.Color(0xff2222)

function updateRings() {
  teammates.forEach((t, idx) => {
    if (idx === activeIndex) {
      t.ring.visible = true
      const ringMat = t.ring.material as THREE.MeshBasicMaterial
      if (possession === activeIndex) {
        // "Pasos": el anillo pasa de verde a rojo según se agota el margen para correr.
        const t01 = THREE.MathUtils.clamp(carryDistance / MAX_CARRY_DISTANCE, 0, 1)
        ringMat.color.copy(carryColorGreen).lerp(carryColorRed, t01)
      } else {
        ringMat.color.setHex(0x22ff88)
      }
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
  // Celebración de gol: primer plano dramático sobre el balón en la red,
  // en vez del plano panorámico habitual, mientras dura el ralentí.
  if (pendingReset !== null) {
    const desired = new THREE.Vector3(ball.position.x - 5, CAMERA_HEIGHT * 0.4, ball.position.z - 8)
    camera.position.lerp(desired, 1 - Math.pow(0.001, dt))
    camera.lookAt(ball.position.x, 0.8, ball.position.z)
    return
  }

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

// --- Panel de plantilla: hasta 6 atacantes y 6 defensores ---
const atkCountEl = document.getElementById('atk-count')!
const defCountEl = document.getElementById('def-count')!
let pendingAttackers = teammates.length
let pendingDefenders = defenders.length

document.getElementById('atk-minus')!.addEventListener('click', () => {
  pendingAttackers = Math.max(MIN_ROSTER, pendingAttackers - 1)
  atkCountEl.textContent = String(pendingAttackers)
})
document.getElementById('atk-plus')!.addEventListener('click', () => {
  pendingAttackers = Math.min(MAX_ROSTER, pendingAttackers + 1)
  atkCountEl.textContent = String(pendingAttackers)
})
document.getElementById('def-minus')!.addEventListener('click', () => {
  pendingDefenders = Math.max(MIN_ROSTER, pendingDefenders - 1)
  defCountEl.textContent = String(pendingDefenders)
})
document.getElementById('def-plus')!.addEventListener('click', () => {
  pendingDefenders = Math.min(MAX_ROSTER, pendingDefenders + 1)
  defCountEl.textContent = String(pendingDefenders)
})
document.getElementById('auto-advance')!.addEventListener('change', (e) => {
  autoAdvance = (e.target as HTMLInputElement).checked
})

const rosterApplyBtn = document.getElementById('roster-apply') as HTMLButtonElement
rosterApplyBtn.addEventListener('click', async () => {
  rosterApplyBtn.disabled = true
  rosterApplyBtn.textContent = 'Cargando...'
  messageEl.textContent = 'Cargando plantilla nueva...'
  try {
    await buildTeams(pendingAttackers, pendingDefenders)
    scoreEl.textContent = 'Goles: 0'
    score = 0
    messageEl.textContent = `Equipos: ${pendingAttackers} atacantes vs ${pendingDefenders} defensores`
  } catch (err) {
    console.error('Error al reconstruir los equipos:', err)
    messageEl.textContent = 'Error al aplicar el cambio de plantilla (revisa la consola).'
  } finally {
    rosterApplyBtn.disabled = false
    rosterApplyBtn.textContent = 'Aplicar y reiniciar'
  }
})

const clock = new THREE.Clock()
function animate() {
  const rawDt = Math.min(clock.getDelta(), 0.05)
  const inSlowMo = elapsedTime < goalSlowMoUntil
  const dt = inSlowMo ? rawDt * GOAL_SLOWMO_SCALE : rawDt
  elapsedTime += rawDt // avanza en tiempo real para que el ralentí dure lo mismo siempre

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
