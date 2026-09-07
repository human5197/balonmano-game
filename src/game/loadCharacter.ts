import * as THREE from 'three'
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js'

const loader = new GLTFLoader()
const TARGET_HEIGHT = 1.8

export async function loadCharacter(url: string, tint?: number): Promise<THREE.Group> {
  const gltf = await loader.loadAsync(url)
  const model = gltf.scene

  const box = new THREE.Box3().setFromObject(model)
  const size = new THREE.Vector3()
  box.getSize(size)
  const scale = TARGET_HEIGHT / (size.y || 1)
  model.scale.setScalar(scale)

  const scaledBox = new THREE.Box3().setFromObject(model)
  model.position.y -= scaledBox.min.y

  model.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.castShadow = true
      child.receiveShadow = true
      if (tint !== undefined && child.material instanceof THREE.MeshStandardMaterial) {
        child.material = child.material.clone()
        child.material.color = new THREE.Color(tint)
      }
    }
  })

  const wrapper = new THREE.Group()
  wrapper.add(model)
  return wrapper
}
