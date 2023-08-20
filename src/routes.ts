import {
  Direction,
  GameState,
  KeyInputs,
  LevelState,
  SolutionMetrics,
  calculateLevelPoints,
  createLevelFromData,
} from "@notcc/logic"
import { Level, getLevelSet } from "./levels.js"
import { Request, Router } from "express"
import { parseAuth } from "./users.js"
import { badRequest, unauthorized } from "@hapi/boom"
import { TinyWSRequest } from "tinyws"
import WebSocket from "ws"
import { LevelDoc, RouteSubDoc, UserDoc, routeSchema } from "./schemata.js"
import { model } from "mongoose"

interface RouteFor {
  Set?: string
  LevelName?: string
  LevelNumber?: number
}

interface RouteFile {
  Moves: string
  Rule: string
  Encode?: "UTF-8"
  "Initial Slide"?: Direction
  /**
   * Not the same as "Seed", as Blobmod only affects blobs and nothing else, unlilke the seed in TW, which affects all randomness
   */
  Blobmod?: number
  // Unused in CC2
  Step?: never
  Seed?: never
  // NotCC-invented metadata
  For?: RouteFor
  ExportApp?: string
}

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

function splitCharString(charString: string): string[] {
  return charString.split(/(?<![pcs])/)
}

const charToDir: Record<string, keyof KeyInputs> = {
  u: "up",
  r: "right",
  d: "down",
  l: "left",
}

function charToInput(char: string): KeyInputs {
  const input = {
    drop: char.includes("p"),
    rotateInv: char.includes("c"),
    switchPlayable: char.includes("s"),
    up: false,
    right: false,
    down: false,
    left: false,
  }
  const lastChar = char[char.length - 1]
  if (lastChar in charToDir) {
    input[charToDir[lastChar]] = true
  }
  return input
}

const BREATHE_INTERVAL = 100

async function runRoute(
  level: LevelState,
  route: RouteFile,
  breathe: (progress: number) => Promise<void>
): Promise<void> {
  const moves = splitCharString(route.Moves)
  level.randomForceFloorDirection = route["Initial Slide"] ?? Direction.UP
  level.blobPrngValue = route.Blobmod ?? 0x88

  level.tick()
  level.tick()

  let breatheCounter = 0
  for (const [moveN, moveChar] of Object.entries(moves)) {
    const inputs = charToInput(moveChar)
    level.gameInput = inputs
    level.tick()
    level.tick()
    level.tick()
    breatheCounter += 1
    if (breatheCounter % BREATHE_INTERVAL === 0) {
      await breathe(parseInt(moveN) / moves.length)
    }
  }
}

const scriptNameToPackName: Record<string, string> = {
  "Chips Challenge": "cc1",
  "Chips Challenge 2": "cc2",
  "Chips Challenge 2 Level Pack 1": "cc2lp1",
}

interface RouteSubmission {
  level: LevelDoc
  routeId: string
  route: RouteSubDoc
}

export function findMainlineRoutes(
  level: LevelDoc
): Record<"time" | "score", RouteSubDoc> | null {
  const time = level.routes.reduce<null | RouteSubDoc>(
    (acc, val) =>
      acc === null ||
      (val.timeLeft && acc.timeLeft && val.timeLeft > acc.timeLeft)
        ? (val as RouteSubDoc)
        : (acc as RouteSubDoc),
    null
  )
  const score = level.routes.reduce<null | RouteSubDoc>(
    (acc, val) =>
      acc === null || (val.points && acc.points && val.points > acc.points)
        ? (val as RouteSubDoc)
        : (acc as RouteSubDoc),
    null
  )
  return time === null || score === null ? null : { time, score }
}

class RouteWsServer {
  submissions: RouteSubmission[] = []
  constructor(public ws: WebSocket, public user: UserDoc) {
    ws.on("message", msgData => {
      const msg: ClientMessage = JSON.parse(msgData.toString("utf-8"))
      if (msg.type === "add route") {
        this.addRoute(msg)
      } else if (msg.type === "remove route") {
        this.removeRoute(msg)
      } else if (msg.type === "submit") {
        this.submitRoutes(msg)
      } else {
        this.wsSend({ type: "error", error: "Unknown message type" })
      }
    })
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

    const routeDoc: RouteSubDoc = {
      moves: {
        moves: route.Moves,
        randomForceFloorDirection: route["Initial Slide"],
        blobMod: route.Blobmod,
      },
      timeLeft: metrics.timeLeft,
      points: metrics.points,
      absoluteTime: (level.currentTick * 3 + level.subtick) / 60,
      submitter: this.user.id,
      createdAt: nowDate,
      updatedAt: nowDate,
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
        const mainlineRoutes = findMainlineRoutes(sub.level)
        if (
          mainlineRoutes &&
          mainlineRoutes.time.timeLeft! >= sub.route.timeLeft! &&
          mainlineRoutes.time.points! >= sub.route.points!
        ) {
          this.wsSend({
            type: "error",
            routeId: sub.routeId,
            error:
              "Submission tagged as mainline, but a better mainline route already exists. If your route showcases an alternate solution, tag it as non-mainline. If you think the current mainline solution should be tagged as non-mainline, raise the issue on the Discord server.",
          })
          issuesRaised = true
        }
      }
      sub.route.routeLabel = label
    }
    if (issuesRaised) return
    for (const sub of this.submissions) {
      sub.level.routes.push(sub.route)
    }
    await Level.bulkSave(this.submissions.map(sub => sub.level))
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
