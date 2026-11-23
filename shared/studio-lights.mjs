// Missing shape and enabled fields are valid in drafts and handoffs made before
// spot and area lights existed. Normalize at every boundary that compares them.
export const lightLimit = 16
export function lightWithDefaults(light) {
  return {
    ...light,
    enabled: light.enabled ?? true,
    shape: light.shape ?? { type: 'point' },
  }
}

const downward = () => [-Math.SQRT1_2, 0, 0, Math.SQRT1_2]
export const lightKinds = Object.freeze({
  point: {
    label: '점광원',
    use: '전구처럼 사방으로',
    description: '등불이나 작은 소품 주변을 고르게 밝힙니다.',
    shape: () => ({ type: 'point' }),
  },
  spot: {
    label: '스포트라이트',
    use: '작품 한 곳에 집중',
    description: '작품에 빛을 모으고 경계의 부드러움을 조절합니다.',
    shape: () => ({
      type: 'spot',
      rotation: downward(),
      angle: 45,
      blend: 0.3,
    }),
  },
  area: {
    label: '면광원',
    use: '창처럼 넓게',
    description: '창이나 조명 패널처럼 넓은 면에서 빛을 보냅니다.',
    shape: () => ({ type: 'area', rotation: downward(), width: 3, height: 2 }),
  },
})
