function formatTime(time) {
  const timeSubticks = Math.round(time * 60)
  const subtick = timeSubticks % 3
  const tick = ((timeSubticks - subtick) / 3) % 20
  return `${Math.ceil(time)}.${
    subtick == 0 && tick === 0 ? 100 : (tick * 5).toString().padStart(2, "0")
  }${["", "⅓", "⅔"][subtick]}`
}

function formatTimeBoldImprovement(thisTime, boldTime) {
  return (Math.ceil(thisTime) - Math.ceil(boldTime)).toString()
}

const formatFuncs = {
  timeLeft: [formatTime, formatTimeBoldImprovement],
  points: [val => val, (thisTime, boldTime) => thisTime - boldTime],
}

export function makeMetricText(upload, metricName, metricSuffix) {
  const [format, formatBoldImprovement] = formatFuncs[metricName]
  const metric = upload.metrics[metricName]
  const boldMetric = upload.boldMetrics[metricName]
  let text = `${format(metric)}${metricSuffix}`
  if (Math.ceil(metric) > Math.ceil(boldMetric)) {
    text += ` (b+${formatBoldImprovement(metric, boldMetric)})`
  } else if (Math.ceil(metric) === Math.ceil(boldMetric)) {
    text += ` (b)`
  }
  const metricEl = document.createElement(text.includes("(b") ? "b" : "span")
  metricEl.innerText = text
  return metricEl
}
export function makeMetrics(upload, forCC1) {
  const el = document.createDocumentFragment()
  el.appendChild(makeMetricText(upload, "timeLeft", "s"))
  if (!forCC1) {
    el.appendChild(document.createTextNode(" / "))
    el.appendChild(makeMetricText(upload, "points", "pts"))
  }
  return el
}
