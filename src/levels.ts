import { LevelDoc, levelSchema } from "./schemata.js"
import { model } from "mongoose"
import { readFile, readdir } from "fs/promises"
import path from "path"
import { LevelSet, LevelSetLoaderFunction } from "@notcc/logic"
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
  const boldScore = apiLevel.level_attribs.find(
    attr => attr.rule_type === "steam" && attr.metric === "score"
  )?.attribs.highest_reported

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

function fsFileLoader(basePath: string): LevelSetLoaderFunction {
  return async (extPath, binary) => {
    const fullPath = path.join(basePath, extPath)
    if (!binary) return readFile(fullPath, "utf-8")
    const buf = await readFile(fullPath)
    return buf.buffer
  }
}

async function makeLevelSet(pack: string): Promise<LevelSet> {
  const packPath = path.join("levels", pack)
  const files = await readdir(packPath)
  const scriptFiles = files.filter(file => file.endsWith(".c2g"))
  if (scriptFiles.length !== 1) throw new Error("Couldn't find the script file")
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
  const levels = await Level.find({
    setName: req.params.pack,
  }).sort({
    levelN: 1,
  })
  if (levels.length === 0) throw notFound(`Pack "${req.params.pack}" not found`)
  const levelObjs = levels.map(level => {
    const levelObj = level.toJSON()
    // @ts-expect-error Don't really care to make a new type where _id is optional
    delete levelObj._id
    return levelObj
  })

  res.contentType("application/json")
  res.write(stringify(levelObjs))
  res.end()
})
