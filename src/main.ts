import * as THREE from 'three'
import { buildCourt, buildGoal, GOAL_LINE_X, GOAL_HALF_WIDTH, GOAL_HEIGHT } from './game/court'
import { loadCharacter } from './game/loadCharacter'

const app = document.getElementById('app')!
const scoreEl = document.getElementById('score')!
const messageEl = document.getElementById('message')!

const PLAYER_SPEED = 6.5
const BALL_RADIUS = 0.1
const GRAVITY = -9.8
const KEEPER_SPEED = 4.5
const SHOOT_ARC = 3.2

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
let hasBall = true

// --- Estado de entrada ---
const keys = new Set<string>()
window.addEventListener('keydown', (e) => keys.add(e.key.toLowerCase()))
window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()))
window.addEventListener('keydown', (e) => {
  if (e.key === ' ') shoot()
})
renderer.domElement.addEventListener('click', () => shoot())

// --- Jugador y portero ---
const player = await loadCharacter('/models/player.glb', 0x2b6cff)
player.position.set(-10, 0, 0)
scene.add(player)

const keeper = await loadCharacter('/models/keeper.glb', 0xff3b3b)
keeper.position.set(GOAL_LINE_X - 0.8, 0, 0)
keeper.rotation.y = -Math.PI / 2
scene.add(keeper)

let score = 0
let facing = new THREE.Vector3(1, 0, 0)

function shoot() {
  if (!hasBall) return
  const target = new THREE.Vector3(GOAL_LINE_X, 0.9, (Math.random() - 0.5) * GOAL_HALF_WIDTH * 1.6)
  const from = ball.position.clone()
  const flat = new THREE.Vector2(target.x - from.x, target.z - from.z)
  const dist = flat.length()
  const dir = new THREE.Vector3(flat.x / dist, 0, flat.y / dist)
  const speed = THREE.MathUtils.clamp(dist * 1.6, 8, 16)
  ballVelocity = dir.multiplyScalar(speed)
  ballVelocity.y = SHOOT_ARC
  hasBall = false
  messageEl.textContent = '¡Lanzamiento!'
}

function resetBall() {
  player.position.set(-10, 0, 0)
  ballVelocity.set(0, 0, 0)
  hasBall = true
}

function updatePlayer(dt: number) {
  const move = new THREE.Vector3()
  if (keys.has('w') || keys.has('arrowup')) move.x += 1
  if (keys.has('s') || keys.has('arrowdown')) move.x -= 1
  if (keys.has('a') || keys.has('arrowleft')) move.z -= 1
  if (keys.has('d') || keys.has('arrowright')) move.z += 1

  if (move.lengthSq() > 0) {
    move.normalize()
    player.position.addScaledVector(move, PLAYER_SPEED * dt)
    player.position.x = THREE.MathUtils.clamp(player.position.x, -19, 19)
    player.position.z = THREE.MathUtils.clamp(player.position.z, -9.5, 9.5)
    facing = move.clone()
    player.rotation.y = Math.atan2(facing.x, facing.z) + Math.PI / 2
  }

  if (hasBall) {
    const holdOffset = facing.clone().multiplyScalar(0.55)
    ball.position.set(player.position.x + holdOffset.x, 0.95, player.position.z + holdOffset.z)
  } else {
    const dist = player.position.distanceTo(ball.position)
    if (dist < 1 && ball.position.y < 0.5) {
      hasBall = true
      messageEl.textContent = '¡Balón recuperado! Espacio o click para lanzar'
    }
  }
}

function updateBall(dt: number) {
  if (hasBall) return

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

  const outOfBounds =
    ball.position.x < -20.5 || ball.position.x > 20.5 || Math.abs(ball.position.z) > 10.5
  if (outOfBounds) {
    messageEl.textContent = 'Balón fuera. Acércate para recuperarlo.'
    ballVelocity.set(0, 0, 0)
  }
}

function updateKeeper(dt: number) {
  const targetZ = THREE.MathUtils.clamp(ball.position.z, -GOAL_HALF_WIDTH + 0.2, GOAL_HALF_WIDTH - 0.2)
  const dz = targetZ - keeper.position.z
  keeper.position.z += THREE.MathUtils.clamp(dz, -KEEPER_SPEED * dt, KEEPER_SPEED * dt)
}

function updateCamera(dt: number) {
  const back = facing.clone().multiplyScalar(-5)
  const desired = new THREE.Vector3(player.position.x + back.x, 3.2, player.position.z + back.z)
  camera.position.lerp(desired, 1 - Math.pow(0.001, dt))
  const lookAt = player.position.clone().addScaledVector(facing, 3)
  lookAt.y = 1
  camera.lookAt(lookAt)
}

const clock = new THREE.Clock()
function animate() {
  const dt = Math.min(clock.getDelta(), 0.05)
  updatePlayer(dt)
  updateBall(dt)
  updateKeeper(dt)
  updateCamera(dt)
  renderer.render(scene, camera)
  requestAnimationFrame(animate)
}
animate()
