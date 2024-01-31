import { prismifyOnPage } from "https://unpkg.com/prismify@1.0.0/prismify.js"
prismifyOnPage()

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
      }</i></b> routes that are better than bold!`
    } else {
      setText += `.`
    }

    setText += ` If one were to execute all public routes, they would have ${metrics(
      setTrivia.totalTime,
      setTrivia.totalScore
    )}. That's ${metrics(
      setTrivia.totalBoldTime - setTrivia.totalTime,
      setTrivia.totalBoldScore - setTrivia.totalScore
    )} off all bolds! `

    setText += "</p>"
    triviaBox.innerHTML += setText
  }
}

getTrivia()
