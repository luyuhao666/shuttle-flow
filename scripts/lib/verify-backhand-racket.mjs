// Intersect shaft, rim and string-plane spans against the actual deformed jersey/head.
import * as THREE from 'three';
export function createBackhandRacketCheck(root) {
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const surfaces = ['Athlete_Jersey', 'Athlete_Skin'].map(name => {
    const source = root.getObjectByName(name), g = source.geometry, indices = [];
    const total = g.index?.count ?? g.attributes.position.count;
    for (let i = 0; i < total; i += 3) {
      const triangle = [0, 1, 2].map(j => g.index ? g.index.getX(i + j) : i + j);
      if (name === 'Athlete_Skin' && !triangle.every(j => g.attributes.position.getY(j) > 1.60)) continue;
      indices.push(...triangle);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(indices.length * 3), 3));
    return { source, indices, mesh: new THREE.Mesh(geometry, material) };
  });
  const shaft = root.getObjectByName('RacketShaft'), rim = root.getObjectByName('RacketFrame');
  const ray = new THREE.Raycaster(), point = new THREE.Vector3();
  return () => {
    for (const { source, indices, mesh } of surfaces) {
      const positions = mesh.geometry.attributes.position;
      indices.forEach((j, i) => { source.getVertexPosition(j, point).applyMatrix4(source.matrixWorld); positions.setXYZ(i, point.x, point.y, point.z); });
      mesh.geometry.computeBoundingSphere(); mesh.geometry.computeBoundingBox();
    }
    const ring = rim.userData.racketOutline
      ? rim.userData.racketOutline.map(p => rim.localToWorld(new THREE.Vector3(...p)))
      : Array.from({ length: 32 }, (_, i) => rim.localToWorld(new THREE.Vector3(.105 * Math.cos(i * Math.PI / 16), .105 * Math.sin(i * Math.PI / 16), 0)));
    const segments = [[shaft.localToWorld(new THREE.Vector3(0, -.15, 0)), shaft.localToWorld(new THREE.Vector3(0, .15, 0))]];
    ring.forEach((p, i) => segments.push([p, ring[(i + 1) % ring.length]]));
    for (let i = 0; i < ring.length / 2; i++) segments.push([ring[i], ring[i + ring.length / 2]]);
    for (const [a, b] of segments) {
      ray.set(a, b.clone().sub(a).normalize()); ray.near = .001; ray.far = a.distanceTo(b) - .001;
      if (ray.intersectObjects(surfaces.map(s => s.mesh), false).length) return false;
    }
    return true;
  };
}
