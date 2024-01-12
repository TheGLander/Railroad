import { makeMetricText, makeMetrics } from "./helpers.js"
import { getAuthInfo, makeAuthHeader } from "./user.js"

function filePrompt() {
  return new Promise((res, rej) => {
    const input = document.createElement("input")
    input.type = "file"
    input.multiple = true
    input.accept = ".route"
    input.click()
    input.addEventListener("input", () => {
      const files = input.files
      if (!files || files.length === 0) {
        rej(new Error("No file given"))
        return
      }
      res(files)
    })
  })
}

uploadRouteButton.addEventListener("click", async () => {
  const files = await filePrompt()
  for (const file of files) {
    const route = JSON.parse(await file.text())
    await uploadRoute(route)
  }
})

document.body.addEventListener("dragover", ev => {
  ev.preventDefault()
  ev.dataTransfer.dropEffect = "copy"
})

document.body.addEventListener("drop", async ev => {
  ev.preventDefault()
  const files = ev.dataTransfer.files
  for (const file of files) {
    const route = JSON.parse(await file.text())
    await uploadRoute(route)
  }
})

let ws = null

function getWs() {
  if (ws === null || ws.readyState === ws.CLOSED) {
    const url = new URL(location.href)
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:"
    url.hash = ""
    url.pathname += "routes"
    const authInfo = getAuthInfo()
    url.username = authInfo.username
    url.password = authInfo.password
    ws = new WebSocket(url)
    ws.addEventListener("message", wsMessageHandler)
    ws.addEventListener("close", wsCloseHandler)
    return new Promise((res, rej) => {
      ws.addEventListener("open", () => res(ws))
      ws.addEventListener("error", rej)
    })
  }
  return Promise.resolve(ws)
}

function wsSend(ws, msg) {
  ws.send(JSON.stringify(msg))
}

const uploads = []
const uploadList = uploadZone.querySelector("tbody")

function wsMessageHandler(rawMsg) {
  const msg = JSON.parse(rawMsg.data)
  let route = null
  if (msg.routeId) {
    route = uploads.find(upload => upload.routeId === msg.routeId)
  }
  if (msg.type === "error") {
    if (route) {
      route.errorMsg = msg.error
    } else {
      alert(`Server error!\n${msg.error}`)
    }
  } else if (msg.type === "validation progress") {
    if (!route) return
    route.progress = msg.progress
  } else if (msg.type === "level report") {
    if (!route) return
    route.progress = 1
    route.metrics = msg.metrics
    route.boldMetrics = msg.boldMetrics
  } else if (msg.type === "done") {
    uploads.length = 0
    alert("Done!")
  }
  rebuildRoutes()
}

function wsCloseHandler() {
  if (uploads.length > 0) {
    alert(`Server disconnected! You'll have to upload the routes again...`)
    uploads.length = 0
    rebuildRoutes()
  }
}

function rebuildRoute(upload) {
  const route = upload.route
  const row = document.createElement("tr")

  const levelName = document.createElement("th")
  levelName.scope = "row"
  levelName.innerText = `${route.For.Set} #${route.For.LevelNumber}: ${route.For.LevelName}`
  row.appendChild(levelName)

  const metrics = document.createElement("td")
  if (upload.progress < 1) {
    const validateProgress = document.createElement("progress")
    validateProgress.min = 0
    validateProgress.max = 1
    validateProgress.value = upload.progress
    metrics.appendChild(validateProgress)
  } else if (upload.metrics) {
    metrics.appendChild(
      makeMetrics(upload, route.For.Set === "Chips Challenge")
    )
  } else {
    metrics.appendChild(document.createTextNode("???"))
  }
  if (upload.errorMsg) {
    if (upload.progress === 0) {
      metrics.children[0].remove()
    }
    const errDiv = document.createElement("div")
    errDiv.innerText = `ERROR! ${upload.errorMsg}`
    metrics.appendChild(errDiv)
  }
  row.appendChild(metrics)

  const category = document.createElement("td")

  const categoryInput = document.createElement("input")
  categoryInput.value = upload.category
  categoryInput.disabled = upload.mainline
  categoryInput.addEventListener("input", () => {
    upload.category = categoryInput.value
  })

  const mainlineLabel = document.createElement("label")
  mainlineLabel.innerText = "Mainline?"

  const mainlineTick = document.createElement("input")
  mainlineTick.type = "checkbox"
  mainlineTick.checked = upload.mainline
  mainlineTick.addEventListener("input", () => {
    upload.mainline = mainlineTick.checked
    categoryInput.disabled = upload.mainline
  })
  mainlineLabel.appendChild(mainlineTick)

  category.appendChild(mainlineLabel)
  category.appendChild(document.createElement("br"))
  category.appendChild(categoryInput)
  row.appendChild(category)

  const rmButton = document.createElement("button")
  rmButton.innerText = "❌"
  rmButton.addEventListener("click", async () => {
    wsSend(await getWs(), { type: "remove route", routeId: upload.routeId })
    uploads.splice(uploads.indexOf(upload), 1)
    rebuildRoutes()
  })
  const rmCell = document.createElement("td")
  rmCell.appendChild(rmButton)
  row.appendChild(rmCell)

  uploadList.appendChild(row)
}

function rebuildRoutes() {
  for (const child of Array.from(uploadList.children)) {
    child.remove()
  }
  for (const upload of uploads) {
    rebuildRoute(upload)
  }
  moreRoutesText.classList.toggle("shown", uploadList.children.length > 1)
  submitRoutesButton.disabled = !uploads.every(
    upload => upload.progress === 1 && !upload.errorMsg
  )
}

let routeN = 0

async function uploadRoute(route) {
  if (!document.body.hasAttribute("data-logged-in")) return
  const ws = await getWs()
  const routeId = routeN.toString()
  routeN += 1
  wsSend(ws, { type: "add route", route, routeId })
  uploads.push({
    routeId,
    route,
    progress: 0,
    mainline: true,
    category: "",
  })
  rebuildRoutes()
}

submitRoutesButton.disabled = true
submitRoutesButton.addEventListener("click", submitRoutes)

async function submitRoutes() {
  const ws = await getWs()
  const categories = {}
  for (const upload of uploads) {
    categories[upload.routeId] = upload.mainline ? "mainline" : upload.category
  }
  wsSend(ws, { type: "submit", categories })
}
