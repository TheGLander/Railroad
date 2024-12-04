import {
  GameState,
  LevelState,
  SolutionMetrics,
  calculateLevelPoints,
  createLevelFromData,
  Route as RouteFile,
  RouteFileInputProvider,
  protobuf,
} from "@notcc/logic"
import { Level, getLevelSet } from "./levels.js"
import { Request, Router } from "express"
import { getUser, parseAuth, userFromToken } from "./users.js"
import { badRequest, unauthorized } from "@hapi/boom"
import { TinyWSRequest } from "tinyws"
import WebSocket from "ws"
import { LevelDoc, RouteSchema, RouteSubDoc, UserDoc } from "./schemata.js"
import { announceNewRouteSubmissions } from "./discord.js"
import { formatTime } from "./utils.js"

type ScoreMetrics = Omit<SolutionMetrics, "realTime">

interface ClientAuthentificateMessage {
  type: "authentificate"
  token: string
}

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
  | ClientAuthentificateMessage

interface ServerErrorMessage {
  type: "error"
  routeId?: string
  invalidatesRoute?: boolean
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
  glitches: string[]
}

interface ServerDoneMessage {
  type: "done"
}

interface ServerIdentifyConfirmedMessage {
  type: "identity confirmed"
}

type ServerMessage =
  | ServerErrorMessage
  | ServerIdentifyConfirmedMessage
  | ServerProgressMessage
  | ServerLevelReportMessage
  | ServerDoneMessage

const BREATHE_INTERVAL = 100

const KnownGlitches = protobuf.GlitchInfo.KnownGlitches

const NONLEGAL_GLITCHES: Partial<
  Record<protobuf.GlitchInfo.KnownGlitches, string>
> = {
  [KnownGlitches.SIMULTANEOUS_CHARACTER_MOVEMENT]:
    "Simultaneous character movement",
  [KnownGlitches.DYNAMITE_EXPLOSION_SNEAKING]: "Dynamite explosion sneaking",
}

export function getNonlegalGlitches(level: LevelState): string[] {
  return level.glitches
    .filter(glitch => glitch.glitchKind! in NONLEGAL_GLITCHES)
    .map(glitch => NONLEGAL_GLITCHES[glitch.glitchKind!]!)
    .filter((val, i, arr) => arr.indexOf(val) === i)
}

export async function runRoute(
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
export type RouteSubmissionPostFactum =
  | Omit<RouteSubmission, "route">
  | { route: RouteSubDoc }

class RouteWsServer {
  submissions: RouteSubmission[] = []
  user: UserDoc | null = null
  constructor(public ws: WebSocket) {
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
    if (msg.type === "authentificate") {
      this.authentificateUser(msg)
    } else if (!this.user) {
      this.wsSend({
        type: "error",
        error: "Must be authentificated to upload routes",
      })
    } else if (msg.type === "add route") {
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
  async authentificateUser(msg: ClientAuthentificateMessage) {
    const user = await userFromToken(msg.token ?? "")
    if (!user) {
      this.wsSend({ type: "error", error: "Invalid user token" })
      return
    }
    this.user = user
    this.wsSend({ type: "identity confirmed" })
  }
  async addRoute(msg: ClientAddRouteMessage) {
    if (!this.user) return
    const { route, routeId } = msg

    if (this.submissions.some(sub => sub.routeId === routeId)) {
      this.wsSend({
        type: "error",
        error: `Submission with routeid "${routeId}" exists.`,
      })
      return
    }

    const sendLvlFindErr = (err: string) => {
      this.wsSend({
        type: "error",
        routeId,
        error: `Couldn't find level for route: ${err}`,
        invalidatesRoute: true,
      })
    }
    const routeFor = route.For
    if (!routeFor) {
      sendLvlFindErr(
        "Route lacks `For` field. Routes uploaded to Railroad should be exported from ExaCC with the appropriate level set open."
      )
    }
    if (!routeFor?.Set || !routeFor?.LevelNumber) {
      sendLvlFindErr(
        "Route lacks `For.Set`/`For.LevelNumber` fields. This may happen if you opened a level in ExaCC instead of the set."
      )
      return
    }
    const packName = scriptNameToPackName[routeFor.Set]
    if (!packName) {
      sendLvlFindErr(`Unknown set "${routeFor.Set}"`)
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
      sendLvlFindErr(`Failed to find level`)
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
        invalidatesRoute: true,
      })
      return
    }
    const glitches = getNonlegalGlitches(level)

    const metrics: ScoreMetrics = {
      points: calculateLevelPoints(
        levelDoc.levelN!,
        Math.ceil(level.timeLeft / 60),
        level.bonusPoints
      ),
      timeLeft: level.timeLeft / 60,
    }
    const disallowedScore =
      levelDoc.disallowedScore && metrics.points >= levelDoc.disallowedScore
    const disallowedTime =
      levelDoc.disallowedTime && metrics.timeLeft >= levelDoc.disallowedTime

    if (disallowedScore || disallowedTime) {
      const disallowedMetric = disallowedScore
        ? `${levelDoc.disallowedScore}pts`
        : `${formatTime(levelDoc.disallowedTime!)}s`
      const thisMetric = disallowedScore
        ? `${metrics.points}pts`
        : `${formatTime(metrics.timeLeft)}s`
      this.wsSend({
        type: "error",
        routeId,
        error: `This route has a ${disallowedScore ? "score" : "time"} of ${thisMetric}, which is equal to or higher than ${disallowedMetric}. This limit is in place to preserve the competition of the game. If you believe this route should be public, ask about it in #optimization in the Chip's Challege Bit Busters Club Discord Server`,
        invalidatesRoute: true,
      })
      return
    }

    const nowDate = new Date()

    const routeDoc: RouteSchema = {
      moves: route,
      timeLeft: metrics.timeLeft,
      points: metrics.points,
      absoluteTime: (level.currentTick * 3 + level.subtick) / 60,
      submitter: this.user.id,
      createdAt: nowDate,
      glitches,
      isMainline: glitches.length === 0,
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
      glitches,
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
    if (!this.user) return
    if (this.submissions.length === 0) {
      this.wsSend({
        type: "error",
        error: "No routes to submit",
      })
      return
    }
    let issuesRaised = false
    for (const sub of this.submissions) {
      let label: string | undefined = msg.categories[sub.routeId]
      if (!label || label.trim() === "") {
        label = undefined
      }
      const mainlineTimeRoute = sub.level.mainlineTimeRoute
      const mainlineScoreRoute = sub.level.mainlineScoreRoute
      const betterThanTime =
        !mainlineTimeRoute || mainlineTimeRoute.timeLeft! <= sub.route.timeLeft!
      const betterThanScore =
        !mainlineScoreRoute || mainlineScoreRoute.points! <= sub.route.points!

      // Routes without a label should be better than the mainline route and not have glitches
      if (!label) {
        if (!sub.route.isMainline) {
          this.wsSend({
            type: "error",
            routeId: sub.routeId,
            error: "Submissions with non-legal glitches must have a label.",
          })
          issuesRaised = true
          continue
        }
        if (!betterThanTime && !betterThanScore) {
          this.wsSend({
            type: "error",
            routeId: sub.routeId,
            error:
              "Submission was not given a label, but a better route already exists. If your route showcases an alternate solution, give it a label describing what's different about it.",
          })
          issuesRaised = true
          continue
        }
      }
      sub.route.routeLabel = label
    }
    if (issuesRaised) return
    for (const sub of this.submissions) {
      sub.level.routes.push(sub.route)
    }
    await Level.bulkSave(this.submissions.map(sub => sub.level))
    await announceNewRouteSubmissions(this.submissions, this.user)
    this.wsSend({ type: "done" })
  }
}

export const router = Router()

// @ts-expect-error We have the middleware loaded, so we'll always have WS here
router.get("/routes", async (req: Request & TinyWSRequest, res) => {
  if (!req.ws) {
    throw badRequest("Use Websockets")
  }
  const ws = await req.ws()
  new RouteWsServer(ws)
})
