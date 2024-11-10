import { Router } from "express"
import { User } from "./users.js"
import { stringify } from "./utils.js"
import { Level } from "./levels.js"
import { AccumulatorOperator, AnyExpression, ArrayExpression } from "mongoose"

export const router = Router()

function bestMainlineRoute(metric: string): AnyExpression {
  return {
    $reduce: {
      input: {
        $filter: {
          input: "$routes",
          cond: "$$this.isMainline",
        },
      },
      initialValue: null,
      in: {
        $cond: [
          { $gte: [`$$this.${metric}`, `$$value.${metric}`] },
          "$$this",
          "$$value",
        ],
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
      routes: "$routes",
      mainlineTimeRoute: bestMainlineRoute("timeLeft"),
      boldTime: "$boldTime",
      boldScore: "$boldScore",
      mainlineScoreRoute: bestMainlineRoute("points"),
      setName: "$setName",
    })
    .addFields({
      isBoldTime: {
        $eq: [{ $ceil: "$mainlineTimeRoute.timeLeft" }, "$boldTime"],
      },
      isBoldScore: { $eq: ["$mainlineScoreRoute.points", "$boldScore"] },
      isBPlusTime: {
        $gt: [{ $ceil: "$mainlineTimeRoute.timeLeft" }, "$boldTime"],
      },
      isBPlusScore: { $gt: ["$mainlineScoreRoute.points", "$boldScore"] },
      isMainlineBimetric: {
        $and: [
          { $ne: ["$mainlineTimeRoute", null] },
          {
            $eq: ["$mainlineScoreRoute._id", "$mainlineTimeRoute._id"],
          },
        ],
      },
      isRouteless: { $eq: ["$mainlineTimeRoute", null] },
      outdatedRoutes: {
        $filter: {
          input: "$routes",
          cond: {
            $and: [
              { $eq: [{ $type: ["$$this.routeLabel"] }, "missing"] },
              { $ne: ["$$this._id", "$mainlineScoreRoute._id"] },
              { $ne: ["$$this._id", "$mainlineTimeRoute._id"] },
            ],
          },
        },
      },
    })
    .addFields({
      outdatedRedundantRoutes: {
        $filter: {
          input: "$outdatedRoutes",
          cond: {
            $anyElementTrue: {
              $map: {
                input: "$routes",
                as: "testedRoute",
                in: {
                  $and: [
                    { $eq: [{ $type: ["$$this.routeLabel"] }, "missing"] },
                    { $ne: ["$$testedRoute._id", "$$this._id"] },
                    {
                      $eq: [
                        { $ceil: "$$this.timeLeft" },
                        { $ceil: "$$testedRoute.timeLeft" },
                      ],
                    },
                    { $eq: ["$$this.points", "$$testedRoute.points"] },
                  ],
                },
              },
            },
          },
        },
      },
    })
    .group({
      _id: "$setName",
      levelsN: { $sum: 1 },
      routesN: { $sum: { $size: "$routes" } },
      outdatedRoutes: { $sum: { $size: "$outdatedRoutes" } },
      outdatedRedundantRoutes: { $sum: { $size: "$outdatedRedundantRoutes" } },
      totalTime: { $sum: { $ceil: "$mainlineTimeRoute.timeLeft" } },
      totalScore: { $sum: "$mainlineScoreRoute.points" },
      totalBoldTime: { $sum: "$boldTime" },
      totalBoldScore: { $sum: "$boldScore" },
      boldTimes: boolSum("$isBoldTime"),
      boldScores: boolSum("$isBoldScore"),
      boldPlusTimes: boolSum("$isBPlusTime"),
      boldPlusScores: boolSum("$isBPlusScore"),
      bimetricRoutes: boolSum("$isMainlineBimetric"),
      routelessLevels: boolSum("$isRouteless"),
    })
    .sort("_id")
  const userCount = await User.count()
  const totalRoutes = triviaBySet.reduce((acc, val) => acc + val.routesN, 0)
  res.contentType("application/json")
  res.write(
    stringify({
      userCount,
      totalRoutes,
      triviaBySet,
    })
  )
  res.end()
})
