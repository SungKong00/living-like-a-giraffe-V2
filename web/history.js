export class EditHistory {
  #value
  #undo = []
  #redo = []
  constructor(initial) {
    this.#value = structuredClone(initial)
  }
  get value() {
    return structuredClone(this.#value)
  }
  change(edit) {
    const next = this.value
    edit(next)
    if (JSON.stringify(next) === JSON.stringify(this.#value)) return
    this.#undo.push(this.#value)
    if (this.#undo.length > 80) this.#undo.shift()
    this.#value = next
    this.#redo = []
  }
  undo() {
    if (this.#undo.length) {
      this.#redo.push(this.#value)
      this.#value = this.#undo.pop()
    }
  }
  redo() {
    if (this.#redo.length) {
      this.#undo.push(this.#value)
      this.#value = this.#redo.pop()
    }
  }
}
