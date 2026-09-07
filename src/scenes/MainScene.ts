import Phaser from 'phaser'

const FIELD_WIDTH = 960
const FIELD_HEIGHT = 560
const GOAL_TOP = 220
const GOAL_BOTTOM = 340
const GOAL_LINE_X = 940

const PLAYER_SPEED = 260
const SHOT_SPEED = 620
const KEEPER_SPEED = 180

export class MainScene extends Phaser.Scene {
  private player!: Phaser.Physics.Arcade.Image
  private ball!: Phaser.Physics.Arcade.Image
  private keeper!: Phaser.Physics.Arcade.Image
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys
  private wasd!: { W: Phaser.Input.Keyboard.Key; A: Phaser.Input.Keyboard.Key; S: Phaser.Input.Keyboard.Key; D: Phaser.Input.Keyboard.Key }
  private hasBall = true
  private score = 0
  private scoreText!: Phaser.GameObjects.Text
  private messageText!: Phaser.GameObjects.Text

  constructor() {
    super('MainScene')
  }

  preload() {
    this.generateCircleTexture('player-tex', 16, 0x2b6cff)
    this.generateCircleTexture('ball-tex', 8, 0xffffff)
    this.generateRectTexture('keeper-tex', 18, 60, 0xff3b3b)
  }

  create() {
    this.drawField()

    this.keeper = this.physics.add.image(GOAL_LINE_X - 4, (GOAL_TOP + GOAL_BOTTOM) / 2, 'keeper-tex')
    this.keeper.setImmovable(true)

    this.player = this.physics.add.image(120, FIELD_HEIGHT / 2, 'player-tex')
    this.player.setCollideWorldBounds(true)
    this.player.setCircle(16)

    this.ball = this.physics.add.image(this.player.x + 22, this.player.y, 'ball-tex')
    this.ball.setCircle(8)
    this.ball.setCollideWorldBounds(true)
    this.ball.setBounce(0.6)
    this.ball.setDamping(true)
    this.ball.setDrag(0.99)

    this.physics.add.overlap(this.ball, this.keeper, () => this.onKeeperSave())

    this.cursors = this.input.keyboard!.createCursorKeys()
    this.wasd = this.input.keyboard!.addKeys('W,A,S,D') as typeof this.wasd

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.shoot(pointer.worldX, pointer.worldY))
    this.input.keyboard!.on('keydown-SPACE', () => this.shoot(GOAL_LINE_X, (GOAL_TOP + GOAL_BOTTOM) / 2))

    this.scoreText = this.add.text(20, 16, 'Goles: 0', { fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff' })
    this.messageText = this.add.text(FIELD_WIDTH / 2, 40, 'WASD/flechas: mover · Click o Espacio: lanzar', {
      fontFamily: 'sans-serif',
      fontSize: '16px',
      color: '#e8ffe8',
    }).setOrigin(0.5, 0)
  }

  update() {
    this.handleMovement()
    this.handleBallFollow()
    this.handleKeeperAI()
    this.checkGoalOrOut()
  }

  private handleMovement() {
    const left = this.cursors.left.isDown || this.wasd.A.isDown
    const right = this.cursors.right.isDown || this.wasd.D.isDown
    const up = this.cursors.up.isDown || this.wasd.W.isDown
    const down = this.cursors.down.isDown || this.wasd.S.isDown

    const vx = (right ? 1 : 0) - (left ? 1 : 0)
    const vy = (down ? 1 : 0) - (up ? 1 : 0)
    const vec = new Phaser.Math.Vector2(vx, vy)
    if (vec.length() > 0) vec.normalize().scale(PLAYER_SPEED)
    this.player.setVelocity(vec.x, vec.y)
  }

  private handleBallFollow() {
    if (this.hasBall) {
      const offset = new Phaser.Math.Vector2(this.player.body!.velocity.x, this.player.body!.velocity.y)
      const dir = offset.length() > 0 ? offset.normalize() : new Phaser.Math.Vector2(1, 0)
      this.ball.setVelocity(0, 0)
      this.ball.setPosition(this.player.x + dir.x * 26, this.player.y + dir.y * 26)
      return
    }

    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, this.ball.x, this.ball.y)
    if (dist < 28) {
      this.hasBall = true
      this.messageText.setText('¡Balón recuperado! Click o Espacio para lanzar')
    }
  }

  private handleKeeperAI() {
    const targetY = Phaser.Math.Clamp(this.ball.y, GOAL_TOP + 10, GOAL_BOTTOM - 10)
    const dy = targetY - this.keeper.y
    const vy = Phaser.Math.Clamp(dy, -KEEPER_SPEED, KEEPER_SPEED)
    this.keeper.y += vy * (1 / 60)
  }

  private shoot(targetX: number, targetY: number) {
    if (!this.hasBall) return
    const dir = new Phaser.Math.Vector2(targetX - this.ball.x, targetY - this.ball.y).normalize()
    this.ball.setVelocity(dir.x * SHOT_SPEED, dir.y * SHOT_SPEED)
    this.hasBall = false
    this.messageText.setText('¡Lanzamiento!')
  }

  private onKeeperSave() {
    if (this.hasBall) return
    this.ball.setVelocity(-this.ball.body!.velocity.x * 0.4, (Math.random() - 0.5) * 300)
    this.messageText.setText('¡Parada del portero!')
  }

  private checkGoalOrOut() {
    if (!this.hasBall && this.ball.x > GOAL_LINE_X && this.ball.y > GOAL_TOP && this.ball.y < GOAL_BOTTOM) {
      this.score += 1
      this.scoreText.setText(`Goles: ${this.score}`)
      this.messageText.setText('¡GOL! 🤾')
      this.resetBall()
      return
    }

    if (!this.hasBall && (this.ball.x > FIELD_WIDTH - 4 || this.ball.x < 4 || this.ball.y > FIELD_HEIGHT - 4 || this.ball.y < 4)) {
      this.messageText.setText('Balón fuera. Acércate para recuperarlo.')
      this.ball.setVelocity(0, 0)
    }
  }

  private resetBall() {
    this.player.setPosition(120, FIELD_HEIGHT / 2)
    this.ball.setPosition(this.player.x + 22, this.player.y)
    this.ball.setVelocity(0, 0)
    this.hasBall = true
  }

  private drawField() {
    const g = this.add.graphics()
    g.fillStyle(0x1f6f3a, 1)
    g.fillRect(0, 0, FIELD_WIDTH, FIELD_HEIGHT)

    g.lineStyle(3, 0xffffff, 0.9)
    g.strokeRect(10, 10, FIELD_WIDTH - 20, FIELD_HEIGHT - 20)

    // Area de portería (6 metros aprox, simplificada)
    g.beginPath()
    g.arc(GOAL_LINE_X, (GOAL_TOP + GOAL_BOTTOM) / 2, 90, Phaser.Math.DegToRad(-90), Phaser.Math.DegToRad(90), false)
    g.strokePath()

    // Portería
    g.lineStyle(6, 0xffffff, 1)
    g.beginPath()
    g.moveTo(GOAL_LINE_X, GOAL_TOP)
    g.lineTo(GOAL_LINE_X, GOAL_BOTTOM)
    g.strokePath()
  }

  private generateCircleTexture(key: string, radius: number, color: number) {
    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(color, 1)
    g.fillCircle(radius, radius, radius)
    g.generateTexture(key, radius * 2, radius * 2)
    g.destroy()
  }

  private generateRectTexture(key: string, width: number, height: number, color: number) {
    const g = this.make.graphics({ x: 0, y: 0 })
    g.fillStyle(color, 1)
    g.fillRect(0, 0, width, height)
    g.generateTexture(key, width, height)
    g.destroy()
  }
}
