import { Level } from "./levels.js"
import { RouteSubmission } from "./routes.js"
import {
  LevelDoc,
  RouteSchema,
  RouteSubDoc,
  UserDoc,
  findMainlineRoute,
  scoreComparator,
  timeComparator,
} from "./schemata.js"
import { formatTime, formatTimeImprovement } from "./utils.js"

function getDiscordSubmissionWebhookUrls() {
  return process.env.DISCORD_SUBMISSIONS_WEBHOOK_URLS?.split(" ") ?? []
}
function getDiscordNewUserWebhookUrls() {
  return process.env.DISCORD_NEW_USER_WEBHOOK_URLS?.split(" ") ?? []
}

function makeLevelName(doc: LevelDoc): string {
  return `${doc.setName!.toUpperCase()} #${doc.levelN!}: ${doc.title!}`
}

function formatTimeBoldImprovement(thisTime: number, boldTime: number): string {
  return (Math.ceil(thisTime) - Math.ceil(boldTime)).toString()
}

function writeMetric(
  suffix: string,
  thisVal: number,
  boldVal: number,
  format: (val: number) => string = val => val.toString(),
  formatBoldImprovement: (thisVal: number, boldVal: number) => string = (
    thisVal,
    boldVal
  ) => (thisVal - boldVal).toString()
) {
  return Math.ceil(thisVal) < Math.ceil(boldVal)
    ? `${format(thisVal)}${suffix} (b-${-formatBoldImprovement(
        thisVal,
        boldVal
      )})`
    : Math.ceil(thisVal) === Math.ceil(boldVal)
      ? `**${format(thisVal)}${suffix} (b)**`
      : `***${format(thisVal)}${suffix} (b+${formatBoldImprovement(
          thisVal,
          boldVal
        )})***`
}

function formatSubmission(
  level: LevelDoc,
  route: RouteSubDoc,
  // Need to know all routes in this submission to know which old route we should be comparing
  // ourselves against
  allRoutes: RouteSubDoc[]
): string | null {
  // Which metrics the route should be reported as being good as, `null` means all metrics
  let routeMetrics: string | null
  let routeImprovement = ""

  const isRouteMainlineTime = level.mainlineTimeRoute?.id === route.id
  const oldTimeRoute = findMainlineRoute(level, timeComparator, allRoutes)

  const isRouteMainlineScore = level.mainlineScoreRoute?.id === route.id
  const oldScoreRoute = findMainlineRoute(level, scoreComparator, allRoutes)

  if (level.setName === "cc1") {
    routeMetrics = null
    if (oldTimeRoute) {
      routeImprovement = `, an improvement of ${formatTimeImprovement(
        route.timeLeft! - oldTimeRoute.timeLeft!
      )}s`
    }
  } else if (isRouteMainlineTime === isRouteMainlineScore) {
    // This route is either better than both old time/score metrics, or not better than anything,
    // so we don't have any improvement or metric to show
    routeMetrics = null
  } else {
    const oldRoute = isRouteMainlineScore ? oldScoreRoute : oldTimeRoute
    routeMetrics = isRouteMainlineScore ? "score" : "time"
    // NOTE: This returns funny results when a route targeting one metric is submitted
    // when there's a generic mainline route, such as "an improvement of -2s / 80pts",
    // but I figure that's fine.
    if (oldRoute) {
      routeImprovement = `, an improvement of ${formatTimeImprovement(
        route.timeLeft! - oldRoute.timeLeft!
      )}s / ${route.points! - oldRoute.points!}pts`
    }
  }
  const scorePart = ` / ${writeMetric("pts", route.points!, level.boldScore!)}`
  return `• [New **${route.routeLabel ? `"${route.routeLabel}" ` : ""}${route.isMainline ? "mainline" : "__non-mainline__"}${routeMetrics ? ` ${routeMetrics}` : ""}** route: ${writeMetric(
    "s",
    route.timeLeft!,
    level.boldTime!,
    formatTime,
    formatTimeBoldImprovement
  )}${
    level.setName === "cc1" ? "" : scorePart
  }${routeImprovement}](https://glander.club/railroad/#${level.setName!}-${route.id!})`
}

function findRouteDocs(
  subs: RouteSubmission[]
): Map<RouteSubmission, RouteSubDoc> {
  const res = new Map<RouteSubmission, RouteSubDoc>()
  for (const sub of subs) {
    const doc = sub.level.routes.find(
      route =>
        route.createdAt === sub.route.createdAt &&
        route.routeLabel === sub.route.routeLabel &&
        route.timeLeft === sub.route.timeLeft &&
        route.points === sub.route.points
    )
    if (!doc)
      throw new Error("Failed to find a document right after creating it??")

    res.set(sub, doc)
  }
  return res
}

export async function announceNewRouteSubmissions(
  submissions: RouteSubmission[],
  submittingUser: UserDoc
): Promise<void> {
  const subLevels = await Promise.all(
    submissions
      .map(sub => sub.level)
      // Unique levels only
      .filter((lvl, i, arr) => arr.findIndex(flvl => flvl.id === lvl.id) === i)
      .sort((a, b) => (a.levelN ?? 0) - (b.levelN ?? 0))
      .sort((a, b) => a.setName!.localeCompare(b.setName!))
      // Have to refetch because if there were two routes for the same level,
      // we'd only grab one copy of the level document, which will contain all old
      // routes *and* our current route, excluding the other routes uploaded this
      // submission
      .map<Promise<LevelDoc | null>>(lvl => Level.findOne({ _id: lvl._id }))
  )

  // Find the route *documents*, not just the schema(ta), since we need to know
  // the dynamically-generated ids. Don't think there's a less stupid way of
  // doing this, since `bulkSave` doesn't give subdoc IDs, as far as I can tell.
  // (wow I love MongoDB so much)
  const routeDocMap = findRouteDocs(submissions)
  const allRoutes = Array.from(routeDocMap.values())

  const fields: any[] = []

  let processedSubmissions = 0

  for (const level of subLevels) {
    if (!level) continue
    const fieldName = makeLevelName(level)
    const subs = submissions.filter(sub => sub.level.id === level.id)
    processedSubmissions += subs.length
    const fieldValue = subs
      .map(sub => formatSubmission(level, routeDocMap.get(sub)!, allRoutes))
      .join("\n")

    fields.push({ name: fieldName, value: fieldValue })
    if (fields.length === 24 && subLevels.length > 25) break
  }

  const unprocessedLevels = subLevels.length - fields.length

  if (unprocessedLevels > 0) {
    fields.push({
      name: `And ${unprocessedLevels} other levels`,
      value: `with **${submissions.length - processedSubmissions}** new routes`,
    })
  }

  const embed = {
    title: `New route${submissions.length > 1 ? "s" : ""}!`,
    color: 0xffff00,
    fields,
    author: {
      name: `Submission${
        submissions.length > 1 ? "s" : ""
      } by ${submittingUser.userName!}`,
    },
    timestamp: new Date().toISOString(),
  }
  const fullMessage = {
    content: null,
    embeds: [embed],
    attachments: [],
  }
  for (const url of getDiscordSubmissionWebhookUrls()) {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(fullMessage),
      headers: { "Content-Type": "application/json" },
    })
  }
}

export async function announceNewUser(user: UserDoc): Promise<void> {
  const fullMessage = {
    content: `New user: ${user.userName}`,
    embeds: [],
    attachments: [],
  }
  for (const url of getDiscordNewUserWebhookUrls()) {
    await fetch(url, {
      method: "POST",
      body: JSON.stringify(fullMessage),
      headers: { "Content-Type": "application/json" },
    })
  }
}
