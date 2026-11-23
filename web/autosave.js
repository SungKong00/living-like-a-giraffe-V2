// Saves the draft shortly after edits settle, one request at a time. A 409
// means another window saved first; saving stops so nothing is overwritten.
export class Autosave {
  #save
  #delay
  #onState
  #timer = null
  #running = null
  #again = false
  state = 'saved'
  error = null
  constructor({ save, delay = 700, onState = () => {} }) {
    this.#save = save
    this.#delay = delay
    this.#onState = onState
  }
  #set(state, error = null) {
    this.state = state
    this.error = error
    this.#onState(state, error)
  }
  schedule() {
    if (this.state === 'conflict') return
    clearTimeout(this.#timer)
    if (!this.#running) this.#set('pending')
    this.#timer = setTimeout(() => this.flush().catch(() => {}), this.#delay)
  }
  get busy() {
    return !!this.#running || this.#timer !== null
  }
  // Resolves after every edit made before the call has been stored.
  async flush() {
    clearTimeout(this.#timer)
    this.#timer = null
    if (this.state === 'conflict') throw Error(this.error)
    if (this.#running) {
      this.#again = true
      await this.#running
      if (this.state === 'error' || this.state === 'conflict')
        throw Error(this.error)
      return
    }
    this.#running = this.#loop()
    try {
      await this.#running
    } finally {
      this.#running = null
    }
    if (this.state !== 'saved') throw Error(this.error)
  }
  async #loop() {
    do {
      this.#again = false
      this.#set('saving')
      try {
        await this.#save()
      } catch (error) {
        if (error.status === 409)
          this.#set(
            'conflict',
            '다른 창에서 먼저 저장했습니다. 다시 열어 최신 초안을 확인하세요.',
          )
        else this.#set('error', error.message)
        return
      }
    } while (this.#again)
    this.#set('saved')
  }
}
