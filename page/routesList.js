import { makeMetricText, makeMetrics } from "./helpers.js"

routesListSelector.addEventListener("input", () => {
  updateRoutesTable()
})

const routesList = routesListTable.querySelector("tbody")

async function scrollIntoLevelRoute(id) {
  const setName = id.split("-")[0]
  routesListSelector.value = setName
  await updateRoutesTable()
  const routeRow = document.getElementById(id)
  routeRow.scrollIntoView()
}

let currentToken = Symbol()

async function updateRoutesTable() {
  const token = Symbol()
  currentToken = token
  const setName = routesListSelector.value
  routesList.innerText = ""
  routesListTable.classList.toggle("shown", setName !== "")
  if (setName === "") return
  const res = await (await fetch(`./packs/${setName}?noMoves`)).json()
  // If `updateRoutesTable` was called while we were fetching stuff, stop this outdated attempt
  if (token !== currentToken) return
  displayRoutesTable(res)
}

function sortRoutes(routes, mainTimeRouteId, mainScoreRouteId) {
  function boolSort(func) {
    return (a, b) => (func(a) ? 1 : 0) - (func(b) ? 1 : 0)
  }
  return routes
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createAt))
    .sort(boolSort(r => !r.routeLabel))
    .sort(boolSort(r => r.isMainline))
    .sort(boolSort(r => r.id === mainScoreRouteId))
    .sort(boolSort(r => r.id === mainTimeRouteId))
    .reverse()
}

function downloadFile(fileData, name) {
  const blob = new Blob([fileData], { type: "application/octet-stream" })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement("a")
  anchor.download = name
  anchor.href = url
  anchor.click()
  anchor.remove()
  URL.revokeObjectURL(url)
}

function makeLevelsRows(level) {
  const levelTh = document.createElement("th")
  const levelAnchor = document.createElement("a")
  levelAnchor.innerText = `${level.setName.toUpperCase()} #${level.levelN}: ${
    level.title
  }`
  levelAnchor.href = `https://scores.bitbusters.club/levels/${level.setName}/${level.levelN}`
  if (level.setName === "cc1") {
    levelAnchor.href += "/steam"
  }
  levelTh.appendChild(levelAnchor)
  levelTh.scope = "row"
  levelTh.rowSpan = level.routes.length
  const pastMainlineCount = level.routes.reduce(
    (acc, val) =>
      acc +
      (val.isMainline &&
      !(
        val.id === level.mainlineScoreRoute ||
        val.id === level.mainlineTimeRoute ||
        val.routeLabel
      )
        ? 1
        : 0),
    0
  )

  const rows = document.createDocumentFragment()

  let firstRow = true
  let firstPastMainline = true

  for (const route of sortRoutes(
    level.routes,
    level.mainlineTimeRoute,
    level.mainlineScoreRoute
  )) {
    const row = document.createElement("tr")
    row.id = `${level.setName}-${route.id}`
    if (firstRow) {
      row.appendChild(levelTh)
    }
    firstRow = false
    const isBestTime = route.id === level.mainlineTimeRoute
    const isBestScore = route.id === level.mainlineScoreRoute
    if (isBestTime || isBestScore) {
      row.classList.add("mainline")
    } else if (!route.routeLabel) {
      row.classList.add("mainline-old")
    } else {
      row.classList.add("misc")
    }
    let categoryText = route.routeLabel ?? "normal"
    if (!route.isMainline) {
      categoryText += " (non-mainline)"
    }
    if (isBestTime && isBestScore) {
    } else if (isBestTime) {
      categoryText += " (best time)"
    } else if (isBestScore) {
      categoryText += " (best score)"
    } else if (!route.routeLabel) {
      categoryText += " (outdated)"
    }
    const categoryTd = document.createElement("td")
    categoryTd.innerText = categoryText
    row.appendChild(categoryTd)

    if (!route.routeLabel && !(isBestTime || isBestScore)) {
      if (firstPastMainline) {
        firstPastMainline = false
        categoryTd.rowSpan = pastMainlineCount
      } else {
        categoryTd.remove()
      }
    }
    const metricsTd = document.createElement("td")
    const mockUpload = {
      metrics: {
        timeLeft: route.timeLeft,
        points: route.points,
      },
      boldMetrics: { timeLeft: level.boldTime, points: level.boldScore },
    }
    metricsTd.appendChild(makeMetrics(mockUpload, level.setName === "cc1"))
    row.appendChild(metricsTd)
    const submitterTd = document.createElement("td")
    submitterTd.innerText = route.submitter
    row.appendChild(submitterTd)
    const uploadTimeTd = document.createElement("td")
    uploadTimeTd.innerText = new Date(route.createdAt).toUTCString()
    row.appendChild(uploadTimeTd)

    const playTd = document.createElement("td")
    const notccLink = document.createElement("a")
    notccLink.href = `https://glander.club/notcc/#/exa/${level.setName}/${level.levelN}?load-solution=railroad-${route.id}`
    notccLink.innerText = "Open in ExaCC"
    notccLink.target = "_blank"
    playTd.appendChild(notccLink)
    playTd.appendChild(document.createElement("br"))
    const downloadButton = document.createElement("button")
    downloadButton.addEventListener("click", async () => {
      const fullLevelRoutes = await (
        await fetch(`./packs/${level.setName}/${level.levelN}`)
      ).json()
      const fullRoute = fullLevelRoutes.routes.find(
        fullRoute => fullRoute.id === route.id
      )
      const routeStr = JSON.stringify(fullRoute.moves)
      const routeBin = new TextEncoder().encode(routeStr)
      downloadFile(routeBin, `Railroad-${level.title}.route`)
    })
    downloadButton.innerText = "Download"
    playTd.appendChild(downloadButton)
    row.appendChild(playTd)
    rows.appendChild(row)
  }
  return rows
}

function displayRoutesTable(levels) {
  for (const level of levels) {
    routesList.appendChild(makeLevelsRows(level))
  }
}

if (location.hash !== "") {
  scrollIntoLevelRoute(location.hash.slice(1)).catch(() => updateRoutesTable())
} else {
  updateRoutesTable()
}
