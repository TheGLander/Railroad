import {
  GameState,
  LevelState,
  SolutionMetrics,
  calculateLevelPoints,
  createLevelFromData,
  Route as RouteFile,
  RouteFileInputProvider,
} from "@notcc/logic"
import { Level, getLevelSet } from "./levels.js"
import { Request, Router } from "express"
import { parseAuth } from "./users.js"
import { badRequest, unauthorized } from "@hapi/boom"
import { TinyWSRequest } from "tinyws"
import WebSocket from "ws"
import { LevelDoc, RouteSchema, RouteSubDoc, UserDoc } from "./schemata.js"
import { announceNewRouteSubmissions } from "./discord.js"

type ScoreMetrics = Omit<SolutionMetrics, "realTime">

interface ClientAddRouteMessage {
  type: "add route"
  routeId: string
  route: RouteFile
}

interface ClientRemoveRouteMessage {
  type: "remove route"
  routeId: string
}

interface ClientSubmitMessage {
  type: "submit"
  categories: Record<string, string>
}

type ClientMessage =
  | ClientAddRouteMessage
  | ClientRemoveRouteMessage
  | ClientSubmitMessage

interface ServerErrorMessage {
  type: "error"
  routeId?: string
  error: string
}

interface ServerProgressMessage {
  type: "validation progress"
  routeId: string
  progress: number
}

interface ServerLevelReportMessage {
  type: "level report"
  routeId: string
  metrics: ScoreMetrics
  boldMetrics: ScoreMetrics
}

interface ServerDoneMessage {
  type: "done"
}

type ServerMessage =
  | ServerErrorMessage
  | ServerProgressMessage
  | ServerLevelReportMessage
  | ServerDoneMessage

const BREATHE_INTERVAL = 100

async function runRoute(
  level: LevelState,
  route: RouteFile,
  breathe: (progress: number) => Promise<void>
): Promise<void> {
  const ip = new RouteFileInputProvider(route)
  ip.setupLevel(level)
  level.inputProvider = ip
  const routeLength = ip.moves.length * 3

  level.tick()
  level.tick()

  let breatheCounter = 0
  while (level.gameState === GameState.PLAYING) {
    level.tick()
    level.tick()
    level.tick()
    if (level.currentTick * 3 + level.subtick > routeLength) {
      break
    }
    breatheCounter += 1
    if (breatheCounter % BREATHE_INTERVAL === 0) {
      await breathe((level.currentTick * 3 + level.subtick) / routeLength)
    }
  }
}

const scriptNameToPackName: Record<string, string> = {
  "Chips Challenge": "cc1",
  "Chips Challenge 2": "cc2",
  "Chips Challenge 2 Level Pack 1": "cc2lp1",
}

export interface RouteSubmission {
  level: LevelDoc
  routeId: string
  route: RouteSchema
}

class RouteWsServer {
  submissions: RouteSubmission[] = []
  constructor(
    public ws: WebSocket,
    public user: UserDoc
  ) {
    ws.on("message", msgData => {
      try {
        let msg: ClientMessage
        try {
          const stringData = msgData.toString("utf-8")
          msg = JSON.parse(stringData)
        } catch {
          this.wsSend({ type: "error", error: "Invalid message format" })
          return
        }
        this.handleClientMessage(msg)
      } catch (err) {
        console.error(err)
        this.wsSend({ type: "error", error: "Internal error" })
      }
    })
  }
  handleClientMessage(msg: ClientMessage) {
    if (msg.type === "add route") {
      this.addRoute(msg)
    } else if (msg.type === "remove route") {
      this.removeRoute(msg)
    } else if (msg.type === "submit") {
      this.submitRoutes(msg)
    } else {
      this.wsSend({ type: "error", error: "Unknown message type" })
    }
  }
  wsSend(msg: ServerMessage) {
    this.ws.send(JSON.stringify(msg))
  }
  async addRoute(msg: ClientAddRouteMessage) {
    const { route, routeId } = msg

    if (this.submissions.some(sub => sub.routeId === routeId)) {
      this.wsSend({
        type: "error",
        error: `Submission with routeid "${routeId}" exists.`,
      })
      return
    }

    const sendLvlFindErr = () => {
      this.wsSend({
        type: "error",
        routeId,
        error: "Couldn't find level for route",
      })
    }
    const routeFor = route.For
    if (!routeFor?.Set || !routeFor?.LevelNumber) {
      sendLvlFindErr()
      return
    }
    const packName = scriptNameToPackName[routeFor.Set]
    if (!packName) {
      sendLvlFindErr()
      return
    }

    const levelDoc = await Level.findOne({
      levelN: routeFor.LevelNumber,
      setName: packName,
    })
    const levelSet = await getLevelSet(packName)
    const levelData = (await levelSet.goToLevel(routeFor.LevelNumber))
      ?.levelData
    if (!levelData || !levelDoc) {
      sendLvlFindErr()
      return
    }

    const level = createLevelFromData(levelData)

    await runRoute(level, route, async progress => {
      this.wsSend({ type: "validation progress", routeId, progress })
    })

    if (level.gameState !== GameState.WON) {
      this.wsSend({
        type: "error",
        routeId,
        error: "Route doesn't win the level",
      })
      return
    }

    const metrics: ScoreMetrics = {
      points: calculateLevelPoints(
        levelDoc.levelN!,
        Math.ceil(level.timeLeft / 60),
        level.bonusPoints
      ),
      timeLeft: Math.ceil(level.timeLeft / 60),
    }

    const nowDate = new Date()

    const routeDoc: RouteSchema = {
      moves: route,
      timeLeft: metrics.timeLeft,
      points: metrics.points,
      absoluteTime: (level.currentTick * 3 + level.subtick) / 60,
      submitter: this.user.id,
      createdAt: nowDate,
    }

    this.submissions.push({ route: routeDoc, routeId, level: levelDoc })

    this.wsSend({
      type: "level report",
      routeId,
      metrics,
      boldMetrics: {
        timeLeft: levelDoc.boldTime!,
        points: levelDoc.boldScore!,
      },
    })
  }
  removeRoute(msg: ClientRemoveRouteMessage) {
    const subIndex = this.submissions.findIndex(
      sub => sub.routeId === msg.routeId
    )
    if (subIndex === -1) {
      this.wsSend({
        type: "error",
        error: `Submission with routeid "${msg.routeId}" not found`,
      })
      return
    }
    this.submissions.splice(subIndex, 1)
  }
  async submitRoutes(msg: ClientSubmitMessage) {
    if (this.submissions.length === 0) {
      this.wsSend({
        type: "error",
        error: "No routes to submit",
      })
      return
    }
    let issuesRaised = false
    const mainlineSubmissionsBetterThan: Map<RouteSubmission, RouteSubDoc[]> =
      new Map()
    for (const sub of this.submissions) {
      const label = msg.categories[sub.routeId]
      if (!label) {
        this.wsSend({
          type: "error",
          routeId: sub.routeId,
          error: "Submission wasn't given a label",
        })
        issuesRaised = true
      }
      if (label === "mainline") {
        const mainlineTimeRoute = sub.level.mainlineTimeRoute
        const mainlineScoreRoute = sub.level.mainlineScoreRoute
        const betterThanTime =
          !mainlineTimeRoute ||
          mainlineTimeRoute.timeLeft! <= sub.route.timeLeft!
        const betterThanScore =
          !mainlineScoreRoute || mainlineScoreRoute.points! <= sub.route.points!

        if (!betterThanTime && !betterThanScore) {
          this.wsSend({
            type: "error",
            routeId: sub.routeId,
            error:
              "Submission tagged as mainline, but a better mainline route already exists. If your route showcases an alternate solution, tag it as non-mainline. If you think the current mainline solution should be tagged as non-mainline, raise the issue on the Discord server.",
          })
          issuesRaised = true
          continue
        }
        mainlineSubmissionsBetterThan.set(
          sub,
          [
            betterThanTime ? mainlineTimeRoute : null,
            betterThanScore ? mainlineScoreRoute : null,
          ].filter((route): route is RouteSubDoc => route !== null)
        )
      }
      sub.route.routeLabel = label
    }
    if (issuesRaised) return
    for (const sub of this.submissions) {
      sub.level.routes.push(sub.route)
    }
    await Level.bulkSave(this.submissions.map(sub => sub.level))
    await announceNewRouteSubmissions(
      this.submissions,
      this.user,
      mainlineSubmissionsBetterThan
    )
    this.wsSend({ type: "done" })
    this.submissions = []
  }
}

export const router = Router()

// @ts-expect-error We have the middleware loaded, so we'll always have WS here
router.get("/routes", async (req: Request & TinyWSRequest, res) => {
  if (!req.ws) {
    throw badRequest("Use Websockets")
  }
  const user = await parseAuth(req.headers.authorization)
  if (!user) {
    res.setHeader("WWW-Authenticate", "Basic")
    throw unauthorized("No authorization provided")
  }
  const ws = await req.ws()
  new RouteWsServer(ws, user)
})
