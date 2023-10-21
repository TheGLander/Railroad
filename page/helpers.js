export function makeMetricText(upload, metricName, metricSuffix) {
  const metric = upload.metrics[metricName]
  const boldMetric = upload.boldMetrics[metricName]
  let text = `${metric}${metricSuffix}`
  if (metric > boldMetric) {
    text += ` (b+${metric - boldMetric})`
  } else if (metric === boldMetric) {
    text += ` (b)`
  }
  const metricEl = document.createElement(metric >= boldMetric ? "b" : "span")
  metricEl.innerText = text
  return metricEl
}
