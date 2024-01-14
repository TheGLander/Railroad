import { LevelDoc, UserDoc, levelSchema } from "./schemata.js"
import { Query, model } from "mongoose"
import { readFile, readdir } from "fs/promises"
import path from "path"
import {
  LevelSet,
  LevelSetLoaderFunction,
  calculateLevelPoints,
} from "@notcc/logic"
import clone from "clone"
import { Request, Router } from "express"
import { notFound } from "@hapi/boom"
import { stringify } from "./utils.js"

interface ApiAttributes {
  rule_type: string
  metric: string
}

interface ApiPack {
  pack: string
  long_desc: string
  short_desc: string
  level_count: number
  valid_configs: ApiAttributes[]
}

interface ApiLevel {
  level: number
  name: string
  game: string
  pack: string
  designers: string
  adapted: boolean
  password: string | null
  time_limit: number
  chips_required: number
  total_chips: number
  chips_note: string
  wiki_article: string
  level_attribs: ApiLevelAttribute[]
}

interface ApiLevelAttribute extends ApiAttributes {
  attribs: {
    melinda: number
    highest_reported: number
    casual_diff: number
    exec_diff: number
    luck_diff: number
    routing_diff: number
  }
}

async function getPacks(): Promise<ApiPack[]> {
  const res = await fetch(`https://api.bitbusters.club/packs/`)
  return await res.json()
}

async function getPackLevels(pack: string): Promise<ApiLevel[]> {
  const res = await fetch(`https://api.bitbusters.club/packs/${pack}/levels`)
  return await res.json()
}

export const Level = model("Level", levelSchema)

function updateLevel(level: LevelDoc | null, apiLevel: ApiLevel): LevelDoc {
  const boldTime = apiLevel.level_attribs.find(
    attr => attr.rule_type === "steam" && attr.metric === "time"
  )?.attribs.highest_reported
  const boldScore =
    apiLevel.level_attribs.find(
      attr => attr.rule_type === "steam" && attr.metric === "score"
    )?.attribs.highest_reported ??
    calculateLevelPoints(apiLevel.level, boldTime!)

  if (level === null) {
    level = new Level({
      setName: apiLevel.pack.toLowerCase(),
      levelN: apiLevel.level,
      title: apiLevel.name,
      routes: [],
      boldTime,
      boldScore,
    })
  } else {
    level.boldTime = boldTime
    level.boldScore = boldScore
  }
  return level
}

async function updatePackLevels(pack: string): Promise<void> {
  const apiLevels = await getPackLevels(pack)
  const levels = await Level.find({
    setName: pack,
  })
  const newLevels: LevelDoc[] = []

  for (const apiLevel of apiLevels) {
    const level = levels.find(dbLevel => dbLevel.levelN === apiLevel.level)
    newLevels.push(updateLevel(level ?? null, apiLevel))
  }

  await Level.bulkSave(newLevels)
}

export async function updateLevelModel(): Promise<void> {
  console.info("Updating level models")
  const packs = (await getPacks())
    .filter(pack => pack.valid_configs.some(attr => attr.rule_type === "steam"))
    .map(pack => pack.pack)
  for (const pack of packs) {
    await updatePackLevels(pack)
  }
}

async function caseInsensitivePathJoin(
  basePath: string,
  extPath: string
): Promise<string> {
  const pathSegments = extPath.split("/")
  const truePathSegments: string[] = []
  for (const segment of pathSegments) {
    const dirPath = path.join(basePath, ...truePathSegments)
    const dirList = await readdir(dirPath)
    const trueSegment = dirList.find(
      ent => ent.toLowerCase() === segment.toLowerCase()
    )
    if (!trueSegment)
      throw new Error(`No directory "${segment}" in ${dirPath} found`)
    truePathSegments.push(trueSegment)
  }
  return path.join(basePath, ...truePathSegments)
}

function fsFileLoader(basePath: string): LevelSetLoaderFunction {
  return async (extPath, binary) => {
    const fullPath = await caseInsensitivePathJoin(basePath, extPath)
    if (!binary) return readFile(fullPath, "utf-8")
    const buf = await readFile(fullPath)
    return buf.buffer
  }
}

async function makeLevelSet(pack: string): Promise<LevelSet> {
  const packPath = path.join("levels", pack)
  const files = await readdir(packPath)
  const scriptFiles = files.filter(file => file.endsWith(".c2g")).sort()
  if (scriptFiles.length === 0) throw new Error("Couldn't find the script file")
  const set = await LevelSet.constructAsync(
    scriptFiles[0],
    fsFileLoader(packPath)
  )
  while (!set.inPostGame) {
    await set.getNextRecord()
    set.lastLevelResult = { type: "skip" }
    delete set.seenLevels[set.currentLevel].levelData
  }
  return set
}

const cachedSets: Record<string, LevelSet> = {}

export async function getLevelSet(pack: string): Promise<LevelSet> {
  let set = cachedSets[pack] ?? (await makeLevelSet(pack))
  if (!(pack in cachedSets)) {
    cachedSets[pack] = set
  }
  return clone(set)
}

export const router = Router()

router.get("/packs/:pack", async (req: Request<{ pack: string }>, res) => {
  let levelsQuery: Query<LevelDoc[], {}> = Level.find({
    setName: req.params.pack,
  })
    .sort({
      levelN: 1,
    })
    .populate("routes.submitter", "userName")

  if (req.query.noMoves !== undefined) {
    levelsQuery = levelsQuery.select("-routes.moves")
  }

  const levels = await levelsQuery

  if (levels.length === 0) throw notFound(`Pack "${req.params.pack}" not found`)
  const levelObjs = levels.map(level => {
    const levelObj: any = level.toJSON({ virtuals: true, versionKey: false })
    delete levelObj._id
    delete levelObj.id
    levelObj.mainlineTimeRoute = levelObj.mainlineTimeRoute?.id
    levelObj.mainlineScoreRoute = levelObj.mainlineScoreRoute?.id
    for (const route of levelObj.routes) {
      delete route._id
      if (route.moves) {
        delete route.moves.id
        delete route.moves._id
      }
      route.submitter = route.submitter.userName
    }
    return levelObj
  })

  res.contentType("application/json")
  res.write(stringify(levelObjs))
  res.end()
})

router.get(
  "/packs/:pack/:levelN",
  async (req: Request<{ pack: string; levelN: string }>, res) => {
    let levelQuery: Query<LevelDoc, {}> = Level.findOne({
      setName: req.params.pack,
      levelN: parseInt(req.params.levelN),
    }).populate("routes.submitter", "userName") as Query<LevelDoc, {}>

    if (req.query.noMoves !== undefined) {
      levelQuery = levelQuery.select("-routes.moves")
    }

    const level = await levelQuery
    if (!level)
      throw notFound(`Level ${req.params.pack} #${req.params.levelN} not found`)
    const levelObj: any = level.toJSON({ virtuals: true, versionKey: false })
    delete levelObj._id
    delete levelObj.id
    levelObj.mainlineTimeRoute = levelObj.mainlineTimeRoute?.id
    levelObj.mainlineScoreRoute = levelObj.mainlineScoreRoute?.id
    for (const route of levelObj.routes) {
      delete route._id
      if (route.moves) {
        delete route.moves.id
        delete route.moves._id
      }
      route.submitter = route.submitter.userName
    }

    res.contentType("application/json")
    res.write(stringify(levelObj))
    res.end()
  }
)
