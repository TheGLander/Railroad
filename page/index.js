import { prismifyOnPage } from "https://unpkg.com/prismify@1.0.0/prismify.js"
prismifyOnPage()

const errorHandler = ev => {
  let error = ev instanceof ErrorEvent ? ev.error : ev.reason
  let errorString
  if (error instanceof Error) {
    errorString = `${error.name}: ${error.message}\nStack: ${error.stack}`
  } else {
    errorString = `Unknown error type: ${error}`
  }
  alert(
    `An error has occured! Please report it to G lander on the Discord server!\n${errorString}`
  )
}
window.addEventListener("error", errorHandler)
window.addEventListener("unhandledrejection", errorHandler)

import "./upload.js"
import "./routesList.js"

async function getTrivia() {
  const trivia = await (await fetch("./trivia")).json()
  const triviaBox = document.querySelector("#triviaText")
  triviaBox.innerHTML = `<p> There are <b>${trivia.userCount}</b> users who have uploaded a total of <b>${trivia.totalRoutes}</b> routes.</p>`
  for (const setTrivia of trivia.triviaBySet) {
    const isCC1 = setTrivia._id === "cc1"
    let setText = ""
    setText += `<p>${setTrivia._id.toUpperCase()}: `
    function metrics(time, score) {
      if (isCC1) return `<b>${score.toLocaleString()}</b>pts`
      return `<b>${time.toLocaleString()}</b>s / <b>${score.toLocaleString()}</b>pts`
    }

    setText += `There are <b>${
      setTrivia.boldTimes + (isCC1 ? 0 : setTrivia.boldScores)
    }</b> public bold routes`

    if (setTrivia.boldPlusTimes + setTrivia.boldPlusScores > 0) {
      setText += `, and even <b><i>${
        setTrivia.boldPlusTimes + (isCC1 ? 0 : setTrivia.boldPlusScores)
      }</i></b> routes that are better than bold! `
    } else {
      setText += `. `
    }

    if (!isCC1) {
      setText += `There are <b>${
        setTrivia.levelsN - setTrivia.bimetricRoutes - setTrivia.routelessLevels
      }</b> levels with different time and score routes. `
    }

    setText += `<b>${
      setTrivia.outdatedRoutes
    }</b> mainline routes have been replaced. Out of those, <b>${
      setTrivia.outdatedRedundantRoutes
    }</b> replacements didn't advance ${
      isCC1 ? "the total public score" : "public time or score"
    }.`

    setText += ` If one were to execute all public routes, they would have ${metrics(
      setTrivia.totalTime,
      setTrivia.totalScore
    )}. That's ${metrics(
      setTrivia.totalBoldTime - setTrivia.totalTime,
      setTrivia.totalBoldScore - setTrivia.totalScore
    )} off all bolds! `

    if (setTrivia.routelessLevels > 0) {
      setText += `There are still <b>${setTrivia.routelessLevels}</b> levels without any routes... Keep going, everyone! `
    }

    setText += "</p>"
    triviaBox.innerHTML += setText
  }
}

getTrivia()
