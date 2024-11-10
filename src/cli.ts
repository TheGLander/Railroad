#!/usr/bin/env node
import * as dotenv from "dotenv"
dotenv.config()

import arg from "arg"
import { Level, getLevelSet, updateLevelModel } from "./levels.js"
import { connect } from "mongoose"
import { RouteSubDoc } from "./schemata.js"
import {
  LevelData,
  Route,
  calculateLevelPoints,
  createLevelFromData,
} from "@notcc/logic"
import { getNonlegalGlitches, runRoute } from "./routes.js"

async function refreshBolds() {
  await connect(process.env.MONGODB_LINK!)

  await updateLevelModel()
}

async function verifyRoute(
  levelN: number,
  levelData: LevelData,
  route: RouteSubDoc
) {
  const level = createLevelFromData(levelData)
  await runRoute(level, route.moves! as Route, async () => {})
  route.timeLeft = level.timeLeft / 60
  route.points = calculateLevelPoints(
    levelN,
    Math.ceil(level.timeLeft / 60),
    level.bonusPoints
  )
  route.glitches = getNonlegalGlitches(level)
  route.isMainline = route.glitches.length === 0
}

async function verifyLevelRoutes() {
  await connect(process.env.MONGODB_LINK!)

  const levels = await Level.find({})
  let levelN = 0
  for (const level of levels) {
    levelN += 1
    console.log(
      `[${levelN}/${levels.length}] Rerunning routes for ${level.setName} #${level.levelN}: ${level.title} `
    )
    const set = await getLevelSet(level.setName!)
    const levelData = (await set.goToLevel(level.levelN!))!.levelData!
    for (const route of level.routes) {
      await verifyRoute(level.levelN!, levelData, route)
    }
    await level.save()
  }
}

const args = arg({
  "--refresh-bolds": Boolean,
  "--verify-level-routes": Boolean,
})

if (args["--refresh-bolds"]) {
  await refreshBolds()
} else if (args["--verify-level-routes"]) {
  await verifyLevelRoutes()
}
process.exit(0)
