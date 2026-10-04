import type { CascadeNetwork } from './liveNetwork';
import { buildAffinityLayout } from './affinityLayout';

// The same relationship signals as 3D, with planar collision spacing and pan controls.
export function buildPlanarLayout(network:CascadeNetwork){
  return buildAffinityLayout(network,2);
}
