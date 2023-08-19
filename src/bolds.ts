import { badImplementation, notFound } from "@hapi/boom"
import { Request, Router } from "express"
import { JSDOM } from "jsdom"
import { stringify } from "./utils.js"

// We're mocking the bb.club API for easy substitution

interface ApiPackLevel {
  level_attribs: ApiPackLevelAttribute[]
}

interface ApiPackLevelAttribute {
  rule_type: string
  metric: string
  attribs: ApiPackLevelAttributeAttribs
}

// Great name, I know
interface ApiPackLevelAttributeAttribs {
  highest_reported: number
  highest_confirmed: number
}

function makeAttributeAttribs(
  doc: Document,
  selector: string
): ApiPackLevelAttributeAttribs[] {
  const attribs: ApiPackLevelAttributeAttribs[] = []
  const rows = doc.querySelectorAll<HTMLTableRowElement>(
    `${selector} tbody > tr`
  )
  for (const row of rows) {
    if (row.children.length === 1) {
      // Lengthen the array and leave an empty item. Very silly, but it works!
      attribs.length += 1
      continue
    }
    const confirmedCell =
      row.querySelector<HTMLTableCellElement>("td:nth-child(2)")
    const unconfirmedCell =
      row.querySelector<HTMLTableCellElement>("td:nth-child(5)")
    if (!confirmedCell || !unconfirmedCell) throw new Error("Missing cells")

    let attrAttribs: ApiPackLevelAttributeAttribs = {
      highest_reported: 0,
      highest_confirmed: 0,
    }

    attrAttribs.highest_confirmed = parseInt(confirmedCell.innerHTML, 10)
    if (unconfirmedCell.innerHTML === "") {
      attrAttribs.highest_reported = attrAttribs.highest_confirmed
    } else {
      attrAttribs.highest_reported = parseInt(unconfirmedCell.innerHTML, 10)
    }
    attribs.push(attrAttribs)
  }
  return attribs
}

function makeAttributes(
  doc: Document,
  selector: string,
  ruleType: string,
  metric: string
): ApiPackLevelAttribute[] {
  return makeAttributeAttribs(doc, selector).map(attrAttribs => ({
    rule_type: ruleType,
    metric,
    attribs: attrAttribs,
  }))
}

export function getPackBestMetrics(pageSrc: string): ApiPackLevel[] {
  const page = new JSDOM(pageSrc)
  const doc = page.window.document
  const isCC1 = doc.querySelector("#ms") !== null
  let allAttribs: ApiPackLevelAttribute[][]
  if (isCC1) {
    allAttribs = [
      makeAttributes(doc, "#ms-levels", "ms", "time"),
      makeAttributes(doc, "#lynx-levels", "lynx", "time"),
      makeAttributes(doc, "#steam-levels", "steam", "time"),
    ]
  } else {
    allAttribs = [
      makeAttributes(doc, "#time-levels", "steam", "time"),
      makeAttributes(doc, "#score-levels", "steam", "score"),
    ]
  }
  // Imitiating Python's `zip` here...
  const levels: ApiPackLevel[] = []
  for (let levelN = 0; levelN < allAttribs[0].length; levelN += 1) {
    levels.push({
      level_attribs: allAttribs
        .map(attrs => attrs[levelN])
        .filter(attr => attr !== undefined),
    })
  }
  return levels
}

export const router = Router()

router.get("/bolds/:pack/", async (req: Request<{ pack: string }>, res) => {
  const packRes = await fetch(
    `https://scores.bitbusters.club/scores/${req.params.pack}`
  )
  if (packRes.status === 404)
    throw notFound(`Pack "${req.params.pack}" not found`)
  else if (!packRes.ok) throw badImplementation("Scores server unresponsive")

  const bolds = getPackBestMetrics(await packRes.text())
  res.contentType("application/json")
  res.send(stringify(bolds))
})
