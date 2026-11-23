import { PostProcess } from '@babylonjs/core/PostProcesses/postProcess'
import { ShaderStore } from '@babylonjs/core/Engines/shaderStore'
import { Texture } from '@babylonjs/core/Materials/Textures/texture'

ShaderStore.ShadersStore.riragiWobblePixelShader = `uniform float amount;
uniform sampler2D textureSampler;
    uniform vec2 resolution;
    uniform float frame;
    varying vec2 vUV;

    float randomValue(vec2 p) {
      return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
    }

    float smoothNoise(vec2 p) {
      vec2 cell = floor(p);
      vec2 f = fract(p);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(randomValue(cell), randomValue(cell + vec2(1.0, 0.0)), f.x),
        mix(randomValue(cell + vec2(0.0, 1.0)), randomValue(cell + vec2(1.0, 1.0)), f.x), f.y);
    }

    void main() {
      vec2 p = vUV * vec2(resolution.x / resolution.y, 1.0) * 48.0;
      vec2 frameShift = vec2(
        randomValue(vec2(frame, 11.71)),
        randomValue(vec2(frame, 19.19))
      ) * 100.0;
      vec2 noise = vec2(smoothNoise(p + frameShift),
        smoothNoise(p + vec2(41.0) - frameShift.yx));
      vec2 offset = (noise * 2.0 - 1.0) * amount / resolution;
      gl_FragColor = texture2D(textureSampler, clamp(vUV + offset, vec2(0.0), vec2(1.0)));
    }`

export function screenWobble(camera, clock) {
  const pass = new PostProcess(
    'v1 화면 일렁임',
    'riragiWobble',
    ['resolution', 'frame', 'amount'],
    null,
    1,
    camera,
    Texture.BILINEAR_SAMPLINGMODE,
  )
  pass.adaptScaleToCurrentViewport = true
  pass.onApply = (effect) => {
    const canvas = camera.getScene().getEngine().getRenderingCanvas()
    effect.setFloat2(
      'resolution',
      canvas.clientWidth * camera.viewport.width,
      canvas.clientHeight * camera.viewport.height,
    )
    effect.setFloat('frame', clock.frame)
    effect.setFloat('amount', clock.screen)
  }
  return pass
}
