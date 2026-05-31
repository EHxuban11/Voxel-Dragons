// Shared voxel collision used by the player and the enemies. Treats an actor as
// a vertical cylinder of `radius` and `height` standing with its feet at
// position.y. Horizontal movement is resolved per-axis (so you slide along a
// wall instead of stopping dead), a wall taller than `stepMax` blocks, and a
// block up to `stepMax` high is a climbable step (the vertical easing lifts you
// onto it gradually — see easeToGround).

const EPS = 1e-3;

function isSolid(world, x, y, z) {
  if (typeof world?.getBlock !== 'function') return false;
  const type = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return Boolean(type) && type !== 'water';
}

// True if a wall higher than a one-step block occupies column (x,z) within the
// actor's body. Cells at or below feetY+stepMax are steps, not walls.
function wallBlocks(world, x, z, feetY, height, stepMax) {
  const lowCell = Math.floor(feetY + stepMax + EPS); // first cell above the step
  const highCell = Math.floor(feetY + height - 0.05);
  for (let y = lowCell; y <= highCell; y += 1) {
    if (isSolid(world, x, y, z)) return true;
  }
  return false;
}

// Resolves a horizontal move by (dx, dz), per-axis, against the actor's radius.
// Mutates position.x / position.z. Returns { x, z }: whether each axis was blocked.
export function moveHorizontal(world, position, dx, dz, radius, height, stepMax = 1.1) {
  if (typeof world?.getBlock !== 'function') {
    position.x += dx;
    position.z += dz;
    return { x: false, z: false };
  }

  const feetY = position.y;
  let blockedX = false;
  let blockedZ = false;

  if (dx !== 0) {
    const nx = position.x + dx;
    const edge = nx + Math.sign(dx) * radius; // the actor's leading face
    const blocked = wallBlocks(world, edge, position.z - radius, feetY, height, stepMax)
      || wallBlocks(world, edge, position.z, feetY, height, stepMax)
      || wallBlocks(world, edge, position.z + radius, feetY, height, stepMax);
    if (blocked) {
      const cell = Math.floor(edge);
      position.x = dx > 0 ? cell - radius - EPS : (cell + 1) + radius + EPS;
      blockedX = true;
    } else {
      position.x = nx;
    }
  }

  if (dz !== 0) {
    const nz = position.z + dz;
    const edge = nz + Math.sign(dz) * radius;
    const blocked = wallBlocks(world, position.x - radius, edge, feetY, height, stepMax)
      || wallBlocks(world, position.x, edge, feetY, height, stepMax)
      || wallBlocks(world, position.x + radius, edge, feetY, height, stepMax);
    if (blocked) {
      const cell = Math.floor(edge);
      position.z = dz > 0 ? cell - radius - EPS : (cell + 1) + radius + EPS;
      blockedZ = true;
    } else {
      position.z = nz;
    }
  }

  return { x: blockedX, z: blockedZ };
}

// Eases position.y toward targetY instead of snapping, so stepping up/down a
// block looks like climbing stairs (Minecraft-style) rather than teleporting.
export function easeToGround(position, targetY, dt, climbSpeed = 9, fallSpeed = 16) {
  const dy = targetY - position.y;
  if (dy > 0) position.y += Math.min(dy, climbSpeed * dt);
  else if (dy < 0) position.y += Math.max(dy, -fallSpeed * dt);
}
