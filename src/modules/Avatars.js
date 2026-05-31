import * as THREE from 'three';

// Blocky Minecraft-style player avatars, themed per character. A player never
// sees their own avatar (first person) — these are what OTHER players would see,
// with the chosen username floating above the head.

const SKIN = 0xe7b48a;

function part(w, h, d, color, opts = {}) {
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: opts.roughness ?? 0.9,
    metalness: opts.metalness ?? 0,
    flatShading: true,
  });
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.castShadow = true;
  return mesh;
}

const THEME = {
  duck: { shirt: 0xffd166, pants: 0xe08a1e, head: 0xffe08a },
  knight: { shirt: 0x9aa6b2, pants: 0x5c6672, head: SKIN },
  hunter: { shirt: 0x3f6b3a, pants: 0x2c3b26, head: SKIN },
  samurai: { shirt: 0xb33636, pants: 0x2a2a2a, head: SKIN },
  mage: { shirt: 0x6a3fb5, pants: 0x4a2f86, head: SKIN },
};

export function buildAvatar(character) {
  const theme = THEME[character?.id] ?? THEME.duck;
  const g = new THREE.Group();
  g.name = 'Avatar';

  const lLeg = part(0.28, 0.8, 0.3, theme.pants); lLeg.position.set(-0.16, 0.4, 0);
  const rLeg = part(0.28, 0.8, 0.3, theme.pants); rLeg.position.set(0.16, 0.4, 0);
  const torso = part(0.7, 0.85, 0.38, theme.shirt); torso.position.y = 1.22;
  const lArm = part(0.24, 0.8, 0.28, theme.shirt); lArm.position.set(-0.47, 1.22, 0);
  const rArm = part(0.24, 0.8, 0.28, theme.shirt); rArm.position.set(0.47, 1.22, 0);
  const head = part(0.5, 0.5, 0.5, theme.head); head.position.y = 1.9;
  g.add(lLeg, rLeg, torso, lArm, rArm, head);

  if (character?.id === 'mage') {
    const brim = part(0.72, 0.08, 0.72, 0x161616); brim.position.y = 2.2;
    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(0.32, 0.62, 6),
      new THREE.MeshStandardMaterial({ color: 0x161616, flatShading: true }),
    );
    cone.position.y = 2.52;
    cone.castShadow = true;
    g.add(brim, cone);
  } else if (character?.id === 'duck') {
    const bill = part(0.3, 0.1, 0.22, 0xff8c1a); bill.position.set(0, 1.85, 0.32);
    g.add(bill);
  }

  return g;
}

export function buildNameTag(name) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  const label = (name || 'Jugador').slice(0, 16);
  ctx.font = 'bold 30px Arial';
  const textWidth = ctx.measureText(label).width;
  const boxWidth = Math.min(252, textWidth + 28);
  ctx.fillStyle = 'rgba(8, 12, 16, 0.62)';
  ctx.fillRect((256 - boxWidth) / 2, 14, boxWidth, 38);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffffff';
  ctx.fillText(label, 128, 34);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 0.5), material);
  mesh.renderOrder = 1002;
  mesh.frustumCulled = false;
  mesh.position.y = 2.7;
  mesh.userData.texture = texture;
  return mesh;
}

export default buildAvatar;
