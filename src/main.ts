import Phaser from 'phaser'
import { MainScene } from './scenes/MainScene'

new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'app',
  width: 960,
  height: 560,
  backgroundColor: '#1f6f3a',
  physics: {
    default: 'arcade',
    arcade: { debug: false },
  },
  scene: [MainScene],
})
