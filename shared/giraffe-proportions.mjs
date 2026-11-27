// Ratios relative to the model published by the character artist.
export const giraffeDimensions = Object.freeze({
  neck: { label: '목 길이', min: 0.75, max: 1.4 },
  head: { label: '머리 크기', min: 0.75, max: 1.3 },
  legs: { label: '다리 길이', min: 0.75, max: 1.3 },
  body: { label: '몸통 크기', min: 0.7, max: 1.4 },
  ears: { label: '귀 크기', min: 0.7, max: 1.4, joints: ['Ear.L', 'Ear.R'] },
  muzzle: { label: '주둥이 길이', min: 0.75, max: 1.35, joints: ['Muzzle'] },
})
