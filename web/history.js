// Each entry keeps an optional `context` (the studio passes its selection) so
// undo and redo can bring back what the editor was looking at.
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
  /** Records `edit`; `context` is what undo will hand back. */
  change(edit, context) {
    const next = this.value
    edit(next)
    if (JSON.stringify(next) === JSON.stringify(this.#value)) return
    this.#undo.push({ value: this.#value, context })
    if (this.#undo.length > 80) this.#undo.shift()
    this.#value = next
    this.#redo = []
  }
  get canUndo() {
    return this.#undo.length > 0
  }
  get canRedo() {
    return this.#redo.length > 0
  }
  /** Returns the context recorded before the undone edit. */
  undo(context) {
    const entry = this.#undo.pop()
    if (!entry) return undefined
    this.#redo.push({ value: this.#value, context })
    this.#value = entry.value
    return entry.context
  }
  /** Returns the context that was current when the edit was undone. */
  redo(context) {
    const entry = this.#redo.pop()
    if (!entry) return undefined
    this.#undo.push({ value: this.#value, context })
    this.#value = entry.value
    return entry.context
  }
}
