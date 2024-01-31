import { Router } from "express"
import { User } from "./users.js"
import { stringify } from "./utils.js"
import { Level } from "./levels.js"
import { AccumulatorOperator, AnyExpression, ArrayExpression } from "mongoose"

export const router = Router()

function bestMainlineRoute(metric: string): AnyExpression {
  return {
    $max: {
      $map: {
        input: {
          $filter: {
            input: "$routes",
            cond: { $eq: ["$$this.routeLabel", "mainline"] },
          },
        },
        in: `$$this.${metric}`,
      },
    },
  }
}
function boolSum(input: ArrayExpression): AccumulatorOperator {
  return { $sum: { $cond: [input, 1, 0] } }
}

router.get("/trivia", async (req, res) => {
  const triviaBySet = await Level.aggregate()
    .project({
      routesN: { $size: "$routes" },
      mainlineTime: { $ceil: bestMainlineRoute("timeLeft") },
      boldTime: "$boldTime",
      boldScore: "$boldScore",
      mainlineScore: bestMainlineRoute("points"),
      setName: "$setName",
    })
    .addFields({
      isBoldTime: { $eq: ["$mainlineTime", "$boldTime"] },
      isBoldScore: { $eq: ["$mainlineScore", "$boldScore"] },
      isBPlusTime: { $gt: ["$mainlineTime", "$boldTime"] },
      isBPlusScore: { $gt: ["$mainlineScore", "$boldScore"] },
    })
    .group({
      _id: "$setName",
      routesN: { $sum: "$routesN" },
      totalTime: { $sum: "$mainlineTime" },
      totalScore: { $sum: "$mainlineScore" },
      totalBoldTime: { $sum: "$boldTime" },
      totalBoldScore: { $sum: "$boldScore" },
      boldTimes: boolSum("$isBoldTime"),
      boldScores: boolSum("$isBoldScore"),
      boldPlusTimes: boolSum("$isBPlusTime"),
      boldPlusScores: boolSum("$isBPlusScore"),
    })
    .sort("_id")
  const userCount = await User.count()
  const totalRoutes = triviaBySet.reduce((acc, val) => acc + val.routesN, 0)
  res.write(
    stringify({
      userCount,
      totalRoutes,
      triviaBySet,
    })
  )
  res.end()
})
