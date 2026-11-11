export const BREEDING_CONFIG = {
  MIN_LAY_DELAY_MS: 1 * 60 * 60 * 1000, // 1 Hour minimum after pairing
  MAX_LAY_DELAY_MS: 6 * 60 * 60 * 1000, // 6 Hours maximum after pairing
  INCUBATION_DURATION_MS: 6 * 60 * 60 * 1000, // 6 Hours after eggs are laid
  CHICK_GENETICS_REVEAL_MS: 3 * 60 * 60 * 1000, // 3 Hours after hatch: feathers/genetics display
  MATURATION_DURATION_MS: 6 * 60 * 60 * 1000, // Another 3 Hours (+6h total): chick becomes Adult READY
  CLUTCH_MIN_SIZE: 3,
  CLUTCH_MAX_SIZE: 5,
  FOSTER_SAFE_MAX_CHICKS: 5,
  FOSTER_OVER_LIMIT_SURVIVAL_CHANCE: 0.5,
  BREEDING_COOLDOWN_MS: 0, // Parents can be paired immediately after a clutch
};
