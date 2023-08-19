import { LevelDoc, levelSchema } from "./schemata.js"
import { model } from "mongoose"

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

const Level = model("Level", levelSchema)

function updateLevel(level: LevelDoc | null, apiLevel: ApiLevel): LevelDoc {
  const boldTime = apiLevel.level_attribs.find(
    attr => attr.rule_type === "steam" && attr.metric === "time"
  )?.attribs.highest_reported
  const boldScore = apiLevel.level_attribs.find(
    attr => attr.rule_type === "steam" && attr.metric === "score"
  )?.attribs.highest_reported

  if (level === null) {
    level = new Level({
      setName: apiLevel.pack,
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
