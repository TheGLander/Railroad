/**
 * JSON.stringify, but good
 */
export function stringify(obj: any): string {
  return JSON.stringify(obj, (_k, v) => v, 2)
}

export function extraTicksFromCeilTime(time: number) {
  return Math.round(((time - 0.05) % 1) * 60) / 3
}

export function formatTime(time: number): string {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const tick = ((timeSubticks - subtick) / 3) % 20
  return `${Math.ceil(time)}.${
    subtick == 0 && tick === 0 ? 100 : (tick * 5).toString().padStart(2, "0")
  }${["", "⅓", "⅔"][subtick]}`
}

export function formatTimeImprovement(time: number): string {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const timeClean = (timeSubticks - subtick) / 60
  return `${timeClean.toFixed(2)}${["", "⅓", "⅔"][subtick]}`
}
